#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

import { directoryInventory } from "./artifact-inventory.mjs";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArguments(arguments_) {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail(`Invalid argument near ${key ?? "end of command"}`);
    }
    values[key.slice(2)] = value;
  }
  return values;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function embeddedFileInventory(prefix, perlVersion) {
  const inventory = {};

  async function visit(root, directory) {
    for (const child of await readdir(directory, { withFileTypes: true })) {
      const filename = join(directory, child.name);
      if (child.isDirectory()) await visit(root, filename);
      else if (child.isFile()) {
        const modulePath = relative(root, filename).replaceAll("\\", "/");
        // Preserve @INC precedence: architecture-specific files are searched
        // before the portable library directory. Ambiguous later copies do
        // not replace the hash used for safe application-library deduplication.
        inventory[modulePath] ??= await sha256(filename);
      }
    }
  }

  for (const root of [
    resolve(prefix, `lib/${perlVersion}/wasm32-wasi`),
    resolve(prefix, `lib/${perlVersion}`),
  ]) {
    await visit(root, root);
  }
  return inventory;
}

const options = parseArguments(process.argv.slice(2));
for (const key of ["source", "destination", "manifest", "wasm", "reactor"]) {
  if (!options[key]) fail(`Missing --${key}`);
}

const source = resolve(options.source);
const destination = resolve(options.destination);
const sourceManifestPath = resolve(source, options.manifest);
const manifest = JSON.parse(await readFile(sourceManifestPath, "utf8"));
const perlVersion = String(manifest.perlVersion);
const buildNumber = Number(manifest.buildNumber);

if (!/^5\.(18\.4|36\.3|44\.0)$/.test(perlVersion)) {
  fail(`Unsupported Perl version in manifest: ${perlVersion}`);
}
if (!Number.isInteger(buildNumber) || buildNumber < 0) {
  fail(`Invalid build number in manifest: ${manifest.buildNumber}`);
}

const wasmPath = resolve(source, options.wasm);
const reactorPath = resolve(source, options.reactor);
if ((await sha256(wasmPath)) !== manifest.artifacts.wasm.sha256) {
  fail(`WASM checksum does not match ${options.manifest}`);
}
if ((await sha256(reactorPath)) !== manifest.artifacts.reactor.sha256) {
  fail(`Reactor checksum does not match ${options.manifest}`);
}

if (!manifest.artifacts.notices?.filename) fail("Manifest has no attribution evidence artifact");
const noticesPath = resolve(source, manifest.artifacts.notices.filename);
if ((await sha256(noticesPath)) !== manifest.artifacts.notices.sha256) {
  fail(`Attribution evidence checksum does not match ${options.manifest}`);
}

const packageName = `@webdyne/webdyne-zeroperl-${perlVersion}`;
const packageVersion = manifest.releaseVersion || `1.0.${buildNumber}`;
if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(packageVersion) || Number(packageVersion.split(".")[2]) !== buildNumber) {
  fail("Release version must be valid and its patch component must match buildNumber");
}
const wasmName = basename(options.wasm);
const reactorName = basename(options.reactor);
const prefixPath = resolve(source, manifest.artifacts.prefix.directory);
const prefixInventory = await directoryInventory(prefixPath);
for (const field of ["files", "bytes", "sha256"]) {
  if (prefixInventory[field] !== manifest.artifacts.prefix[field]) {
    fail(`Prefix ${field} does not match ${options.manifest}`);
  }
}
const embeddedFiles = await embeddedFileInventory(prefixPath, perlVersion);

const licenseDirectory = resolve(options["license-destination"] || resolve(destination, "..", "release-licenses"));
if (licenseDirectory === destination || licenseDirectory.startsWith(destination + "/")) {
  fail("Release licences must be outside the npm package directory");
}
const licenseName = `third-party-licenses-${perlVersion}-${packageVersion}.tar.gz`;
const licenseArchive = resolve(licenseDirectory, licenseName);
const noticePolicy = resolve(options["notice-policy"] || `release/licences/${perlVersion}.json`);
await mkdir(destination, { recursive: true });
const runtimeNotices = resolve(destination, "THIRD-PARTY-LICENSES.txt");
const embeddedInventoryPath = resolve(destination, "embedded-files.json");
await writeFile(embeddedInventoryPath, `${JSON.stringify(embeddedFiles, null, 2)}\n`);
// Review tooling needs the same verified payload inventory as normal packaging.
if (options["inventory-only"] === "true") process.exit(0);
execFileSync("python3", ["-B", fileURLToPath(new URL("./runtime-notices.py", import.meta.url)), noticesPath, noticePolicy, sourceManifestPath, runtimeNotices, embeddedInventoryPath], {stdio: "inherit"});
execFileSync("python3", ["-B", fileURLToPath(new URL("./release-licenses.py", import.meta.url)), noticesPath, licenseArchive, sourceManifestPath, runtimeNotices, noticePolicy], {stdio: "inherit"});
const releaseUrl = `https://github.com/aspeer/zeroperl/releases/tag/aspeer-zeroperl_${packageVersion}`;
const licenseUrl = `https://github.com/aspeer/zeroperl/releases/download/aspeer-zeroperl_${packageVersion}/${licenseName}`;
const licenseHash = await sha256(licenseArchive);
await writeFile(licenseArchive + ".sha256", `${licenseHash}  ${licenseName}\n`);

