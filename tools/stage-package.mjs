#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {readFileSync, appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve, basename} from 'node:path';

const [archive, inventory, mode] = process.argv.slice(2);
if (!archive || !inventory) throw Error('Usage: stage-package.mjs TARBALL PACK_JSON [--check-only]');
if (mode && mode !== '--check-only') throw Error('Unknown staging option');
const records = JSON.parse(readFileSync(inventory, 'utf8'));
if (records.length !== 1) throw Error('Expected exactly one package');
const pack = records[0];
const integrity = 'sha512-' + createHash('sha512').update(readFileSync(archive)).digest('base64');
if (pack.integrity !== integrity || pack.filename !== basename(archive)) throw Error('Tarball differs from verified npm pack inventory');
if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(pack.version)) throw Error('Expected stable npm version');
console.log(`Verified staging input ${pack.name}@${pack.version}: ${integrity}`);
if (mode !== '--check-only') {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pack.name)}`, {signal: AbortSignal.timeout(30000)});
  if (response.status === 404) throw Error('npm staging requires an existing package. Bootstrap this package name before retrying; direct publication is never attempted here.');
  if (!response.ok) throw Error(`npm package preflight failed: HTTP ${response.status}`);
  const metadata = await response.json();
  if (metadata.versions?.[pack.version]) throw Error(`${pack.name}@${pack.version} is already published; use a new release version`);
  try {
    const result = execFileSync('npm', ['stage', 'publish', resolve(archive), '--access', 'public', '--tag', 'latest', '--json'], {encoding: 'utf8', maxBuffer: 10 * 1024 * 1024});
    console.log(result);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n## Staged ${pack.name}@${pack.version}\n\nSource: ${process.env.GITHUB_SHA}\n\nIntegrity: ${integrity}\n\nReview and approve in npm Staged Packages. No approval was performed by CI.\n\n\`\`\`json\n${result}\n\`\`\`\n`);
  } catch (error) {
    console.error(error.stdout?.toString() || '', error.stderr?.toString() || '');
    throw Error('Staging failed. Check npm for an existing staged candidate or a trusted-publisher configuration error. CI never rejects, replaces or approves candidates.');
  }
}
