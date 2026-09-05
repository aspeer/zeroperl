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

Each new build preserves attribution evidence before comment/POD stripping in
`third-party-notices-<perl>-<build>.tar.gz`. The npm package carries the same
checksum-verified archive as `third-party-notices.tar.gz`. It includes original
upstream license files, metadata, and source files containing attribution from
Perl, CPAN, compression libraries, and the installed WASI SDK. The inventory is
deliberately broader than the installed prefix and includes build dependencies.

Before publication, review this inventory against the final payload and check
wasi-libc/compiler-rt coverage. Evidence collection does not by itself establish
that every upstream distribution's notice requirements have been satisfied. Do not infer the license of
all embedded dependencies from the npm package's top-level `license` field.

The standalone toolchain notices omitted from the installed SDK archive have
been added under `licenses/wasi-sdk-27`. `SOURCES.json` records the exact
wasi-libc and LLVM/compiler-rt revisions selected by the
[WASI SDK 27 source tree](https://github.com/WebAssembly/wasi-sdk/tree/wasi-sdk-27),
upstream URLs, and SHA-256 hashes. The collection includes the additional
licenses referenced by wasi-libc's top-level LICENSE. These supplement the
build evidence archive in both npm distributions.
