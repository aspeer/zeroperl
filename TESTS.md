# Verification

## Current status (2026-09-06)

WebDyne 3.026 final build 1 passes qualification on Perl 5.18.4, 5.36.3 and
5.44.0. Final 5.44 npm-package local stream/storage acceptance passes, including
sustained SSE cancellation after enabling Cloudflare request signals. The exact
final binary also passes approved hosted lifetime, overlap and disconnect-recovery
checks. The abrupt-WebSocket-disconnect warning remains an accepted limitation.
See [RELEASE-QUALIFICATION.md](RELEASE-QUALIFICATION.md) for exact source refs,
checksums, evidence, limitations and remaining publication prerequisites.
The dated records below preserve earlier findings and are superseded by that
record where they describe old artifacts or outstanding runtime defects.


Each supported standard artifact must pass:

- embedded-prefix and required core-module smoke tests, with no conditional
  skips for retained modules;
- static `Socket` XS smoke tests;
- asynchronous disposal tests for scalar values, references, results, arrays,
  and hashes;
- SFS generator and native runtime tests; and
- the `zeroperl-ts` bridge suite for the bundled default artifact.

Release-pipeline validation additionally requires shell and workflow linting,
SHA-256 verification after every packaging boundary, structural validation of
both WASM files, an exact npm tarball file allowlist, npm publication dry-run,
and GitHub build-provenance attestations. Initial workflow runs must keep
GitHub Release and npm publication disabled.

The first Perl 5.44.0 release dry run completed successfully in GitHub Actions
run `33537280381`; its GitHub Release job was skipped. npm candidate run
`33538766245` consumed that exact qualified artifact, passed its publish dry
run and provenance attestation, and executed only the deliberately disabled
publication message.

The portable-runtime package candidate was installed as a tarball into an
independent minimal application with no `wrangler.jsonc`. Its direct
`webdyne-cloudflare` command generated the default configuration, passed a
Wrangler deployment dry run, and served both an evaluated WebDyne server-time
page and a sibling static asset from VFS `/app`. A request-time probe created a
file in writable `/tmp` and observed `TMPDIR=/tmp`. A root `cpanfile` installed
the Pure-Perl `String::ShellQuote` fixture under `/perl5/lib`; the next build
used the dependency cache without network access.
The default Cloudflare adapter also passed live SSE start/event/close handling
and separate WebSocket text and binary echo requests. A control run against the
previous Worker isolated and corrected a bootstrap load-order regression before
these protocol checks were accepted.

The npm-extension integration added 12 JavaScript contract tests, including
recursive retention of nested files under a configured application directory,
static provider imports, extension Perl-library mounting, interpreter/request
lifecycle cleanup, and generated D1 configuration. The independent
`psp-WebDyne-Time` consumer installed the renamed
`@webdyne/webdyne-zeroperl-5.44.0@1.0.0` tarball together with
`@webdyne/webdyne-cloudflare@1.0.0`; its Wrangler dry run passed and a live
local request rendered a D1 `datetime('now')` result through the packaged Perl
and JavaScript extension surfaces.

The package builder subsequently added generated Workers KV and R2 binding
support. Its 12 JavaScript tests pass exact mapping of application-facing
`kvNamespaces` and `r2Buckets` options to Wrangler's `kv_namespaces` and
`r2_buckets` fields, including preview, jurisdiction, and remote settings.

The reversed npm package convention was then requalified from the existing
immutable binary artifacts. GitHub Actions runs `33649857265` (5.44.0),
`33649866179` (5.36.3), and `33649874827` (5.18.4) each passed checksum/source
verification, exact package inspection, both WASM validations, npm publication
dry-run, provenance attestation, and artifact upload. Each reached only the
deliberately disabled publication step.

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

## Embedded WebDyne index regression

The Perl 5.44.0 standard artifact was rebuilt after embedded SFS files were
given a deterministic nonzero modification time. The generator tests and all
164 native SFS runtime assertions passed in the container build, as did the
core/module smoke. With the rebuilt artifact staged in `wasm-WebDyne-PAGI`, an
unchanged `WEBDYNE_INDEX = "1"` rendered the embedded
`WebDyne/index.psp` at `/` with HTTP 200. The cold request completed in 0.91
seconds and a second request on the same interpreter completed in 0.029
seconds.

