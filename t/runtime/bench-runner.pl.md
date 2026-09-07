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
node t/runtime/bench-runner.mjs output/5.44.0/zeroperl-webdyne-5.44.0-1.0.4.wasm /tmp/pagi-runner-before.pl
# After editing:
node t/runtime/bench-runner.mjs native bin/pagi-runner.pl
node t/runtime/bench-runner.mjs output/5.44.0/zeroperl-webdyne-5.44.0-1.0.4.wasm bin/pagi-runner.pl
```

Use the same WASM artifact and JS bridge for both runs. The harness mounts the
selected runner as a VFS file; no WASM rebuild is needed. It uses the repository's
bundled `js/zeroperl.js`. Native tests need Future, Future::AsyncAwait and the
runner's chosen JSON backend installed. Warm-up performs 5,000 iterations per
case, except large bodies (100). Five timed batches follow. Report medians;
WASM timer granularity and JIT activity can affect individual samples.

## Results: 7 September 2026

Baseline: fresh JSON::PP object per operation. After: one lexical
Cpanel::JSON::XS object, canonical output, character-string JSON, and explicit
allow_nonref. Both use Perl 5.44.0. Units are median microseconds per operation.
Raw samples and artifact/baseline SHA-256 identities are in
[runner-json-benchmark.json](runner-json-benchmark.json).

| Case | Native before | Native after | WASM before | WASM after | WASM before/after |
| --- | ---: | ---: | ---: | ---: | ---: |
| SSE event | 6.89 | 1.53 | 17.30 | 5.80 | 2.98x |
| 64 KiB HTTP body | 148.96 | 202.73 | 335.00 | 375.00 | 0.89x |
| Connection poll | 8.32 | 0.48 | 21.00 | 1.10 | 19.09x |
| Mock request lifecycle | 90.41 | 12.10 | 178.00 | 26.50 | 6.72x |

Large base64-heavy bodies take about 12% longer in WASM and 36% longer natively.
The shared XS codec is retained for its gains on frequent small events, polling,
and lifecycle operations. These measurements do not establish end-to-end HTTP
throughput or a universal XS advantage. No size-based fallback or custom JSON
serialization is introduced.

## Compatibility checks

```sh
prove t/runtime/runner-json.t t/runtime/lifespan.t t/runtime/webdyne-error-isolation.t
node t/runtime/test-runner-json.mjs output/5.44.0/zeroperl-webdyne-5.44.0-1.0.4.wasm
node t/runtime/smoke-lifespan.mjs output/5.44.0/zeroperl-webdyne-5.44.0-1.0.4.wasm
npm run test:cloudflare-package
```

Native: 40 assertions across three files pass; the 22 JSON assertions also pass
against the saved baseline. WASM: the same 22 JSON assertions and all five
lifespan integration scenarios pass. Package suite: 47 tests pass.
The WASM JSON test mounts native pure-Perl Test/Test2 libraries only for testing
and uses scalar output handles because WASI cannot duplicate stdout/stderr.
JSON coverage includes Unicode, binary fields, original-event preservation,
JSON::PP boolean interoperability, malformed-input recovery, scope and completion.

Canonical serialization remains enabled, but backend-specific error wording,
number formatting and ordering of unusual Unicode keys are not promised to be
byte-identical. The PAGI field/value contract is retained. Older Perl WASM
versions and hosted Cloudflare performance were not requalified in this change.
