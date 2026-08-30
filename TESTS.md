# Verification

Each supported standard artifact must pass:

- embedded-prefix and core-module smoke tests;
- static `Socket` XS smoke tests;
- asynchronous disposal tests for scalar values, references, results, arrays,
  and hashes;
- SFS generator and native runtime tests; and
- the `zeroperl-ts` bridge suite for the bundled default artifact.

The mini experiment must pass the same relevant runtime checks and demonstrate
at least a 30% reduction in compressed WASM size.
