# Building the ZeroPerl runtime

This repository builds Perl and a selected CPAN library into a WebAssembly
runtime, then prepares versioned artifacts for the WebDyne npm runtime package.
The WebDyne runtime is available from npm; application installation is covered
in [WEBDYNE.md](WEBDYNE.md). This guide is for maintainers building from the
main branch. Run the commands below from the repository root.

## Requirements and defaults

- Docker, or Apple Container on macOS, with its service running.
- Bash, Make, tar, Node.js/npm, and Python 3 for local orchestration and checks.
- Network access for container/toolchain downloads and CPAN source archives.
- Space for container build caches and the versioned `output/` directories.

Install the host-side verification dependencies before a full build:

```sh
npm --prefix tools ci
```

Perl and Carton are built/installed inside the container; a matching Perl or
Carton installation on the host is not required. Work on the TypeScript bridge
itself additionally uses Bun and its own build instructions.

[release/defaults.mk](release/defaults.mk) supplies the default `PERL_VERSION`
for Make and `build.sh`, currently **5.44.0**. The supported release targets are
**5.18.4, 5.36.3, and 5.44.0**. The release profile locks WebDyne
**3.026**, including its Carp 1.50 minimum. This default is a repository setting, not a lookup
of the latest upstream Perl release. Direct Dockerfile builds have their own
`ARG` defaults; pass `--build-arg PERL_VERSION=...` explicitly when using them.

Both wrappers prefer Apple Container when its `container` command is present,
otherwise Docker. The snapshot wrapper also accepts `CONTAINER_CMD=docker` to
select Docker explicitly; `build.sh` currently selects the engine automatically.

## Quick start

A checkout containing current snapshots can build immediately:

```sh
./build.sh run off
```

If the default snapshot is missing or `cpanfile` has changed, first run:

```sh
make cpanfile.snapshot
```

To select another supported Perl:

```sh
make cpanfile.snapshot PERL_VERSION=5.18.4
PERL_VERSION=5.18.4 ./build.sh run off
```

The project version comes from [release/versions.json](release/versions.json).
See [RELEASING.md](RELEASING.md) for make release, paired tags and npm staging.
For local experiments, override its patch component; for example:

```sh
PERL_VERSION=5.44.0 BUILD_NUMBER=7 ./build.sh run off
```

The wrapper refuses to overwrite an existing version/build artifact set.
`ZEROPERL_OVERWRITE=true` explicitly permits replacing that local set. Prefer a
new build number for outputs you want to retain or compare.

## What the container builds

“Native” means executable Linux code inside the build container. “Target” means
WASM code that will execute inside the delivered runtime. An XS distribution's
C sources must be compiled separately for these two execution environments.
Both compilations use the same locked CPAN source distribution.

| Stage | Responsibility |
| --- | --- |
| `base` | Install the compiler tools, WASI SDK and Binaryen; build supporting WASI libraries. |
| `native-perl-tools` | Build the selected native Perl and bootstrap CPAN tooling, including Carton. Snapshot generation reuses this stage. |
| `native-perl` | Validate the selected snapshot and source checksums, install locked dependencies with Carton, and optionally build ExifTool. |
| `wasi-perl` | Build target Perl, cross-compile the configured XS distributions, assemble/trim the Perl filesystem, and run build checks. |
| `final` | Link the static WASM reactor, apply Asyncify, run module smoke tests, and collect artifacts. |
| Final export image | Retain `/artifacts` for extraction by `build.sh`. |

See [Dockerfile](Dockerfile), [ARCHITECTURE.md](ARCHITECTURE.md), and the scripts
in [pipeline](pipeline) for the implementation.

CPAN installation uses `/build/cpan-project/local`. Its library is copied into
the native prefix for existing build tools, while target prefix assembly reads
from that isolated installation. Target core files and target-built XS Perl
companions take precedence. Native shared libraries and other build files are
stripped; selected XS implementations are statically linked into WASM.

The default build embeds the prepared Perl filesystem into WASM. Installing
the resulting npm runtime does not run this repository's CPAN build process.
An application's optional `cpanfile`, handled by the deployment CLI, is a
separate dependency-installation path.

## Maintaining CPAN snapshots

Keep `cpanfile` focused on required runtime modules and the compact configure
and test requirements used by `pm-WebDyne`. Do not copy optional Apache,
Windows, server-launcher or development suggestions into the WASM manifest,
and do not repeat runtime requirements in build/test blocks. The explicit XS
requirements and per-Perl compatibility constraints remain part of the base
runtime contract. The minimum runtime Perl is 5.18.

