# Preparing a release

Release versions belong to the project. Perl versions select build variants.
The next release increments the version recorded in release/versions.json.
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

The Perl-specific package is `@webdyne/webdyne-zeroperl-5.44.0@<semver>`.
The newest supported Perl also produces `@webdyne/webdyne-zeroperl@<semver>`
as a complete duplicate with the same version, runtime and exports. Only its
package identity and README differ. Semver is the npm version, not part of
the package name. Older Perl variants never update the unsuffixed alias.
Selecting multiple Perl variants creates one candidate per variant plus the alias; npm approval is per candidate, not atomic across
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

npm contains one production WASM, application tooling and the reviewed
`THIRD-PARTY-LICENSES.txt`. Shared terms are deduplicated; component-specific
copyright notices and exceptions remain. A short THIRD-PARTY-NOTICES.md links
to broader attribution evidence on the matching GitHub Release. The full
licence/source directories, reactor and diagnostic archive are outside npm.
CI enforces 500 KB raw notices and a 6 MB compressed-package budget.

The default Perl 5.44.0 profile has a reviewed inventory in `release/licences/`.
A changed runtime module, version, linked component or notice source fails
packaging until its inventory is reviewed. Host-generated metadata differences
are permitted without discarding the relevant copyright notices. See
[the review procedure](release/licences/README.md). Other Perl variants still
build, but need notice inventories before release packaging.

Packaging creates a deterministic supplemental archive under
`dist/npm/<perl>-<version>/release-licenses/`. It contains the npm notices,
review inventory, broader attribution texts, SDK/bridge licences, build manifest
and file hashes. The workflow publishes it and its checksum on the canonical
tag's GitHub Release, verifies downloaded bytes and public state, then stages
npm. Existing differing assets fail rather than being replaced. The release
job needs `contents: write`; npm retains stage-only OIDC permission.

For a manual first-package bootstrap, publish the matching supplemental archive
before uploading npm. With the canonical tag already pushed:

```sh
node tools/publish-release-licenses.mjs \
  dist/npm/5.44.0-1.0.3/package/manifest.json \
  dist/npm/5.44.0-1.0.3/release-licenses
```

Add `--check-only` to validate local inputs without accessing GitHub. This
GitHub publication does not approve the npm package for publication.

The full prefix, reactor and source evidence remain in the separate
zeroperl-diagnostics-* Actions artifact (90-day retention). The supplemental
licence archive is a GitHub Release asset without Actions retention expiry.

## Local development tarballs

On the development checkout, after `npm install`:

```sh
npm run pack:dev
```

This validates and reuses existing WASM artifacts under `output/5.44.0` for the
version in `release/versions.json`, combines them with current checkout tooling,
and writes a genuine npm `.tgz` and inventory JSON under `dist/dev/`. `.tgz` is
npm's conventional name for a gzip-compressed tar archive. No Docker rebuild is
needed for CLI-only changes. Runtime/embedded-Perl changes still require rebuilding
and qualifying the WASM artifacts first; this command does not compile them.

Select another existing, qualified artifact set with:

```sh
npm run pack:dev -- --perl-version 5.44.0 --runtime-version 1.0.3
```

The package version becomes the next patch with a unique development suffix,
for example `1.0.4-dev.20260907040506007.gabcdef012345`. The timestamp prevents
confusion between rebuilds; the hash identifies the tooling checkout. Manifest
metadata also records whether uncommitted changes were included. The WASM's
original version, hashes, source provenance and attribution remain unchanged.
The development package is marked private. No tracked release version, git tag,
registry dist-tag, push, staging or publication is performed.

In the application repository, use the actual filename printed by the build:

```sh
npm init                          # only if package.json does not exist
npm install /absolute/path/to/webdyne-webdyne-zeroperl-5.44.0-VERSION.tgz
npx --no-install webdyne-cloudflare init
npm run dev
```

`npm install file:/absolute/path/to/package.tgz` is also supported. Use
`npm install`, not `npm init file:...`: npm init's package argument follows its
create-package initializer convention. Here the installed CLI's `init`
subcommand performs WebDyne setup. Installing the tarball saves the local file
reference; installing a later tarball replaces it. Wrangler and other npm
dependencies may still need registry access on the first installation.


## Seeding the latest-Perl alias

If a name is absent from npm, download its verified tarball from the tagged
workflow's `webdyne-zeroperl-npm-<perl>-<semver>` artifact. Candidates are uploaded
before staging, so they remain available if the missing name stops staging.
The same workflow publishes and verifies the referenced licence archive first.
Check the package identity with `tar -xOf PACKAGE.tgz package/package.json`.

With an npm account permitted to publish under `@webdyne`:

```sh
npm login
npm publish /absolute/path/to/PACKAGE.tgz --access public
```

Run this only for each missing name; already-published versions cannot be reused.
Then open that package's npm Settings → Trusted publishing and add GitHub Actions:
owner `aspeer`, repository `zeroperl`, workflow `zeroperl-webdyne-release.yml`,
no environment, with stage-only permission. Configure both names independently.
Future tagged releases build, attest and stage both candidates automatically;
approval in npm remains manual. Do not rerun the seeded version expecting it to
stage again: use the next release. A successful sibling staging operation remains
pending even when the other name needs seeding; review it separately in npm.
