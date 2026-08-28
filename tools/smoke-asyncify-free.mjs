#!/usr/bin/env node

// Regression probe for releasing a Perl value whose DESTROY method crosses an
// Asyncify host callback. It intentionally runs against the current runtime;
// no runtime workaround belongs in this test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WASI } from 'node:wasi';

const args = process.argv.slice(2);
const caseArg = args.find((arg) => arg.startsWith('--case='));
const requestedCase = caseArg?.slice('--case='.length);
const positionalArgs = args.filter((arg) => !arg.startsWith('--case='));
const wasmPath = path.resolve(positionalArgs[0] ?? 'output/zeroperl.wasm');
const prefixPath = path.resolve(
  positionalArgs[1] ?? 'output/perl-wasi-prefix',
);

if (!fs.existsSync(wasmPath)) throw new Error(`WASM file not found: ${wasmPath}`);
if (!fs.existsSync(prefixPath)) throw new Error(`Perl prefix not found: ${prefixPath}`);

const wasi = new WASI({
  version: 'preview1',
  preopens: { '/zeroperl': prefixPath, '/dev': '/dev' },
});

let wasm;
let asyncifyData;
let shouldSuspend = false;
let unwound = false;
let resumed = false;
let hostCalls = 0;

const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {
  wasi_snapshot_preview1: wasi.wasiImport,
  env: {
    call_host_function: () => {
      hostCalls += 1;
      if (!shouldSuspend) return 0;

      if (!unwound) {
        unwound = true;
        wasm.asyncify_start_unwind(asyncifyData);
        return 0;
      }

      // During replay, the same import is called a second time. Its returned
      // value is the result of the original asynchronous host operation.
      assert.equal(wasm.asyncify_get_state(), 2, 'host callback must replay while rewinding');
      resumed = true;
      return 0; // undef is sufficient for the test host function
    },
  },
});

wasi.initialize(instance);
wasm = instance.exports;

// Binaryen Asyncify expects two wasm32 pointers: the start and end of its
// scratch stack. Keep this allocation alive for the full test.
const asyncifyStackSize = 64 * 1024;
asyncifyData = wasm.malloc(8 + asyncifyStackSize);
new DataView(wasm.memory.buffer).setUint32(asyncifyData, asyncifyData + 8, true);
new DataView(wasm.memory.buffer).setUint32(
  asyncifyData + 4,
  asyncifyData + 8 + asyncifyStackSize,
  true,
);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function writeCString(text) {
  const bytes = encoder.encode(`${text}\0`);
  const ptr = wasm.malloc(bytes.length);
  new Uint8Array(wasm.memory.buffer).set(bytes, ptr);
  return ptr;
}

function readCString(ptr) {
  const memory = new Uint8Array(wasm.memory.buffer);
  let end = ptr;
  while (memory[end]) end += 1;
  return decoder.decode(memory.subarray(ptr, end));
}

// Drive an exported function through the host side of Binaryen Asyncify.
async function invokeAsync(exportedFunction, ...args) {
  let result = exportedFunction(...args);
  const state = wasm.asyncify_get_state();
  if (state === 0) return result;

  assert.equal(state, 1, 'export must return while Asyncify is unwinding');
  wasm.asyncify_stop_unwind();
  await Promise.resolve();
  wasm.asyncify_start_rewind(asyncifyData);
  result = exportedFunction(...args);

  if (wasm.asyncify_get_state() === 2) wasm.asyncify_stop_rewind();
  assert.equal(wasm.asyncify_get_state(), 0, 'Asyncify must finish in the normal state');
  return result;
}

