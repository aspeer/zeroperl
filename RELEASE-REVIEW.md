# First release review — 2026-09-05

## Current status (2026-09-06)

WebDyne 3.026 final build 1 passes qualification on Perl 5.18.4, 5.36.3 and
5.44.0. Final 5.44 npm-package local stream/storage acceptance passes, including
sustained SSE cancellation after enabling Cloudflare request signals. Earlier
3.026 hosted stream tests pass; repeating them with the exact final binary
requires upload approval. The abrupt-WebSocket-disconnect warning is accepted.
See [RELEASE-QUALIFICATION.md](RELEASE-QUALIFICATION.md) for exact source refs,
checksums, evidence, limitations and remaining publication prerequisites.
The dated records below preserve earlier findings and are superseded by that
record where they describe old artifacts or outstanding runtime defects.


## Release assessment

Local preparation is on `codex/first-release-review` in both canonical repos.
The callback ownership and asynchronous replacement defects are repaired and
pass the new lifecycle checks on rebuilt Perl 5.44.0. A fresh build additionally
exposed mismatched Cpanel::JSON::XS Perl/XS versions; the pipeline now installs
Perl companions from their exact target builds. Candidate build 5 passes
qualification across Perl 5.44.0, 5.36.3, and 5.18.4.

The user approved preparing from the latest implementations and explicitly
requested no publication. No push, merge, or publication has been performed.
Review baselines remain runtime `c1c3182` and bridge `d471917`.

## Repaired runtime release blockers

- **Callback ownership:** C captures a borrowed return before freeing argument
  handles. An independent return transfers its owned SV reference without an
  extra increment. The bridge invalidates expired/transferred wrappers and
  rejects reference-count changes on borrowed arguments. Regression checks
  include identity, rejected promises, exact object destructor counts, and
  values from another interpreter (returns, setters, and calls).
- **Asynchronous replacement:** array/hash setters and scalar assignment run
  through the asyncjmp boundary. Bridge setters retain their temporary values
  and C strings until completion and expose `MaybePromise<void>` while keeping
  the ordinary synchronous path. Tests verify completion before subsequent eval.
- **XS companion drift:** fresh CPAN resolution installed Cpanel::JSON::XS 4.44
  while the target archive was pinned to 4.43. Requiring the module failed with
  a bootstrap version mismatch. Both target build helpers now install their
  own `blib/lib` files. Native site files cannot replace these target companions.
  The smoke suite loads every deliberately linked CPAN XS module and tests JSON.

Direct bridge getters/conversions/collections do not promise tied or overloaded
magic support. Perform those operations through Perl eval/call. General wrapper
use after interpreter reset/disposal and concurrent entry remain lifecycle
improvement work; callers must follow the documented lifetime/serialization rules.

- **Asyncify rewind stack:** the 5.36 matrix exposed a rejected-callback trap.
  Restarting the export to rewind could overwrite live C stack frames before
  saved WASM locals were restored. The bridge now preserves space below those
  frames through both the wait and the rewind call. Rejected callbacks recover
  correctly across all three supported versions.
- **Perl 5.18 scalar cleanup:** older `sv_setsv` mortalizes an overwritten
  reference. Scalar replacement now opens/drains its own temporary scope within
  the async boundary, so destruction belongs to the setter's completion.
- **Longjmp scratch ownership:** recovery no longer attempts to free the static
  scratch buffer used by `_asyncjmp_longjmp`. This was a separate invalid-free
  defect found while investigating the older runtime error paths.

## Artifact and attribution preparation

- `tools/build-bridge.ts` regenerates `js/zeroperl.js` from the canonical bridge.
- npm packaging checks prefix contents/count/size against the manifest before
  deriving its embedded-file inventory. A same-size tampering regression passes.
- npm source metadata now agrees with the runtime's existing MIT LICENSE.
  The generated Apache bridge's license and notice are included separately.
- Builds collect attribution evidence before stripping comments/POD, including
  Perl/CPAN source notices and compression-library notices. The checksummed
  archive is carried with release artifacts and npm packages. This is an
  overinclusive evidence inventory, not a completed legal coverage assessment.
- The installed SDK contained no standalone toolchain license files. The exact
  SDK 27 wasi-libc/compiler-rt notices and wasi-libc's referenced licenses are
  now included separately, with upstream revision URLs and content hashes.
- The interpreter build now copies only the needed compatibility headers,
  shims and SFS sources before compilation; C bridge changes can reuse those
  expensive cached layers.

## Remaining release actions

1. Finish the user's other pre-release changes. Candidate builds 2–5 do not
   select the first public version or change `release/versions.json`.
