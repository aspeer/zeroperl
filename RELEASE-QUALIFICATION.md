# Final release qualification — 2026-09-06

## Current 1.0.3 candidate: minimal propagated runtime notices

This candidate supersedes both the link-only and broad in-package notice
candidates below. The shared local artifact paths now contain this candidate.
The unpublished annotated tag pair points to clean source
`8b6a9f816b0a7cd23c754e1f35a0d257108b6846`; GitHub was checked before updating
the tags. The bridge remains pinned to `7e91d2c`, Perl is 5.44.0 and WebDyne is
3.026. A packaged bridge comment identifies its upstream origin and modifications.

- npm: **4,835,121 bytes**, 24 files, 14,980,298 bytes unpacked.
- npm SHA-256: `e9a56ed8a9ad6f375b41bbc26cbbe8ac4628340b41a8eb37bf2bf4bfa5fd73e6`.
- WASM SHA-256: `94f5261359a3107881f8bdfad367a4b39520d08cc5b6cf13718e4b27aee34cac`.
- Bundled notices: **334,334 bytes** (about 59 KB gzip), down from 11,898,252.
- Notice SHA-256: `c7dae973ec7fedb4a79959ef2075ac3482ccf18593cc97fc4b9e86ade81ec4d4`.
- Review inventory SHA-256: `8b16ae4c8892741c973543593d6bc1aad60a4ef3b5bb182739ab4b0980e1588b`.
- Supplemental GitHub archive: 3,761,264 bytes.
- Supplemental SHA-256: `c0743f7f526121de1231a724ac8b8d03dd908b505d63b2cf604bf0273bab3825`.

The reviewed inventory covers 82 component groups, including 74 installed CPAN
distributions. It excludes 18 absent CPAN tool distributions and implementation/
manual bulk while preserving applicable copyright notices, grants and exceptions.
Common Apache and Artistic terms are shared; the Artistic option is selected
where offered. Unicode licences and compiler-rt's referenced contributor list
are included. The broader collection and reviewed extraction inventory remain
outside npm in the supplemental archive. See `release/licences/README.md`.

The final notice file is byte-identical when generated from the earlier GitHub
x86_64 evidence and this local aarch64 build. Guards permit identified generated
host metadata differences while binding actual payload paths/code, snapshots,
linking/build inputs and notice sources. New module or licence changes require
review. Only the default 5.44.0 release profile is currently qualified by this
inventory; other buildable Perl versions need their own notice inventories.

Passed: 26 Node tests; the runtime-notice regression test (exact excerpt
preservation, shared attribution, stale/changed/invalid source rejection and
host metadata tolerance); three broad-extraction tests; release workflow lint;
CPAN/XS versions; XS magic; 24 lifecycle checks; 100 Asyncify re-entry rounds;
embedded INC/core/Socket/release probes; attribution and artifact checksums;
exact npm inventory; bundled notice/policy hashes; supplemental archive inventory
and matching build provenance; staging and licence-publisher check-only.

Offline installation of this exact tarball passed. Local Worker acceptance
passed 100 overlap rounds (600 requests), SSE completion followed by WebSocket
echo and HTTP verification of WebDyne 3.026/Perl 5.44. Lifecycle checks also
passed against the packaged bridge with its attribution banner. No hung-request,
memory-trap, SpanParent or cross-request I/O diagnostic appeared. Earlier
long-lived/storage/hosted results below remain historical; this packaging
revision was not uploaded to Cloudflare.

No push, GitHub licence upload, npm staging or npm approval was performed.
The local tarball is under `dist/npm/5.44.0-1.0.3/tarball/`, with notices in
`package/THIRD-PARTY-LICENSES.txt` and supplemental evidence in `release-licenses/`.
Temporary evidence logs use `/tmp/zeroperl-reviewed-notices-*.log`.


## Superseded 1.0.3 candidate: externally hosted third-party licences

This candidate supersedes the earlier 8.40 MB package below. Both unpublished
local tags were updated to clean source `a90f925048b76249e698114691f1607137fc31ef`
after verifying that neither 1.0.3 tag existed on GitHub. The bridge remains
`7e91d2c`; Perl 5.44.0 includes WebDyne 3.026.

- npm: 23 files, **4,771,603 bytes compressed**, 14,645,103 bytes unpacked.
- npm SHA-256: `3d64b6f382d9388fadf6f76681b9822812f9d1026eb0cec6fcda0a364ad75b1a`.
- WASM SHA-256: `1a52c47daab3134ccf25d18caf38c7d97dcccd45b64e4d5586680b63cc5a4e99`.
- Separate licence archive: 16 files, 3,630,260 bytes compressed.
- Licence SHA-256: `e4bacb124b3e30aca49c30bceda6a056ba6ed2e9106deee64dd4b01c111d05c8`.

npm contains a generated third-party notice reference with the exact release
URL and archive checksum. Third-party licence text files and the licenses
folder are absent. The separate archive contains the verbatim legal texts,
SDK/bridge notices, build manifest and file inventory. The interpreter is
unchanged; the packaging budget is now 6 MB compressed.