The dependency inputs have distinct roles:

| File | Purpose |
| --- | --- |
| [cpanfile](cpanfile) | Required modules, compatible version constraints, and dependency phases. |
| `cpanfile.snapshot.<PERL_VERSION>` | Carton's selected distributions and module versions for that Perl. |
| `cpanfile.snapshot.<PERL_VERSION>.meta.json` | Input hashes, target Perl version, and source-archive checksums. |
| [tools/cpan-xs.json](tools/cpan-xs.json) | Target XS build recipes; no independent distribution versions or download URLs. |

Keep the snapshot and its metadata companion together in version control.
Do not manually edit their versions or hashes. The metadata is an integrity
record, not a second dependency resolver.

### Create or reconcile a snapshot

```sh
make cpanfile.snapshot
make cpanfile.snapshot PERL_VERSION=5.36.3
```

The target builds/reuses `zeroperl-cpan-tools:<version>`, sends `cpanfile` and
any existing selected snapshot into a disposable container, and runs Carton
under that Perl in a clean local installation. Inside the container the lock
is named `cpanfile.snapshot`, as Carton expects.

With an existing snapshot, Carton retains locked versions where compatible and
resolves additions or changed requirements as necessary. With no snapshot, it
resolves a fresh dependency set. It bundles the source archives, validates XS
recipe coverage, records checksums, and exports the two versioned files only
after successful completion. It does not write the container's `local/` tree
into the repository.

Review both output files before committing. Unchanged inputs should preserve
the existing selection; this behaviour is covered by release qualification.

### Deliberately refresh versions

```sh
make cpanfile.snapshot-update
make cpanfile.snapshot-update PERL_VERSION=5.36.3
```

This ignores the existing snapshot during resolution and exports a fresh lock
and metadata pair for the selected Perl. Constraints in `cpanfile` still apply:
for example, an exact version requirement is not removed by this target.

The target updates one Perl version at a time. After editing the shared
`cpanfile`, reconcile **all supported snapshots**, even if a change applies only
to one Perl: metadata hashes the complete file, including comments.

```sh
for version in 5.18.4 5.36.3 5.44.0; do
  make cpanfile.snapshot PERL_VERSION="$version" || exit 1
done
```

Separate snapshots account for differences in core modules and dependency
compatibility. For example, the older Perl requires a different Future::XS
version. A successful native installation still needs WASM qualification.

### Normal builds consume the lock

Normal builds require the matching snapshot and metadata, validate their input
hashes and Perl version, fetch their exact source archives, verify checksums,
and run `carton install --deployment --cached`. They never refresh the lock.
The XS recipes then read archive paths from that same snapshot/cache.

Archives are cached within the container build; they need not be committed.
These locks cover the additional CPAN dependency graph. Core Perl comes from
the selected Perl release, and bootstrap tools such as Carton are installed
separately. Locking the complete Docker/compiler environment is outside this
module-version consistency mechanism.

## Adding an XS module

Adding an XS requirement to `cpanfile` alone does not make its machine code
available in WASM. Use the following process for a new module.

### 1. Inspect its dependencies and target requirements

Identify the CPAN distribution providing the module, its build system, XS
bootstrap module name, generated library name, and any supporting XS modules
or external C libraries. Check for operating-system assumptions such as native
threads, process creation, dynamic loading, or unavailable system APIs.

Prefer a supported upstream build configuration. If a dependency needs WASI
patches or an additional target library, implement that in the owning pipeline
script rather than copying a Linux `.so` into the target filesystem.

### 2. Declare the dependency

Add the module to [cpanfile](cpanfile), including a version constraint when
compatibility requires one. Keep the XS dependency declared even though it has
a separate target build recipe. Explicitly declare supporting XS modules that
the build must always include rather than relying on incidental resolution.

For a hypothetical module:

```perl
requires 'Example::Fast';
```

Use the existing Perl-version conditional style when requirements differ by
target. Confirm the chosen distribution supports every intended Perl version.

### 3. Add a target recipe

Add an entry to [tools/cpan-xs.json](tools/cpan-xs.json). For example, assuming
the distribution actually generates `Fast.a` and bootstraps `Example::Fast`:

