# Third-party notices

The runtime source is distributed under the MIT licence in `LICENSE`.
Perl, embedded CPAN modules, WASI support libraries and the generated bridge
retain their respective licences.

The npm package includes `THIRD-PARTY-LICENSES.txt`: reviewed copyright notices,
licence texts and exceptions for the delivered runtime. Shared terms are
printed once, with the applicable components listed. Where offered, Perl's
Artistic licence option is used. The package's top-level MIT field does not
replace these component licences. A prominent notice in the packaged bridge
identifies its upstream origin and modifications.

`tools/runtime-notices.py` renders the pinned source ranges in
`release/licences/<perl-version>.json`. The inventory binds the actual payload,
dependency snapshot, build inputs and notice sources. Unknown or changed runtime
components require review before packaging. It does not use the broad keyword
collector to make licence decisions during releases. See
[the review procedure](release/licences/README.md).

The broader attribution collection is supplied separately in
`third-party-licenses-<perl-version>-<package-version>.tar.gz` on the canonical
GitHub Release. The generated npm notice reference and manifest provide the
exact URL and SHA-256. That archive includes the npm notice file, its extraction
inventory, the broad original collection, SDK/bridge source notices, supplementary
Unicode licences and compiler-rt credits, and build provenance/file hashes.
The workflow verifies the public archive before npm staging. The full build
source-evidence archive remains in the diagnostic Actions artifact.

This separation retains propagation notices in npm while keeping manuals,
implementation bodies and audit evidence out of the runtime package. Source
URLs and hashes for supplementary texts are recorded under `licenses/`.
The standalone TypeScript package retains its separate packaging policy.
