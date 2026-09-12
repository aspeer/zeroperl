import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync } from "fflate";
import { unpackTar } from "modern-tar";

export function verifyIntegrity(bytes, integrity) {
  if (typeof integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) {
    throw new Error("Official npm package requires a SHA-512 integrity value");
  }
  if (`sha512-${createHash("sha512").update(bytes).digest("base64")}` !== integrity) {
    throw new Error("Official npm package integrity mismatch");
  }
}

export async function extractPublishedPackage(bytes, integrity, destination, { name, runtime, perl }) {
  verifyIntegrity(bytes, integrity);
  const entries = await unpackTar(gunzipSync(bytes), { strict: true });
  const seen = new Set();
  for (const { header, data } of entries) {
    const path = header.name.replace(/\/$/, "");
    if (!path.startsWith("package/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..") || seen.has(path)) {
      throw new Error("Unsafe or duplicate npm archive path");
    }
    seen.add(path);
    const target = join(destination, path.slice("package/".length));
    if (header.type === "directory") await mkdir(target, { recursive: true });
    else if (header.type === "file" && data) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data, { mode: header.mode ?? 0o644 });
    } else throw new Error("Unsupported npm archive entry");
  }
  const pkg = JSON.parse(await readFile(join(destination, "package.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"));
  if (pkg.name !== name || pkg.version !== runtime || manifest.releaseVersion !== runtime || manifest.perlVersion !== perl || manifest.npmPackage.name !== name || manifest.npmPackage.version !== runtime) {
    throw new Error("Published package identity does not match requested runtime");
  }
  for (const artifact of [manifest.artifacts.wasm, manifest.npmPackage.runtimeNotices]) {
    if (!artifact || typeof artifact.filename !== "string" || /[\\/]/.test(artifact.filename) || artifact.filename === "..") throw new Error("Invalid published artifact filename");
    const hash = createHash("sha256").update(await readFile(join(destination, artifact.filename))).digest("hex");
    if (hash !== artifact.sha256) throw new Error("Published artifact SHA-256 mismatch");
  }
  return manifest;
}

export async function prepareDevelopmentFromNpm({ root, work, prepared, runtime, perl }) {
  const name = `@webdyne/webdyne-zeroperl-${perl}`;
  const spec = `${name}@${runtime}`;
  const registry = "https://registry.npmjs.org";
  const cache = join(work, "npm-cache");
  const metadata = JSON.parse(execFileSync("npm", ["view", spec, "dist", "--json", "--registry", registry, "--cache", cache], { encoding: "utf8" }));
  const [pack] = JSON.parse(execFileSync("npm", ["pack", spec, "--json", "--ignore-scripts", "--registry", registry, "--cache", cache, "--pack-destination", work], { encoding: "utf8" }));
  const bytes = await readFile(join(work, pack.filename));
  await extractPublishedPackage(bytes, metadata.integrity, prepared, { name, runtime, perl });
  // Reuse the released bridge, WASM, inventory, dependency metadata and licences.
  // Only the portable source layer is overlaid; this mode cannot test XS/ABI edits.
  for (const directory of ["bin", "lib", "scripts", "js/runtime", "js/provider", "js/transport"]) {
    await rm(join(prepared, directory), { recursive: true, force: true });
    await cp(join(root, directory), join(prepared, directory), { recursive: true });
  }
  await cp(join(root, "js/worker.js"), join(prepared, "js/worker.js"));
  return { name, version: runtime, integrity: metadata.integrity, tarball: metadata.tarball };
}
