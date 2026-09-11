# Backlog

## Release follow-up

- Qualify an update to the pinned Wrangler toolchain. The 2026-09-11 consumer
  audit reports GHSA-rgj7-g3m4-5g8c in sharp through Miniflare/Wrangler
  (four high-severity dependency entries). npm reports no automatic fix for
  this pinned runtime package; do not mistake offline audit output for clearance.

- Confirm the current npm status before announcing a version. The last recorded
  1.0.6 workflow staged the Perl-specific package but hit E401 on the unsuffixed
  alias. Check that name's Trusted Publishing configuration and the existing
  candidate before retrying. See [RELEASING.md](RELEASING.md).
- Add reviewed licence inventories before selecting Perl 5.18/5.36 for npm
  release packaging. Their runtime builds are supported; the current release
  selection is 5.44.0.
- Automate refresh/verification of the compiled bridge against the canonical
  zeroperl-ts source, so an outdated generated bridge cannot reach a release.

## Runtime and tooling

- Watch server-side application/library files and `.assetsignore` during dev.
  For now, rebuilding or restarting Wrangler is required after those changes.
- Add graceful shutdown dispatch for controlled interpreter disposal. Do not
  promise callbacks on isolate eviction or WASM traps.
- Add Perl-owned lifespan state and request-state propagation.
- Define interpreter-lifetime service capabilities before permitting shared
  D1/KV/R2 objects during startup. Current handles belong to one request.
- Qualify asynchronous/background lifespan work under Worker request ownership.
- Investigate remaining Opcode and CGI::Simple::Cookie startup warnings.
- Measure hosted PAGI JSON performance if profiling warrants it; local runner
  benchmarks exclude rendering, bridge crossings and network overhead.
- Qualify another provider when there is a concrete target.

Plain `.pagi` applications, WebDyne lifespan callbacks and per-request diagnostic
clearing are implemented. They are no longer development tasks.
