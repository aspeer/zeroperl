// Run: node t/runtime/smoke-lifespan-callbacks.mjs qualified.wasm /path/to/pm-WebDyne/lib
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApplicationArchives } from "../../scripts/build-vfs.mjs";
import { generatedWranglerConfig } from "../../scripts/webdyne-cloudflare.mjs";
register("./perl-source-loader.mjs", import.meta.url);
const { createWebDyneRuntime } = await import("../../js/runtime/webdyne-runtime.js");
if (!process.argv[3]) throw new Error("Supply WASM artifact and updated WebDyne library directory");
const zeroperlModule = await WebAssembly.compile(await readFile(process.argv[2]));
const root = await mkdtemp(join(tmpdir(), "lifespan-callbacks-"));
const interpreters = [];
const errors = [];
const originalError = console.error;
console.error = (...args) => errors.push(args);
try {
  await mkdir(join(root, "app"));
  await mkdir(join(root, "lib/WebDyne"), {recursive: true});
  await cp(new URL("../fixtures/lifespan/My", import.meta.url), join(root, "lib/My"), {recursive: true});
  await writeFile(join(root, "app/app.psp"), '<start_html><perl>print "startup-count=$My::App::STARTS"</perl>');
  const project = {packageJson: {name: "lifespan-callbacks"}, webdyne: {lifespan: {startup: "My::App::startup", shutdown: "My::App::shutdown"}}, cloudflare: {}};
  const configPath = await generatedWranglerConfig(root, project, {entry: "app.psp"}, root);
  const bindings = JSON.parse(await readFile(configPath, "utf8")).vars;
  async function runtime(overlay) {
    if (overlay) await cp(join(process.argv[3], "WebDyne/PAGI.pm"), join(root, "lib/WebDyne/PAGI.pm"));
    const files = await buildApplicationArchives({projectRoot: root, appDirectory: "app", libraryDirectories: ["lib"], outputDirectory: join(root, "out")});
    return createWebDyneRuntime({
      zeroperlModule,
      appVfsArchive: new Uint8Array(await readFile(files.appVfsArchive)).buffer,
      perlLibraryVfsArchive: new Uint8Array(await readFile(files.perlLibraryVfsArchive)).buffer,
      extensions: [{register(perl) { interpreters.push(perl); }}],
    });
  }
  async function request(app, env = bindings) {
    const result = app.dispatch(new Request("http://localhost/app.psp"), env);
    const response = await result.response;
    const body = await response.text();
    await result.completion;
    return {status: response.status, body};
  }
  // An old artifact must not silently accept callback settings it cannot execute.
  const old = await runtime(false);
  assert.equal((await request(old)).status, 500);
  assert.match(JSON.stringify(errors), /require updated WebDyne/);
  console.log("PASS: old embedded core reports unsupported callbacks");

  const app = await runtime(true);
  const env = {...bindings, WEBDYNE_TEST_STARTUP_DELAY: "1"};
  const responses = await Promise.all([request(app, env), request(app, env), request(app, env)]);
  responses.push(await request(app, env));
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.match(response.body, /startup-count=1/);
  }
  console.log("PASS: configured async startup completes once before cold and warm PSP requests");
  for (const [startup, diagnostic] of [["My::App::missing", /not defined/], ["Missing::LifespanFixture::startup", /Unable to load lifespan callback/]]) {
    const invalid = await runtime(true);
    assert.equal((await request(invalid, {...bindings, WEBDYNE_STARTUP: startup})).status, 500);
    assert.match(JSON.stringify(errors), diagnostic);
  }
  const failed = await runtime(true);
  assert.equal((await request(failed, {...bindings, WEBDYNE_TEST_STARTUP_FAIL: "1"})).status, 500);
  assert.match(JSON.stringify(errors), /callback fixture failed/);
  console.log("PASS: missing modules/functions and callback errors block requests");
} catch (error) {
  originalError(JSON.stringify(errors, null, 2));
  throw error;
} finally {
  console.error = originalError;
  for (const perl of interpreters) await perl.dispose();
  await rm(root, {recursive: true, force: true});
}
