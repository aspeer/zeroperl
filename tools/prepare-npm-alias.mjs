#!/usr/bin/env node
import {cp, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compareVersions} from './release.mjs';

export function latestPerl(versions) {
  if (!versions.length) throw Error('No supported Perl versions');
  return [...versions].sort(compareVersions).at(-1);
}

export async function prepareAlias(source, destination, supported) {
  source = resolve(source);
  destination = resolve(destination);
  if (source === destination || destination.startsWith(source + '/')) throw Error('Alias destination must be separate');
  const manifest = JSON.parse(await readFile(resolve(source, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(resolve(source, 'package.json'), 'utf8'));
  if (manifest.perlVersion !== latestPerl(supported)) throw Error('Only the latest supported Perl may produce the alias');
  if (pkg.name !== `@webdyne/webdyne-zeroperl-${manifest.perlVersion}` ||
      manifest.npmPackage.name !== pkg.name || manifest.npmPackage.version !== pkg.version) throw Error('Package identity differs from manifest');
  await cp(source, destination, {recursive: true, force: false, errorOnExist: true});
  const name = '@webdyne/webdyne-zeroperl';
  const readme = await readFile(resolve(destination, 'README.md'), 'utf8');
  await writeFile(resolve(destination, 'README.md'), readme.replaceAll(pkg.name, name));
  pkg.name = name;
  manifest.npmPackage.name = name;
  await writeFile(resolve(destination, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  await writeFile(resolve(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) throw Error('Usage: prepare-npm-alias.mjs SOURCE DESTINATION');
  const config = JSON.parse(await readFile(new URL('../release/versions.json', import.meta.url), 'utf8'));
  await prepareAlias(source, destination, config.supportedPerlVersions);
}