Artifact evidence:

- `zeroperl.wasm`: 14,869,138 bytes; gzip 4,844,215 bytes;
  SHA-256 `d84676e4728bab51f99818b48023af434453f175d29194e74630ac97000dcec3`.
- `zeroperl_reactor.wasm`: 13,604,111 bytes.
- ExifTool was disabled and no older Perl variant was rebuilt for this
  iteration.

## First release review

See RELEASE-REVIEW.md for the exact coverage and remaining publication actions.
`npm run test:cloudflare-package` now covers library override deduplication,
Perl-safe bootstrap configuration and failed Fetch response construction.
`make -C t/sfs` runs native C and generator tests; the generator harness
supports the root ESM package scope. Build tools require a native lz4 addon
compiled for the Node architecture in use.

## First-release runtime fixes

`tools/smoke-asyncify-free.mjs` now verifies borrowed/fresh callback returns and
11 asynchronous C ABI cases, including array/hash/scalar replacement. Run it
against each newly built versioned artifact and prefix. The bridge's
`tools/check-runtime-lifecycle.mjs <wasm>` additionally checks transferred
wrapper invalidation, rejected callbacks, exact destructor counts, foreign
values, and synchronous replacement.

The core module smoke now requires every deliberately linked CPAN XS module
and exercises Cpanel::JSON::XS encode/decode, catching mismatched Perl companions.
The native module smoke passes on Perl 5.42.2 (IO::File is skipped by its existing
host compatibility check). These are marker-based scripts, not TAP tests.

The package tests include a same-size prefix tampering check. Release packaging
also verifies the attribution evidence checksum; workflow archive allowlists
include the preserved notices.

Final candidate build 5 passes the 24-check generated bridge lifecycle suite,
11 C ABI cases and ten external async releases on Perl 5.18.4, 5.36.3 and
5.44.0. Attribution inventories verify 11,370, 11,150 and 11,425 files
respectively. Runtime release CI runs the generated lifecycle probe against
each selected version. The extracted 38-file runtime npm tarball also passes
all lifecycle checks; the 45-file TypeScript tarball passes Node 22/24/26
ESM, CJS and strict NodeNext checks.

## CPAN snapshot checks

`t/cpan/xs-runtime.t` runs the shared `Core::XSCompatibility` checks under
native Perl during the container build. The WASM smoke harness runs the same
checks twice in one interpreter: actual XS entry points, subroutine names,
parameter validation, hash/array accessors, CSV quoting/Unicode/binary/error
handling, and Variable::Magic attach/detach/scope cleanup.

`node tools/check-xs-magic.mjs WASM` additionally checks asynchronous host calls
from Variable::Magic set/free callbacks over three interpreter turns. It runs
in release qualification alongside the existing lifecycle tests.

`t/cpan/lock.t` runs in the container build with the selected native Perl
and Carton. It checks input binding, archive integrity, locked recipe lookup,
and rejection of unsupported installed XS modules. Run it independently with
`container run --rm -v "$PWD:/review:ro" zeroperl-cpan-tools:5.44.0
/build/native/prefix/bin/prove /review/t/cpan/lock.t` (one shell line).

Snapshot generation and full WASM builds must pass for each supported Perl.
Repeat `make cpanfile.snapshot` without input changes and check that the snapshot
and metadata remain unchanged. Normal runtime builds must never regenerate them.

## Base XS qualification (2026-09-05)

Local standard (`off`, embedded prefix) build 8 passes on all three supported
Perls: native `prove` lock and XS suites; core/WASM module smoke tests; locked
XS version checks (14 on 5.18, 13 on 5.36/5.44); embedded @INC; socket XS;
11 asynchronous release operations; 24 lifecycle checks; and asynchronous
Variable::Magic set/free callbacks over three turns. Artifact checksums and
upstream attribution inventories also pass. No TypeScript source changed.

