# record-library-sources.pl

Records original Perl source hashes before runtime trimming, so an application's
unmodified CPAN files can be recognised even when embedded copies are minified.

```sh
perl tools/record-library-sources.pl PREFIX PERL_VERSION tools/cpan-xs.json
```

Writes schema-1 JSON to stdout with `perlVersion`, `sourceFiles` (relative module
path to SHA-256), and `nativeModules` (CPAN XS companion path to distribution
identity). Architecture-specific target files take precedence over portable
files. The helper reads target files as bytes and never adds the target prefix
to host Perl's `@INC` or executes target modules.

`pipeline/prepare-prefix.sh` calls this after deployment exclusions but before
Perl::Tidy. It keeps the output under `/build` until SFS generation completes,
then places `library-sources.json` at the exported prefix root. Consequently it
is covered by the prefix artifact checksum without enlarging the WASM SFS.

The npm packager verifies the prefix checksum, intersects source entries with
its final delivered file inventory, and ships `library-sources.json` for the
host builder. Removed modules are never advertised as embedded dependencies.
Older artifacts without this sidecar yield an empty source inventory.

Native capabilities require both an applicable `tools/cpan-xs.json` recipe and
matching installed distribution metadata. This is deliberately narrower than
all core XS compiled into Perl; absence means staging must reject an unknown
host binary. Recipe presence is trusted only within the existing build pipeline,
which cross-compiles and links those extensions before publishing artifacts.

Requires host Perl 5.18 or later and core Perl modules only. An early `BEGIN`
block checks the required modules before the normal `use` statements. If any
cannot load, it lists all failed modules with installation guidance and the
underlying errors, then exits with status 2 before reading target files. This
also protects direct invocation from the container build pipeline.
