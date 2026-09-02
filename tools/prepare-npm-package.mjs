#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

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
if (!Number.isInteger(buildNumber) || buildNumber < 1) {
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

const packageName = `@webdyne/webdyne-zeroperl-${perlVersion}`;
const packageVersion = `${buildNumber}.0.0`;
const wasmName = basename(options.wasm);
const reactorName = basename(options.reactor);
const prefixPath = resolve(source, manifest.artifacts.prefix.directory);
const embeddedFiles = await embeddedFileInventory(prefixPath, perlVersion);

await mkdir(destination, { recursive: true });
await Promise.all([
  copyFile(wasmPath, resolve(destination, wasmName)),
  copyFile(reactorPath, resolve(destination, reactorName)),
  copyFile(sourceManifestPath, resolve(destination, "manifest.json")),
  copyFile(resolve("LICENSE"), resolve(destination, "LICENSE")),
  cp(resolve("bin"), resolve(destination, "bin"), { recursive: true }),
  cp(resolve("js"), resolve(destination, "js"), { recursive: true }),
  cp(resolve("lib"), resolve(destination, "lib"), { recursive: true }),
  cp(resolve("scripts"), resolve(destination, "scripts"), { recursive: true }),
]);
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
    "./zeroperl-reactor.wasm": `./${reactorName}`,
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
    "scripts",
    wasmName,
    reactorName,
  ],
  dependencies: {
    fflate: "0.8.3",
    "modern-tar": "0.8.4",
    wrangler: "4.127.1",
  },
  sideEffects: false,
  keywords: ["perl", "webdyne", "pagi", "wasm", "webassembly", "wasi"],
  author: "Anthony Speer",
  license: "Apache-2.0",
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
export const reactorWasmUrl = new URL(${JSON.stringify(`./${reactorName}`)}, import.meta.url);
`;

const readme = `# ${packageName}

This package contains the qualified ZeroPerl WebAssembly runtime for Perl
${perlVersion}, WebDyne, WebDyne::PAGI, PAGI::Tools, their required runtime and
static-XS dependencies, a provider-neutral PAGI runtime, and the default
Cloudflare adapter needed to serve a WebDyne PSP application.

Package version ${packageVersion} corresponds to WebDyne build ${buildNumber}.
The normal runtime is \`${wasmName}\`; the pre-Asyncify linker output is
\`${reactorName}\`.

Place the complete application tree in \`app/\`. A minimal project only needs
\`package.json\` and \`app/app.psp\`; Cloudflare configuration is generated when
the project does not provide its own \`wrangler.jsonc\`.

\`\`\`sh
npm install ${packageName}@${buildNumber}
npx webdyne-cloudflare dev
\`\`\`

Use \`webdyne-cloudflare check\` for a Wrangler dry run,
\`webdyne-cloudflare dev\` for local development, and
\`webdyne-cloudflare deploy\` for a checked deployment. The package includes
its tested Wrangler version. Installation has no deployment side effects.

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
