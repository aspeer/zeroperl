# Verification

Tests live in `t/` (Perl, native C and WASM fixtures) and `t.js/` (JavaScript
contracts). They are excluded from the npm runtime package.

## Local checks

Install the Node dependencies as described in [BUILD.md](BUILD.md), then run:

```sh
npm run test:cloudflare-package
prove -I/absolute/path/to/pm-WebDyne/lib t/runtime/*.t
```

Use the WebDyne version pinned in `cpanfile` and its dependencies for native
tests. The `.pagi` bootstrap test deliberately runs without loading WebDyne. CPAN lock and XS
checks in `t/cpan/` need the prepared build environment and selected snapshot;
`prove -r t` is appropriate there, not an assertion that every host Perl has
all build dependencies installed.

The JavaScript suite checks application initialization, paths, asset privacy,
library packaging, extension configuration, generated Wrangler settings,
request cleanup, lifespan and command dispatch. Wrangler calls in CLI contract
tests are injected; these tests don't deploy or delete real Workers.

## WASM checks

Use the exact Asyncify artifact being released. For example:

```sh
node t/runtime/smoke-pagi-application.mjs /absolute/path/runtime.wasm
node t/runtime/smoke-lifespan-callbacks.mjs /absolute/path/runtime.wasm
```

The first checks startup, arbitrary routes, concurrent/warm requests and the
absence of WebDyne in plain PAGI mode. The second exercises named callbacks
with the embedded WebDyne. See the runners' arguments for optional overlays.

Release qualification also checks embedded modules and pinned versions,
Socket and required static XS modules, JSON encoding, Asyncify reentry and
disposal, interpreter lifecycle, embedded `@INC`, and native SFS behaviour.
Run the build's normal qualification targets described in [BUILD.md](BUILD.md).
The standalone bridge has its own suite in the `zeroperl-ts` submodule.

## Worker acceptance

Install the exact runtime tarball in an independent application. Check `init`,
`build` and `check`, then run local Wrangler and verify PSP rendering, static
assets, HTTP/SSE/WebSocket traffic and recovery after a failed request.
Repeat disconnect and overlapping-session tests against a persistent interpreter:

- `t/runtime/smoke-stream-sequence.mjs`
- `t/runtime/smoke-stream-lifetime.mjs`
- `t/runtime/smoke-stream-overlap.mjs`

For D1/KV/R2 integration use the independent consumer and smoke instructions in
[WebDyne::Cloudflare TEST.md](https://github.com/aspeer/pm-WebDyne-Cloudflare/blob/main/TEST.md).
Hosted tests require explicitly selected test resources and deployment approval.

## Packaging and release evidence

The release workflow validates checksums, both WASM artifacts, exact npm
contents, package size, attribution inventory and provenance before staging.
Keep the inspected package and manifest together; an old passing binary does
not qualify a changed embedded library. See [RELEASING.md](RELEASING.md).

## Known limits

- Startup is dispatched; Worker shutdown and lifespan-state propagation are not.
- The 10-second startup timeout cannot interrupt CPU-bound Perl which does not yield.
- Custom Wrangler configurations need `enable_request_signal` for disconnected
  SSE cancellation.
- Abrupt WebSocket disconnects can produce workerd hung-request diagnostics.
  The standalone JavaScript reproducer is in [t/runtime/hung-request](t/runtime/hung-request/README.md).
  Earlier local/hosted acceptance verified cleanup and subsequent recovery;
  repeat that check when changing the adapter or Wrangler.
- Perl 5.24.4 is excluded after real WebDyne Chain/Template execution trapped
  despite passing isolated async probes.
- The experimental mini build failed its compressed-size improvement target;
  it is not a qualified release alternative.
- Development tooling does not watch server-side application/library files or
  `.assetsignore`; rebuild or restart Wrangler after those changes.
- Opcode and CGI::Simple::Cookie startup warnings need investigation if they
  affect the selected application.

## Extension and release tooling checks

JavaScript regression tests cover immediate capability revocation, shared cleanup
completion, multiple cleanup failures, partial attachment failures, deadline abort,
late rejection and dispatch completion after setup failure. Generator tests cover
extension variants, binding validation and preservation of user-owned configuration.
The Cloudflare extension repository owns live PostgreSQL qualification; these local
contracts alone do not prove Worker/database socket cancellation or recycling.

Run the notice and licence suites alongside the JavaScript package tests:

```sh
python3 -B t/test_compact_notices.py
python3 -B t/test_runtime_notices.py
python3 -B t/test_licence_review.py
```

For runner JSON performance, use the [benchmark harness](t/runtime/bench-runner.pl.md).
Its local measurements exclude rendering, bridge crossings and network overhead.
