#!/usr/bin/env node
// Verify delivered XS companions and WebDyne against the Carton lock.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ZeroPerl } from '../js/zeroperl.js';

const [wasmPath, perlVersion] = process.argv.slice(2);
if (!wasmPath || !/^5\.\d+\.\d+$/.test(perlVersion ?? '')) {
  throw new Error('Usage: node tools/check-cpan-versions.mjs WASM PERL_VERSION');
}
const snapshot = await readFile(new URL(`../cpanfile.snapshot.${perlVersion}`, import.meta.url), 'utf8');
const recipes = JSON.parse(await readFile(new URL('./cpan-xs.json', import.meta.url), 'utf8'));
const versions = new Map();
let provides = false;
for (const line of snapshot.split('\n')) {
  if (/^    \S/.test(line)) provides = line === '    provides:';
  const match = provides && line.match(/^      ([\w:]+) (\S+)$/);
  if (match) versions.set(match[1], match[2]);
}
const runtime = await readFile(wasmPath);
const perl = await ZeroPerl.create({ fetch: async () => new Response(runtime) });
try {
  let count = 0;
  for (const recipe of [...recipes, { module: 'WebDyne' }, { module: 'WebDyne::PAGI' }]) {
    if (recipe.before && Number(perlVersion.split('.')[1]) >= Number(recipe.before.split('.')[1])) continue;
    const module = recipe.module;
    const expected = versions.get(module);
    assert.match(module, /^[A-Za-z_]\w*(?:::\w+)*$/);
    assert.match(expected ?? '', /^[v\d][\d._]*$/);
    const result = await perl.eval(`require ${module}; die "${module} version differs from snapshot" unless $${module}::VERSION eq '${expected}'; 1;`);
    assert.equal(result.success, true, `${module}: ${result.error}`);
    count++;
  }
  const carp = await perl.eval("require Carp; Carp->VERSION('1.50'); 1;");
  assert.equal(carp.success, true, `Carp >= 1.50: ${carp.error}`);
  console.log(`Verified ${count} target XS and WebDyne module versions against Perl ${perlVersion} snapshot`);
} finally {
  await perl.dispose();
}
