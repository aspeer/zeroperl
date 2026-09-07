# cpan-lock.pl

Internal build helper using Carton's snapshot parser under the selected Perl.

`perl tools/cpan-lock.pl MODE ROOT RECIPES` operates on `ROOT/cpanfile`,
`ROOT/cpanfile.snapshot`, and the target XS recipe JSON file.

- `record` validates required XS distributions and writes integrity metadata
  from Carton's bundled source archives.
- `verify` checks input hashes, target Perl version, and recipe coverage.
- `installed` additionally rejects installed native XS libraries without a
  target recipe or matching core extension.
- `fetch` additionally downloads missing locked sources, verifies their hashes,
  and writes a local CPAN index for Carton deployment installation.
- `recipes` emits tab-separated locked archive paths and target build settings.

This helper does not resolve versions. Missing files, changed inputs, invalid
archive paths, and checksum failures are fatal. Metadata records checksums, not
another version selection. Test with `prove t/cpan/lock.t` under a Perl with
Carton installed (the `native-perl-tools` image provides it).