Sizes below are bytes; gzip uses level 9 and mtime 0. Growth compares build 8
with the existing build 6 and includes the executable-module packaging repair.

| Perl | Raw WASM | Gzip-9 | Raw growth | Gzip growth |
| --- | ---: | ---: | ---: | ---: |
| 5.18.4 | 12,988,140 | 4,489,362 | 226,198 | 59,100 |
| 5.36.3 | 13,600,771 | 4,492,487 | 217,921 | 58,803 |
| 5.44.0 | 14,288,201 | 4,634,526 | 218,862 | 57,501 |

The controlled 5.44 size comparison reuses the same compiled interpreter,
toolchain and optimization flags, removes selected target archives and prefix
files, regenerates the SFS/bootstrap registry, and relinks. The complete batch
accounts for 210,258 raw / 58,048 gzip bytes; Variable::Magic accounts for
27,791 raw / 194 gzip bytes in that comparison. Hidden installation metadata
is excluded by SFS already. These whole-binary compressed deltas are not
portable per-module size promises.

Local evidence is in `output/5.44.0/xs-size-build-8/`: `sizes.json`,
`matrix.json`, the measurement script and the three compared WASM files.
The full comparison binary has SHA-256
`6605e16e373be2610d37c20da19204dabff5717a746c16afdaea26efa27abcd0`,
matching `output/5.44.0/zeroperl-webdyne-5.44.0-8.wasm`.

The subsequent cpanfile cleanup reconciled successfully on all three Perls.
Snapshots are byte-identical to their build-8 selections, with only
`cpanfile_sha256` changed in each metadata file. The existing native CPAN lock
suite passed all 10 checks on 5.44. No interpreter or dependency code changed,
so the cleanup did not require another WASM build or repeated runtime matrix.

### Request error isolation

`prove t/runtime/webdyne-error-isolation.t` exercises a recovered API
exception followed by an ordinary PSP request three times, plus an uncaught
current-request failure and recovery. The regression failed before the adapter
fix and passes all 12 assertions afterward. Local Wrangler acceptance also
checks D1 batch rollback/recovery immediately followed by KV and R2 operations.

The mixed stream acceptance sequence currently fails on the final 5.44.0
local Worker: SSE emits ready/done successfully, then WebSocket startup traps
with a WASM memory access error. This reproduces before and after the diagnostic
isolation fix. See `t/runtime/smoke-stream-sequence.mjs`; publication remains
blocked pending resolution. Standalone text/binary WebSocket echo passes.

## Asyncify re-entry qualification (2026-09-05)

The corrected bridge passes 160 Bun tests and installed ESM/CJS/NodeNext
package checks. `tools/check-asyncify-reentry.mjs` in the TypeScript repository
passes 100 rounds per binary on Perl 5.18.4, 5.36.3 and 5.44.0 (local build 1),
covering scalar/list return handles, repeated yields, host allocations and
rejected callbacks. All 24 lifecycle checks pass for each binary. The runtime
bridge was regenerated and its 17 JavaScript tests pass. No WASM rebuild is
needed for this bridge-only correction.

Run `npm run build`, then `npm run test:asyncify -- /absolute/path/to/runtime.wasm`
in the TypeScript repository. Cloudflare overlap stability remains a separate
release gate; these bridge checks do not certify provider request lifetimes.

## Cloudflare completion retention

The implemented provider correction passes 1,000 rounds (6,000 requests) using
`ROUNDS=1000 node t/runtime/smoke-stream-overlap.mjs BASE_URL`. Install the
existing `t/runtime/stream-sequence` fixtures in the acceptance app first.
D1/KV/R2 checks during overlap and a WebSocket echo after 45 seconds also pass.
All 17 runtime JavaScript tests pass. Forced socket termination leaves service
responsive but produces a separate hung-request warning; see
CLOUDFLARE-CONTEXT-INVESTIGATION.md for evidence and remaining qualification.

## Hung-request diagnostic isolation

`t/runtime/hung-request/README.md` documents the standalone reproduction
and observed toolchain versions. The Node TCP client passes follow-up HTTP
checks against both the standalone Worker and Perl 5.44; both log the diagnostic.
Temporary tracing confirms WebDyne session removal and extension release.
Another 200 normal overlap rounds pass after disconnects. No runtime code
change or warning suppression was retained; hosted behaviour remains untested.


