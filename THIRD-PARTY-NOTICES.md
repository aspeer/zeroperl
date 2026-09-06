# Third-party notices

The runtime source is distributed under the MIT licence in `LICENSE`.
Perl, embedded CPAN modules, WASI support libraries and the generated
JavaScript bridge retain their own licences.

The npm package contains a generated `THIRD-PARTY-NOTICES.md` with links to
its exact GitHub Release and the matching third-party licence archive, plus
its SHA-256 checksum. The archive is named
`third-party-licenses-<perl-version>-<package-version>.tar.gz` and attached to
`https://github.com/aspeer/zeroperl/releases/tag/aspeer-zeroperl_<package-version>`.
It contains:

- `THIRD-PARTY-LICENSES.txt`: deduplicated verbatim legal texts from verified
  build evidence, including complete legal comment/POD blocks and whole-file
  fallback for unfamiliar syntax.
- `licenses/`: the bridge licence/NOTICE and the matching WASI SDK licences
  and source references, including `licenses/wasi-sdk-27/SOURCES.json`.
- `build-manifest.json` and `inventory.json`: provenance and file hashes.

`tools/release-licenses.py` creates this deterministic archive outside the npm
package. The release workflow uploads it and its checksum to the public GitHub
Release before npm staging. Existing assets are verified and never overwritten.
The full source-evidence archive remains in the diagnostic Actions artifact.

This external distribution layout is the maintainer's requested packaging
policy; it does not change any component's redistribution requirements or
establish that a link alone satisfies them. The top-level npm MIT field does
not replace embedded-component licences. The standalone TypeScript package
retains its separate packaging policy.