2. Bring the reviewed source and generated bridge together on the intended
   main branches and update the runtime's `zeroperl-ts` gitlink. Current main
   remains old, and the configured TypeScript remote has no main branch.
   The gitlink still points to `c72bf69`; candidate manifests honestly record
   a dirty source tree. Final release artifacts must use the final source refs.
3. Make the configured public TypeScript source/submodule URL available before
   fresh-clone CI. An earlier unauthenticated GitHub check returned Repository
   not found. No remote changes are authorized by this preparation task.
4. Review and, if desired, curate the broad attribution evidence before npm
   publication. The 5.44 evidence archive is about 19 MB, mostly SDK source
   notices; it is stored once in the TypeScript package. The missing standalone
   toolchain notices have been supplied. Distinguish linked modules from
   build-only evidence when reducing this collection.
5. Complete real browser/Worker/Deno/Windows acceptance where these targets will
   be advertised. Local Node/Bun tests do not replace those platform checks.

## Implemented and verified fixes

- TypeScript large integer conversion no longer wraps through the int32 ABI;
  explicit createInt/createUInt APIs remain 32-bit.
- Perl hash projection and memory-filesystem directories preserve prototype
  names such as `__proto__` and `constructor` as ordinary keys.
- Bundled WASM loading handles escaped local paths and exact Node Buffer views;
  HTTP failures produce useful diagnostics. Browser worker contexts are
  recognized without requiring window/document.
- UTF-8 stdout/stderr decoding retains partial characters across writes.
- WASI random_get chunks calls at 64 KiB; clock_res_get writes the entire
  uint64 result and reports millisecond realtime resolution.
- Empty C strings get a real terminator; argv construction refreshes memory
  views after allocations that could grow memory.
- Preserve the tested call() empty-result/getLastError() API. Runtime callers
  now inspect the error before clearing it, so a caught Perl exception fails
  the session instead of being silently discarded. The API contract is documented.
- Build failures propagate; packed ESM and CJS declarations resolve under
  NodeNext. Package checks execute the archive from paths with spaces and #.
- Runtime bootstrap configuration uses encoded data instead of interpolating
  JSON inside a Perl double-quoted string. Dollar signs, at signs, backslashes,
  quotes, and Unicode are preserved.
- VFS deduplication retains differing application overrides across libraries.
- Invalid Fetch response construction can now settle with a 500 response
  instead of leaving the response promise pending.
- Runtime teardown awaits asynchronous disposal.
- The SFS generator harness works under the repository's ESM package scope.
- npm-facing installation instructions distinguish the standalone bridge from
  versioned WebDyne runtime packages and from the pre-Asyncify reactor.

## Verification

- Bridge: 160 ordinary tests; 24 targeted lifecycle checks on the rebuilt 5.44
  candidate; declaration and bundle generation.
- Packed ESM/CJS: identity and asynchronous replacement, plus strict NodeNext
  consumers, on Node 22, 24 and 26; extracted paths include spaces and #.
- Runtime: 17 JavaScript tests, including native Perl bootstrap data round trip
  and prefix tampering; native core module smoke passes on Perl 5.42.2 with its
  existing IO::File skip. These Perl smoke scripts are marker-based, not TAP.
- Rebuilt candidate 2: core/module/embedded-INC, socket XS, and 11 asynchronous
  C ABI release/replacement cases pass. It exposed the separate Cpanel::JSON::XS
  version mismatch and is superseded by candidate 3.
- Candidate 5 matrix: all versions pass core/module/static-XS smoke, 24 bridge
  lifecycle checks, 11 C ABI release/replacement cases, ten external async
  releases, and attribution inventory verification. Binary/config/manifest/
  notice checksums and prefix inventories pass.
- Runtime npm tarball: 38 files match the release workflow allowlist; the
  extracted package's generated bridge passes all 24 lifecycle checks.
- Final bridge npm tarball: 45 files; ESM/CJS and strict NodeNext consumers pass
  on Node 22, 24 and 26. Its bundled WASM and evidence archive match the manifest.
- Prior review SFS checks: native harness 164 assertions and generator 17 tests.
- Shell syntax and changed release workflows pass validation. No publication.

## Further improvement opportunities

1. Extend lifecycle enforcement to wrappers used after interpreter reset/disposal
   and to concurrent or recursive interpreter entry. Borrowed/transferred values,
   foreign values and rejected host promises now have regression coverage.
2. Consolidate duplicated fd_open/path_open handling and complete/document
   append flags, descriptor rights, missing parent directories, partial readdir
   buffers and UTF-8 preopen names. Current VFS is a WASI subset, not a complete
   POSIX filesystem.
