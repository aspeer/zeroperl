# Reviewed runtime notices

The npm package contains `THIRD-PARTY-LICENSES.txt`, rendered by
`tools/runtime-notices.py` from the matching JSON inventory here. Packaging
never decides a new component's licence using a keyword scan. The broader
collection and this inventory remain available in the GitHub licence archive.

The current reviewed profile is Perl 5.44.0 with the default embedded WebDyne
build, shrink off, WebDyne 3.027 and the pinned CPAN snapshot. Other Perl
versions require their own inventory before npm packaging. This is an artifact
qualification restriction, not removal of their build support.

## Scope and selection

The 5.44.0 inventory covers 74 installed CPAN distributions and eight additional
component groups: Perl, zlib, bzip2, LZ4, the bridge, WASI runtime libraries,
Unicode data and the Asyncjmp/ZeroPerl code. A dependency is not excluded just
because CPAN categorizes it as a build/test dependency: if its modules remain
embedded, its notices remain included.

Each source record identifies the original file, its SHA-256 and the selected
byte ranges. Ranges preserve complete grants, copyright notices and exceptions.
Core/vendor C notices are included as well as top-level distribution licences.
Author lists explicitly incorporated by copyright notices are retained.

Common complete Apache-2.0 and Artistic-2.0 texts are shared by their components;
LLVM exceptions and component copyright statements are retained separately.
Identical excerpts are deduplicated after comparing whitespace-normalized text;
the first excerpt is emitted verbatim. No legal words are rewritten. POD and
comment formatting may remain in the text. Where Perl's dual licence permits
it, redistribution uses Artistic; separable, unselected GPL alternatives are
excluded. Upstream alternatives remain in the broader attribution archive.

Removed material includes the absent CPAN distributions listed in the JSON,
standalone manuals and examples, generated portability-tool bodies, disabled
Perl allocator/EBCDIC implementation material, and full allocator/SDK source.
Small allocator grants, applicable SDK licences and referenced contributor
credits remain. Unicode data notices are supplemented with their licence texts;
source URLs and hashes are recorded in `licenses/supplemental/SOURCES.json`.

## Review guards

The inventory binds the Perl version, build profile, snapshot, static-XS and
build scripts, bridge source, every delivered path and non-generated payload
hash, and each selected notice source. Packaging first verifies the build
manifest and prefix inventory, then enforces these review guards. A new module,
version, source licence or linking change fails packaging until reviewed.

Host metadata contents (`.meta`, `.packlist`, `Config_heavy.pl`) are excluded
from the content fingerprint, but their paths remain checked. Their contents
include host paths, JSON ordering and configuration details. Generated Errno.pm
has a separate hash for its complete copyright POD section, because host errno
constants move that section. This produces byte-identical notices from the
qualified local aarch64 and GitHub x86_64 artifacts.

The top-level evidence/prefix/config hashes are the original review's provenance,
not a demand for byte-identical compiler-host metadata. The manifest's live
attribution checksum is still verified on every package operation.

## Updating an inventory

1. Build the new target and inspect its manifest, embedded file inventory and
   untrimmed attribution archive. Review new/removed distributions, linked XS
   components and changed licence files; do not rely only on META license tags.
2. Update the affected source paths, ranges, component mappings and hashes.
   Read the complete surrounding licence section before shortening a range.
   Add supplementary upstream texts when a retained notice refers to them.
3. Refresh the payload identity and build-input hashes after reviewing those
   changes. Do not merely accept new hashes to bypass a stale-review error.
4. Run the notice tests, package tests and actual package preparation. Verify
   important component notices, the archive inventory and the final npm size.
   A changed host should produce identical notices unless its payload differs.

`payload_identity()` in `tools/runtime-notices.py` computes the reviewed identity
from `embedded-files.json`. The package preparer supports `--notice-policy` for
an explicitly reviewed alternate inventory; normal releases use this directory.
The notice text has a 500 KB raw budget and npm retains a 6 MB compressed budget.
No full source bodies or nested evidence archives should be added to npm.
