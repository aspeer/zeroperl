#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const command = args => execFileSync('gh', args, {encoding: null, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});

export function publishLicenses(manifest, directory, gh = command, checkOnly = false) {
  const tag = `aspeer-zeroperl_${manifest.releaseVersion}`;
  const repository = 'aspeer/zeroperl';
  const notice = manifest.npmPackage.notices;
  const filename = `third-party-licenses-${manifest.perlVersion}-${manifest.releaseVersion}.tar.gz`;
  const url = `https://github.com/${repository}/releases/download/${tag}/${filename}`;
  if (notice.filename !== filename || notice.url !== url || !/^[a-f0-9]{64}$/.test(notice.sha256)) throw Error('Invalid release licence reference');
  const archive = resolve(directory, filename);
  if (hash(readFileSync(archive)) !== notice.sha256) throw Error('Release licence checksum mismatch');
  if (readFileSync(archive + '.sha256', 'utf8') !== `${notice.sha256}  ${filename}\n`) throw Error('Invalid licence checksum sidecar');
  if (checkOnly) return url;

  const run = (...args) => gh([...args, '--repo', repository]);
  const view = () => {
    try { return JSON.parse(run('release', 'view', tag, '--json', 'isDraft,tagName,assets')); }
    catch (error) {
      if (/release not found|HTTP 404/.test(String(error.stderr))) return null;
      throw error;
    }
  };
  let release = view();
  if (!release) {
    const scratch = mkdtempSync(join(tmpdir(), 'zeroperl-release-notes-'));
    try {
      const notes = join(scratch, 'notes.md');
      writeFileSync(notes, `Third-party licence and attribution archives for ${tag}.\n\nEach archive includes the matching build manifest and file hashes. npm publication is approved separately by the maintainer.\n`);
      try {
        run('release', 'create', tag, '--verify-tag', '--draft', '--latest=false', '--title', tag, '--notes-file', notes);
      } catch (error) {
        // Another Perl variant may have created the same release concurrently.
        if (!view()) throw error;
      }
    } finally { rmSync(scratch, {recursive: true, force: true}); }
    release = view();
  }
  if (!release || release.tagName !== tag) throw Error('Release tag mismatch');
  for (const path of [archive, archive + '.sha256']) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (!release.assets.some(asset => asset.name === name)) {
      run('release', 'upload', tag, path);
    }
    const downloaded = run('release', 'download', tag, '--pattern', name, '--output', '-');
    if (hash(downloaded) !== hash(readFileSync(path))) throw Error(`Existing release asset differs: ${name}; refusing to overwrite`);
  }
  if (release.isDraft) run('release', 'edit', tag, '--draft=false', '--latest=false');
  if (view()?.isDraft !== false) throw Error('Licence release is not public');
  return url;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , manifestPath, directory, mode] = process.argv;
  if (!manifestPath || !directory || (mode && mode !== '--check-only')) throw Error('Usage: publish-release-licenses.mjs manifest directory [--check-only]');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  console.log(publishLicenses(manifest, directory, undefined, mode === '--check-only'));
}
