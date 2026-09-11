# Updating a bundled Perl module

Use this checklist when updating WebDyne or another Perl module inside the
ZeroPerl runtime. The usual sequence is:

**Change the dependency → refresh snapshots → build → review licences → commit
→ merge → prepare and push the release.**

The runtime takes modules from CPAN. Changes in a neighbouring `pm-WebDyne`
checkout are not automatically included: publish the desired WebDyne version to
CPAN first and wait until it is available to the dependency resolver.

## 1. Start an update branch

Start with a clean working tree and an up-to-date `main`:

```sh
cd /Users/aspeer/Development.github/aspeer-zeroperl
git switch main
git fetch github
git merge --ff-only github/main
git switch -c codex/update-webdyne
```

Choose a different branch name if that one already exists. For other modules,
use a name describing that update.

Have Docker or Apple Container running. Install the host verification tools if
this is a new checkout:

```sh
npm --prefix tools ci
```

## 2. Change the module version

Edit `cpanfile`. For example, to select WebDyne 3.030 **when that version is
available**, change its line to:

```perl
requires 'WebDyne', '== 3.030';
```

For another module, change its existing requirement to the desired compatible
version. An exact `==` requirement makes the intended update explicit.

The WebDyne version and the ZeroPerl release version are separate. Leave
`release/versions.json` alone at this stage; `make release` handles it later.

## 3. Refresh the dependency snapshots

```sh
for version in 5.18.4 5.36.3 5.44.0; do
  make cpanfile.snapshot PERL_VERSION="$version" || exit 1
done

git diff -- cpanfile 'cpanfile.snapshot.*'
```

Check that the intended module version was selected and that any other dependency
changes are expected. All supported snapshots need refreshing because their
metadata includes a hash of the shared `cpanfile`.

Use `cpanfile.snapshot` for a targeted update: it retains compatible locked
versions. `cpanfile.snapshot-update` deliberately resolves the entire dependency
set afresh. Do not manually edit snapshot files or their hashes.

## 4. Build and review

The current release profile uses Perl 5.44.0:

```sh
PERL_VERSION=5.44.0 ./build.sh run off
make licence-review PERL_VERSION=5.44.0
```

Stop if either command fails. The build runs native and WASM checks. The review
verifies the artifacts, carries forward unchanged notice excerpts, runs notice
and package tests, and prepares a local npm tarball with a size check.

The command prints the location of `report.json`, `evidence.diff` and
`candidate.json` under `output/licence-review/`. Check that the report says
`verified-proposal` with no blockers, then inspect `evidence.diff` for added or
changed copyright/licence notices. For a routine WebDyne update, the diff will
often contain only version and code changes.

Keep the build's attribution archive: the next update needs the archive matching
the adopted inventory. Do not delete or overwrite that baseline.

### If an output with this version already exists

Choose an unused local build number rather than replacing the baseline. For
example, while the project version is `1.0.x`:

```sh
PERL_VERSION=5.44.0 BUILD_NUMBER=100 ./build.sh run off
make licence-review LICENCE_MANIFEST=output/5.44.0/manifest-5.44.0-1.0.100.json
```

Use the actual manifest filename printed by the build, and pass that same
`LICENCE_MANIFEST` to `make licence-commit` below. This number only names the local
qualification artifacts; it does not set the next published release version.

## 5. Adopt and commit

Once the evidence review is satisfactory:

```sh
make licence-commit
```

If you selected another manifest, include it:

```sh
make licence-commit LICENCE_MANIFEST=output/5.44.0/manifest-5.44.0-1.0.100.json
```

This rechecks and adopts the candidate, then commits the dependency snapshots,
licence inventory and the explicitly listed supporting files on your current
branch. It refuses pre-existing staged changes. Additional source files you
changed outside that list need their own review and commit.

`make licence-adopt` is available if you want adoption without a commit.

## 6. Merge and release

After the update is committed and the working tree is clean:

```sh
git switch main
git merge --ff-only codex/update-webdyne
make release
```

Use your actual update branch name. If the fast-forward merge is refused, reconcile
the branches using your normal review workflow before preparing the release.

`make release` increments the ZeroPerl release version, commits it and creates two
local annotated tags. **Run the exact atomic push command it prints.** That push
starts the GitHub build, qualification and npm staging workflow.

After CI succeeds, approve the staged packages in npm to publish them. The
Perl-specific package and the unsuffixed alias need separate approval.

## When the automatic review stops

- **Missing baseline archive:** locate the original archive and supply
  `LICENCE_BASELINE=/absolute/path/to/archive.tar.gz` to `make licence-review`.
  It must match the existing inventory's checksum.
- **Changed notice text, new dependencies or changed build inputs:** inspect the
  report and follow [the licence review procedure](release/licences/README.md).
  These cases require a completed review before adoption; do not simply replace
  hashes to silence the error.
- **A new or changed XS dependency fails to build:** follow the XS instructions
  in [BUILD.md](BUILD.md). Native installation alone does not establish WASM support.

## Documentation-only changes

A documentation update does not need a version bump or release tags. Commit the
file and push only `main`:

```sh
git add UPDATE.md
git commit -m "Document the Perl module update workflow"
git -c push.followTags=false push github main:main
```

A branch-only push does not trigger the runtime release workflow. Do not run
`make release` or push release tags for a documentation-only update.
