// Run: node t/runtime/smoke-lifespan.mjs /path/to/qualified-perl-5.44.wasm
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApplicationArchives } from "../../scripts/build-vfs.mjs";

register("./perl-source-loader.mjs", import.meta.url);
const { createWebDyneRuntime } = await import("../../js/runtime/webdyne-runtime.js");
if (!process.argv[2]) throw new Error("Supply a qualified Perl WASM artifact path");
const zeroperlModule = await WebAssembly.compile(await readFile(process.argv[2]));
const root = await mkdtemp(join(tmpdir(), "zeroperl-lifespan-"));
const bytes = async (path) => new Uint8Array(await readFile(path)).buffer;
const interpreters = [];
const errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args); };
try {
  await mkdir(join(root, "app"));
  await writeFile(join(root, "app/app.psp"), '<start_html><p>lifespan page</p>');
  const archives = await buildApplicationArchives({
    projectRoot: root, appDirectory: "app", outputDirectory: join(root, "out"),
  });
  const assets = {
    zeroperlModule,
    appVfsArchive: await bytes(archives.appVfsArchive),
    perlLibraryVfsArchive: await bytes(archives.perlLibraryVfsArchive),
  };

  function createRuntime(fixture = "") {
    let startups = 0;
    let generations = 0;
    const runtime = createWebDyneRuntime({ ...assets, extensions: [{
      register(perl) {
        generations++;
        interpreters.push(perl);
        const send = perl.registerFunction.bind(perl);
        send("lifespan_test_started", () => { startups++; return perl.createUndef(); });
        const runFile = perl.runFile.bind(perl);
        perl.runFile = async (path) => {
          const result = await runFile(path);
          if (!result.success || !path.endsWith("webdyne-app.pl")) return result;
          // Wrap only the test interpreter; production still calls the real app.
          return perl.eval(`
            use Future::AsyncAwait;
            my $original_cr=\\&Pagi::WebDyne::application;
            no warnings 'redefine';
            *Pagi::WebDyne::application=async sub {
              my ($scope_hr, $receive_cr, $send_cr)=@_;
              if ($scope_hr->{'type'} eq 'lifespan') {
                main::lifespan_test_started();
                ${fixture}
              }
              return await $original_cr->($scope_hr, $receive_cr, $send_cr);
            };
          `);
        };
      },
    }] });
    return { runtime, startups: () => startups, generations: () => generations };
  }

  async function request(runtime, failure) {
    const result = runtime.dispatch(new Request("http://localhost/app.psp"));
    const response = await result.response;
    const body = await response.text();
    if (failure) await assert.rejects(result.completion, failure);
    else await result.completion;
    return { status: response.status, body };
  }

  const normal = createRuntime();
  const cold = await Promise.all(Array.from({ length: 3 }, () => request(normal.runtime)));
  for (const result of cold) {
    assert.equal(result.status, 200);
    assert.match(result.body, /lifespan page/);
  }
  assert.equal((await request(normal.runtime)).status, 200);
  assert.equal(normal.startups(), 1, "concurrent and warm requests share startup");
  console.log("PASS: actual WebDyne startup, concurrent first requests and warm request");

  const failed = createRuntime(`
    await $receive_cr->();
    await $send_cr->({type => 'lifespan.startup.failed', message => 'fixture startup failure'});
    return;
  `);
  const failures = await Promise.all([request(failed.runtime, /fixture startup failure/), request(failed.runtime, /fixture startup failure/)]);
  for (const result of failures) {
    assert.equal(result.status, 500);

  }
  assert.match(JSON.stringify(errors), /fixture startup failure/);
  assert.equal(failed.startups(), 1);
  assert.equal((await request(failed.runtime, /fixture startup failure/)).status, 500);
  assert.equal(failed.generations(), 2, "a replacement interpreter runs startup again");
  console.log("PASS: failed startup blocks requests and a replacement reruns startup");

  for (const fixture of ["return;", 'die "lifespan unsupported\\n";', "await $receive_cr->(); return;"]) {
    const unsupported = createRuntime(fixture);
    const results = await Promise.all(Array.from({ length: 3 }, () => request(unsupported.runtime)));
    for (const result of results) {
      assert.equal(result.status, 200);
      assert.match(result.body, /lifespan page/);
    }
    assert.equal((await request(unsupported.runtime)).status, 200);
    assert.equal(unsupported.startups(), 1);
    assert.equal(unsupported.generations(), 1, "unsupported lifespan does not retire the interpreter");
  }
  console.log("PASS: unsupported lifespan permits concurrent and warm HTTP requests");

  const invalid = createRuntime(`
    await $receive_cr->();
    await $send_cr->({type => 'http.response.start'});
  `);
  assert.equal((await request(invalid.runtime, /Unexpected PAGI lifespan event/)).status, 500);
  assert.match(JSON.stringify(errors), /Unexpected PAGI lifespan event/);
  console.log("PASS: invalid lifespan response blocks requests");

  const delayed = createRuntime("await Future::IO->sleep(0.02);");
  assert.equal((await request(delayed.runtime)).status, 200);
  console.log("PASS: asynchronous startup can resume through the session timer bridge");

  const stalled = createRuntime("await $receive_cr->(); await $receive_cr->();");
  const timeout = await request(stalled.runtime, /startup timed out/);
  assert.equal(timeout.status, 500);
  assert.match(JSON.stringify(errors), /startup timed out/);
  console.log("PASS: missing startup acknowledgement times out");
} catch (error) {
  originalError(JSON.stringify(errors, null, 2));
  throw error;
} finally {
  console.error = originalError;
  for (const perl of interpreters) await perl.dispose();
  await rm(root, { recursive: true, force: true });
}
