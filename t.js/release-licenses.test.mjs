import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, join} from 'node:path';
import {publishLicenses} from '../tools/publish-release-licenses.mjs';

test('licence publishing verifies uploads, permits identical reruns and refuses replacement', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-licenses-'));
  try {
    const filename = 'third-party-licenses-5.44.0-1.0.3.tar.gz';
    const bytes = Buffer.from('licences');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(root, filename), bytes);
    writeFileSync(join(root, filename + '.sha256'), `${sha256}  ${filename}\n`);
    const manifest = {releaseVersion: '1.0.3', perlVersion: '5.44.0', npmPackage: {notices: {
      filename, sha256, url: `https://github.com/aspeer/zeroperl/releases/download/aspeer-zeroperl_1.0.3/${filename}`,
    }}};
    let release = null;
    let uploads = 0;
    const assets = new Map();
    const gh = args => {
      switch (args[1]) {
        case 'view':
          if (!release) throw Object.assign(Error('missing'), {stderr: 'release not found'});
          return JSON.stringify({...release, assets: [...assets.keys()].map(name => ({name}))});
        case 'create':
          assert.ok(args.includes('--verify-tag'));
          release = {tagName: args[2], isDraft: true}; return Buffer.alloc(0);
        case 'upload':
          uploads++; assets.set(basename(args[3]), readFileSync(args[3])); return Buffer.alloc(0);
        case 'download': return assets.get(args[args.indexOf('--pattern') + 1]);
        case 'edit': release.isDraft = false; return Buffer.alloc(0);
        default: throw Error('Unexpected gh command');
      }
    };
    publishLicenses(manifest, root, () => {throw Error('check-only must not call GitHub');}, true);
    publishLicenses(manifest, root, gh);
    assert.equal(uploads, 2);
    assert.equal(release.isDraft, false);
    publishLicenses(manifest, root, gh);
    assert.equal(uploads, 2);
    assets.set(filename, Buffer.from('different'));
    assert.throws(() => publishLicenses(manifest, root, gh), /refusing to overwrite/);
    assert.throws(() => publishLicenses(manifest, root, () => {throw Object.assign(Error('auth failed'), {stderr: 'HTTP 403'});}), /auth failed/);
    writeFileSync(join(root, filename), 'tampered');
    assert.throws(() => publishLicenses(manifest, root, gh), /checksum mismatch/);
  } finally {rmSync(root, {recursive: true, force: true});}
});
