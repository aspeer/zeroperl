# Verification

Each supported standard artifact must pass:

- embedded-prefix and required core-module smoke tests, with no conditional
  skips for retained modules;
- static `Socket` XS smoke tests;
- asynchronous disposal tests for scalar values, references, results, arrays,
  and hashes;
- SFS generator and native runtime tests; and
- the `zeroperl-ts` bridge suite for the bundled default artifact.

The mini experiment must pass the same relevant runtime checks and demonstrate
at least a 30% reduction in compressed WASM size.

## Milestone 1 verification record

Perl 5.18.4, 5.36.3, and 5.44.0 each passed the embedded-prefix/core smoke,
static Socket smoke, all eight asynchronous disposal probes, and a 115-request
persistent WebDyne Worker regression using an empty optional library archive.
The build also ran 17 SFS generator checks and the native SFS runtime suite for
each target. All standard builds used `BUILD_EXIFTOOL=false`.

Perl 5.24.4 passed the isolated async probes but failed real WebDyne
Chain/Template execution at `_asyncjmp_longjmp` with both 32 KiB and 64 KiB
capture buffers, so it is not a qualified standard artifact.

The safe 5.44 mini candidate passed the same runtime gates, but gzip size grew
from 4,713,197 to 5,055,576 bytes. It failed the 30% reduction requirement and
was rejected.
