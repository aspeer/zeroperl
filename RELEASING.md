# Preparing a release

Release versions belong to the project. Perl versions select build variants.
The first new release is 1.0.1; the checked-in 1.0.0 is the pre-release baseline.
Earlier local 1.0.0 candidates remain historical test artifacts.

On a clean main checkout containing the changes to release:

```sh
make release
```

This fetches GitHub tags, verifies that local main includes GitHub main,
increments the project patch version, commits release/versions.json, and creates
two annotated tags: `aspeer-zeroperl_1.0.1` and `v1.0.1` for the first release.
It creates both tag refs atomically and prints the exact atomic push command:

```sh
git push --atomic github main refs/tags/aspeer-zeroperl_1.0.1 refs/tags/v1.0.1
```

Nothing is pushed, built or staged by make release itself. Use the command it
prints for the actual version. The github remote points to GitHub; origin may
point to Gitea. Publish the referenced zeroperl-ts implementation commit to its
GitHub repository before pushing a runtime release, so CI can check it out.

## Version and Perl configuration

`release/versions.json` contains one `version`, the `perlVersions` to release,
and `supportedPerlVersions` for local builds. Only 5.44.0 is selected initially.
Add qualified variants to perlVersions before preparing the next release.
All selected variants receive the same npm version. Build 2 is version 1.0.2,
not 2.0.0. The patch component is retained as buildNumber in manifests for
compatibility; releaseVersion records the complete version. Artifact filenames
include both Perl and the complete project version, for example
`zeroperl-webdyne-5.44.0-1.0.2.wasm`.

To choose a larger version explicitly, use:

```sh
RELEASE_VERSION=1.1.0 make release
```

The version must be greater than both the configured version and existing
project release tags. No per-Perl counter or GitHub run number determines the
npm version. A local BUILD_NUMBER override changes the patch component only;
it does not create a release or bypass tag validation.

## GitHub workflow

`.github/workflows/zeroperl-webdyne-release.yml` is the single build, package
and staging workflow. It validates the tag pair, builds each selected Perl once,
runs runtime and package qualification, archives the results, and stages each
variant through its npm trusted publisher. The previous separate npm workflow
has been removed. Configure npm to trust **zeroperl-webdyne-release.yml** in
**aspeer/zeroperl**. No GitHub environment is specified by this workflow.

For the first release, the package is
`@webdyne/webdyne-zeroperl-5.44.0@1.0.1`. Selecting multiple Perl variants creates
one candidate per variant; npm approval is per candidate, not atomic across
packages. The standalone TypeScript package has its own independent release.

## Staging and approval

The workflow uses Node 24 and npm 11.19.1. Configure an npm trusted publisher
for the GitHub repository and the workflow filename below, with permission to
run **npm stage publish only**. CI receives OIDC credentials; no npm token is
needed. Do not enable direct publishing permission. There is no automated
approve/reject command and no fallback to direct publishing.

The package name must already exist in npm. If it does not, the workflow stops
with a bootstrap message. See [npm staging prerequisites](https://docs.npmjs.com/staged-publishing/).
Initial package creation requires a separately approved publication.

Review the candidate in npm's Staged Packages tab and approve it with 2FA when
ready. The workflow summary records the package, source commit, integrity and
npm staging result. An upload to staging does not make the version public.

Published versions are refused before staging. Pending staged versions share
npm's version-uniqueness constraint. Stage-only OIDC credentials cannot list
pending candidates, so a rerun that reaches an already staged version fails
clearly; inspect the existing candidate in npm. CI never silently treats an
unverified existing candidate as a successful upload or replaces it. If source
changes are needed, prepare a new version and new tag pair. A failed build can
be rerun at the same tag; retries do not increment the version.

Both tags must be annotated, match the committed version, and point at the
same commit reachable from GitHub main. Only the project-prefixed tag triggers
the release workflow; the conventional v tag is an alias. Ordinary branch
pushes and documentation changes do not stage anything. For manual retries,
select the existing canonical tag in Run workflow; dispatching main is refused.

Builds and package consumers are tested before staging the exact inspected
archive. Packages and checksums remain available as GitHub Actions artifacts;
the runtime workflow also publishes third-party licences on the matching
GitHub Release before npm staging. Download diagnostic artifacts
before their retention expires (npm candidate: 30 days for runtime, 90 days
for TypeScript; runtime binary bundle: 90 days).


## Lean runtime package (1.0.3 onward)

npm contains one production WASM and the files needed to run or build WebDyne
applications. A small THIRD-PARTY-NOTICES.md links to the matching third-party
licence archive and records its SHA-256. Licence texts, SDK/bridge notice files,
the pre-Asyncify reactor and full source-attribution archive are outside npm.
Reactor exports are removed from the npm interface. CI verifies the file
inventory and imposes a 6 MB compressed-package budget.

Packaging creates a deterministic archive under
`dist/npm/<perl>-<version>/release-licenses/`. It contains verbatim legal texts,
SDK/bridge licences, the build manifest and an inventory. The workflow publishes
it and its checksum on the canonical tag's GitHub Release, verifies downloaded
bytes and public release state, then stages npm. Existing differing assets fail
rather than being replaced. The release job needs `contents: write`; npm retains
stage-only OIDC permission. Publishing these GitHub licence assets does not
approve the npm package for publication.

For a manual first-package bootstrap, publish the matching licence archive
before uploading npm. With the canonical tag already pushed:

```sh
node tools/publish-release-licenses.mjs \
  dist/npm/5.44.0-1.0.3/package/manifest.json \
  dist/npm/5.44.0-1.0.3/release-licenses
```

Add `--check-only` to validate local inputs without accessing GitHub. Do not
publish an npm candidate whose licence URL is not yet available.

The full prefix, reactor and source evidence remain in the separate
zeroperl-diagnostics-* Actions artifact (90-day retention). The public licence
archive is a GitHub Release asset, so it is not subject to Actions retention.
See THIRD-PARTY-NOTICES.md for scope and redistribution requirements.
