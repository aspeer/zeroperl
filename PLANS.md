# ZeroPerl implementation plan

1. Consolidate the divergent runtime forks into this canonical repository.
2. Build and validate standard artifacts for Perl 5.18.4, 5.36.3, and 5.44.0;
   exclude 5.24.4 after its approved 64 KiB experiment.
3. Measure a Perl 5.44.0 mini artifact and retain the target only if it passes
   the 30% compressed-size gate and the WebDyne compatibility checks.
4. Supply the verified artifacts to `zeroperl-ts` and the Cloudflare
   `wasm-WebDyne-PAGI` integration.
5. [x] Define versioned local output names and independent build numbers for
   each retained Perl release.
6. [x] Replace the legacy matrix release design with per-version GitHub release
   and npm-candidate workflows whose publishing steps are guarded or disabled.
7. [x] Validate the new workflows on GitHub in nonpublishing mode.
8. [ ] Configure the public binary distribution repository and npm Trusted
   Publisher after their external names and permissions are supplied.
9. [x] Make the versioned npm distribution self-contained for WebDyne on
   Cloudflare by including the compiled bridge, portable PAGI runtime, default
   provider adapter, Perl launchers, and application VFS/deployment tooling.
10. [x] Prove the package contract from the independent `psp-WebDyne-Time`
    example before enabling npm publication.
11. [x] Split the Worker into a portable runtime and Fetch transport with a
    small default Cloudflare adapter; adopt `/app`, `/perl5`, and writable
    `/tmp` VFS conventions and optional root-cpanfile installation.
12. [x] Add explicit npm extension discovery and interpreter/request lifecycle
    hooks; integrate the separately packaged `@webdyne/webdyne-cloudflare`
    extension without making D1 part of the core runtime.
13. [x] Generate Cloudflare Workers KV and R2 bindings from application
    package configuration while keeping their service bridges in the optional
    extension.

Release creation, npm publication, and repository merges require separate
approval. Feature-branch pushes and nonpublishing workflow runs are approved
for the current release-pipeline work.


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

## Runtime blocker fixes (authorized 2026-09-05)

- [x] Preserve borrowed callback returns and transfer fresh returned SV ownership.
- [x] Route array/hash/scalar replacement through the asynchronous runtime boundary.
- [x] Rebuild and qualify supported Perl candidates; refresh the canonical bridge.
- [x] Verify prefix inventory before generating npm embedded-file metadata.
- [x] Match npm source license metadata to the existing MIT LICENSE.
- [x] Collect and integrity-check attribution evidence; supply pinned SDK notices.

Local candidate builds use build numbers 2–5 without changing release/versions.json.
No publishing, pushing, or merging is authorized by this preparation step.

Additional matrix findings repaired: native/target XS companion drift, live C
stack overwrite during Asyncify rewind, static longjmp scratch-buffer free,
and deferred scalar destruction on Perl 5.18. Final build 5 matrix passed.

## Per-Perl CPAN snapshots (authorized)

- [x] Add explicit snapshot/reconciliation and update Make targets.
- [x] Share the configured default Perl and native tools container stage.
- [x] Consume locked source archives in native and WASM XS builds.
- [x] Generate and qualify snapshots for all three supported Perl versions.
- [x] Exercise unchanged locks, stale input rejection, and checksum failures.

## Base XS additions (2026-09-05)

Work continues from the uncommitted release preparation on
`codex/base-xs-modules`; existing changes are preserved.

- [x] Inspect Sub::Name, Params::Util, Class::XSAccessor, Text::CSV_XS and
  Variable::Magic source/build requirements.
- [x] Add explicit target recipes and shared native/WASM functional checks.
- [x] Reconcile all three supported Perl snapshots and qualify build 8.
- [x] Measure the added runtime size; retain Variable::Magic (27,791 raw bytes,
  194 gzip bytes in the controlled 5.44 comparison).
- [x] Record final evidence in TESTS.md and DECISIONS.md.

## CPAN manifest cleanup (2026-09-05)

- [x] Remove optional declarations and consolidate configure/test requirements
  to match pm-WebDyne, retaining the explicit runtime and XS requirements.
- [x] Reconcile all supported snapshots: distribution selections remain
  byte-identical; only the manifest hash changes in the integrity metadata.
- [x] Pass the 10 existing CPAN lock tests and review the manifest diff.
