#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

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

const packageName = `@webdyne/zeroperl-webdyne-${perlVersion}`;
const packageVersion = `${buildNumber}.0.0`;
const wasmName = basename(options.wasm);
const reactorName = basename(options.reactor);

await mkdir(destination, { recursive: true });
await Promise.all([
  copyFile(wasmPath, resolve(destination, wasmName)),
  copyFile(reactorPath, resolve(destination, reactorName)),
  copyFile(sourceManifestPath, resolve(destination, "manifest.json")),
  copyFile(resolve("LICENSE"), resolve(destination, "LICENSE")),
]);

const packageJson = {
  name: packageName,
  version: packageVersion,
  description: `Perl ${perlVersion} WebAssembly runtime with the WebDyne::PAGI stack`,
  type: "module",
  main: "./index.js",
  exports: {
    ".": "./index.js",
    "./zeroperl.wasm": `./${wasmName}`,
    "./zeroperl-reactor.wasm": `./${reactorName}`,
    "./manifest.json": "./manifest.json",
  },
  files: [
    "index.js",
    "manifest.json",
    wasmName,
    reactorName,
  ],
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
${perlVersion}, WebDyne, WebDyne::PAGI, PAGI::Tools, and their required runtime
and static-XS dependencies.

Package version ${packageVersion} corresponds to WebDyne build ${buildNumber}.
The normal runtime is \`${wasmName}\`; the pre-Asyncify linker output is
\`${reactorName}\`.

The TypeScript host bridge is distributed separately.
`;

await Promise.all([
  writeFile(resolve(destination, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`),
  writeFile(resolve(destination, "index.js"), indexSource),
  writeFile(resolve(destination, "README.md"), readme),
]);

console.log(JSON.stringify({ packageName, packageVersion, wasmName, reactorName }));
