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
- `minify`: whether to compact retained `.pm`/`.pl` files.
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

## Minification and compatibility

Host Perl 5.18 or later is supported. Minification requires exactly
`Perl::Tidy 20260826` (`cpanm Perl::Tidy@20260826`). No modules are downloaded
by the helper. The npm CLI enables minification for libraries by default;
`webdyne.perlMinify: false` disables it. Host Perl is still required for library
staging, but applications with no extra libraries retain their Node-only build.
The lower-level `buildApplicationArchives` API defaults `minify` to false;
callers select the transformation explicitly.

Files containing `__DATA__`, `__END__`, `<<`, `__LINE__`, or `#line` directives
are retained byte-for-byte. This intentionally conservative rule protects
runtime data, heredocs and line-sensitive code. It may also skip harmless
shift operators or strings. Syntax/formatter errors stop the build; source
is never evaluated to validate it. PSP pages are not passed to Perl::Tidy.

Each report contains source/output hashes and byte counts, actions and reasons,
flattened paths, formatter version, runtime identity and inventory digest.
`input_bytes` counts all source files, including excluded metadata;
`output_bytes` includes retained documentation. `saved_bytes` is their
uncompressed difference and can be negative for very small libraries. Compare
actual `.tar.gz` sizes separately when estimating Worker upload savings.
