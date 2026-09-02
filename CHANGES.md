# Changes

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
