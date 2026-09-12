import assert from "node:assert/strict";
import test from "node:test";
import { developmentVersion } from "../tools/pack-dev.mjs";

test("local versions target the next patch without changing the runtime release", () => {
  assert.equal(developmentVersion("1.0.3", "abcdef0123456789", new Date("2026-09-07T04:05:06.007Z")),
    "1.0.4-dev.20260907040506007.gabcdef012345");
  assert.equal(developmentVersion("2.1.9", "abcdef0123456789", new Date("2026-09-07T04:05:06.008Z")),
    "2.1.10-dev.20260907040506008.gabcdef012345");
  assert.throws(() => developmentVersion("1.0.3-dev.1", "abc"), /stable/);
  assert.throws(() => developmentVersion("../1.0.3", "abc"), /stable/);
});


import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyIntegrity, extractPublishedPackage } from "../tools/prepare-dev-from-npm.mjs";

function integrity(bytes) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

test("published development input rejects changed bytes before extraction", () => {
  const bytes = Buffer.from("official tarball bytes");
  verifyIntegrity(bytes, integrity(bytes));
  assert.throws(() => verifyIntegrity(Buffer.from("changed"), integrity(bytes)), /integrity mismatch/);
  assert.throws(() => verifyIntegrity(bytes, "sha1-abc"), /SHA-512/);
});

test("published development input checks package identity and preserved artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "zeroperl-published-dev-"));
  try {
    const dir = join(root, "package");
    await mkdir(dir);
    const requested = { name: "@webdyne/webdyne-zeroperl-5.44.0", runtime: "1.0.9", perl: "5.44.0" };
    const artifact = (filename, content) => ({ filename, sha256: createHash("sha256").update(content).digest("hex") });
    await writeFile(join(dir, "package.json"), JSON.stringify({name: requested.name, version: requested.runtime}));
    const manifest = { releaseVersion: requested.runtime, perlVersion: requested.perl,
      artifacts: {wasm: artifact("runtime.wasm", "wasm fixture")},
      npmPackage: {name: requested.name, version: requested.runtime, runtimeNotices: artifact("NOTICES", "notices fixture")} };
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
    await writeFile(join(dir, "runtime.wasm"), "wasm fixture");
    await writeFile(join(dir, "NOTICES"), "notices fixture");
    const tarball = join(root, "input.tgz");
    execFileSync("tar", ["-czf", tarball, "-C", root, "package/package.json", "package/manifest.json", "package/runtime.wasm", "package/NOTICES"]);
    const bytes = await readFile(tarball);
    await extractPublishedPackage(bytes, integrity(bytes), join(root, "good"), requested);
    await assert.rejects(extractPublishedPackage(bytes, integrity(bytes), join(root, "wrong"), {...requested, runtime: "1.0.8"}), /identity/);
    await writeFile(join(dir, "runtime.wasm"), "changed wasm");
    execFileSync("tar", ["-czf", tarball, "-C", root, "package/package.json", "package/manifest.json", "package/runtime.wasm", "package/NOTICES"]);
    const changed = await readFile(tarball);
    await assert.rejects(extractPublishedPackage(changed, integrity(changed), join(root, "changed"), requested), /SHA-256 mismatch/);
  } finally { await rm(root, {recursive: true, force: true}); }
});