await mkdir(destination, { recursive: true });
// Remove payloads left by an earlier packaging run in this same destination.
for (const path of ["licenses", "third-party-notices.tar.gz", reactorName]) {
  await rm(resolve(destination, path), {recursive: true, force: true});
}
await Promise.all([
  copyFile(wasmPath, resolve(destination, wasmName)),
  copyFile(resolve("LICENSE"), resolve(destination, "LICENSE")),
  cp(resolve("bin"), resolve(destination, "bin"), { recursive: true }),
  cp(resolve("js"), resolve(destination, "js"), { recursive: true }),
  cp(resolve("lib"), resolve(destination, "lib"), { recursive: true }),
  cp(resolve("scripts"), resolve(destination, "scripts"), { recursive: true }),
]);
const packagedBridge = resolve(destination, "js/zeroperl.js");
await writeFile(packagedBridge, `/* Derived from zeroperl-ts; modified for WebDyne's WASI/Asyncify runtime.
 * Includes code bearing Copyright 2019 Google Inc. All Rights Reserved.
 * Apache-2.0; licence and attribution texts: ../THIRD-PARTY-LICENSES.txt.
 */\n${await readFile(packagedBridge, "utf8")}`);
await writeFile(resolve(destination, "THIRD-PARTY-NOTICES.md"), `# Third-party licences and notices

This runtime includes Perl, CPAN modules, WASI support libraries and the
ZeroPerl JavaScript bridge. These components retain their respective licences.
The top-level LICENSE covers this project's MIT-licensed source only.

Required licence texts, copyright notices and exceptions are included in
THIRD-PARTY-LICENSES.txt. Shared terms are deduplicated using the reviewed
inventory for this runtime. Where offered, Perl's Artistic licence option is
used. The top-level MIT licence does not replace these component licences.

The broader attribution collection and extraction inventory are supplied
separately with release ${packageVersion} (Perl ${perlVersion}):

- [GitHub Release](${releaseUrl})
- [Download third-party licences](${licenseUrl})
- SHA-256: \`${licenseHash}\`

The archive includes a build manifest and an inventory of its files and hashes.
Consult the component licences before redistributing this runtime.
`);
const packageManifest = {...manifest, npmPackage: {
  name: packageName, version: packageVersion,
  includedArtifacts: ["wasm"],
  runtimeNotices: {filename: "THIRD-PARTY-LICENSES.txt", sha256: await sha256(runtimeNotices), policySha256: await sha256(noticePolicy)},
  notices: {filename: licenseName, url: licenseUrl, releaseUrl, sha256: licenseHash},
}};
await writeFile(resolve(destination, "manifest.json"), `${JSON.stringify(packageManifest, null, 2)}\n`);
await writeFile(resolve(destination, "embedded-files.json"), `${JSON.stringify(embeddedFiles, null, 2)}\n`);

const packageJson = {
  name: packageName,
  version: packageVersion,
  description: `Perl ${perlVersion} WebAssembly runtime with the WebDyne::PAGI stack`,
  type: "module",
  main: "./index.js",
  exports: {
    ".": "./index.js",
    "./cloudflare": "./js/provider/cloudflare.js",
    "./runtime": "./js/runtime/webdyne-runtime.js",
    "./runtime/extensions": "./js/runtime/extensions.js",
    "./transport/fetch": "./js/transport/fetch-pagi.js",
    "./worker": "./js/worker.js",
    "./zeroperl.wasm": `./${wasmName}`,
    "./manifest.json": "./manifest.json",
  },
  bin: {
    "webdyne-cloudflare": "scripts/webdyne-cloudflare.mjs",
  },
  files: [
    "bin",
    "embedded-files.json",
    "index.js",
    "js",
    "lib",
    "manifest.json",
    "THIRD-PARTY-NOTICES.md",
    "THIRD-PARTY-LICENSES.txt",
    "scripts",
    wasmName,
  ],
  dependencies: {
    fflate: "0.8.3",
    ignore: "5.3.2",
    "modern-tar": "0.8.4",
    wrangler: "4.127.1",
  },
  sideEffects: false,
  keywords: ["perl", "webdyne", "pagi", "wasm", "webassembly", "wasi"],
  author: "Anthony Speer",
  license: "MIT",
  repository: {
    type: "git",
    url: "git+https://github.com/aspeer/zeroperl.git",
  },
  homepage: "https://github.com/aspeer/zeroperl#readme",
  publishConfig: {
    access: "public",
  },
};

const indexSource = `export const perlVersion = ${JSON.stringify(perlVersion)};
export const buildNumber = ${buildNumber};
export const wasmUrl = new URL(${JSON.stringify(`./${wasmName}`)}, import.meta.url);
`;

