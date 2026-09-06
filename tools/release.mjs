#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function versionParts(version) {
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) throw Error(`Invalid release version: ${version}`);
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw Error('Version components must be safe integers');
  return parts;
}
export function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}
export function nextVersion(current, tags, prefix, explicit) {
  versionParts(current);
  const versions = tags.filter(tag => tag.startsWith(prefix + '_')).map(tag => tag.slice(prefix.length + 1));
  versions.forEach(versionParts);
  const latest = [current, ...versions].sort(compareVersions).at(-1);
  const parts = versionParts(latest); parts[2]++;
  const next = explicit || parts.join('.'); versionParts(next);
  if (compareVersions(next, latest) <= 0) throw Error(`Release must be newer than ${latest}`);
  return next;
}
export function releaseContext(root) {
  const runtime = existsSync(resolve(root, 'release/versions.json'));
  const file = runtime ? 'release/versions.json' : 'package.json';
  const config = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
  versionParts(config.version);
  return {file, config, prefix: runtime ? 'aspeer-zeroperl' : 'aspeer-zeroperl-ts'};
}
export function validateRelease(root, tag) {
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
  const {config, prefix} = releaseContext(root);
  const canonical = `${prefix}_${config.version}`;
  if (tag !== canonical) throw Error(`Expected canonical release tag ${canonical}`);
  const head = git('rev-parse', 'HEAD');
  for (const name of [canonical, `v${config.version}`]) {
    if (git('cat-file', '-t', `refs/tags/${name}`) !== 'tag') throw Error(`Tag must be annotated: ${name}`);
    if (git('rev-parse', `refs/tags/${name}^{commit}`) !== head) throw Error(`Tag does not match checkout: ${name}`);
  }
  if (git('status', '--porcelain')) throw Error('Release checkout must be clean');
  return config.version;
}
export function prepareRelease(root, remote = 'github', explicit) {
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
  if (git('branch', '--show-current') !== 'main') throw Error('Run make release on main');
  if (git('status', '--porcelain')) throw Error('Commit working-tree changes before releasing');
  const {file, config, prefix} = releaseContext(root);
  git('fetch', remote, '--tags');
  git('merge-base', '--is-ancestor', `${remote}/main`, 'HEAD');
  const version = nextVersion(config.version, git('tag', '--list').split('\n'), prefix, explicit);
  const names = [`${prefix}_${version}`, `v${version}`];
  const tags = new Set(git('tag', '--list').split('\n'));
  if (names.some(name => tags.has(name))) throw Error('A release tag already exists');
  config.version = version;
  writeFileSync(resolve(root, file), JSON.stringify(config, null, 2) + '\n');
  const files = [file];
  if (file === 'package.json' && existsSync(resolve(root, 'package-lock.json'))) {
    const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
    lock.version = version;
    if (lock.packages?.['']) lock.packages[''].version = version;
    writeFileSync(resolve(root, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
    files.push('package-lock.json');
  }
  git('add', '--', ...files);
  git('commit', '-m', `Prepare ${prefix} ${version}`);
  const head = git('rev-parse', 'HEAD');
  const identity = git('var', 'GIT_COMMITTER_IDENT');
  const refs = names.map(name => {
    const content = `object ${head}\ntype commit\ntag ${name}\ntagger ${identity}\n\n${prefix} ${version}\n`;
    const object = execFileSync('git', ['mktag'], {cwd: root, input: content, encoding: 'utf8'}).trim();
    return `create refs/tags/${name} ${object}`;
  });
  execFileSync('git', ['update-ref', '--stdin'], {cwd: root, input: refs.join('\n') + '\n'});
  console.log(`Prepared ${names.join(' and ')} at ${head}. Nothing pushed or staged.`);
  console.log(`Push this release: git push --atomic ${remote} main refs/tags/${names[0]} refs/tags/${names[1]}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = process.cwd();
    if (process.argv[2] === 'validate') console.log(validateRelease(root, process.env.RELEASE_TAG || process.argv[3]));
    else if (process.argv[2] === 'prepare') prepareRelease(root, process.env.RELEASE_REMOTE || 'github', process.env.RELEASE_VERSION || undefined);
    else throw Error('Usage: release.mjs prepare|validate');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
