# Third-party notices

The runtime source is distributed under the MIT license in `LICENSE`.
The generated JavaScript bridge comes from `aspeer/zeroperl-ts`; its Apache 2.0
license and attribution notice are preserved in `licenses/zeroperl-ts-*`.
These source licenses do not replace the licenses of the interpreter or its
embedded modules.

Release artifacts also contain Perl, CPAN modules, WASI libc/compiler support,
zlib, bzip2, and LZ4. The build strips comments from embedded Perl sources, so
notices must be collected from the matching untrimmed build sources. A prefix
file/hash inventory identifies the installed payload but does not by itself
supply those upstream notices.

Each build preserves complete attribution evidence before comment/POD stripping
in a checksummed diagnostic archive. That archive includes upstream source,
metadata and installed SDK files; it is retained with the GitHub Actions
diagnostic artifacts, not distributed in the npm package.

The npm package carries THIRD-PARTY-LICENSES.txt instead. It retains verbatim
dedicated notice/license/README files and complete source comment or POD blocks
containing legal text, deduplicated by content with all original source paths.
Unrecognized legal-text syntax falls back to the complete original source file.
The scope conservatively includes build-only components. No license is inferred
solely from npm's top-level license field. tools/compact-notices.py generates
this file from checksum-verified evidence.

The installed SDK evidence is excluded from the compact text because the
matching SDK licenses and source references are shipped in licenses/wasi-sdk-27.
This separates redistribution notices from bulky development evidence without
requiring npm users to download a second archive.

The standalone toolchain notices omitted from the installed SDK archive have
been added under `licenses/wasi-sdk-27`. `SOURCES.json` records the exact
wasi-libc and LLVM/compiler-rt revisions selected by the
[WASI SDK 27 source tree](https://github.com/WebAssembly/wasi-sdk/tree/wasi-sdk-27),
upstream URLs, and SHA-256 hashes. The collection includes the additional
licenses referenced by wasi-libc's top-level LICENSE. These supplement the
compact notices in the WebDyne runtime package. The standalone TypeScript
package retains its separate packaging policy.
