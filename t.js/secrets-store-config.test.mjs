import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generatedWranglerConfig} from '../scripts/webdyne-cloudflare.mjs';

test('Secrets Store resources generate Wrangler bindings without secret values or new compatibility flags', async () => {
  const root = await mkdtemp(join(tmpdir(), 'secrets-store-config-'));
  const output = join(root, '.webdyne'); await mkdir(output);
  const entry = {binding: 'API_KEY', storeId: 'a'.repeat(32), secretName: 'upstream-api-key'};
  const project = {packageJson: {name: 'secret-test'}, webdyne: {}, cloudflare: {secretsStoreSecrets: [entry]}};
  try {
    const path = await generatedWranglerConfig(root, project, {entry: 'app.psp'}, output);
    const config = JSON.parse(await readFile(path, 'utf8'));
    assert.deepEqual(config.secrets_store_secrets, [{binding: 'API_KEY', store_id: entry.storeId, secret_name: entry.secretName}]);
    assert.equal(config.compatibility_flags.includes('nodejs_compat'), false);
    for (const value of [{}, [null], [entry, entry], [{...entry, value: 'PRIVATE_VALUE'}],
      [{...entry, storeId: ''}], [{...entry, secretName: 'bad name'}], [{...entry, binding: 'bad-name'}]]) {
      project.cloudflare.secretsStoreSecrets = value;
      await assert.rejects(generatedWranglerConfig(root, project, {entry: 'app.psp'}, output), error => {
        assert.equal(error.message.includes('PRIVATE_VALUE'), false); return /Secrets Store|secretsStoreSecrets/.test(error.message);
      });
    }
    const original = '{"name":"user-owned","main":"custom.js"}\n';
    await writeFile(join(root, 'wrangler.jsonc'), original);
    assert.equal(await generatedWranglerConfig(root, project, {}, output), join(root, 'wrangler.jsonc'));
    assert.equal(await readFile(join(root, 'wrangler.jsonc'), 'utf8'), original);
  } finally { await rm(root, {recursive: true, force: true}); }
});