const readme = `# ${packageName}

This package contains the qualified ZeroPerl WebAssembly runtime for Perl
${perlVersion}, WebDyne, WebDyne::PAGI, PAGI::Tools, their required runtime and
static-XS dependencies, a provider-neutral PAGI runtime, and the default
Cloudflare adapter needed to serve a WebDyne PSP application.

Package version ${packageVersion} corresponds to WebDyne build ${buildNumber}.
The runtime is \`${wasmName}\`. The pre-Asyncify reactor and full attribution
source archive are diagnostic build artifacts and are not included in npm.

The manifest records build provenance and hashes; not every build artifact is
shipped in this package. \`THIRD-PARTY-LICENSES.txt\` contains the reviewed runtime
licence and attribution texts. Full supporting evidence is available from the
[matching GitHub Release](${releaseUrl}). See \`THIRD-PARTY-NOTICES.md\` for scope,
the archive link and checksum. The runtime source is
MIT-licensed; embedded components retain their own licenses.

Place the complete application tree in \`app/\`. A minimal project only needs
\`package.json\` and \`app/app.psp\`; Cloudflare configuration is generated when
the project does not provide its own \`wrangler.jsonc\`.

\`\`\`sh
npm init
npm install ${packageName}@${packageVersion}
npx webdyne-cloudflare init
npm run dev
\`\`\`

Use \`webdyne-cloudflare check\` for a Wrangler dry run,
\`webdyne-cloudflare dev\` for local development, and
\`webdyne-cloudflare deploy\` for a checked deployment. The package includes
its tested Wrangler version. Installation has no deployment side effects.


The explicit \`init\` command adds npm scripts for \`build\`, \`check\`, \`dev\`,
\`deploy\`, \`destroy\`, \`login\`, \`logout\`, and \`whoami\`, retaining existing scripts.
It sets \`webdyne.static: false\` and creates a root \`.assetsignore\` containing
\`*.psp\`, \`*.pm\`, \`*.pl\`, and \`*.conf\` unless the file already exists.
Use \`npm run login\`, \`npm run whoami\`, then \`npm run deploy\` to publish.
Use \`npm run destroy\` to delete the configured Worker. Type the full \`Yes\`
at the local confirmation (blank means No), then confirm Wrangler's named target.
Destroy requires an interactive terminal, rejects confirmation-bypass flags,
and uses deployment configuration without building the application. Rerun
\`npx webdyne-cloudflare init\` after upgrading to add the new npm script.


When the application root contains \`.assetsignore\`, the CLI automatically
passes \`--assets\` with that directory to Wrangler. Public assets are omitted
from the application VFS; ignored files remain available to Perl. Add patterns
for any data or templates Perl must read. Patterns are reread on every build.
Only the root ignore file is supported by Wrangler; nested ignore files and
misspelled \`.assetignore\` files produce an actionable error. Root patterns can
match subdirectories. Existing explicit \`--assets DIR\` arguments take precedence;
VFS filtering uses that directory's root ignore file. Without a root ignore file,
VFS packaging remains unchanged. Automatic assets arguments override an assets
directory in a custom Wrangler configuration; use explicit \`--assets\` to choose
another root. Custom configurations remain responsible for \`WEBDYNE_STATIC=0\`.

Initialization accepts \`--app-directory DIR\` (alias \`--document-root\`),
\`--entry FILE\`, \`--output DIR\`, \`--library DIR\`, and \`--wrangler-config FILE\`,
and saves those settings. The default source root is \`webdyne.appDirectory\` or
\`app\`; the runtime VFS root stays \`/app\`. Generated output must be outside the
assets root. \`dev\` builds once before Wrangler starts; rerun \`npm run build\`
after changing server-side files or ignore rules, or restart \`npm run dev\`.

Custom Wrangler configurations must include the \`enable_request_signal\`
compatibility flag so disconnected SSE sessions stop promptly. Generated
configurations include it automatically.

Portable settings belong below \`package.json.webdyne\`. Use \`appDirectory\`
to override the source \`app/\` directory, \`entry\` to override \`app.psp\`,
\`static: false\` to disable static-file serving, or \`perlLibrary\` for one or
more Pure-Perl library trees. The application always mounts at VFS \`/app\`.
A root \`cpanfile\` is installed automatically into the cached \`.webdyne/cpan\`
tree; commit \`cpanfile.snapshot\` for reproducible dependencies. Native Perl
extensions are rejected because host binaries cannot execute inside the Wasm
runtime. Runtime helpers and dependencies use \`/perl5\`, while \`/tmp\` is
writable and exposed to Perl as \`TMPDIR=/tmp\`.

Optional provider packages are direct dependencies enabled through
\`webdyne.extensions\`. The build reads their exported declarative manifests,
adds their Pure-Perl files to \`/perl5/lib\`, and statically imports the selected
Cloudflare adapters. Every regular file below the configured application
directory is recursively included in VFS \`/app\`.
`;

await Promise.all([
  writeFile(resolve(destination, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`),
  writeFile(resolve(destination, "index.js"), indexSource),
  writeFile(resolve(destination, "README.md"), readme),
]);

console.log(JSON.stringify({ packageName, packageVersion, wasmName, reactorName }));
