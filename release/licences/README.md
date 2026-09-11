# Reviewed runtime notices

The npm package contains `THIRD-PARTY-LICENSES.txt`, rendered by
`tools/runtime-notices.py` from the matching JSON inventory here. Packaging
never decides a new component's licence using a keyword scan. The broader
collection and this inventory remain available in the GitHub licence archive.

The current reviewed profile is Perl 5.44.0 with the default embedded WebDyne
build, shrink off, with WebDyne and dependency versions recorded in `5.44.0.json`.
Other Perl
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

## Automated proposal and verification

After building the current release with `./build.sh run off`, run:

```sh
make licence-review
```

The target selects `PERL_VERSION` and the version in `release/versions.json`.
It verifies the build artifacts and attribution archive, locates the original
archive matching the committed policy's `evidenceSha256` under `output/`, and
carries forward byte-identical notice excerpts into a proposed inventory.
Versioned CPAN paths and moved excerpt offsets are updated automatically.
It uses the package preparer's verified embedded inventory rather than a
separate implementation of library precedence.

Output is written to `output/licence-review/<perl>-<release>/`:

- `report.json`: changes, blockers and verification status.
- `evidence.diff`: all attribution source changes, including text outside the
  previously selected excerpts. Inspect this for additional notices.
- `candidate.json`: a complete proposed policy when matching succeeds.
- `incomplete.json`: a proposal requiring manual completion when matching fails.
- `package/` and `tarball/`: locally prepared and size-checked npm artifacts.

Successful matching runs notice tests, package tests, actual package preparation,
`npm pack --ignore-scripts` and the npm content/size gate. Nothing is published,
committed, or copied over the reviewed policy. A successful exit means a verified
proposal, not a legal determination: unchanged selected text does not establish
that no additional obligations were introduced. Inspect the evidence diff before
adopting the candidate as `release/licences/<perl>.json`.

Changed/missing or ambiguous excerpts, new/removed evidence files or distributions,
and changes to build inputs other than the dependency snapshot stop the refresh.
Repository notice changes also require review. The snapshot's distributions must
match the evidence and explicitly excluded bootstrap tools. No licence text is
inferred from package metadata or silently replaced.

Override the artifact manifest or baseline archive explicitly when necessary:

```sh
make licence-review PERL_VERSION=5.44.0 \
  LICENCE_MANIFEST=/absolute/path/manifest-5.44.0-1.0.8.json \
  LICENCE_BASELINE=/absolute/path/third-party-notices-5.44.0-1.0.5.tar.gz
```

The baseline override must still match the committed review's evidence checksum.
Keep that archive available after adopting a new policy: the next refresh needs
its original notice bytes. Failed verification returns nonzero; inspect the report
and terminal output. CI continues to verify the committed inventory normally.

## Adopt and commit in one command

After inspecting a successful review's evidence diff, run:

```sh
make licence-commit
```

This checks that Git has no pre-existing staged changes, adopts the verified
candidate, checks whitespace, and commits the explicitly listed licence tooling,
policy, dependency snapshot and supporting documentation files. Other working-tree
files are left alone. It works on the current branch and does not merge, create
release tags or push. Repeating it with no changes creates no extra commit.

Use `make licence-adopt` to update the policy without committing. Adoption checks
the candidate and manifest hashes saved by the successful review, rejects a policy
edited since review, and reruns actual package preparation against current artifacts
and build inputs before replacing the policy atomically. Old reports without these
hashes require a fresh `make licence-review`. Both targets accept the same Perl and
manifest overrides as the review target.

Once these changes are on clean `main`, `make release` remains the command to bump
the release version and create paired tags; run its printed push command to start CI.
