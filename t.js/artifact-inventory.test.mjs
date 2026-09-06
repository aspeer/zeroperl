import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { directoryInventory } from "../tools/artifact-inventory.mjs";

test("npm packaging rejects a changed prefix even when file counts and sizes match", async () => {
  const root = await mkdtemp(join(tmpdir(), "zeroperl-prefix-"));
  try {
    const prefix = join(root, "prefix");
    const module = join(prefix, "lib/5.44.0/Example.pm");
    await mkdir(join(prefix, "lib/5.44.0/wasm32-wasi"), {recursive: true});
    await writeFile(module, "original");
    const bytes = Buffer.from("fixture");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(join(root, "runtime.wasm"), bytes);
    await writeFile(join(root, "reactor.wasm"), bytes);
    await mkdir(join(root, "third-party-notices"));
    await writeFile(join(root, "third-party-notices/LICENSE"), bytes);
    await writeFile(join(root, "third-party-notices/inventory.json"), JSON.stringify({files: [{path: "LICENSE", sha256, bytes: bytes.length}]}));
    execFileSync("tar", ["-czf", join(root, "notices.tar.gz"), "-C", root, "third-party-notices"]);
    const noticeBytes = await readFile(join(root, "notices.tar.gz"));
    const noticeHash = createHash("sha256").update(noticeBytes).digest("hex");
    await writeFile(join(root, "manifest.json"), JSON.stringify({
      perlVersion: "5.44.0", buildNumber: 1,
      artifacts: {wasm: {sha256}, reactor: {sha256}, notices: {filename: "notices.tar.gz", sha256: noticeHash}, prefix: {directory: "prefix", ...await directoryInventory(prefix)}},
    }));
    const args = ["tools/prepare-npm-package.mjs", "--source", root, "--destination", join(root, "package"),
      "--manifest", "manifest.json", "--wasm", "runtime.wasm", "--reactor", "reactor.wasm"];
    execFileSync(process.execPath, args, {stdio: "pipe"});
    const metadata = JSON.parse(await readFile(join(root, "package/package.json"), "utf8"));
    assert.equal(metadata.license, "MIT");
    assert.equal(metadata.exports["./zeroperl-reactor.wasm"], undefined);
    assert.ok(!metadata.files.includes("reactor.wasm"));
    assert.ok(!metadata.files.includes("third-party-notices.tar.gz"));
    const packaged = await readdir(join(root, "package"));
    assert.ok(!packaged.includes("THIRD-PARTY-LICENSES.txt"));
    assert.ok(!packaged.includes("licenses"));
    assert.ok(!metadata.files.includes("licenses"));
    assert.match(await readFile(join(root, "package/THIRD-PARTY-NOTICES.md"), "utf8"), /releases\/download\/aspeer-zeroperl_1\.0\.1\/third-party-licenses-5\.44\.0-1\.0\.1\.tar\.gz/);
    const notice = JSON.parse(await readFile(join(root, "package/manifest.json"), "utf8")).npmPackage.notices;
    const archive = join(root, "release-licenses", notice.filename);
    assert.equal(createHash("sha256").update(await readFile(archive)).digest("hex"), notice.sha256);
    assert.match(execFileSync("tar", ["-xOzf", archive, "THIRD-PARTY-LICENSES.txt"], {encoding: "utf8"}), /fixture/);
    assert.match(execFileSync("tar", ["-tzf", archive], {encoding: "utf8"}), /licenses\/zeroperl-ts-LICENSE/);
    // Repacking cleans obsolete on-disk payloads and produces identical licences.
    await mkdir(join(root, "package/licenses"));
    await writeFile(join(root, "package/THIRD-PARTY-LICENSES.txt"), "stale");
    execFileSync(process.execPath, args, {stdio: "pipe"});
    assert.ok(!(await readdir(join(root, "package"))).includes("licenses"));
    assert.equal(createHash("sha256").update(await readFile(archive)).digest("hex"), notice.sha256);
    assert.ok(!(await readFile(join(root, "package/index.js"), "utf8")).includes("reactorWasmUrl"));
    await writeFile(join(root, "notices.tar.gz"), "changed");
    assert.throws(() => execFileSync(process.execPath, args, {stdio: "pipe"}), error => {
      assert.match(error.stderr.toString(), /Attribution evidence checksum does not match/);
      return true;
    });
    await writeFile(join(root, "notices.tar.gz"), noticeBytes);
    await writeFile(module, "modified");
    assert.throws(() => execFileSync(process.execPath, args, {stdio: "pipe"}), error => {
      assert.match(error.stderr.toString(), /Prefix sha256 does not match/);
      return true;
    });
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