```json
{
  "module": "Example::Fast",
  "archive": "Fast.a",
  "destination": "lib/auto/Example/Fast/Fast.a",
  "builder": "makemaker"
}
```

| Field | Meaning |
| --- | --- |
| `module` | Module provided by the locked distribution; use the relevant XS module name. |
| `archive` | Archive filename produced under `blib`, determined from the module's build. |
| `destination` | Target archive location under `/build/wasm`, conventionally `lib/auto/<module/path>/<archive>`. |
| `builder` | `makemaker` for a supported `Makefile.PL` build, or `modulebuild` for a supported `Build.PL` build. |
| `patch` | Optional filename under `patches/`, applied with `patch -p1` in the extracted distribution. |
| `before` | Optional Perl numeric-version upper bound, exclusive; for example `"5.024"` enables a recipe only before Perl 5.24. |

Recipe order is build order: put supporting XS recipes before consumers. The
current schema only offers the `before` condition; more complex selection needs
an explicit implementation and tests. Source extraction currently uses tar;
a distribution requiring another archive format or build system needs pipeline
support rather than an invented recipe field.

The helpers in [pipeline/build-wasi-cpan-xs.sh](pipeline/build-wasi-cpan-xs.sh)
compile against target Perl headers/configuration and install `blib/lib`
companions from that exact target build. Extend those helpers if a distribution
needs additional generated files or custom steps. Keep version selection in
the snapshot, including when adding a custom recipe.

For standard builds, archive discovery and
[tools/emit-wasm-xs-bundle.pl](tools/emit-wasm-xs-bundle.pl) generate the XS
bootstrap registration. Ensure the archive path corresponds to the expected
bootstrap symbol. Do not hand-edit generated `gen/xs_init.inc`. Unusual modules
with multiple bootstraps or archives need explicit generator/build support.

### 4. Regenerate and inspect the snapshots

Run `make cpanfile.snapshot` for every supported Perl, then review the lock and
metadata diffs. The helper rejects missing recipe distributions and installed
native XS libraries without a recipe or core counterpart. This is a useful
guard, not proof that a core extension or a new XS module works in WASM.

### 5. Build and exercise the module in WASM

Add a functional case to [tests/smoke/lib/Core/TestMod.pm](tests/smoke/lib/Core/TestMod.pm)
or an appropriate dedicated test. Exercise a real XS-backed operation, including
relevant error paths; a successful `require` alone is insufficient. Confirm
supporting modules and data files survive prefix trimming.

Build each supported Perl and run the checks below. The recipe-based version
check automatically includes the new recipe and compares its module version
with the snapshot. If a module exposes an unusual version representation,
extend that check deliberately. Review its preserved attribution evidence too.

Qualify the normal `off` profile first. If the module must work with `full`
shrinking, also update tracing/warmup inputs as needed and verify that the
module, archive and bootstrap registration survive that profile.

## Validation and artifacts

`build.sh` performs container checks and host module smoke tests before moving
artifacts into their final versioned output paths. The release workflow adds
further checks. Substitute the project release version being validated:

```sh
version=5.44.0
release=1.0.7
artifact_dir="output/$version"
release_id="$version-$release"
wasm="$artifact_dir/zeroperl-webdyne-$release_id.wasm"
prefix="$artifact_dir/perl-wasi-prefix-$release_id"

node tools/check-cpan-versions.mjs "$wasm" "$version"
node tools/check-xs-magic.mjs "$wasm"
node tools/check-runtime-lifecycle.mjs "$wasm" js/zeroperl.js
node tools/wasm-smoke.mjs "$wasm"
node tools/smoke-socket.mjs "$wasm" "$prefix"
node tools/smoke-asyncify-free.mjs "$wasm" "$prefix"
python3 tools/verify-notices.py "$artifact_dir/third-party-notices-$release_id.tar.gz"
(cd "$artifact_dir" && shasum -a 256 -c "SHA256SUMS-$release_id")
```

The container also runs [tests/cpan/lock.t](tests/cpan/lock.t) under the selected
native Perl. To run that suite independently after creating a tools image:

```sh
container run --rm -v "$PWD:/review:ro" zeroperl-cpan-tools:5.44.0 \
  /build/native/prefix/bin/prove /review/tests/cpan/lock.t
```

Use `docker` instead of `container` when the image was built with Docker.
See [TESTS.md](TESTS.md) and
[the release workflow](.github/workflows/zeroperl-webdyne-release.yml) for the
remaining verification steps.

