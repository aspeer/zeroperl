import test from 'node:test';
import {readFileSync} from 'node:fs';
const configuredVersion = JSON.parse(readFileSync(new URL('../release/versions.json', import.meta.url))).version;
const expectedVersion = configuredVersion.replace(/\d+$/, '2');
import assert from 'node:assert/strict';
import {releaseMetadata} from '../tools/release-metadata.mjs';

test('a patch build shares its project version across Perl variants', () => {
  for (const perl of ['5.18.4', '5.36.3', '5.44.0']) {
    const metadata = releaseMetadata(perl, '2');
    assert.equal(metadata.npmVersion, expectedVersion);
    assert.equal(metadata.releaseTag, `aspeer-zeroperl_${expectedVersion}`);
    assert.equal(metadata.wasm, `zeroperl-webdyne-${perl}-${expectedVersion}.wasm`);
  }
});
