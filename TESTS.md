# Verification

Tests live in `t/` (Perl, native C and WASM fixtures) and `t.js/` (JavaScript
contracts). They are excluded from the npm runtime package.

## Local checks

Install the Node dependencies as described in [BUILD.md](BUILD.md), then run:

```sh
npm run test:cloudflare-package
prove -I/absolute/path/to/pm-WebDyne/lib t/runtime/*.t
```

Use WebDyne 3.028 and its dependencies for the native tests. The `.pagi`
bootstrap test deliberately runs without loading WebDyne. CPAN lock and XS
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

The last recorded GitHub run, `34138265604`, built and qualified 1.0.6 with
WebDyne 3.028 and passed package/alias checks. It staged the Perl-specific npm
candidate; the unsuffixed alias returned E401. This is historical build evidence,
not a claim that both packages are currently published. Confirm registry state
before an announcement. The 1.0.5 build had passed runtime checks but failed
an expected-file inventory check, corrected for 1.0.6.

Older qualification covered Perl 5.18.4, 5.36.3 and 5.44.0, including static XS,
asynchronous disposal and persistent WebDyne rendering. Current release
packaging selects 5.44.0. Superseded build diaries remain in Git history.

## Documentation review checks (2026-09-11)

- 51 JavaScript contract tests and 62 native runtime assertions passed.
- Plain PAGI and named lifespan callback smoke tests passed using the local
  1.0.5 WebDyne 3.028 WASM artifact, without a library overlay.
- Relative documentation links and whitespace checks passed. No new binary,
  hosted deployment or publication was produced by this documentation review.

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


## Asynchronous extension cleanup development checks

The `codex/hyperdrive-support` change adds five lifecycle tests for immediate
revocation and shared completion, mixed cleanup failures, partial attachment
failure, deadline abort and late rejection, and dispatch completion on setup
failure. The complete JavaScript suite passes 58 tests. These checks use JavaScript
resources and a dispatch failure before WASM starts; real Worker/database socket
closure, request abort, and interpreter recycling still need phase-1 integration
coverage. No new Perl or XS binary was built for this change.


Hyperdrive generator/lifecycle qualification (2026-09-12): extension variant
selection is opt-in, malformed or ambiguous variants fail, Hyperdrive IDs and
binding uniqueness are checked, and user-owned Wrangler files remain unchanged.
The Cloudflare extension repository owns the live PostgreSQL qualification harness.
Run `npm run test:cloudflare-package` and the three Python notice/licence test
files before preparing the 1.0.10 release.
