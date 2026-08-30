zeroperl is an experimental build of Perl 5 in a sandboxed, self-contained WebAssembly module.
This WebDyne integration fork builds the last patch releases of four supported
release lines: **5.18.4**, **5.24.4**, **5.36.3**, and **5.44.0**.

Read the full blog [here](https://andrews.substack.com/p/zeroperl-sandboxed-perl-with-webassembly)

## Note

This is the canonical ZeroPerl runtime for WebDyne::PAGI WASM targets. It
consolidates upstream fork improvements and statically compiles the XS modules
needed by WebDyne. See [wasm-WebDyne-PAGI](https://github.com/aspeer/wasm-WebDyne-PAGI)
for the Cloudflare integration.

## Build

Requires Docker or Apple Container (macOS).

**Docker:**

```bash
docker build -t zeroperl .
mkdir -p output
docker run --rm -v $(pwd)/output:/output zeroperl cp -r /artifacts/. /output/
```

**Apple Container (macOS):**

```bash
container build -t zeroperl .
mkdir -p output
container run --rm zeroperl sh -c 'cd /artifacts && tar cf - .' | tar xf - -C output
```

Output in `./output/`:

- `zeroperl.wasm` — wasm-opt output from `zeroperl_reactor.wasm` (asyncify-instrumented when `ASYNCIFY=true`; see `pipeline/build-wasm.sh`)
- `zeroperl_reactor.wasm` — linker output (`-mexec-model=reactor`) before the wasm-opt asyncify pass
- `config.h` — Perl/WASI `config.h` from the wasm build tree (useful for debugging toolchain mismatches)
- `perl-wasi-prefix/` — Perl library prefix
- `exiftool.min.pl` — minified ExifTool (if enabled)

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
| `PERL_VERSION`                          | `5.44.0`                                                | Perl source version; supported release artifacts use 5.18.4, 5.24.4, 5.36.3, and 5.44.0.            |
| `EXIFTOOL_VERSION`                      | `13.55`                                                 | ExifTool release tag                                                                                 |
| `BUILD_EXIFTOOL`                        | `true`                                                  | Build and ship ExifTool                                                                              |
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
./build.sh run

# Another supported release
PERL_VERSION=5.24.4 ./build.sh run

# Override versions
PERL_VERSION=5.44.0 ZLIB_VERSION=1.3.2 EXIFTOOL_VERSION=13.55 ./build.sh run full
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

This repo vendors `zeroperl-ts` as a git submodule at `./zeroperl-ts`. You must
initialize submodules before running any in-repo `npm install` or `npm ci` that
resolves the local `zeroperl-ts` package via `file:./zeroperl-ts` (root) or
`file:../zeroperl-ts` (`tools/`).

Clone with submodules:

```bash
git clone --recurse-submodules https://github.com/aspeer/zeroperl.git
```

Or, if you already cloned without submodules:

```bash
git submodule update --init --recursive
```

Without `./zeroperl-ts` present, npm installs will fail because the local
`file:` dependency cannot be resolved.

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

For an in-repo verification that the built wasm can load modules from the
embedded `/zeroperl` prefix without mounting `output/perl-wasi-prefix`, run:

```bash
npm --prefix tools ci
node tools/verify-embedded-inc.mjs output/zeroperl.wasm
```

This verifier uses the local `zeroperl-ts` submodule (`./zeroperl-ts`) to instantiate the local wasm artifact
directly, inspects `@INC`, and requires `Image::ExifTool` modules without
providing the extracted prefix tree. It assumes the build was produced with
`BUILD_EXIFTOOL=true`.

## Usage

> **Note:** The first argument passed to Perl **must** be `zeroperl`.
> Depending on your runtime, you may need to map `/dev/null` as a preopen.
