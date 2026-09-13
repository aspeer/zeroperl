# stage-perl-libraries.pl

Build-time preparation of application Perl libraries for ZeroPerl. The helper
runs on host Perl; it is not loaded into the Worker. Its JavaScript caller
retains npm integration, deterministic tar/gzip generation and cleanup.

## Invocation and contract

```sh
perl scripts/stage-perl-libraries.pl request.json
```

The request is a JSON object containing:

- `libraries`: ordered, absolute library roots. Later roots take precedence.
- `destination`: an existing empty directory owned by the caller, disjoint
  from all inputs. The caller removes this directory after archiving or error.
- `embeddedFiles`: packaged paths and SHA-256 hashes of embedded runtime files.
- `sourceInventory`: optional schema-1 `library-sources.json` from that same
  runtime. It records original source hashes and verified CPAN XS recipes.
- `minify`: `"auto"`, `true` or `false`, controlling compaction of retained `.pm`/`.pl` files.
- `runtime`: optional runtime package/version label for the report.

On success stdout contains `{report, omittedEmbeddedFiles}` as JSON. Failures
exit nonzero with a contextual error on stderr. Inputs are never rewritten.
The stage contains `lib/` and, when necessary,
`PERL-LIBRARY-DOCUMENTATION.txt`; the builder mounts these below `/perl5`.
The complete report is written to `.webdyne/perl-library-report.json` only
when archive generation succeeds. A failure leaves the previous report intact.

## Staging decisions

1. Inspect all files, rejecting symlinks and special filesystem entries.
2. Identify the running host Perl's architecture directory and foreign
   architecture roots evidenced by Carton's `.meta/*/install.json` layout.
   Read distribution identities before excluding installation metadata.
3. Exclude `.meta`, `.packlist`, standalone `.pod`, `WebDyne/Install.pm` and
   `WebDyne/Install/`. Flatten portable sources from architecture roots, with
   architecture-specific files taking precedence within each input library.
4. Compare original file hashes with delivered hashes and recorded pre-trim
   source hashes. Never omit a module absent from the delivered inventory.
   A differing copy at any input precedence level prevents deduplication.
5. Omit a host XS artifact only when a target CPAN XS recipe, distribution
   identity and unchanged companion module all match. Missing evidence,
   modified companions and unsupported native dependencies fail. Empty `.bs`
   files are omitted as bootstrap metadata; nonempty ones require XS evidence.
6. Optionally compact retained `.pm`/`.pl` files, preserving comments. Move
   removed POD verbatim into the archive's documentation file, outside `@INC`.
   This preserves attribution and counts documentation in net size savings.

No distribution-version-only deduplication is performed. Raw hashes allow
comparison with a runtime whose modules were already minified. Older runtime
packages without source inventories retain final-byte deduplication and cannot
silently discard host native dependencies. Core XS not explicitly evidenced
by the CPAN recipe inventory is conservatively rejected.

## Explicit application libraries

The npm CLI bypasses this helper for `webdyne.perlLibrary` and `--library`
trees by default. Node preserves their file bytes, paths, metadata files and
empty directories; archive metadata is normalised. It rejects native binaries,
symlinks and special entries. Set `webdyne.perlLibraryOptimize: true` to send
these trees through this helper. `perlMinify` alone does not opt them in.
Npm extension and CPAN libraries continue to use the helper automatically.

The JavaScript archive API accepts `verbatimLibraryDirectories` for this bypass;
`libraryDirectories` retains its managed staging contract. Explicit trees overlay
managed output, with later explicit roots winning. File/directory collisions
fail. Their files are never deduplicated against the runtime. Modified explicit
companions also prevent managed XS removal based on an embedded source match.
Reports include verbatim files and their bytes alongside managed decisions.

## Minification and compatibility

Host Perl 5.18 or later is supported. JavaScript checks for an executable Perl
on `PATH` using filesystem operations only, before managed staging or CPAN
installation. It does not launch a probe process or inspect modules. The
standalone helper's early `BEGIN` block checks required core modules before
its `use` statements. Load failures produce one diagnostic listing failed
modules, installation guidance and original errors; the helper exits with
status 2 before reading inputs. Perl::Tidy remains a separate optional check. Minification requires exactly
`Perl::Tidy 20260826` (`cpanm Perl::Tidy@20260826`). No modules are downloaded
by the helper. The npm CLI defaults `webdyne.perlMinify` to `"auto"`: use the
approved formatter when available, otherwise warn and stage without minification.
A load failure or different version triggers this fallback; all other staging
optimisations and checks still run. `true` requires the approved version and
fails with installation guidance if unavailable; `false` disables minification. Host Perl is still required for managed
staging; applications with only verbatim libraries retain their Node-only build.
The lower-level `buildApplicationArchives` API defaults `minify` to false;
callers select the transformation explicitly.

Files containing `__DATA__`, `__END__`, `<<`, `__LINE__`, or `#line` directives
are retained byte-for-byte. This intentionally conservative rule protects
runtime data, heredocs and line-sensitive code. It may also skip harmless
shift operators or strings. Syntax/formatter errors stop the build; source
is never evaluated to validate it. PSP pages are not passed to Perl::Tidy.

Reports record `minify_requested`, effective boolean `minify`, and
`minification_skipped` with the diagnostic when auto mode falls back.

Each report contains source/output hashes and byte counts, actions and reasons,
flattened paths, formatter version, runtime identity and inventory digest.
`input_bytes` counts all source files, including excluded metadata;
`output_bytes` includes retained documentation. `saved_bytes` is their
uncompressed difference and can be negative for very small libraries. Compare
actual `.tar.gz` sizes separately when estimating Worker upload savings.
