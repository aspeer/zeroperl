# Backlog

Current release procedure: [RELEASING.md](RELEASING.md). Project tag staging
is implemented; verify external package bootstrap/OIDC setup and the first
tagged GitHub run. Direct publication still requires maintainer approval.

- Configure the binary distribution repository and add its GitHub App-scoped
  promotion job after the repository is supplied.
- Bootstrap the public `@webdyne` npm package names, configure npm Trusted
  Publishing for the `webdyne-zeroperl` packages with stage-only permission.
  The tag-triggered workflow is implemented; its first hosted run remains to be verified.
- [x] Rebuild and qualify final WebDyne 3.026 artifacts for all three Perls.
- Automate refreshing `js/zeroperl.js` from the canonical `zeroperl-ts`
  submodule and fail CI if the generated bridge is stale.
- Decide whether a future package should expose convenience TypeScript types;
  the package currently exposes the compiled bridge and Worker factory only.
- Qualify another serverless provider only when there is a concrete target.
  Implement its lifecycle/WebSocket adapter against the portable runtime and
  retain Cloudflare as the default provider and deployment command.


## First release review (2026-09-05)

Work is isolated on `codex/first-release-review`, based on `c1c3182`.
The user confirmed preparing from the latest implementations for eventual main
merges. No merge, push or publication was performed.

Completed: bootstrap data escaping, buffered response failure settlement,
application override preservation, async teardown awaiting, and SFS test-runner
ESM compatibility. The canonical TypeScript repository contains the companion
bridge and npm consumer fixes. See RELEASE-REVIEW.md for evidence and gates.

Runtime blockers are repaired and build 5 is qualified on Perl 5.18.4, 5.36.3
and 5.44.0. Attribution evidence and supplemental upstream license texts are
preserved. Remaining publication actions are final source/main/gitlink alignment,
public source accessibility, version selection, and the user's other release
changes. Curation of the broad notice archive is an optional size improvement.

### Additional clean-build finding

- [x] Pair every cross-compiled CPAN XS archive with its own `blib/lib` Perl
  companions. A fresh resolver installed Cpanel::JSON::XS 4.44 alongside the
  pinned 4.43 XS code; requiring it failed. The smoke suite now loads all
  deliberately linked CPAN XS modules and exercises the JSON codec.
- [x] Preserve attribution evidence before prefix comment/POD stripping;
  checksum and carry that archive with the runtime and npm package.
- [x] Supply SDK 27 wasi-libc/compiler-rt standalone notices and referenced
  third-party license files from the exact upstream revisions.
- [ ] Optionally curate the broad evidence archive to reduce npm download size
  while preserving notices for every included component.

## CPAN snapshot qualification

- [x] Complete the supported-Perl snapshot/build matrix and negative lock tests.
- [ ] Audit additional XS dependencies before adding them to the runtime profile.

## Base XS additions

- [x] Add and qualify the approved four-module batch plus the small
  Variable::Magic dependency on all three supported Perl versions (build 8).
- [x] Refresh the canonical bridge from build 8 and qualify its package.
- [ ] Confirm public bridge repository access and npm publishing configuration;
  publication remains disabled pending approval.

## Final acceptance follow-ups

- [x] Prevent a caught API error from leaking into the next Worker request.
- [ ] Improve WebDyne core handling of caught exceptions within a request;
  the runtime adapter currently clears inherited diagnostics at request entry.
- [ ] Reduce upstream startup warnings from Opcode and CGI::Simple::Cookie
  after verifying changes against every supported Perl version.
- [x] Fix SSE completion followed by WebSocket startup trapping in the same
  persistent interpreter: corrected Asyncify re-entry stack restoration.
  Reproducer: `tests/runtime/smoke-stream-sequence.mjs` and adjacent fixtures.
- [x] Register all Cloudflare session completions with waitUntil; original
  overlapping-request context cancellation no longer reproduces on Perl 5.44.0.
- [x] Isolate forced-WebSocket hung-request diagnostics: standalone JavaScript
  reproduces them on two workerd versions; WebDyne sessions complete cleanup.
- [x] Maintainer accepts the abrupt-disconnect warning as a known limitation.
  Standalone reproduction: `tests/runtime/hung-request`.
- [x] Fix long-lived SSE cancellation with enable_request_signal and pass
  final-package local lifetime/overlap acceptance. Earlier 3.026 hosted tests pass.
- [x] Repeat hosted acceptance with the exact final binary after upload approval;
  lifetime, overlap and disconnect recovery pass. See RELEASE-QUALIFICATION.md.

- [x] Pin the corrected bridge implementation at 7e91d2c and retain the virtual
  WASM resolver. See RELEASE-QUALIFICATION.md for current source/artifact refs.
