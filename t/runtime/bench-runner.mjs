// node t/runtime/bench-runner.mjs native|artifact.wasm runner.pl
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { MemoryFileSystem, ZeroPerl } from "../../js/zeroperl.js";

const [target, runner] = process.argv.slice(2);
if (!target || !runner) throw new Error("Supply native|artifact.wasm and runner.pl");
const cases = [["sse", 10000], ["body64k", 200], ["poll", 10000], ["lifecycle", 2000]];
const calls = cases.map(([name, count]) => `RunnerBench::run('${name}', ${count});`).join("\n");
const fixture = resolve("t/runtime/bench-runner.pl");
if (target === "native") {
  const result = spawnSync("perl", ["-e", `require $ARGV[0]; require $ARGV[1]; ${calls}`, resolve(runner), fixture], { encoding: "utf8" });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status ?? 1);
} else {
  const fileSystem = new MemoryFileSystem();
  fileSystem.addFile("/runner.pl", await readFile(runner));
  fileSystem.addFile("/bench.pl", await readFile(fixture));
  const perl = await ZeroPerl.create({
    wasmModule: await WebAssembly.compile(await readFile(target)), fileSystem,
    stdout: chunk => process.stdout.write(chunk), stderr: chunk => process.stderr.write(chunk),
  });
  try {
    const result = await perl.eval(`require '/runner.pl'; require '/bench.pl'; ${calls}`);
    if (!result.success) throw new Error(result.error);
  } finally { await perl.dispose(); }
}
