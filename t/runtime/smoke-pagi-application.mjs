// Run: node t/runtime/smoke-pagi-application.mjs /path/to/runtime.wasm
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApplicationArchives } from "../../scripts/build-vfs.mjs";
register("./perl-source-loader.mjs", import.meta.url);
const { createWebDyneRuntime } = await import("../../js/runtime/webdyne-runtime.js");
const root = await mkdtemp(join(tmpdir(), "zeroperl-pagi-"));
const interpreters = [];
try {
  await mkdir(join(root, "app"));
  await writeFile(join(root, "app/app.pagi"), `
use Future::AsyncAwait;
my $starts=0;
async sub {
    my ($scope_hr, $receive_cr, $send_cr)=@_;
    die "WebDyne loaded" if grep { /^WebDyne(?:\\/|\\.pm)/ } keys %INC;
    if ($scope_hr->{'type'} eq 'lifespan') {
        await $receive_cr->();
        ++$starts;
        await $send_cr->({type => 'lifespan.startup.complete'});
        await $receive_cr->();
        return;
    }
    await $send_cr->({type => 'http.response.start', status => 200, headers => [['content-type','text/plain']]});
    await $send_cr->({type => 'http.response.body', body => "$starts:$scope_hr->{'type'}:$scope_hr->{'path'}", more_body => 0});
};
`);
  const files = await buildApplicationArchives({ projectRoot: root, appDirectory: "app", outputDirectory: join(root, "out") });
  const runtime = createWebDyneRuntime({
    zeroperlModule: await WebAssembly.compile(await readFile(process.argv[2])),
    appVfsArchive: new Uint8Array(await readFile(files.appVfsArchive)).buffer,
    perlLibraryVfsArchive: new Uint8Array(await readFile(files.perlLibraryVfsArchive)).buffer,
    extensions: [{ register(perl) { interpreters.push(perl); } }],
  });
  async function request(path) {
    const result = runtime.dispatch(new Request(`http://localhost${path}`), { WEBDYNE_INDEX: "app.pagi" });
    const response = await result.response;
    assert.equal(response.status, 200);
    assert.equal(await response.text(), `1:http:${path}`);
    await result.completion;
  }
  await Promise.all([request("/"), request("/deep/route"), request("/missing.psp")]);
  await request("/warm");
  console.log("PASS: PAGI startup once, arbitrary paths, concurrent and warm requests, no WebDyne loaded");
} finally {
  for (const perl of interpreters) await perl.dispose();
  await rm(root, { recursive: true, force: true });
}
