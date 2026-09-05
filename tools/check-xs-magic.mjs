#!/usr/bin/env node
// Qualify Variable::Magic callbacks crossing the asynchronous host boundary.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ZeroPerl } from '../js/zeroperl.js';

const wasmPath = process.argv[2];
if (!wasmPath) throw new Error('Usage: node tools/check-xs-magic.mjs WASM');
const runtime = await readFile(wasmPath);
const perl = await ZeroPerl.create({ fetch: async () => new Response(runtime) });
const events = [];
perl.registerFunction('xs_magic_yield', async value => {
  const event = value.toString();
  await new Promise(resolve => setTimeout(resolve, 1));
  events.push(event);
});
try {
  for (let turn = 0; turn < 3; turn++) {
    const result = await perl.eval(`
      require Variable::Magic;
      my $wizard_ref=Variable::Magic::wizard(
          set => sub { xs_magic_yield('set'); return 0 },
          free => sub { xs_magic_yield('free'); return 0 });
      {
          my $value=0;
          &Variable::Magic::cast(\\$value, $wizard_ref);
          $value=42;
          die 'magic write value' unless $value==42;
      }
      1;
    `);
    assert.equal(result.success, true, result.error);
    assert.deepEqual(events.slice(turn * 2), ['set', 'free']);
  }
  console.log('Variable::Magic asynchronous set/free callbacks passed across 3 turns');
} finally {
  await perl.dispose();
}
