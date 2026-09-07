// node t/runtime/test-runner-json.mjs artifact.wasm
import { readFile, readdir } from "node:fs/promises";
import { MemoryFileSystem, ZeroPerl } from "../../js/zeroperl.js";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
const fileSystem = new MemoryFileSystem();
fileSystem.addFile("/runner.pl", await readFile("bin/pagi-runner.pl"));
fileSystem.addFile("/runner-json.t", await readFile("t/runtime/runner-json.t"));
// Test::More is deliberately absent from the production WASM prefix.
// Mount its native pure-Perl test libraries only for this test process.
const testRoot = dirname(dirname(execFileSync("perl", ["-MTest::More", "-e", 'print $INC{"Test/More.pm"}'], { encoding: "utf8" })));
async function mount(source, target) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const dest = `${target}/${entry.name}`;
    if (entry.isDirectory()) await mount(join(source, entry.name), dest);
    else fileSystem.addFile(dest, await readFile(join(source, entry.name)));
  }
}
await mount(join(testRoot, "Test"), "/testlib/Test");
await mount(join(testRoot, "Test2"), "/testlib/Test2");
let output = "";
const perl = await ZeroPerl.create({
  wasmModule: await WebAssembly.compile(await readFile(process.argv[2])), fileSystem,
  env: { PAGI_RUNNER: "/runner.pl", PERL5LIB: "/testlib" },
  stdout: chunk => { output += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); process.stdout.write(chunk); },
  stderr: chunk => process.stderr.write(chunk),
});
try {
  // WASI cannot dup stdout/stderr; Test2 can write to scalar handles instead.
  const result = await perl.eval(`
    $|=1;
    my ($out, $err)=('', '');
    {
      local *STDOUT; local *STDERR;
      open(STDOUT, '>', \\$out) or die $!;
      open(STDERR, '>', \\$err) or die $!;
      do '/runner-json.t'; die $@ if $@;
    }
    print $out; print STDERR $err;
  `);
  if (!result.success || /^not ok/m.test(output) || !/^1\.\.\d+/m.test(output)) {
    throw new Error(result.error || "Runner JSON TAP failed");
  }
} finally { await perl.dispose(); }
