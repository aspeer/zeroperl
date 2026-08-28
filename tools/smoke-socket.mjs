#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { WASI } from 'node:wasi';

const wasmPath = path.resolve(process.argv[2] ?? 'output/zeroperl.wasm');
const prefixPath = path.resolve(
  process.argv[3] ?? 'output/perl-wasi-prefix',
);

if (!fs.existsSync(wasmPath)) {
  throw new Error(`WASM file not found: ${wasmPath}`);
}
if (!fs.existsSync(prefixPath)) {
  throw new Error(`Perl prefix not found: ${prefixPath}`);
}

const wasi = new WASI({
  version: 'preview1',
  preopens: {
    '/zeroperl': prefixPath,
    '/dev': '/dev',
  },
});

const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {
  wasi_snapshot_preview1: wasi.wasiImport,
  env: { call_host_function: () => 0 },
});

wasi.initialize(instance);

const { exports } = instance;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function writeCString(text) {
  const bytes = encoder.encode(`${text}\0`);
  const ptr = exports.malloc(bytes.length);
  new Uint8Array(exports.memory.buffer).set(bytes, ptr);
  return ptr;
}

function readCString(ptr) {
  const memory = new Uint8Array(exports.memory.buffer);
  let end = ptr;
  while (memory[end]) end += 1;
  return decoder.decode(memory.subarray(ptr, end));
}

try {
  if (exports.zeroperl_init() !== 0) {
    throw new Error(`init: ${readCString(exports.zeroperl_last_error())}`);
  }

  const code = `
    die "Socket bootstrap missing\\n" unless defined &Socket::bootstrap;
    require Socket;
    my $packed = Socket::inet_aton('127.0.0.1');
    die "Socket XS did not load\\n"
        unless defined($packed) && length($packed) == 4;
    print "Socket static XS OK\\n";
  `;

  const codePtr = writeCString(code);
  const result = exports.zeroperl_eval(codePtr, 0, 0, 0);
  exports.free(codePtr);

  if (result !== 0) {
    throw new Error(`eval: ${readCString(exports.zeroperl_last_error())}`);
  }
} finally {
  exports.zeroperl_shutdown();
}
