# PAGI runner JSON benchmark

Measures the actual runner with a small SSE event, a 65,536-byte binary HTTP
body (base64 conversion included), connection status decoding, and a mocked
request lifecycle. The lifecycle decodes a scope, creates the session and
Futures, polls the connection twice, encodes headers/body/completion, and cleans
up. Host callbacks are Perl no-ops: this excludes JS callback crossing, network,
WebDyne rendering, interpreter startup and module load time.

Run from the canonical ZeroPerl repository. Save the working runner before
editing it, including any existing uncommitted changes:

```sh
cp bin/pagi-runner.pl /tmp/pagi-runner-before.pl
node t/runtime/bench-runner.mjs native /tmp/pagi-runner-before.pl
node t/runtime/bench-runner.mjs /absolute/path/to/runtime.wasm /tmp/pagi-runner-before.pl
# After editing:
node t/runtime/bench-runner.mjs native bin/pagi-runner.pl
node t/runtime/bench-runner.mjs /absolute/path/to/runtime.wasm bin/pagi-runner.pl
```

Use the same WASM artifact and JS bridge for both runs. The harness mounts the
selected runner as a VFS file; no WASM rebuild is needed. It uses the repository's
bundled `js/zeroperl.js`. Native tests need Future, Future::AsyncAwait and the
runner's chosen JSON backend installed. Warm-up performs 5,000 iterations per
case, except large bodies (100). Five timed batches follow. Report medians;
WASM timer granularity and JIT activity can affect individual samples.

## Compatibility checks

```sh
prove t/runtime/runner-json.t t/runtime/lifespan.t t/runtime/webdyne-error-isolation.t
node t/runtime/test-runner-json.mjs /absolute/path/to/runtime.wasm
node t/runtime/smoke-lifespan.mjs /absolute/path/to/runtime.wasm
npm run test:cloudflare-package
```

The WASM JSON test mounts native pure-Perl Test/Test2 libraries only for testing
and uses scalar output handles because WASI cannot duplicate stdout/stderr.
JSON coverage includes Unicode, binary fields, original-event preservation,
JSON::PP boolean interoperability, malformed-input recovery, scope and completion.

Canonical serialization remains enabled, but backend-specific error wording,
number formatting and ordering of unusual Unicode keys are not promised to be
byte-identical. The PAGI field/value contract is retained. Qualify each intended
Perl runtime separately; local measurements do not establish hosted throughput.
