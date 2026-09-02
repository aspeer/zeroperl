import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const worker = await readFile(new URL("../js/worker.js", import.meta.url), "utf8");
const packageBuilder = await readFile(new URL("../tools/prepare-npm-package.mjs", import.meta.url), "utf8");

test("the Cloudflare Worker has no private package dependencies", () => {
  assert.doesNotMatch(worker, /@aspeer\//);
  assert.doesNotMatch(worker, /D1HostBridge/);
  assert.match(worker, /export function createWebDyneWorker/);
});

test("the npm builder includes only the named runtime directories", () => {
  for (const directory of ["bin", "js", "lib", "script"]) {
    assert.match(packageBuilder, new RegExp(`resolve\\(destination, "${directory}"\\)`));
  }
  assert.doesNotMatch(packageBuilder, /resolve\(destination, "t(?:\.js)?"\)/);
});

test("the packaged bridge exposes the Worker runtime primitives", async () => {
  const bridge = await import(new URL("../js/zeroperl.js", import.meta.url));
  assert.equal(typeof bridge.ZeroPerl, "function");
  assert.equal(typeof bridge.MemoryFileSystem, "function");
});