Passed: 26 Node tests; three notice extraction tests; modified release workflow
lint; locked CPAN/XS checks; XS magic; 24 lifecycle checks; 100 Asyncify re-entry
rounds; embedded INC/core/Socket/release probes; full attribution verification;
source and artifact hashes; exact npm inventory; external licence inventory and
build provenance; local staging and licence-publisher check-only. Negative
checks reject bundled licence payloads, extra WASM, diagnostic archives and
packages over 6 MB. Publisher tests cover upload verification, identical reruns,
replacement refusal, permission failure and tampered input without real uploads.

Offline installation of the final tarball passed, followed by 100 local Worker
overlap rounds (600 requests), SSE completion followed by WebSocket echo and
WebDyne 3.026/Perl 5.44 HTTP output. Lifecycle checks also passed against the
packaged bridge and WASM. No hung-request, memory-trap, SpanParent or cross-request
I/O diagnostic appeared in these smoke tests. The earlier long-lived and
storage tests below were not repeated for this packaging-only revision.

Repository-wide actionlint additionally reports existing shellcheck findings in
unchanged nodefs.yml; the modified release workflow passes independently.
No hosted Worker upload, GitHub push, licence publication or npm staging was
performed. The tag-triggered workflow must publish and verify the licence assets
before npm staging; the URLs are not yet live. See RELEASING.md for manual
bootstrap ordering. The local files are under `dist/npm/5.44.0-1.0.3/` and logs
under `/tmp/zeroperl-external-licenses-*.log`.


## Superseded initial lean npm release 1.0.3

Built and qualified from clean source
`59fe8bfa284eaec850d86c8789f9fa8197fc099f`, tagged locally as
`aspeer-zeroperl_1.0.3` and `v1.0.3`. This package targets Perl 5.44.0 and
includes WebDyne 3.026. The bridge remains pinned to `7e91d2c`.

The final npm tarball contains 37 files, downloads as **8,402,233 bytes**
(previous 1.0.2: 30,761,950 bytes), and unpacks to 26,890,775 bytes.
Its SHA-256 is
`ae7819158a829dbfbf7a59e438cdfaf19196e4d2a7f9e2f6c1f357813ba7e729`.
The production WASM SHA-256 is
`dad6520e897c40813303347a79dabcbcb0e67f79c6f804076ee434cc8c29a415`.

npm includes one production WASM and deduplicated verbatim redistribution
notices. The pre-Asyncify reactor and full attribution evidence archive are
excluded. The workflow retains full build diagnostics in a separate GitHub
Actions artifact for 90 days. A 10,000,000-byte compressed package budget,
archive inventory checks and diagnostic-artifact rejection guard future builds.

Validation passed:

- 25 Node tests, three compact-notice tests and workflow actionlint.
- Locked CPAN/XS versions, XS magic, 24 runtime lifecycle checks, 100 Asyncify
  re-entry rounds, embedded INC, core modules, Socket and 11 release probes.
- Full attribution inventory, build checksums, exact npm file inventory,
  compact-notice hash, clean tagged-source manifest and staging check-only.
- Offline installation of the final tarball into the local Worker acceptance app.
- HTTP pages, WebDyne 3.026/Perl 5.44 version output, CPAN and writable tmp.
- Live SSE/WebSocket for 45 seconds, cancellation/close, then 45 seconds of
  HTTP health checks; 100 overlap rounds (600 requests); SSE-to-WebSocket sequence.
- Local D1, KV and R2 operations, including concurrency and atomic D1 batches.
- 20 deliberately forced WebSocket disconnects with healthy follow-up HTTP.

The forced disconnects produced 20 instances of the previously accepted
server-side hung-request diagnostic. Existing streams and subsequent overlap
requests remained healthy. No WASM memory trap or cross-request I/O diagnostic
was observed. This package was tested locally; no new hosted deployment was
performed. Prior hosted qualification below remains historical evidence for
the runtime implementation, not a hosted test of this exact tarball.

The local tarball is
`dist/npm/5.44.0-1.0.3/tarball/webdyne-webdyne-zeroperl-5.44.0-1.0.3.tgz`.
Temporary evidence logs use `/tmp/zeroperl-1.0.3-*.log`. No push or npm publication
was performed. The paired release tags remain on the build source commit;
subsequent documentation commits only record these results.

## Earlier first-release qualification

The first-release artifacts include WebDyne **3.026**, pinned exactly in
`cpanfile` and all three target snapshots. Builds use clean runtime source
`b08c545bb740d2093b8858a09be9e7a3a0b3cc04` and bridge implementation
`7e91d2cfd3e2c42c3d5ecb97cf81d739f8d83a71`. Subsequent qualification-document
and bridge-manifest commits do not change the tested implementation. The runtime
submodule remains pinned to that implementation to avoid circular references
between its source revision and the TypeScript package's runtime manifest.

