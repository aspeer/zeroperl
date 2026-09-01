#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

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

async function fileRecord(directory, filename) {
  const path = resolve(directory, filename);
  const details = await stat(path);
  return {
    filename,
    bytes: details.size,
    sha256: await sha256(path),
  };
}

async function directoryInventory(root) {
  const paths = [];
  let bytes = 0;

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        paths.push(path);
        bytes += (await stat(path)).size;
      }
    }
  }

  await visit(root);
  paths.sort((left, right) => relative(root, left).localeCompare(relative(root, right)));
  const treeHash = createHash("sha256");
  for (const path of paths) {
    treeHash.update(relative(root, path));
    treeHash.update("\0");
    treeHash.update(await readFile(path));
    treeHash.update("\0");
  }
  return { files: paths.length, bytes, sha256: treeHash.digest("hex") };
}

const options = parseArguments(process.argv.slice(2));
const required = [
  "artifact-dir",
  "perl-version",
  "build-number",
  "wasm",
  "reactor",
  "config",
  "prefix",
  "manifest",
  "source-revision",
  "source-dirty",
  "submodule-revision",
  "shrink",
  "embed-prefix",
  "build-exiftool",
];

for (const key of required) {
  if (!options[key]) fail(`Missing --${key}`);
}

const artifactDirectory = resolve(options["artifact-dir"]);
const manifest = {
  schemaVersion: 1,
  distribution: "zeroperl-webdyne",
  perlVersion: options["perl-version"],
  buildNumber: Number(options["build-number"]),
  source: {
    repository: "https://github.com/aspeer/zeroperl",
    revision: options["source-revision"],
    dirty: options["source-dirty"] === "true",
    zeroperlTsRevision: options["submodule-revision"],
  },
  profile: {
    shrink: options.shrink,
    embedPrefix: options["embed-prefix"] === "true",
    buildExifTool: options["build-exiftool"] === "true",
  },
  artifacts: {
    wasm: await fileRecord(artifactDirectory, options.wasm),
    reactor: await fileRecord(artifactDirectory, options.reactor),
    config: await fileRecord(artifactDirectory, options.config),
    prefix: {
      directory: options.prefix,
      ...(await directoryInventory(resolve(artifactDirectory, options.prefix))),
    },
  },
};

if (options["build-exiftool"] === "true") {
  manifest.artifacts.exiftool = await fileRecord(artifactDirectory, options.exiftool);
}

await writeFile(
  resolve(artifactDirectory, options.manifest),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
