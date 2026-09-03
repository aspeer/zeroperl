# Verification

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
