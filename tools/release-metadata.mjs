#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions, versionParts } from "./release.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const versionsPath = resolve(projectRoot, "release/versions.json");
const versions = JSON.parse(await readFile(versionsPath, "utf8"));
versionParts(versions.version);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function validateVersion(version) {
  if (!versions.supportedPerlVersions.includes(version)) {
    fail(`Unsupported Perl version: ${version}`);
  }
}

function resolveBuildNumber(version, override) {
  validateVersion(version);
  const value = override || versions.version.split('.')[2];
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    fail(`Build number must be a nonnegative integer: ${value}`);
  }
  if (!Number.isSafeInteger(Number(value))) fail("Build number exceeds safe integer range");
  return Number(value);
}

export function releaseMetadata(version, override) {
  const buildNumber = resolveBuildNumber(version, override);
  const npmVersion = [...versions.version.split('.').slice(0, 2), buildNumber].join('.');
  const releaseId = `${version}-${npmVersion}`;
  return {
    perlVersion: version,
    buildNumber,
    releaseId,
    releaseTag: `aspeer-zeroperl_${npmVersion}`,
    archiveBase: `zeroperl-webdyne-${releaseId}`,
    wasm: `zeroperl-webdyne-${releaseId}.wasm`,
    reactor: `zeroperl-webdyne-reactor-${releaseId}.wasm`,
    prefix: `perl-wasi-prefix-${releaseId}`,
    config: `config-${releaseId}.h`,
    manifest: `manifest-${releaseId}.json`,
    checksums: `SHA256SUMS-${releaseId}`,
    npmName: `@webdyne/webdyne-zeroperl-${version}`,
    npmVersion,
    npmAlias: version === [...versions.supportedPerlVersions].sort(compareVersions).at(-1),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, version, override = ""] = process.argv.slice(2);

  if (!command || !version) {
    fail("Usage: release-metadata.mjs <build-number|version|json|shell> <perl-version> [build-number]");
  }

  const metadata = releaseMetadata(version, override);

  switch (command) {
    case "version":
      console.log(metadata.npmVersion);
      break;
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

}
