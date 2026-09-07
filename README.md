# ZeroPerl — WebDyne integration fork

For maintainers: [release tagging and npm staging](RELEASING.md).

This is a fork of the original [6over3/zeroperl](https://github.com/6over3/zeroperl)
project. It supports a WASM implementation of WebDyne, primarily on Cloudflare
Workers at this time, with the potential to support other WASM providers later.

**WebDyne-specific installation and usage instructions are in
[WEBDYNE.md](WEBDYNE.md).** See [BUILD.md](BUILD.md) for this fork's build process,
CPAN snapshots and XS modules. Install the WebDyne runtime from npm as described
in that usage guide. The source license is in [LICENSE](LICENSE);
bundled-component attribution is described in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Credits

- [6over3/zeroperl](https://github.com/6over3/zeroperl) and
  [6over3/zeroperl-ts](https://github.com/6over3/zeroperl-ts): the original
  runtime and JavaScript/TypeScript bridge, and their contributors.
- [lbe/zeroperl](https://github.com/lbe/zeroperl): inherited multi-version
  build work, shrink tracing, compressed SFS and release tooling, including
  [commit 025be1c](https://github.com/lbe/zeroperl/commit/025be1ccdfe63b143cd550d35170bcd76ea75f51).
  [lbe/zeroperl-ts](https://github.com/lbe/zeroperl-ts) also supplied bridge
  custom-fetch and Perl-version helper improvements.
- [lilohuang/zeroperl](https://github.com/lilohuang/zeroperl) and
  [lilohuang/zeroperl-ts](https://github.com/lilohuang/zeroperl-ts): additional
  fork work consulted during consolidation, particularly ExifTool build,
  packaging and CI work. These are reference/inspiration credits; they do not
  imply that every feature or patch from those forks is included here.

## Original upstream README

The text below is from the original **6over3/zeroperl** repository's
[README at `c28db5d`](https://github.com/6over3/zeroperl/blob/c28db5dd4fc9660e67117dfdb9f18a43623f5f3d/README.md),
preserved unchanged. Its defaults and commands describe that upstream revision;
use [BUILD.md](BUILD.md) and [WEBDYNE.md](WEBDYNE.md) for this fork.

---

zeroperl is an experimental build of Perl5 in a sandboxed, self-contained WebAssembly module.

Read the full blog [here](https://andrews.substack.com/p/zeroperl-sandboxed-perl-with-webassembly)

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
container run --rm -v $(pwd)/output:/output zeroperl cp -r /artifacts/. /output/
```

Output in `./output/`:
- `zeroperl.wasm` — reactor with asyncify
- `zeroperl_reactor.wasm` — reactor without asyncify
- `perl-wasi-prefix/` — Perl library prefix
- `exiftool.min.pl` — minified ExifTool (if enabled)

### Build args

**Docker:**
```bash
docker build --build-arg PERL_VERSION=5.42.0 --build-arg BUILD_EXIFTOOL=false -t zeroperl .
```

**Apple Container:**
```bash
container build --build-arg PERL_VERSION=5.42.0 --build-arg BUILD_EXIFTOOL=false -t zeroperl .
```

<details>
<summary>Available build arguments</summary>

| Arg | Default | |
|-----|---------|--|
| `PERL_VERSION` | `5.42.0` | Perl source version |
| `EXIFTOOL_VERSION` | `13.42` | ExifTool version |
| `BUILD_EXIFTOOL` | `true` | Include ExifTool |
| `STACK_SIZE` | `8388608` | WASM stack (bytes) |
| `INITIAL_MEMORY` | `33554432` | WASM initial memory (bytes) |
| `ASYNCIFY` | `true` | Enable asyncify |
| `TRIM` | `true` | Strip unused modules |

</details>

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

## Testing

The easiest way to test a new build of `zeroperl.wasm` is to clone the TypeScript wrapper and run its test suite:

```bash
git clone https://github.com/6over3/zeroperl-ts
```

See the [zeroperl-ts README](https://github.com/6over3/zeroperl-ts) for details.

## Usage

> **Note:** The first argument passed to Perl **must** be `zeroperl`.
> Depending on your runtime, you may need to map `/dev/null` as a preopen.

## Initialize a Cloudflare application

In an application repository with PSP pages and supporting files in `app/`:

```sh
npm init
npm install @webdyne/webdyne-zeroperl-5.44.0
npx webdyne-cloudflare init
npm run dev
```

The initializer is included in the next package release built from this source.
It preserves existing npm scripts, adds `build`, `check`, `dev`, `deploy`,
`login`, `logout`, and `whoami` where absent, and updates `.gitignore` for
installed dependencies and generated output. Existing `.assetsignore` contents
are preserved. It sets `webdyne.static` to `false` and otherwise creates exactly:

```gitignore
*.psp
*.pm
*.pl
*.conf
```

Run `npm run login`, `npm run whoami`, then `npm run deploy` to publish.
Authentication uses the package's Wrangler without building the application.
`npm run` lists commands. Wrangler is already a distribution dependency;
installation does not log in or deploy.

The source root is `--app-directory DIR` (or `--document-root DIR`), then
`package.json.webdyne.appDirectory`, then `app`. Initialization saves explicit
source, entry, output, library and Wrangler-config options for subsequent runs.
There is no separate host `DIR_ROOT` variable; the application still mounts at
VFS `/app`. Generated output must be outside the assets directory.

A root `.assetsignore` enables automatic `--assets DIR` for check, development,
and both deployment stages. Files ignored by Cloudflare stay in the VFS; public
assets are omitted. **Add patterns for templates or data Perl reads directly.**
Removing the ignore file restores complete application packaging. Every build
rereads the file. The entry page must be ignored or the build refuses to proceed.

Cloudflare reads one [root `.assetsignore`](https://developers.cloudflare.com/workers/static-assets/binding/#ignoring-assets)
using gitignore patterns, including comments, negation and directory patterns.
Root patterns apply throughout the tree; nested `.assetsignore` files are not
loaded. The CLI rejects nested files and misspelled `.assetignore` files with
instructions to move their rules. `/_headers`, `/_redirects`, and `/.assetsignore`
follow Wrangler's default ignore rules. The small `ignore` dependency implements
these rules rather than maintaining a separate glob implementation.

Explicit forwarded `--assets DIR` or `--assets=DIR` takes precedence and is not
duplicated. Its root ignore file controls VFS selection for files inside that
assets tree; application files outside it remain in the VFS. This permits an
explicit `app/public` assets root. Paths are relative to the project, including
when generated Wrangler config lives in `.webdyne`. Without an ignore file,
explicit assets flags still reach Wrangler but VFS pruning is disabled.
Automatic assets arguments override any assets directory in a custom Wrangler
config; choose another root using explicit `--assets`. Custom configs remain
untouched and must set `vars.WEBDYNE_STATIC` to `"0"` themselves.

Development currently builds the server archive once before starting Wrangler.
After changing PSP/Perl files or ignore rules, run `npm run build` in another
terminal or restart `npm run dev`. For explicit forwarded asset roots, pass the
same `-- --assets DIR` to the rebuild. Wrangler handles public asset changes.

To remove the deployed Worker, run `npm run destroy`. Type the full `Yes` at
`Are you sure [Yes/No] (default No)?`, then confirm Wrangler's own named-target
prompt. Blank, No, other answers, or cancellation do not invoke deletion.
Piped/unattended input and confirmation-bypass flags are refused. The command
uses the same Wrangler configuration as deployment but does not build or need
an `app/` directory. Wrangler retains its checks for dependent Workers.
For configured environments, use `npm run destroy -- -- --env staging`.
After upgrading an existing app, rerun `npx webdyne-cloudflare init` to add
`"destroy": "webdyne-cloudflare destroy"` while preserving other scripts.
