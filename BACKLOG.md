# Backlog

- Configure the binary distribution repository and add its GitHub App-scoped
  promotion job after the repository is supplied.
- Bootstrap the public `@webdyne` npm package names, configure npm Trusted
  Publishing for the `webdyne-zeroperl` packages, and replace the deliberately
  disabled final publication message with an approved OIDC publish step.
- Rebuild and requalify final build-numbered artifacts for Perl 5.18.4 and
  5.36.3 after the 5.44.0 release workflow is proven.
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