A normal artifact set contains:

```text
output/<perl-version>/
  zeroperl-webdyne-<perl-version>-<release-version>.wasm
  zeroperl-webdyne-reactor-<perl-version>-<release-version>.wasm
  perl-wasi-prefix-<perl-version>-<release-version>/
  config-<perl-version>-<release-version>.h
  third-party-notices-<perl-version>-<release-version>.tar.gz
  manifest-<perl-version>-<release-version>.json
  SHA256SUMS-<perl-version>-<release-version>
```

The reactor is the linked output before Asyncify; the normal runtime WASM is
instrumented. The prefix is retained even when embedded, for inspection and
packaging. The manifest records artifact and prefix integrity; the notice
archive preserves upstream attribution. ExifTool builds add its script artifact.

[tools/prepare-npm-package.mjs](tools/prepare-npm-package.mjs) consumes verified
artifacts to prepare a runtime package directory. The canonical TypeScript
repository bundles the selected WASM, matching manifest and notice archive.
Keep these build inputs together for verification. The WebDyne npm package
ships only the production WASM, a versioned licence link and application tooling.
Third-party licence texts are packaged separately for the matching GitHub
Release; the reactor and full evidence stay in diagnostic Actions artifacts.
See RELEASING.md for the 6 MB npm size gate and licence publication order. Applications
install the published packages directly from npm; see
[WEBDYNE.md](WEBDYNE.md) for installation and usage.

## Build controls and troubleshooting

| Control or symptom | Behaviour or next step |
| --- | --- |
| `./build.sh run off` | Standard runtime profile; use this for initial qualification. |
| `./build.sh run full` | Enable the tracing/shrink profile; qualify the intended workload separately. |
| `ZEROPERL_NO_CACHE=true` | Rebuild container layers; dependency versions still come from the snapshot. |
| `ZEROPERL_EMBED_PREFIX=false` | Build with an external prefix instead of embedding it; consumers must supply the prefix. |
| `BUILD_EXIFTOOL=true` | Include the optional ExifTool build. |
| `CONTAINER_BUILD_MEMORY` | Builder memory setting, default `5G`; increase if the build runs out of memory. |
| Missing snapshot or changed-input error | Reconcile the selected snapshot and review both generated files. Do not hand-edit hashes. |
| Archive checksum mismatch | Investigate the cache/download and expected source; do not bypass verification or blindly accept new bytes. |
| Native XS module has no recipe | Inspect the dependency that introduced it; add and qualify target support, or revise the dependency selection. |
| Patch or static link failure after an update | Review upstream changes and adjust the WASI recipe/patch; a successful Carton installation does not guarantee cross-compilation. |
| Existing version/build output | Choose an unused build number, or explicitly authorize local replacement with `ZEROPERL_OVERWRITE=true`. |

`BUILD_CPANFILE` and `TRIM` are Dockerfile build arguments, not forwarded
environment switches in `build.sh`. In particular,
`BUILD_CPANFILE=false ./build.sh run off` does not disable CPAN installation.
For advanced direct image builds, consult the Dockerfile argument reference below. Direct image builds do not perform the wrapper's
versioned extraction and host-side checks automatically.

## Extended build and bridge reference

### Build args

**Docker:**

```bash
docker build --build-arg PERL_VERSION=5.44.0 --build-arg BUILD_EXIFTOOL=false -t zeroperl .
```

**Apple Container:**

```bash
container build --build-arg PERL_VERSION=5.44.0 --build-arg BUILD_EXIFTOOL=false -t zeroperl .
```

<details>
<summary>Build configuration reference</summary>

### Dockerfile build arguments

Declared in [Dockerfile](Dockerfile) as `ARG` (pass with `--build-arg`).