## Tag-triggered staging verification

Release-helper integration tests use temporary Git repositories and local bare
remotes: patch selection, clean-main enforcement, paired annotated tags,
alias conflicts/mismatches, package-lock updates and no implicit push. Staging
input integrity tests reject changed tarball bytes without registry access.
Runtime metadata additionally checks project-version consistency across Perl
variants. Workflow/action and shell lint pass.

The runtime package builder produced a 1.0.1 package from the previously
qualified 5.44 binary using a manifest with releaseVersion. The pinned npm
11.19.1 staging command passed --dry-run; it did not upload. The standalone
bridge passes 167 Bun tests and installed ESM/CJS/NodeNext checks against the
exact already-packed archive. No interpreter changes or WASM recompilation were
needed for these workflow/metadata changes. A real tagged GitHub/OIDC staging
run remains to be exercised after the maintainer initiates the release push.

## Clean-checkout dependency installation

The first tagged GitHub run exposed an ignored root package-lock.json. The
root tooling package now has a stable name and a tracked lock generated with
npm 11.19.1. A clean source export with the pinned bridge source passed npm ci
--ignore-scripts and all 25 runtime/release tests. This check does not rely on
the developer checkout node_modules or ignored lockfile. A new release tag is
needed to include this correction; rerunning an older tag uses its old source.

## Application initialization and assets (2026-09-07)

`t.js/assets-init.test.mjs` adds ten regression cases covering repeatable setup,
preserved metadata/scripts and ignore files, custom roots (including spaces),
saved options, gitignore negation/anchoring/directory semantics, dynamic rebuild
selection, default metadata rules, explicit asset roots, dev/check/deploy
argument forwarding, legacy packaging, malformed ignore locations, public entry
rejection, symlink boundaries, and authentication without an application.

Validation on `development`:

- `npm run test:cloudflare-package`: all 36 JavaScript tests pass.
- `prove t/runtime/webdyne-error-isolation.t`: all 12 native Perl checks pass.
- ESLint recommended rules with Node globals pass for the changed JavaScript;
  this repository has no configured root lint command. No TypeScript changed.
- Prepared the real 5.44.0/1.0.3 candidate from existing verified WASM artifacts
  into a temporary directory and installed it into an independent npm consumer.
- Real `npx --no-install webdyne-cloudflare init` and `npm run check` pass.
- Real local Wrangler 4.127.1: `/app.psp` returns 200 with WASM-rendered content;
  `/site.css` returns 200, the expected CSS content type and exact source bytes.
  Unpacked the application archive and confirmed CSS is absent from VFS.
- `git diff --check` passes. No remote deployment or publication performed.

The initial local run exposed that today's compatibility date (2026-09-07) is
newer than bundled workerd supports (2026-09-04). Initialization now preserves
the existing package default (2026-08-27) or a user's explicit date. The rerun
passes. The first sandboxed attempt could not bind localhost or write Wrangler
logs; the local serving check succeeded with sandbox escalation. CGI::Simple
emits its existing ambiguous `lc` warnings during first-page startup; both
responses succeed. The test server was stopped after acceptance.

## Local development tarball (2026-09-07)

- `t.js/pack-dev.test.mjs` checks next-patch prerelease naming, timestamps,
  revision identification and rejection of malformed/runtime-prerelease input.
- All 37 JavaScript tests pass; changed files pass ESLint recommended rules.
- `npm run pack:dev` produced a 4,838,894-byte npm tarball, passing the existing
  package size/content check and the underlying WASM/prefix/notice validation.
- Installed that exact .tgz with `npm install file:...` in an independent app.
  `npx --no-install webdyne-cloudflare init`, `npm run build`, and real Wrangler
  `npm run check` pass. Verified private development version, unchanged 1.0.3
  runtime provenance, Scratch ignore defaults, PSP in VFS and CSS omitted.
- This repackages the previously tested WASM; no native/TypeScript/runtime code
  changes or compiler rebuild are involved. Nothing published or deployed.

