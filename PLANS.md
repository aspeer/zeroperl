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

## Final main acceptance

- [x] Commit the reviewed runtime and bridge and prepare local main branches.
- [x] Build and qualify Perl 5.18.4, 5.36.3 and 5.44.0 from clean source.
- [x] Add a request-entry compatibility fix for WebDyne's retained error stack,
  with native regression coverage and local Worker storage-sequence acceptance.
- [ ] Publish only after explicit approval and public source/publisher setup.

## Source-only bridge checkout

- [x] Resolve the bridge WASM import virtually so compiling the embedded bridge
  does not require a binary in the canonical TypeScript checkout.

## Asyncify re-entry correction (2026-09-05)

- [x] Restore root stack before export re-entry and suspended stack at import rewind.
- [x] Qualify scalar/list results, repeated yields, host allocations and rejected
  callbacks on Perl 5.18.4, 5.36.3 and 5.44.0; all 24 lifecycle checks also pass.
- [x] Regenerate the runtime bridge from the corrected TypeScript source.
- [x] Implement approved Cloudflare waitUntil correction for all sessions and
  qualify overlap, storage and long-lived WebSocket behaviour locally on 5.44.
- [x] Investigate forced WebSocket termination diagnostics and qualify hosted
  request lifetimes with the final 5.44 binary. Publication is not approved.

## Forced WebSocket disconnect investigation

- [x] Reproduce with session-completion and extension-release tracing on 5.44.
- [x] Isolate the same warning in a standalone JavaScript Worker on two workerd
  versions; retain a dependency-free reproduction and remove instrumentation.
- [x] Recheck normal overlap after forced disconnects.
- [x] Complete the separately authorized hosted comparison.
- [ ] Pursue upstream resolution of the accepted disconnect diagnostic.

## WebDyne 3.026 final release qualification

- [x] Reconcile all supported CPAN snapshots with WebDyne exactly 3.026.
- [x] Integrate the corrected bridge source and restyled Perl loaders.
- [x] Build and verify final artifacts and npm consumers for all supported Perls.
- [x] Run local Cloudflare mixed traffic and storage acceptance with 3.026.
- [x] Merge qualified feature branches into local main; publication stays paused.

Final evidence: [RELEASE-QUALIFICATION.md](RELEASE-QUALIFICATION.md). Exact-final
hosted preview acceptance passes. npm publication remains approval-gated.


## Project tags and npm staging

- [x] Use a single project version and paired annotated project/v tags.
- [x] Add make release for local version preparation and atomic tag creation.
- [x] Consolidate build, package verification and stage-only submission.
- [x] Restrict automatic staging to project release tags; normal pushes do not stage.
- [ ] Configure/verify the npm stage-only trusted publisher and run the first
  tagged workflow after main integration and an explicitly initiated tag push.

See RELEASING.md for the current release procedure. Earlier entries describing
per-Perl numbering or disabled staging are historical.


## Lean 1.0.3 npm release

- [x] Exclude the reactor and full source-evidence archive from npm.
- [x] Retain deduplicated verbatim license/notice texts and SDK/bridge licenses.
- [x] Add a 10 MB package budget and reject diagnostic payloads in npm.
- [x] Build and qualify 1.0.3, including packed runtime consumers.
- [ ] Push/stage only when initiated by the maintainer; no public publication.

## GitHub-hosted third-party licences

- [x] Replace npm licence payloads with a versioned release link and checksum.
- [x] Create a deterministic licence archive with build provenance and inventory.
- [x] Publish and verify licence assets before npm staging; reject replacements.
- [x] Qualify the revised 1.0.3 package and update the unpublished local tag pair.
- [ ] Push the release to publish licence assets and stage npm when initiated.

## Minimal propagated runtime notices

- [x] Inventory the delivered Perl/CPAN/static-library payload and notice sources.
- [x] Deduplicate shared terms; preserve component copyright notices/exceptions.
- [x] Supplement Unicode licences and compiler-rt's referenced contributor list.
- [x] Bind packaging to the reviewed inventory, allowing known host metadata differences.
- [x] Confirm identical notices from local and GitHub build evidence.
- [x] Qualify the final 1.0.3 package and update unpublished release tags.
- [ ] Add separate inventories before packaging Perl 5.18/5.36 variants.
- [ ] Push/stage when initiated by the maintainer; no npm approval performed.

## Application initialization and Cloudflare assets (2026-09-07)

Work on the requested `development` branch, based on the existing local main.

- [x] Add repeatable initialization and bundled Wrangler authentication commands.
- [x] Share root `.assetsignore` semantics between VFS selection and Wrangler assets.
- [x] Verify custom roots, ignore patterns, preserved configuration, and local serving.
- [x] Document workflow and archive ownership; review the final diff.

No push, release, deployment, or merge is part of this change.

## Local development package (2026-09-07)

- [x] Add a repeatable private development tarball command using verified WASM.
- [x] Verify version provenance and install/init/build from the actual tarball.
- [x] Deliver the artifact and document local installation versus npm init.

## Confirmed Worker teardown (2026-09-07)

- [x] Add destroy, explicit confirmation, and no-build configuration reuse.
- [x] Test cancellation, acceptance, noninteractive rejection and force rejection.
- [x] Build and verify the updated local development tarball.


## Latest-Perl npm alias and WebDyne 3.027 (2026-09-07)

The maintainer authorized work on development, verification, merging to main,
pushing to GitHub for a tagged build/staging run, and removal of merged branches
locally and from github/origin. npm approval remains manual.

