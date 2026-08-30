# Changes

## Milestone 1: runtime consolidation

- Consolidated multi-version, shrink, SFS, and build-pipeline improvements.
- Added WebDyne CPAN dependencies and required static XS support.
- Added a portable `POSIX::strftime` compatibility surface.
- Corrected destructive ABI paths for Asyncify suspension and hash deletion.
- Added standard release targets for Perl 5.18.4, 5.24.4, 5.36.3, and 5.44.0.
- Added core, XS, embedded-prefix, and asynchronous-disposal verification.
- Replaced the line-based Socket patch with a source-layout-aware transform for
  all four supported Perl release lines.
- Retained Perl's compatibility ABI layer through 5.36 for current WebDyne XS
  dependencies.
- Supplied portable WASI 64-bit integer formats for older Perl cross-builds,
  preventing XS callers from receiving the unsupported `%Ld` format family.
- Made ExifTool opt-in and excluded it from all standard WebDyne artifacts.
- Verified the complete ExifTool-free matrix with core, static Socket, SFS,
  and async-disposal gates.
- Restored generated `unicore/Heavy.pl` when present so Perl 5.18.4 and 5.24.4
  can load version feature bundles used by Future::IO and WebDyne::PAGI.
- Cross-compiled Scalar-List-Utils 1.70 for Perl 5.18.4 so WebDyne::PAGI's
  required `Sub::Util` and the statically linked `List::Util` remain paired.
- Rejected the 5.44 mini candidate after its compressed size increased by
  7.3%, despite a 16.1% raw-size reduction.