## Artifacts and checks

| Perl | Runtime npm version | Main WASM SHA-256 |
| --- | --- | --- |
| 5.18.4 | 1.0.0 | `9e501db352a83e6febfebacda619bee95ba004d4be0c8ec18bece0725fe3b207` |
| 5.36.3 | 1.0.0 | `1f98d2a301b0885ddefa94cdd808db151176fd369ede72ac50d51d34d3e90380` |
| 5.44.0 | 1.0.0 | `bd59be6cc0a4b0efbbad83ccdf34606b812e651acb4a256f30e1890034bbde61` |

Each target passed locked CPAN/XS versions (including WebDyne and WebDyne::PAGI
3.026 and Carp >= 1.50), XS magic checks, 24 lifecycle checks, 100 Asyncify
re-entry rounds, embedded/core modules, Socket, 11 C ABI release cases,
notice integrity, artifact checksums, exact 38-file npm archive inventory and
npm publication dry-run. Both standard and reactor artifacts were generated.
The persistent Cloudflare acceptance below uses the standard 5.44 artifact.

The TypeScript package `@aspeer/zeroperl-ts@1.1.0` bundles this exact 5.44
artifact. Declaration and bundle builds, 160 Bun tests (266 assertions),
24 lifecycle checks, 100 Asyncify rounds, 47-file package inspection, installed
Node ESM/CJS and NodeNext consumers, and npm publication dry-run all pass.

Additional checks: 17 runtime JavaScript tests; 164 native SFS assertions and
17 generator tests; shell/workflow lint; Perl loader syntax and 22 native
regression/CPAN-lock assertions using matching Perl 5.44 and WebDyne 3.026 in
the native build container. Host Perl XS installations were incompatible with
the host's recent Perl upgrade; the matching container supplied native evidence.

## Persistent Cloudflare interpreter

A separate application installed the final 5.44 npm archive and passed:

- WebDyne 3.026 / Perl 5.44.0 verification through an HTTP version endpoint.
- 45 seconds of live SSE and WebSocket traffic, cancellation/close, then
  another 45 seconds of healthy HTTP requests.
- 1,000 mixed HTTP/SSE/WebSocket rounds (6,000 requests), then sequential
  SSE completion and WebSocket echo.
- 20 abrupt WebSocket disconnects with healthy follow-up HTTP. The previously
  accepted upstream hung-request warning remains; it also reproduces without Perl.
- D1 HTML/JSON/insert/recovery, 24 concurrent reads and 8 atomic batch checks;
  KV and R2 operations and cleanup, alongside live streams.

Long-lived SSE cancellation initially exposed a separate real queue stall.
Generated Wrangler configurations now enable `enable_request_signal`, allowing
the existing abort listener to deliver PAGI disconnect and release the session.
Custom Wrangler configurations must enable this flag too; see WEBDYNE.md.

The maintainer subsequently approved the exact-final hosted upload. Cloudflare
remote preview acceptance passed using the checksum-matched final 5.44 binary:

- HTTP confirms WebDyne 3.026 and Perl 5.44.0; PSP rendering, the application
  CPAN dependency, writable /tmp and static-file checks pass.
- The 45-second live SSE/WebSocket and 45-second post-cancellation health test passes.
- 100 overlap rounds (600 requests), sequential SSE-to-WebSocket use, and
  20 forced TCP disconnects with healthy follow-up HTTP pass.
- Another 20 overlap rounds (120 requests) pass after forced disconnects.

Captured preview logs contain no WASM memory trap, SpanParent/cross-request I/O
error or hung-request diagnostic. Five `Network connection lost` diagnostics
occurred during deliberate TCP termination; service remained healthy. This does
not establish that the accepted disconnect warning can never occur in production.
Cloudflare controls isolate placement; hosted requests are not guaranteed to
share one isolate. Local persistent-interpreter evidence remains complementary.
Hosted D1/KV/R2 were not exercised. The temporary preview was stopped; no
production Worker was modified. Browser, Deno and Windows remain outside this
acceptance. Hosted evidence is in `/tmp/zeroperl-3026-approved-final-remote-*.log`.

## Integration and publication

The user authorized local main integration after these checks. The corresponding
commits contain the final manifest and this qualification record. No push or npm
publication is performed. The release may prioritize Perl 5.44 even though all
three local build/qualification targets passed.

Before publication, obtain the user's publication approval, confirm public
source/submodule access and publisher permissions, host the manifest-matched
artifacts, and configure the TypeScript artifact base URL. npm dry-run verifies
packaging; it does not prove publish permissions. Exact-final hosted stream
acceptance is now complete.

Local build/qualification logs are `/tmp/zeroperl-3026-final-build-<perl>.log`
and `/tmp/zeroperl-3026-final-qualify-<perl>.log`. Final-package local evidence
is `/tmp/zeroperl-3026-package-{lifetime,overlap,disconnect}.log`. These temporary
logs supplement this committed record; they are not distributed artifacts.