3. CPAN distribution versions and source checksums are now locked per target
   Perl; ordinary builds use Carton deployment mode without a resolver fallback.
   Pinning the complete compiler/container toolchain and proving byte-for-byte
   reproducibility remain optional work outside the requested module consistency.
4. Curate the broad attribution evidence archive to reduce npm download size;
   prefix and attribution hashes are now enforced by the package builder.
5. Add complete transport integration checks to release CI, including failures
   after response start, cancellation, backpressure, and repeated runtime resets.
6. Consider reducing duplicated WASM payloads in the ESM/CJS archive only after
   preserving bundler and package-relative loading behavior. Keep this separate
   from the correctness fixes.

## CPAN snapshot implementation (2026-09-05)

Implemented `make cpanfile.snapshot` and `make cpanfile.snapshot-update`, with
`PERL_VERSION` defaulting to 5.44.0 through `release/defaults.mk`. Snapshots
contain 81 distributions for 5.18.4 and 69 each for 5.36.3 and 5.44.0. Companion
metadata binds input hashes and source archive checksums. Native Carton
deployment installation and static WASM recipes consume the same locked
archives. Native XS libraries without a recipe or core counterpart are rejected.

All three local build-6 runtimes passed core/module smoke tests, 24 lifecycle
checks each, and the snapshot-to-runtime XS version check (9 modules on 5.18;
8 on 5.36/5.44). Lock tests passed 10 cases on each Perl. Repeating the default
snapshot target preserved both files byte-for-byte; the update target passed
on 5.36. All 17 JavaScript tests pass. The refreshed TypeScript candidate passes
160 tests, its build and actual npm tarball check.

Carton exposed a native Perl 5.18 Errno generator incompatibility with GCC line
markers; suppressing them restores EINTR/EPIPE. Bootstrap MakeMaker is updated
before Carton. These fixes do not change the WASM target core implementation.

Carton and cpanminus caches exposed duplicate attribution inventory entries.
The collector now records each destination once and prefix preparation verifies
the archive. Build-6 output archives were repaired using the same last-record
rule, retaining all payload files; manifest/checksum files were refreshed.
Verified inventories contain 11518, 11296 and 11538 files for 5.18, 5.36 and
5.44. Existing build-6 container images precede this inventory repair; use the
verified output directories or rebuild from final source. WASM binaries were
unchanged by the archive repair.

The default runtime npm candidate and canonical TypeScript bundled runtime now
use local build 6. Release version configuration is unchanged. No commit, push,
merge, release or npm publication was performed.

## Main-source cleanup

The bridge implementation is committed and pinned by the runtime submodule.
The generated bridge has been refreshed from that exact checkout. The existing
first-release numbering is retained: runtime build 1/package 1.0.0 for each
Perl, bridge package 1.1.0. Final publication artifacts must be rebuilt from
clean commits; local build-8 outputs remain qualification evidence. GitHub's
public runtime repository is accessible; its API still cannot resolve
aspeer/zeroperl-ts. Public source availability and npm publisher setup remain
external release prerequisites. No remote push or publication is performed.

### Final acceptance: publication blocker

Clean main-source builds for all three supported Perls passed native/WASM
module checks, locked XS version comparison, 24 lifecycle checks per build,
Asyncify release probes, socket smoke, notice verification and checksums.
The refreshed bridge passed 160 tests and its 47-file package verification.

Local Wrangler acceptance found and fixed a caught D1 error leaking into the
next KV request (12 native regression assertions; three D1/KV/R2 sequences).

The SSE-to-WebSocket memory trap is repaired by correcting two Asyncify stack
restorations in the TypeScript bridge. The regenerated bridge passes 17 runtime
JavaScript tests; the three supported Perl binaries each pass the new 100-round
re-entry regression and 24 lifecycle checks. Sequential local Worker streaming
acceptance passes with the correction. See DECISIONS.md D011 and TESTS.md.

The approved provider correction retains all session completions with `waitUntil`.
The original context cancellation no longer reproduces in 1,000 overlap rounds
on Perl 5.44.0, including concurrent storage checks. Forced WebSocket termination
still emits a separate hung-request diagnostic. Publication remains paused for
that investigation and hosted acceptance; see CLOUDFLARE-CONTEXT-INVESTIGATION.md.
Fixtures for sequential acceptance remain in `tests/runtime/stream-sequence`;
run `node tests/runtime/smoke-stream-sequence.mjs http://127.0.0.1:PORT/`.
