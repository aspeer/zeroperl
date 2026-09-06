#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ZeroPerl} from '../js/zeroperl.js';

const wasm = await readFile(process.argv[2] ?? new URL('../zeroperl.wasm', import.meta.url));
const perl = await ZeroPerl.create({fetch: async () => new Response(wasm)});
try {
  perl.registerFunction('reentry_pause', async value => {
    await Promise.resolve();
    const allocation = perl.createString('x'.repeat(4096));
    await allocation.dispose();
    return value;
  });
  perl.registerFunction('reentry_reject', async () => {
    await Promise.resolve();
    throw new Error('expected rejection');
  });
  const setup = await perl.eval(`
    sub reentry_scalar {my $x=reentry_pause(20); return $x+reentry_pause(22)}
    sub reentry_list {reentry_pause(0); reentry_pause(1); return (1,'two',3)}
  `);
  assert.equal(setup.success, true, setup.error);
  for (let round = 0; round < 100; round++) {
    const scalar = await perl.call('reentry_scalar', [], 'scalar');
    assert.ok(scalar, 'async scalar call must preserve its result handle');
    try { assert.equal(scalar.toInt(), 42); } finally { await scalar.dispose(); }
    const list = await perl.call('reentry_list', [], 'list');
    try { assert.deepEqual(list.map(value => value.toString()), ['1', 'two', '3']); }
    finally { for (const value of list) await value.dispose(); }
    const caught = await perl.eval(`
      eval {reentry_reject()};
      die 'missing rejection' unless $@ =~ /expected rejection/;
    `);
    assert.equal(caught.success, true, caught.error);
  }
  console.log('Asyncify re-entry: 100 rounds passed (scalar/list results, repeated yields, allocations, rejection recovery)');
} finally {
  await perl.dispose();
}