| Arg                                     | Default                                                 | Notes                                                                                                |
| --------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `PERL_VERSION`                          | `5.44.0`                                                | Perl source version; qualified release artifacts use 5.18.4, 5.36.3, and 5.44.0.                    |
| `EXIFTOOL_VERSION`                      | `13.55`                                                 | ExifTool release tag                                                                                 |
| `BUILD_EXIFTOOL`                        | `false`                                                 | Optionally build and ship ExifTool; it is not part of standard WebDyne artifacts                     |
| `BUILD_CPANFILE`                        | `true`                                                  | Install WebDyne dependencies and cross-compile their XS components                                   |
| `EXIFTOOL_WARMUP_MODE`                  | `curated`                                               | `curated` or `full`                                                                                  |
| `STACK_SIZE`                            | `8388608`                                               | WASM stack (bytes), `final` stage                                                                   |
| `INITIAL_MEMORY`                        | `33554432`                                              | WASM initial memory (bytes), `final` stage                                                           |
| `ASYNCIFY`                              | `true`                                                  | wasm-opt asyncify imports (`final` stage)                                                           |
| `WASM_OPT_FLAGS`                        | `""`                                                    | Extra flags appended to the wasm-opt invocation (`final` stage)                                      |
| `TRIM`                                  | `true`                                                  | Strip unused modules                                                                                 |
| `ZEROPERL_SHRINK`                       | `off`                                                   | `off` or `full`                                                                                      |
| `ZEROPERL_SFS_COMPRESS`                 | auto (`true` when `ZEROPERL_SHRINK=full`, else `false`) | LZ4-framed SFS entries (`pipeline/prepare-prefix.sh` / `pipeline/build-wasm.sh`)                     |
| `ZEROPERL_EMBED_PREFIX`                 | `true`                                                  | Embed prefix in wasm via SFS (`false` = empty SFS; consumer supplies `perl-wasi-prefix/`)             |

### Shrink tracer environment

Read by [tools/regen-wasm-shrink.sh](tools/regen-wasm-shrink.sh) during the `wasi-perl` image layer (defaults and overrides in [tools/wasm-shrink.env](tools/wasm-shrink.env)). The stock Dockerfile does **not** declare these as `ARG`, so `docker build --build-arg TRACE_…` has no effect unless you add matching `ARG`/`ENV` wiring.

| Variable                                | Default                                                 | Role                                                                                                 |
| --------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `TRACE_EXPLICIT_PACKAGES`               | (empty)                                                 | Comma-separated modules for `--explicit-package` (full subtrees when expansion is on).               |
| `TRACE_USE_MODULE`                      | `Image::ExifTool` when `BUILD_EXIFTOOL=true`, else empty | Comma-separated `--use` seeds for the tracer.                                                        |
| `TRACE_EXPAND_EXPLICIT_PACKAGE_TREES`   | `true`                                                  | Expand explicit packages to full subtrees on disk.                                                   |
| `TRACE_EXPAND_DEPENDENCY_PACKAGE_TREES` | `true`                                                  | Expand traced dependency packages to full subtrees.                                                  |

</details>

Shrink implementation notes:

- `ZEROPERL_SHRINK=off` preserves the current full-copy / full-XS behavior.
- `ZEROPERL_SHRINK=full` enables traced site-perl copying, deterministic shrink artifacts,
  generated `static_ext`, linker archives, `xs_init.inc`, and unicore stripping.
- `ZEROPERL_SFS_COMPRESS` defaults to `true` only when `ZEROPERL_SHRINK=full` (otherwise `false`); leave unset for that auto behavior or override explicitly.
- `ZEROPERL_SFS_COMPRESS=true` stores each embedded SFS file as an LZ4 frame and enables lazy decompression in the runtime.
- Compressed entries are decompressed on first open and cached in an LRU (20 MB cap, 4096 entries).
- If all cache entries are pinned and cannot be evicted, runtime serves a transient non-cached decompressed buffer for that open.
- Decompression failures return `EIO` and fail fast (no fallback to raw bytes).
- Rollback switch: set `ZEROPERL_SFS_COMPRESS=false` and rebuild.
- `ZEROPERL_EMBED_PREFIX=false` skips embedding the Perl library prefix in the wasm binary. The prefix directory is still produced as a build artifact (`perl-wasi-prefix/`), but the wasm has an empty SFS table. Consumers must provide the library files externally and set `PERL5LIB`.
- When `ZEROPERL_EMBED_PREFIX=false`, `ZEROPERL_SFS_COMPRESS` is silently forced to `false` (nothing to compress).
- `TRACE_USE_MODULE` adds `--use` seeds so the tracer executes those modules during warm-up (comma-separated).
- `TRACE_EXPLICIT_PACKAGES` registers `--explicit-package` modules; when `TRACE_EXPAND_EXPLICIT_PACKAGE_TREES=true`, those packages are retained as full directory subtrees.
- When `TRACE_EXPAND_DEPENDENCY_PACKAGE_TREES=true`, traced dependency modules are also retained as full package trees.
- Generated shrink artifacts live in `gen/` and can be refreshed via `tools/regen-wasm-shrink.sh`.
- Checked-in smoke corpus sources live in `tests/smoke/` (`sample.jpg.b64`, `sample.tiff.b64`, `sample.xmp`).
- Prefix/full image builds with `BUILD_EXIFTOOL=true` now run shrink smoke automatically in the `wasi-perl` stage and fail if missing paths are detected.
- Run smoke validation manually inside the wasi build image for version-matched Perl (Apple Containers on macOS):
  - `container run --rm -v $PWD:/work -w /work zeroperl:wasi sh -lc './tools/wasm-smoke.sh .'`
    It exercises `exiftool.min.pl` against that corpus and writes diagnostics to `gen/wasm-smoke.log` and missing-path findings to `gen/wasm-missing-paths.txt`.
