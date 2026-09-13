# WebDyne on ZeroPerl

This fork supports WebDyne running in WebAssembly, primarily on Cloudflare
Workers today. Plain `.pagi` applications are supported too. The sister package
[WebDyne::Cloudflare](https://github.com/aspeer/pm-WebDyne-Cloudflare#readme)
connects Perl applications to D1, Workers KV and R2. Other WASM providers may be
supported later; the PAGI runtime is kept separate from the Cloudflare adapter.

See [examples/README.md](examples/README.md) for standalone WebDyne, native PAGI
and optional Cloudflare KV applications.

## Quick start

Use a recent Node.js installation (22 or later) and npm. In a new application
directory:

```sh
npm init -y
npm install @webdyne/webdyne-zeroperl@1
npx webdyne-cloudflare init
```

Create `app/app.psp` with a small page:

```html
<start_html title="Server Time" h1 hr>
Server time is: <perl>localtime()</perl>
<end_html>
```

Then start the local Worker and open the address Wrangler prints:

```sh
npm run dev
```

`init` creates the application directory, adds npm commands and updates
`.gitignore`. It preserves existing commands and `.assetsignore` contents.
It does not create the page itself. Wrangler is included with the runtime;
you don't need to install it separately.

When you're ready to deploy:

```sh
npm run check
npm run login
npm run whoami
npm run deploy
```

`check` builds and validates a deployment dry run. `deploy` also runs that
check before uploading. Installing the package never logs in or deploys.

## npm packages

| Package | Use it for |
| --- | --- |
| `@webdyne/webdyne-zeroperl@1` | The complete WebDyne/PAGI runtime using the newest supported Perl. |
| `@webdyne/webdyne-zeroperl-5.44.0@1` | The same runtime, staying on Perl 5.44.0. |
| `@webdyne/webdyne-zeroperl-ts` | Embedding Perl directly in JavaScript/TypeScript. WebDyne applications don't need to install this separately. |

The two WebDyne packages use the same project version. The unsuffixed package
follows the newest supported Perl; the suffix selects a Perl version, not an
npm release number. Commit your application's npm lockfile to retain the
package versions you tested.

The runtime includes WebDyne 3.028, PAGI::Tools 0.002002, their dependencies,
the JavaScript bridge, PAGI host and Cloudflare CLI. Common XS modules are
compiled in, including Sub::Name, Params::Util, Class::XSAccessor (and its
array accessors), Text::CSV_XS and Variable::Magic. Ordinary PSP applications
need no separate Perl library archive or WebDyne checkout.

The source supports builds for Perl 5.18.4, 5.36.3 and 5.44.0. The release
configuration currently selects 5.44.0 for npm packaging. The normal Asyncify
WASM and the pre-Asyncify reactor are separate build artifacts; direct bridge
consumers need the Asyncify version.

## Application configuration

Put application settings inside `webdyne` in **package.json**. These are the
settings understood by the CLI:

| Setting | Default | Meaning |
| --- | --- | --- |
| `appDirectory` | `"app"` | Source tree, relative to the project. Contents mount at VFS `/app`. |
| `entry` | `"app.psp"` | Default PSP page below that tree, or a `.pagi` entry application. Must exist when building. |
| `static` | `true`; `init` sets `false` | Let WebDyne serve static files from its VFS. Leave false when Cloudflare serves your assets. |
| `outputDirectory` | `".webdyne"` | Generated Worker, archives and default Wrangler configuration. Keep outside the application/assets tree. |
| `perlLibrary` | None | A project-relative directory, or array of directories, containing additional Perl libraries for staging. |
| `perlLibraryOptimize` | `false` | Opt explicitly supplied `perlLibrary` / `--library` trees into managed staging optimisations. |
| `perlMinify` | `"auto"` | Compact managed `.pm`/`.pl` libraries when host Perl::Tidy 20260826 is available; otherwise warn and retain formatting. `true` requires that version; `false` disables minification. |
| `extensions` | None | An object mapping direct npm dependency names to their options, or an array of package names with no options. |
| `lifespan.startup` | None | Qualified Perl startup function, such as `My::App::startup`. |
| `lifespan.shutdown` | None | Qualified shutdown function. Accepted by WebDyne, but the Worker does not yet dispatch shutdown. |
| `cloudflare.wranglerConfig` | Root `wrangler.jsonc`, otherwise generated | Project-relative path to a custom Wrangler file. |
| `cloudflare.name` | Derived from npm package name | Worker name in generated configuration. |
| `cloudflare.compatibilityDate` | `"2026-08-27"` | Compatibility date in generated configuration, qualified with the bundled Wrangler. |
| `cloudflare.workersDev` | `true` | Enable the workers.dev address in generated configuration. |
| `cloudflare.d1Databases` | None | D1 binding definitions; see the sister package's configuration guide below. |
| `cloudflare.kvNamespaces` | None | KV binding definitions. |
| `cloudflare.r2Buckets` | None | R2 binding definitions. |

D1/KV/R2 options and extension configuration are documented in the
[WebDyne::Cloudflare README](https://github.com/aspeer/pm-WebDyne-Cloudflare#configuration).
They belong to that package's usage guide.

CLI options override saved paths: `--app-directory` (also `--document-root`),
`--entry`, `--output`, and `--wrangler-config`. Repeat `--library` to add library
directories to the saved list. Running `init` with these options saves them for
later commands. Paths must stay within the project.

### Change the document directory and index page

For a source tree called `site` with `home.psp` as its directory index:

```json
{
  "webdyne": {
    "appDirectory": "site",
    "entry": "home.psp",
    "static": false
  }
}
```

Or initialize with `npx webdyne-cloudflare init --app-directory site --entry home.psp`.
Create `site/home.psp` before building. The host directory changes, but Perl
still sees `/app/home.psp`. With PSP routing, `/` uses `home.psp` and a request
for an existing directory such as `/docs/` uses `docs/home.psp`. Explicit PSP
paths still work. `entry` is a single filename/path, not an ordered list of
index candidates.

To serve only a subdirectory of the packaged tree, use a custom Wrangler file
with `WEBDYNE_ROOT` set to `/app/public` and `WEBDYNE_INDEX` to `home.psp`.
Keep the build entry as `public/home.psp`, relative to `appDirectory`, so the
CLI validates the same file. The source tree still mounts at `/app`; changing
the runtime root does not move files.

### Custom Wrangler configuration

The CLI uses an explicit configuration first, then project-root
`wrangler.jsonc`, then generates `.webdyne/wrangler.jsonc`. Supplied files are
left untouched: package settings do not rewrite their variables or bindings.
To take over configuration, build once and copy the generated file to the
project root, changing `main` from `worker.js` to `.webdyne/worker.js` (and
adjusting the schema path). Keep its module rules and compatibility flags.

Wrangler does not read a `webdyne` section. Set runtime options under `vars`:

| Wrangler variable | Runtime default | Meaning |
| --- | --- | --- |
| `WEBDYNE_ROOT` | `"/app"` | Absolute document root inside the VFS. |
| `WEBDYNE_INDEX` | `"app.psp"` | PSP directory index or `.pagi` application. `"1"` selects WebDyne's built-in index page. |
| `WEBDYNE_STATIC` | `"1"` | WebDyne static-file serving; set `"0"` for Cloudflare assets. |
| `WEBDYNE_CONF` | `"0"` | Set `"1"` to load `.webdyne.conf.pl` from the runtime document root. This bridge option is a boolean, not a config filename. |
| `WEBDYNE_STARTUP` | Unset | Qualified WebDyne startup function. |
| `WEBDYNE_SHUTDOWN` | Unset | Qualified WebDyne shutdown function; no Worker shutdown dispatch yet. |

Use strings for these variables. Boolean settings accept `1`, `true`, `yes`
and `on` (case-insensitive); other values are false. Callback names must be
qualified names without parentheses, arguments or surrounding whitespace.
Other string `WEBDYNE_*` bindings are also exposed in Perl's environment;
they do not automatically become CLI settings.

For the subdirectory example, replace the copied configuration's `vars` with:

```json
{
  "WEBDYNE_ROOT": "/app/public",
  "WEBDYNE_INDEX": "home.psp",
  "WEBDYNE_STATIC": "0"
}
```

Keep `enable_request_signal` in `compatibility_flags`. The runtime needs it to
notice disconnected SSE clients before a later write can block the shared
interpreter. A recent compatibility date alone does not enable this behaviour.

## Static assets and .assetsignore

Normally Cloudflare serves images, CSS, JavaScript and other public files
without running Perl. Put **one `.assetsignore` at the root of the assets
directory**, normally `app/.assetsignore`. `init` creates it with:

```gitignore
*.psp
*.pagi
*.pm
*.pl
*.conf
```

On every build, the CLI uses this file to split the application:

- Ignored files stay in the Perl VFS and are excluded from Cloudflare uploads.
- Public files go to Cloudflare's asset service and are omitted from the VFS.

Add rules for anything Perl reads directly, including templates and private
data. For example:

```gitignore
/templates/
/data/
*.sqlite
```

An ignored file is still available to your application; this is not a ban on
serving it through application code. Keep `webdyne.static` false for the normal
Cloudflare-assets setup. A custom Wrangler file needs `WEBDYNE_STATIC: "0"`.

Patterns use gitignore syntax, including comments, negation and directory
patterns. Bare patterns such as `*.psp` match throughout the tree; `/data/`
anchors at the assets root. Nested `.assetsignore` files and the misspelling
`.assetignore` are rejected. The CLI also refuses to package an entry page
that would be uploaded as public source. Existing ignore files are preserved
by `init`, so add `*.pagi` yourself when upgrading an older project.
See [Cloudflare's asset ignore documentation](https://developers.cloudflare.com/workers/static-assets/binding/#ignoring-assets).

The root ignore file enables automatic `--assets` arguments for check, dev
and deploy. To use a separate public directory:

```sh
npm run dev -- -- --assets app/public
```

Place its ignore file at `app/public/.assetsignore`. Application files outside
that assets tree remain in the VFS. Forward the same assets option on rebuilds:
`npm run build -- -- --assets app/public`. The extra `--` separates CLI options
from options forwarded to Wrangler.

An explicit `--assets` wins over automatic selection. Automatic selection wins
over an assets directory in a custom Wrangler file. Paths passed to the CLI
are relative to the project even when generated configuration is in `.webdyne`.
Without an ignore file, VFS pruning is disabled; removing the file restores
complete application packaging. Explicit assets flags still reach Wrangler,
so keep server source outside an unfiltered assets root.

## Development and commands

`npm run` lists the commands added by `init`: build, check, dev, deploy,
login, logout, whoami and destroy. Existing scripts are preserved; check them
if a command behaves differently from these defaults.

Development builds the server archive once before starting Wrangler. After
changing PSP/Perl files, libraries or ignore rules, run `npm run build` in
another terminal or restart `npm run dev`. Wrangler handles public asset changes.

`npm run destroy` deletes the configured Worker without building the app.
It asks for the full `Yes`, then Wrangler confirms the named target. Blank
input, No and cancellation stop deletion. It requires an interactive terminal
and refuses confirmation-bypass flags. For an environment, use
`npm run destroy -- -- --env staging`. Rerun `init` after upgrading an older
application to add missing commands.

## Additional Perl libraries and extensions

Put application modules in a directory such as `lib` and set
`webdyne.perlLibrary` to `"lib"`. The builder mounts them under `/perl5/lib`.
A root `cpanfile` is installed with Carton, or cpanminus if Carton is unavailable,
and cached below the output directory's `cpan/` until `cpanfile` or
`cpanfile.snapshot` changes. Commit the snapshot for reproducible dependency
selection.

Explicit libraries supplied through `webdyne.perlLibrary` or `--library` are
packaged by Node with file contents and relative paths unchanged. There is no
minification, deduplication, metadata/installer removal or architecture flattening.
These libraries alone do not require host Perl. Symlinks, special filesystem
entries and native binaries (including nonempty `.bs` files) are rejected;
empty `.bs` files are retained. Tar metadata is normalised for reproducibility.
Explicit libraries override managed libraries at the same path; later explicit
roots win. File/directory collisions fail instead of deleting a tree.

Set `"perlLibraryOptimize": true` under `webdyne` to opt explicit libraries into
the managed staging pipeline. For example:

```json
{"webdyne": {"perlLibrary": "lib", "perlLibraryOptimize": true, "perlMinify": "auto"}}
```

Automatically supplied npm extension and CPAN libraries continue to use managed
staging. Managed staging requires host Perl 5.18 or newer and optionally
`cpanm Perl::Tidy@20260826` for minification. The default `"perlMinify": "auto"`
warns and records skipped minification when Perl::Tidy cannot be loaded or its
version differs. Other staging optimisations still run. Set `true` to require
the approved formatter, or `false` to disable minification. This setting does
not itself opt explicit libraries into staging. Actual formatter errors fail
the build. Apps without managed libraries retain the Node-only build path.

Managed staging excludes installation metadata, standalone POD and WebDyne installer
components. It flattens portable Perl files from recognised host architecture
directories. Host binaries are never uploaded: a redundant CPAN XS installation
is omitted only when the packaged runtime inventory proves a matching target
implementation, distribution identity and unchanged Perl companion. Unsupported
or incompatible XS dependencies fail the build. Older runtime inventories
without that evidence remain conservative.

Embedded duplicates are recognised using final file hashes or original source
hashes captured before runtime minification. Modified application overrides
are retained. Staging never modifies your sources or installed dependencies.
Minification preserves comments and skips files with data sections, heredoc
markers or line-sensitive code. Removed POD is retained in the archive as
`/perl5/PERL-LIBRARY-DOCUMENTATION.txt`, outside the module search path, including
its attribution and licence text. PSP files are not minified.

Each successful build writes `.webdyne/perl-library-report.json` with per-file
reasons, hashes, byte counts and formatter/runtime identity. The console reports
net uncompressed savings, including retained documentation; actual compressed
archive savings may be smaller. See
[scripts/stage-perl-libraries.pl.md](scripts/stage-perl-libraries.pl.md) for the
staging contract and conservative compatibility rules.

Extensions must be direct npm dependencies and explicitly enabled in
`webdyne.extensions`. Their manifests supply Perl modules and a static provider
import. For storage services, install `@webdyne/webdyne-cloudflare@1` and follow
[its setup guide](https://github.com/aspeer/pm-WebDyne-Cloudflare#configuration).

Perl also has the embedded `/zeroperl` prefix, `/perl5/bin` launchers, `/dev`
and writable `/tmp`, with `TMPDIR=/tmp`. Temporary files belong to an
interpreter instance; use a storage service for persistent application data.

## Application startup and lifespan callbacks

The runtime sends `lifespan.startup` when it lazily creates a Perl interpreter.
Requests wait for acknowledgement or for the app to decline lifespan support;
concurrent first requests share one startup,
and warm requests reuse that interpreter. Startup runs again if a failed
interpreter is replaced.

WebDyne handles the protocol without configuration. To add application startup:

```json
{
  "webdyne": {
    "perlLibrary": "lib",
    "lifespan": {
      "startup": "My::App::startup"
    }
  }
}
```

Put the function in `lib/My/App.pm`. It receives `($app_or, $scope_hr)`.
A normal return succeeds; a returned Future is awaited. Exceptions and failed
Futures produce a lifespan failure. Missing modules/functions fail bootstrap.
Omit a callback to disable it; empty strings, nulls and Perl expressions are
not accepted. These callbacks are included in the runtime with WebDyne 3.028.

Explicit startup failure or a pending acknowledgement after 10 seconds fails waiting
requests. The timeout cannot interrupt CPU-bound Perl which does not yield.
Callback configuration stays fixed for that interpreter generation.

`lifespan.shutdown` uses the same function-name format, but the Worker currently
sends startup only. It does not dispatch shutdown on retirement, propagate
lifespan state into requests, or supply request-scoped D1/KV/R2 capabilities
to startup. Don't retain service objects for later requests.

## Plain PAGI applications

Set `webdyne.entry` to `app.pagi`, or another path ending in `.pagi`:

```sh
npx webdyne-cloudflare init --entry app.pagi
```

Create `app/app.pagi` before building. The file is loaded once and must return
a PAGI application coderef accepting `(scope, receive, send)`. It receives all
paths and scope types directly, including HTTP, SSE, WebSocket and lifespan,
without loading WebDyne or using its PSP routing/static middleware.

Lifespan support is optional. An application that returns or throws before sending
any lifespan response is treated as unsupported, and HTTP requests proceed using
the same interpreter. This is logged once per interpreter at informational level;
there is no configuration switch or required lifespan boilerplate.

Applications that implement lifespan must receive `lifespan.startup` and send
`lifespan.startup.complete`. An explicit `lifespan.startup.failed`, an invalid
response, or a pending startup that exceeds 10 seconds still fails startup.
Interpreter failures are not treated as unsupported lifespan. The WebDyne
startup/shutdown function settings do not apply in this mode. Keep `.pagi` source in `.assetsignore`.
For a custom Wrangler file set `WEBDYNE_INDEX` to the entry path relative to
`WEBDYNE_ROOT` as well as keeping the build entry in package.json.

## More information

- [README.md](README.md): fork background and upstream credits.
- [BUILD.md](BUILD.md): runtime builds, CPAN snapshots and compiled XS modules.
- [TESTS.md](TESTS.md): verification commands and known limitations.
- [RELEASING.md](RELEASING.md): preparing and staging a release.
- [ARCHITECTURE.md](ARCHITECTURE.md): runtime layout and build internals.


## Extension resource cleanup

Extensions can return a cleanup function or `{ release(context) }` from their
synchronous `attachScope()` hook. Cleanup may return a Promise. Revoke request
capabilities synchronously when cleanup starts, then return the Promise for
closing resources. All hooks are invoked once, in reverse registration order,
before the manager waits for their asynchronous completions.

Cleanup receives `{ signal }`. The runtime option `extensionCleanupTimeoutMs`
defaults to 10000 ms. At that deadline the signal aborts and request completion
rejects. Extensions must implement their own forced-close behavior on abort:
a deadline does not itself cancel network operations. Late cleanup rejections
remain observed. Do not put awaited network work in a Perl destructor.

The portable runtime includes cleanup in `dispatch.completion`; the Cloudflare
provider passes this Promise to `waitUntil()`. Partial attachment failure also
awaits cleanup. Already-sent HTTP responses cannot be replaced by cleanup errors;
completion rejects and diagnostics record the failure. A platform termination
can still prevent cleanup from finishing, so database code must not interpret
connection loss during commit as proof of rollback or automatically retry writes.

Synchronous extension hooks continue to work. Direct consumers of the exported
extension manager must now await `manager.attachScope(context)` to obtain the
release function and await `release()` for completion. The generated Worker
handles this internally. Resource creation during attachment should remain
synchronous; open connections lazily in request operations.


For JavaScript/portable-source development when raw build artifacts are absent,
run `npm run pack:dev -- --from-npm`. This downloads the exact versioned official
Perl-specific npm package from registry.npmjs.org, verifies its published SHA-512
integrity and manifest hashes for WASM and notices, then overlays `bin`, `lib`,
`scripts`, the runtime/provider/transport JavaScript directories, and `js/worker.js`.
The private development tarball records the published input and source revision.
It retains the released JS bridge, WASM, embedded inventory, licences, exports,
and dependency metadata. Use the original raw-artifact mode for XS/ABI/bridge or
package dependency/export changes; the published-input mode does not rebuild or
validate those changes. Neither mode publishes a package.


## PostgreSQL through Hyperdrive (runtime 1.0.10)

Install `@webdyne/webdyne-cloudflare` 1.3.0 or later, then configure an explicit
request binding allow-list and the existing Hyperdrive resource ID:

```json
{
  "webdyne": {
    "extensions": {
      "@webdyne/webdyne-cloudflare": { "hyperdriveBindings": ["DB"] }
    },
    "cloudflare": {
      "hyperdrive": [{ "binding": "DB", "id": "YOUR_32_HEX_HYPERDRIVE_ID" }]
    }
  }
}
```

`webdyne-cloudflare check`/`deploy` generates the Hyperdrive binding and selects
its pg-enabled provider export. D1/KV/R2-only applications retain their original
provider. Generated configurations include the selected provider's compatibility
flags and logs/traces. User-owned Wrangler files are never rewritten: add the
Hyperdrive binding and `nodejs_compat` there yourself. Use caching-disabled
Hyperdrive for the initial CRUD/read-after-write use case.

Local database credentials belong in the private environment variable
`WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB`, never in package.json. The
resource array accepts only binding and id. The Perl API and examples are
maintained in the Cloudflare extension package. No DBI/XS additions are required.

Extension manifests may declare Cloudflare `variants`: each contains a
`whenOption` naming an explicit nonempty array/string option, an exported module,
a factory name, and optional `compatibilityFlags`. At most one variant may be
active. This is declarative static import selection, not executable build code.
An empty/absent option selects the original provider. Runtime 1.0.10 also passes
`lifecycle.asyncCleanup: true` to attachment hooks; async-cleanup extensions must
reject older runtimes rather than silently discarding cleanup Promises.

### Secrets Store bindings

With the WebDyne::Cloudflare Secrets Store adapter, set extension option
`secretsStoreBindings: ["API_KEY"]` and configure
`webdyne.cloudflare.secretsStoreSecrets` as an array of
`{ "binding": "API_KEY", "storeId": "YOUR_32_HEX_STORE_ID", "secretName": "upstream-api-key" }`.
The generator validates these metadata fields and emits Wrangler
`secrets_store_secrets` entries using `binding`, `store_id` and `secret_name`.
Secret values are never accepted in this configuration. Duplicate binding names
and unknown fields are rejected. No new compatibility flag is needed.
Existing user-owned Wrangler files remain untouched; named environments must
configure their own bindings. Local development requires locally provisioned
dummy secrets, not production values.