The versioned npm name retains its Perl suffix; the unsuffixed name duplicates
only the greatest supported Perl version. Both use the same project semver and
runtime bytes. Each package has independent npm trusted-publisher configuration
and staging/approval. Refresh CPAN locks and review the 3.027 notice inventory
before qualification. Download any first-name seed candidate locally.

Qualification complete: both package identities, native/wasm regressions,
notice preservation, and installed-alias SSE/WebSocket acceptance pass.
See RELEASE-QUALIFICATION.md for evidence. Proceed with the authorized
main merge, paired 1.0.4 tags and GitHub staging build.


GitHub run [34116837410](https://github.com/aspeer/zeroperl/actions/runs/34116837410)
rebuilt clean tagged commit `4d2593f` and passed qualification for both packages.
It published/verified the licence assets and successfully staged the Perl-specific
1.0.4 package. Only alias staging failed: npm returned 404 because the unsuffixed
name needs its first publication. The attested alias was downloaded to
`dist/downloads/github-34116837410/alias/tarball/` and its SHA-512 pack integrity
was verified. Local `NPM-SEED.md` contains exact upload and trusted-publisher
instructions. No npm publication or approval was performed by this task.

Only main and development remain locally and on github/origin, verified against
remote heads after deleting branches already contained in main. Both branches
contain the release changes; development tracks origin/development.


## Conventional test directory (2026-09-07)

Move tests/ to t/ on development, preserving its subdirectory structure and
keeping t.js/ for JavaScript package tests. Update Docker, CI, smoke runners
and documentation; refresh the reviewed Dockerfile hash for the path-only
change. Verify native, WASM and release-tooling checks from the new locations.

Completed: all 26 test files moved and old path references removed. Verification
passes: 45 JavaScript tests, four Python notice tests, SFS C/generator suites,
12 native request assertions, 10 container CPAN-lock assertions, WASM smoke,
actionlint and npm package preparation with the refreshed inventory hash.
The separate host-native XS test cannot start because Sub::Name is missing;
no dependency installation or release rebuild was performed for this rename.


## Cloudflare CLI cleanup (2026-09-07)

Completed on `codex/cloudflare-cli-cleanup`: documented every function in
`scripts/webdyne-cloudflare.mjs`, moved option lookup setup outside the parser
loop, and shared check/deploy dry-run dispatch. Configuration and command
behavior are preserved. D1/KV/R2 binding translation remains in the deployment
CLI; service calls and Perl marshalling belong to `pm-WebDyne-Cloudflare`.
Validation: all 45 JavaScript package tests and Node syntax checking pass.
No Perl or WASM runtime changes, dependency additions or publication.


## Basic PAGI lifespan startup (2026-09-07)

Implemented on the user-requested `development` branch, preserving existing
uncommitted work. This first step connects the host to the existing
`WebDyne::PAGI::handler_lifespan` through the normal application interface.

- [x] Add a dedicated startup transport using the existing PAGI session runner.
- [x] Gate first requests on `lifespan.startup.complete`, once per interpreter
  generation, with a 10-second acknowledgement timeout and failure containment.
- [x] Retain the lifespan session until interpreter retirement; release pending
  host waits during reset without attempting to re-enter a broken interpreter.
- [x] Verify native WebDyne, real Perl 5.44 WASM, and local Worker HTTP/SSE/WS.
- [x] Document the limited scope and subsequent increments in BACKLOG.md.

No custom callback configuration, lifespan state propagation, generic app
loading, service capability changes, or graceful shutdown dispatch is included.
No WASM rebuild, commit, push, merge or deployment was performed for this step.

## PAGI runner JSON optimization (2026-09-07)

- [x] Preserve the current working runner as the benchmark baseline.
- [x] Replace per-operation JSON::PP allocation with a shared bundled
  Cpanel::JSON::XS codec on `codex/pagi-runner-json-xs`.
- [x] Compare warmed native/WASM runner benchmarks and validate JSON semantics,
  lifespan integration, and package tests. See `t/runtime/bench-runner.pl.md`.


## Named lifespan callbacks (2026-09-07)

After successful native/WASM tests, portable startup/shutdown callbacks were
merged into `pm-WebDyne` main as `645cf4d5`. Continued on this repository's
existing development branch without modifying its earlier checkpoints.

- [x] Validate `webdyne.lifespan.startup` and `.shutdown` function names.
- [x] Emit generated Worker bindings and translate them into bootstrap config.
- [x] Load modules, resolve coderefs and pass both callbacks to WebDyne.
- [x] Reject older embedded cores that would silently ignore callback options.
- [x] Test native bootstrap, async startup in WASM and local Worker HTTP/SSE/WS.

No core binary rebuild, shutdown host dispatch, shared state or Cloudflare
capability changes are included. Source and runtime compatibility requirements
are documented in WEBDYNE.md.

## 1.0.5 release

- [x] Merge development and pin the published WebDyne 3.028 archive.
- [x] Add direct `.pagi` entry dispatch and default private asset rules.
- [x] Remove bootstrap error clearing, qualify the new WASM and npm payload,
  and update the reviewed WebDyne attribution inventory.
- [x] Push paired release tags; 1.0.5 exposed a stale CI file list, corrected
  in 1.0.6 without changing application code.
- [x] Confirm 1.0.6 Perl-specific npm staging after full GitHub qualification.
- [ ] Correct npm authentication/Trusted Publishing for the unsuffixed alias;
  its qualified 1.0.6 candidate received E401 and was not staged.
