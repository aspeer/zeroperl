import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {latestPerl, prepareAlias} from '../tools/prepare-npm-alias.mjs';

test('latest Perl is numeric and independent of release matrix ordering', () => {
  assert.equal(latestPerl(['5.9.0', '5.44.0', '5.18.4']), '5.44.0');
});

test('alias duplicates payload and retains provenance while changing package identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'npm-alias-'));
  try {
    const source = join(root, 'source'), target = join(root, 'alias');
    await mkdir(source);
    const name = '@webdyne/webdyne-zeroperl-5.44.0';
    const pkg = {name, version: '1.0.4', exports: {'./runtime': './runtime.js'}};
    const manifest = {perlVersion: '5.44.0', source: {revision: 'abc'}, npmPackage: {name, version: pkg.version}};
    for (const [path, content] of Object.entries({'package.json': JSON.stringify(pkg), 'manifest.json': JSON.stringify(manifest), 'README.md': `npm install ${name}@1.0.4`, 'runtime.js': 'export default 42;', 'runtime.wasm': '\0asm'})) await writeFile(join(source, path), content);
    await assert.rejects(prepareAlias(source, target, ['5.44.0', '5.46.0']), /latest supported/);
    await prepareAlias(source, target, ['5.18.4', '5.44.0']);
    for (const path of ['runtime.js', 'runtime.wasm']) assert.deepEqual(await readFile(join(target, path)), await readFile(join(source, path)));
    assert.deepEqual(JSON.parse(await readFile(join(target, 'package.json'))), {...pkg, name: '@webdyne/webdyne-zeroperl'});
    assert.deepEqual(JSON.parse(await readFile(join(target, 'manifest.json'))), {...manifest, npmPackage: {...manifest.npmPackage, name: '@webdyne/webdyne-zeroperl'}});
    assert.match(await readFile(join(target, 'README.md'), 'utf8'), /webdyne-zeroperl@1.0.4/);
    assert.equal(JSON.parse(await readFile(join(source, 'package.json'))).name, name);
  } finally {await rm(root, {recursive: true, force: true});}
});
