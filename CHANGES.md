# Changes

## 1.0.15

- Added standalone WebDyne, native PAGI and optional Cloudflare KV examples
  with installation instructions and expected responses.

- Updated the bridge submodule and verifier to
  `@webdyne/webdyne-zeroperl-ts` 1.1.4; updated imports and package guidance.
- Removed obsolete development plans, benchmark reports and the disabled
  release workflow while retaining active tests and maintained documentation.

## 1.0.5–1.0.6

- Embedded WebDyne 3.028 with named lifespan callbacks and request diagnostic clearing.
- Added direct `.pagi` application loading, including lifespan acknowledgement.
- Added `.pagi` to newly generated asset ignore files.
- Corrected the release inventory for lifespan transport and bootstrap documentation.
- Consolidated public usage/configuration guides and removed obsolete review diaries.

## 1.0.3–1.0.4

- Adopted project semver and paired tags with a single build/package/staging workflow.
- Added the unsuffixed newest-Perl npm package.
- Kept reviewed notices in the lean npm package and broad evidence in release assets.

Earlier entries below record the implementation sequence; release mechanics
which they introduced may have been superseded above. See RELEASING.md for
the current process.

## CPAN manifest cleanup

- Removed all optional recommendations/suggestions from the WASM cpanfile.
- Matched pm-WebDyne's compact configure/test sections, removed duplicated
  build/test declarations, and corrected the runtime Perl minimum to 5.18.
- Reconciled all three snapshots; distribution selections and source checksums
  are unchanged, so qualified build 8 remains applicable.

## Base XS application support

- Added Sub::Name, Params::Util, Class::XSAccessor (hash and array accessors),
  Text::CSV_XS and Variable::Magic to the standard embedded runtime.
- Reconciled the supported Perl snapshots without upgrading existing locked
  distributions; Perl 5.18 also receives the required Pure Perl XSLoader update.
- Added a WASI-only Params::Util configuration patch and preserved module
  sources whose upstream executable bits previously caused them to be stripped.
- Qualified local build 8 on Perl 5.18.4, 5.36.3 and 5.44.0 with native, WASM
  and asynchronous callback tests. Compressed growth is approximately 56–58 KiB.

## Versioned WebDyne distribution pipeline

- Split the npm Worker host into a provider-neutral runtime, Fetch/PAGI
  transport, and a small default Cloudflare adapter.
- Standardized application VFS paths as `/app`, runtime launchers as
  `/perl5/bin`, optional application modules as `/perl5/lib`, and writable
  temporary storage as `/tmp` with `TMPDIR` preserved during PAGI requests.
- Made repository `app/` the default complete application source tree, added
  package.json overrides, automatic Wrangler configuration, and optional
  cached root-cpanfile installation for Pure-Perl dependencies.
- Renamed package build and deployment tooling from `script/` to `scripts/`.
- Added independent build numbers and versioned output directories for each
  qualified Perl release.
- Added manifests and SHA-256 checksum lists to every local artifact set.
- Replaced the legacy multi-version workflow with a guarded, per-version
  GitHub release candidate pipeline and signed build-provenance attestations.
- Added a separate npm candidate workflow that consumes qualified release
  bytes, validates a strict package allowlist, and leaves publication disabled.
- Renamed the npm convention to `@webdyne/webdyne-zeroperl-<perl-version>` and
  added declarative npm extension discovery, static provider imports,
  interpreter-generation registration, request attachment, and guaranteed
  cleanup.
- Added regression coverage proving that configured application directories
  are archived recursively, including nested static and support files.

## Milestone 1: runtime consolidation

- Consolidated multi-version, shrink, SFS, and build-pipeline improvements.
- Added WebDyne CPAN dependencies and required static XS support.
- Added a portable `POSIX::strftime` compatibility surface.
- Corrected destructive ABI paths for Asyncify suspension and hash deletion.
- Qualified standard release targets for Perl 5.18.4, 5.36.3, and 5.44.0;
  excluded 5.24.4 after its real WebDyne async-longjmp failure persisted with
  both 32 KiB and 64 KiB capture buffers.
- Added core, XS, embedded-prefix, and asynchronous-disposal verification.
- Replaced the line-based Socket patch with a source-layout-aware transform for
  all four investigated Perl release lines.
- Retained Perl's compatibility ABI layer through 5.36 for current WebDyne XS
  dependencies.
- Supplied portable WASI 64-bit integer formats for older Perl cross-builds,
  preventing XS callers from receiving the unsupported `%Ld` format family.
- Made ExifTool opt-in and excluded it from all standard WebDyne artifacts.
- Embedded WebDyne 3.023, PAGI::Tools 0.002002, and their runtime dependencies
  so ordinary PSP applications need no external Perl library archive.
- Verified the complete ExifTool-free matrix with core, static Socket, SFS,
  embedded-module, async-disposal, and persistent Worker render gates.
- Restored generated `unicore/Heavy.pl` when present so Perl 5.18.4 and 5.24.4
  can load version feature bundles used by Future::IO and WebDyne::PAGI.
- Cross-compiled Scalar-List-Utils 1.70 for Perl 5.18.4 so WebDyne::PAGI's
  required `Sub::Util` and the statically linked `List::Util` remain paired.
- Linked PerlIO::scalar where it is a separate core extension and
  Tie::Hash::NamedCapture on Perl 5.18 for the complete WebDyne session path.
- Increased the Asyncify setjmp capture buffer to 64 KiB while retaining the
  separate 8 MiB WebAssembly execution stack.
- Rejected the 5.44 mini candidate after its compressed size increased by
  7.3%, despite a 16.1% raw-size reduction.

## Application tooling — application setup and Cloudflare assets

- Add repeatable `webdyne-cloudflare init` and bundled login/logout/whoami.
- Initialize Scratch-compatible assets rules and disable WebDyne static serving.
- Automatically route assets through Wrangler and omit public files from VFS,
  with root gitignore semantics, custom roots and explicit asset-flag support.
- Reject misplaced ignore files and accidental public entry pages.

## Application tooling — local development tarballs

- Add `npm run pack:dev` to validate existing runtime artifacts and package current
  tooling as a private, uniquely versioned development .tgz without a release.
- Record tooling revision/dirty state separately from original WASM provenance.

## Application tooling — Worker teardown

- Add `npm run destroy` through initialization; use deployment configuration
  without an app build, require interactive full-Yes confirmation, and retain
  Wrangler's target/dependency confirmation without using force deletion.

## Unreleased: finite invocations for Durable Objects

- Add an opt-in finite result transport and `mode: "invocation"` runtime, reusing
  interpreter scheduling, session timers and awaited capability cleanup.
- Lazily load qualified Perl adapter entrypoints; expose explicit runtime disposal.
- Generate Perl Durable Object classes and SQLite namespace declarations from
  `webdyne.cloudflare.durableObjects`; preserve custom Wrangler configuration.
- Target Wrangler 4.131.1 in generated runtime packages. Cloudflare object policy
  remains in WebDyne::Cloudflare. The existing WASM ABI is unchanged.
