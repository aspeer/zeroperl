#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const versionsPath = resolve(projectRoot, "release/versions.json");
const versions = JSON.parse(await readFile(versionsPath, "utf8"));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function validateVersion(version) {
  if (!Object.hasOwn(versions, version)) {
    fail(`Unsupported Perl version: ${version}`);
  }
}

function resolveBuildNumber(version, override) {
  validateVersion(version);
  const value = override || String(versions[version].build);
  if (!/^[1-9][0-9]*$/.test(value)) {
    fail(`Build number must be a positive integer: ${value}`);
  }
  return Number(value);
}

function releaseMetadata(version, override) {
  const buildNumber = resolveBuildNumber(version, override);
  const releaseId = `${version}-${buildNumber}`;
  return {
    perlVersion: version,
    buildNumber,
    releaseId,
    releaseTag: `v${version}-webdyne.${buildNumber}`,
    archiveBase: `zeroperl-webdyne-${releaseId}`,
    wasm: `zeroperl-webdyne-${releaseId}.wasm`,
    reactor: `zeroperl-webdyne-reactor-${releaseId}.wasm`,
    prefix: `perl-wasi-prefix-${releaseId}`,
    config: `config-${releaseId}.h`,
    manifest: `manifest-${releaseId}.json`,
    checksums: `SHA256SUMS-${releaseId}`,
    npmName: `@webdyne/webdyne-zeroperl-${version}`,
    npmVersion: `${buildNumber}.0.0`,
  };
}

const [command, version, override = ""] = process.argv.slice(2);

if (!command || !version) {
  fail("Usage: release-metadata.mjs <build-number|json|shell> <perl-version> [build-number]");
}

const metadata = releaseMetadata(version, override);

switch (command) {
  case "build-number":
    console.log(metadata.buildNumber);
    break;
  case "json":
    console.log(JSON.stringify(metadata));
    break;
  case "shell":
    for (const [key, value] of Object.entries(metadata)) {
      const shellKey = key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
      console.log(`${shellKey}=${value}`);
    }
    break;
  default:
    fail(`Unknown command: ${command}`);
}
