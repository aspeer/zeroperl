#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { prepareDevelopmentFromNpm } from "./prepare-dev-from-npm.mjs";

export function developmentVersion(runtimeVersion, revision, date = new Date()) {
  const parts = runtimeVersion.split(".");
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(runtimeVersion)) {
    throw new Error("Runtime version must be a stable major.minor.patch version");
  }
  parts[2] = String(Number(parts[2]) + 1);
  const stamp = date.toISOString().replace(/\D/g, "");
  return `${parts.join(".")}-dev.${stamp}.g${revision.slice(0, 12)}`;
}

export async function main(args = process.argv.slice(2)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const release = JSON.parse(await readFile(join(root, "release/versions.json"), "utf8"));
  const { values } = parseArgs({ args, options: {
    "from-npm": { type: "boolean", default: false },
    "perl-version": { type: "string", default: "5.44.0" },
    "runtime-version": { type: "string", default: release.version },
  } });
  const perl = values["perl-version"];
  const runtime = values["runtime-version"];
  if (!release.supportedPerlVersions.includes(perl)) throw new Error(`Unsupported Perl: ${perl}`);
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const version = developmentVersion(runtime, revision);
  const dirty = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim());
  const source = join(root, "output", perl);
  const manifestName = `manifest-${perl}-${runtime}.json`;

  const destination = join(root, "dist/dev");
  await mkdir(destination, { recursive: true });
  const work = await mkdtemp(join(destination, "work-"));
  const prepared = join(work, "package");
  try {
    let publishedPackage;
    if (values["from-npm"]) {
      publishedPackage = await prepareDevelopmentFromNpm({ root, work, prepared, runtime, perl });
    } else {
      const original = JSON.parse(await readFile(join(source, manifestName), "utf8"));
      execFileSync(process.execPath, ["tools/prepare-npm-package.mjs",
        "--source", source, "--destination", prepared, "--manifest", manifestName,
        "--wasm", original.artifacts.wasm.filename, "--reactor", original.artifacts.reactor.filename,
      ], { cwd: root, stdio: "inherit" });
    }
    const packagePath = join(prepared, "package.json");
    const pkg = JSON.parse(await readFile(packagePath, "utf8"));
    pkg.version = version;
    pkg.private = true;
    await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
    const manifestPath = join(prepared, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.npmPackage.version = version;
    manifest.npmPackage.development = { revision, dirty, runtimeVersion: runtime, ...(publishedPackage ? { publishedPackage, overlay: ["bin", "lib", "scripts", "js/runtime", "js/provider", "js/transport", "js/worker.js"] } : {}) };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const readmePath = join(prepared, "README.md");
    const readme = await readFile(readmePath, "utf8");
    await writeFile(readmePath, `# Local development package ${version}\n\nThis private local package combines current checkout tooling with verified WASM\nfrom runtime release ${runtime}. It is not published to npm. Install the .tgz\nwith npm install, then run npx webdyne-cloudflare init. Runtime release links\nand attribution below describe the reused binary.\n\n${readme.replace(`Package version ${runtime}`, `Runtime package version ${runtime}`).replace(`npm install ${pkg.name}@${runtime}`, "npm install /absolute/path/to/the-development-package.tgz")}`);
    const inventory = execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", destination], {
      cwd: prepared, encoding: "utf8",
    });
    const [pack] = JSON.parse(inventory);
    const tarball = join(destination, pack.filename);
    const inventoryPath = `${tarball}.json`;
    await writeFile(inventoryPath, inventory);
    execFileSync(process.execPath, ["tools/check-npm-size.mjs", tarball, inventoryPath], { cwd: root, stdio: "inherit" });
    console.log(`\nLocal development tarball: ${tarball}\nVersion: ${version}\nRuntime: ${runtime}; tooling: ${revision}${dirty ? " (working tree changes included)" : ""}`);
    return tarball;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const invoked = process.argv[1] && await realpath(resolve(process.argv[1])).catch(() => undefined);
if (invoked === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