## Confirmed Worker teardown (2026-09-07)

All 42 JavaScript tests pass, including five teardown cases: full-Yes versus
blank/No/other input, noninteractive refusal, cancellation without Wrangler,
accepted command/config/environment forwarding without an app build, and
force-bypass rejection plus initializer upgrade. Deletion is stubbed in tests;
no real Worker was removed. ESLint and diff whitespace checks pass.

The updated development tarball passes the 6 MB inventory gate (4,839,408
bytes). Installed it over the previous local package in the independent test
app, reran init, and verified the destroy script was added. A real subprocess
with piped Yes exits with the interactive-terminal error before Wrangler runs.


## Test directory layout

The main suite lives under `t/`: `cpan/`, `runtime/`, `smoke/` and `sfs/`,
plus the Python notice tests. JavaScript package/release tests remain in
`t.js/`. Run the native Perl test subset with `prove -r t` in the prepared
build environment; it needs the pinned CPAN/XS dependencies.


## Basic lifespan startup (2026-09-07)

- `prove t/runtime/lifespan.t t/runtime/webdyne-error-isolation.t`: 18 native
  assertions pass, including actual WebDyne startup acknowledgement, a pending
  lifespan Future and session removal on retirement.
- `npm run test:cloudflare-package`: all 47 JavaScript tests pass. The new
  `t.js/lifespan.test.mjs` covers acknowledgement, pending receive, invalid
  messages, startup failure and host-wait cleanup.
- `node t/runtime/smoke-lifespan.mjs
  output/5.44.0/zeroperl-webdyne-5.44.0-1.0.4.wasm` (one command): passes actual
  WebDyne startup, concurrent cold and warm requests, explicit startup failure,
  replacement-generation startup, early application return, asynchronous timer
  resumption and missing-acknowledgement timeout. The test imports current
  source through a Node text loader and requires an existing qualified artifact.
- Local Wrangler 4.127.1 with that artifact and current source passes concurrent
  cold HTTP, SSE, WebSocket echo and warm HTTP. The temporary fixture used the
  existing 2026-08-27 compatibility date: the installed workerd supports dates
  only through 2026-09-04 and rejects today's 2026-09-07 date. No dependencies
  or production configuration were changed to work around that limitation.

No TypeScript changed; no root lint configuration exists. Older Perl WASM
versions and remote deployment were not run for this increment.

## PAGI runner JSON codec

`t/runtime/runner-json.t` checks Unicode and binary wire values, booleans,
input preservation and recovery after malformed JSON. Run with `prove`, or use
`t/runtime/test-runner-json.mjs <artifact.wasm>` for the same assertions in WASM.
The reproducible native/WASM benchmark commands, measurements and limitations
are recorded in `t/runtime/bench-runner.pl.md`.


## Named lifespan callback integration (2026-09-07)

- `npm run test:cloudflare-package`: all 50 JavaScript tests pass. New tests
  cover callback names, generated bindings, invalid settings before building,
  and preservation of explicit Wrangler configuration.
- `prove -I/path/to/pm-WebDyne/lib t/runtime/lifespan-callbacks.t
  t/runtime/lifespan.t t/runtime/webdyne-error-isolation.t` (one command):
  35 native assertions pass against the merged core.
- `node t/runtime/smoke-lifespan-callbacks.mjs
  output/5.44.0/zeroperl-webdyne-5.44.0-1.0.4.wasm /path/to/pm-WebDyne/lib`
  (one command): passes old-core rejection, configured async startup once
  before concurrent/warm requests, missing modules/functions and callback errors.
  The new core module is explicitly overlaid into the test VFS.
- Local Wrangler 4.127.1 with generated callback bindings, the existing 1.0.4
  Perl 5.44 artifact, and the merged core overlay passes concurrent cold HTTP,
  SSE, WebSocket echo and warm HTTP; PSP observes startup-count=1.

Shutdown invocation is covered by native bootstrap and the core's native/WASM
callback tests. The Worker does not yet send shutdown. No TypeScript changed,
no root lint configuration exists, and no new binary or remote deployment was
produced.