let makeProbeName;
let holderName;
let keyName;
try {
  assert.equal(wasm.zeroperl_init(), 0, readCString(wasm.zeroperl_last_error()));

  const hostFunctionName = writeCString('main::test_yield');
  wasm.zeroperl_register_function(1, hostFunctionName);
  wasm.free(hostFunctionName);

  const setup = writeCString(`
    our $destroy_count = 0;
    sub make_async_free_probe { bless {}, 'AsyncFreeProbe' }
    sub make_async_free_holder { $async_free_holder = bless {}, 'AsyncFreeProbe' }
    package AsyncFreeProbe;
    sub DESTROY { main::test_yield(); ++$main::destroy_count }
  `);
  assert.equal(wasm.zeroperl_eval(setup, 0, 0, 0), 0, readCString(wasm.zeroperl_last_error()));
  wasm.free(setup);

  makeProbeName = writeCString('main::make_async_free_probe');
  holderName = writeCString('main::async_free_holder');
  keyName = writeCString('probe');

  function evalOrThrow(code) {
    const codePtr = writeCString(code);
    const status = wasm.zeroperl_eval(codePtr, 0, 0, 0);
    wasm.free(codePtr);
    assert.equal(status, 0, readCString(wasm.zeroperl_last_error()));
  }

  function makeHolderValue() {
    // Move the returned object into a global through the public API, then
    // discard the result. The subsequent get_var handle is now the only
    // reference after the global is cleared.
    const result = wasm.zeroperl_call(makeProbeName, 1, 0, 0);
    assert.notEqual(result, 0, readCString(wasm.zeroperl_last_error()));
    const resultValue = wasm.zeroperl_result_get(result, 0);
    assert.notEqual(resultValue, 0, 'call result did not contain a probe value');
    assert.equal(wasm.zeroperl_set_var(holderName, resultValue), 1);
    wasm.zeroperl_result_free(result);

    const holder = wasm.zeroperl_get_var(holderName);
    assert.notEqual(holder, 0, 'could not obtain probe holder');
    const value = wasm.zeroperl_deref(holder);
    assert.notEqual(value, 0, 'could not dereference probe holder');
    wasm.zeroperl_value_free(holder);
    evalOrThrow('$main::async_free_holder = undef');
    return value;
  }

  function assertDestroyed(expectedCount) {
    evalOrThrow(`die "DESTROY count: $destroy_count\\n" unless $destroy_count == ${expectedCount}`);
  }

  async function releaseWithAsyncify(release) {
    shouldSuspend = true;
    unwound = false;
    resumed = false;
    const callsBefore = hostCalls;
    await release();
    shouldSuspend = false;
    assert.equal(unwound, true, 'DESTROY did not reach the asynchronous host callback');
    assert.equal(resumed, true, 'DESTROY did not resume through the host callback');
    assert.equal(hostCalls - callsBefore, 2, 'host callback should run once and replay once');
  }

  const releaseCases = {
    async value_free() {
      const value = makeHolderValue();
      await releaseWithAsyncify(() => invokeAsync(wasm.zeroperl_value_free, value));
    },
    async decref() {
      const value = makeHolderValue();
      await releaseWithAsyncify(() => invokeAsync(wasm.zeroperl_decref, value));
      // decref leaves the C handle allocated but its SV is no longer valid.
      wasm.free(value);
    },
    async result_free() {
      const result = wasm.zeroperl_call(makeProbeName, 1, 0, 0);
      assert.notEqual(result, 0, readCString(wasm.zeroperl_last_error()));
      await releaseWithAsyncify(() => invokeAsync(wasm.zeroperl_result_free, result));
    },
    async array_free() {
      const value = makeHolderValue();
      const array = wasm.zeroperl_new_array();
      assert.notEqual(array, 0, 'could not create array');
      wasm.zeroperl_array_push(array, value);
      wasm.zeroperl_value_free(value);
      await releaseWithAsyncify(() => invokeAsync(wasm.zeroperl_array_free, array));
    },
    async array_clear() {
      const value = makeHolderValue();
      const array = wasm.zeroperl_new_array();
      assert.notEqual(array, 0, 'could not create array');
      wasm.zeroperl_array_push(array, value);
      wasm.zeroperl_value_free(value);
      await releaseWithAsyncify(() => invokeAsync(wasm.zeroperl_array_clear, array));
      wasm.zeroperl_array_free(array);
    },
    async hash_free() {
      const value = makeHolderValue();
      const hash = wasm.zeroperl_new_hash();
      assert.notEqual(hash, 0, 'could not create hash');
      assert.equal(wasm.zeroperl_hash_set(hash, keyName, value), 1);
      wasm.zeroperl_value_free(value);
      await releaseWithAsyncify(() => invokeAsync(wasm.zeroperl_hash_free, hash));
    },
    async hash_clear() {
      const value = makeHolderValue();
      const hash = wasm.zeroperl_new_hash();
      assert.notEqual(hash, 0, 'could not create hash');
      assert.equal(wasm.zeroperl_hash_set(hash, keyName, value), 1);
      wasm.zeroperl_value_free(value);
      await releaseWithAsyncify(() => invokeAsync(wasm.zeroperl_hash_clear, hash));
      wasm.zeroperl_hash_free(hash);
    },
    async hash_delete() {
      const value = makeHolderValue();
      const hash = wasm.zeroperl_new_hash();
      assert.notEqual(hash, 0, 'could not create hash');
      assert.equal(wasm.zeroperl_hash_set(hash, keyName, value), 1);
      wasm.zeroperl_value_free(value);
      await releaseWithAsyncify(() => invokeAsync(wasm.zeroperl_hash_delete, hash, keyName));
      wasm.zeroperl_hash_free(hash);
    },
  };

  const selectedCases = requestedCase
    ? [[requestedCase, releaseCases[requestedCase]]]
    : Object.entries(releaseCases);
  assert(selectedCases.every(([, test]) => test), `unknown release case: ${requestedCase}`);

  let expectedDestroyCount = 0;
  for (const [name, test] of selectedCases) {
    await test();
    expectedDestroyCount += 1;
    assertDestroyed(expectedDestroyCount);
    console.log(`Asyncify release probe OK: ${name}`);
  }
} finally {
  if (makeProbeName) wasm.free(makeProbeName);
  if (holderName) wasm.free(holderName);
  if (keyName) wasm.free(keyName);
  if (asyncifyData) wasm.free(asyncifyData);
  wasm.zeroperl_shutdown();
}