- If `gen/wasm-missing-paths.txt` is non-empty, triage each entry into `gen/extra-paths-allowlist.txt` or trace seed/warmup inputs, then regenerate.
- For deterministic checks, run `tools/check-wasm-shrink-determinism.sh` inside the build image after native prefix/exiftool assets are present.

### End-to-end build with build.sh

`build.sh` drives the full pipeline: container build → artifact extract.

```bash
# Default (Perl 5.44.0, no shrink)
./build.sh run off

# Another supported release
PERL_VERSION=5.36.3 ./build.sh run off

# Explicit build-number override
PERL_VERSION=5.44.0 BUILD_NUMBER=2 ./build.sh run off
```

### Iterating on stubs/zeroperl.c

Build from `final` stage to reuse cached wasi-perl:

**Docker:**

```bash
docker build --target final -t zeroperl .
```

**Apple Container:**

```bash
container build --target final -t zeroperl .
```

## Node tooling & submodule setup

This repo vendors the canonical development `zeroperl-ts` source as a git
submodule at `./zeroperl-ts`. Initialize it before running the root package or
editing and testing the bridge in place. Release-build verifier tooling instead
uses a public bridge commit pinned in `tools/package-lock.json`, so clean CI
builders use that pinned verifier independently of the development submodule.

Clone with submodules:

```bash
git clone --recurse-submodules https://github.com/aspeer/zeroperl.git
```

Or, if you already cloned without submodules:

```bash
git submodule update --init --recursive
```

Without `./zeroperl-ts` present, root-level npm installs and bridge development
will fail because the root package retains its local `file:` dependency.

> **Windows note:** `npm file:` dependencies create symlinks under
> `node_modules`. On Windows, symlink creation may require Developer Mode or an
> elevated terminal. See [Microsoft: Enable your device for development](https://learn.microsoft.com/en-us/windows/apps/get-started/enable-your-device-for-development).

## Testing

This repo vendors `zeroperl-ts` as `./zeroperl-ts`. After initializing
submodules (see [Node tooling & submodule setup](#node-tooling--submodule-setup)),
you can test a new `zeroperl.wasm` build using the local submodule:

```bash
cd zeroperl-ts
npm test
```

You can also iterate on `zeroperl-ts` source directly inside `./zeroperl-ts`;
the parent repo tracks it as a submodule.

If you need to work on the canonical WebDyne TypeScript bridge in isolation,
clone it separately:

```bash
git clone https://github.com/aspeer/zeroperl-ts
```

See the [zeroperl-ts README](https://github.com/aspeer/zeroperl-ts) for details.

### Refreshing the compiled bridge before a release

From this repository, run `bun tools/build-bridge.ts` after updating the
`zeroperl-ts` submodule. An explicit canonical checkout may
be supplied, for example `bun tools/build-bridge.ts ../aspeer-zeroperl-ts`. The
generated `js/zeroperl.js` must be reviewed with the matching bridge source.

Array/hash replacement and scalar assignment can now complete asynchronously
when an overwritten object runs an asynchronous destructor. Await bridge
`set()` and `setVariable()` calls in that situation. Callback arguments are
borrowed; returning one is supported, while an owned returned wrapper transfers
its reference to Perl. Wrappers from another interpreter are rejected.

New runtime builds preserve upstream attribution evidence before stripping Perl
comments. The manifest checksums `third-party-notices-<perl>-<build>.tar.gz`;
packaging verifies both that archive and the full prefix inventory. npm includes
the archive and separate bridge notices. See THIRD-PARTY-NOTICES.md for the
attribution scope. The runtime source license remains MIT.
