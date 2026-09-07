# WebDyne on ZeroPerl

This fork supports WebDyne running in WebAssembly, primarily on Cloudflare
Workers today. Other WASM providers may be supported later; the provider-neutral
PAGI runtime is kept separate from the Cloudflare adapter.

For fork history and upstream credits see [README.md](README.md). For building
the runtime, maintaining CPAN snapshots, and adding XS modules see
[BUILD.md](BUILD.md).

## npm packages

The main branch provides the WebDyne ZeroPerl runtime distribution, available
from npm. Use the WebDyne runtime package to run PSP applications; use the
TypeScript bridge package when embedding Perl directly.

The npm packages have different roles:

| Package | Contents | Consumer |
| --- | --- | --- |
| `@webdyne/webdyne-zeroperl-5.44.0@1.0.6` | Versioned Perl WASM, embedded WebDyne modules, compiled bridge, PAGI runtime and deployment CLI | WebDyne applications |
| `@webdyne/webdyne-zeroperl@1.0.6` | Same complete runtime for the newest supported Perl version | WebDyne applications following the latest Perl |
| `@aspeer/zeroperl-ts@1.1.0` | ESM/CommonJS bridge, TypeScript declarations and bundled WASM | JavaScript/TypeScript applications embedding Perl directly |

The normal Asyncify WASM and pre-Asyncify reactor are separate artifacts;
applications using the TypeScript bridge must select the Asyncify version.
Installing the npm package does not deploy an application; build/dev/check/deploy
are explicit commands.

This WebDyne integration fork builds the last patch releases of three qualified
release lines: **5.18.4**, **5.36.3**, and **5.44.0**.

## Runtime contents

This is the canonical ZeroPerl runtime for WebDyne::PAGI WASM targets. It
consolidates upstream fork improvements, embeds WebDyne 3.028 and PAGI::Tools
0.002002 with their runtime dependencies, and statically compiles the XS
modules needed by WebDyne, plus Sub::Name, Params::Util, Class::XSAccessor
(including its array accessors), Text::CSV_XS and Variable::Magic for common
application code. A normal PSP application therefore does not need a
separate Perl library archive. The versioned npm package also includes the
compiled JavaScript bridge, provider-neutral PAGI runtime, default Cloudflare
adapter, Perl launchers, and application VFS builder required to serve PSP
files without another WebDyne checkout.

## Cloudflare package usage

Install the latest-Perl runtime using `@webdyne/webdyne-zeroperl@1`.
Use `@webdyne/webdyne-zeroperl-5.44.0@1` to stay on Perl 5.44.0.
The unsuffixed package is a complete duplicate, updated only from the newest
supported Perl; each package uses the same project semver.
Put the complete application tree below
`app/`, including the default `app/app.psp`, then install the runtime:

```bash
npm install @webdyne/webdyne-zeroperl@1
```

The package includes its qualified Wrangler version. Add these convenient
commands to the application's `package.json`:

```json
{
  "scripts": {
    "build": "webdyne-cloudflare build",
    "check": "webdyne-cloudflare check",
    "dev": "webdyne-cloudflare dev",
    "deploy": "webdyne-cloudflare deploy"
  }
}
```

`npm run dev` starts local Wrangler and `npm run deploy` validates a dry-run
bundle before uploading it to Cloudflare. When the project has no root
`wrangler.jsonc`, the command generates a safe default in `.webdyne/`; a root
configuration always takes precedence. The application should ignore the
entire generated `.webdyne/` directory.

Every regular file under `app/` is copied to VFS `/app`, preserving its
relative path. The generated runtime also provides `/zeroperl`, `/perl5/bin`,
`/perl5/lib`, `/dev`, and a writable `/tmp`; Perl receives `TMPDIR=/tmp`.

Portable application settings live under `webdyne` in `package.json`:

```json
{
  "webdyne": {
    "appDirectory": "site",
    "entry": "home.psp",
    "static": true,
    "perlLibrary": "lib"
  }
}
```

`appDirectory` changes the source directory only; its contents still mount at
VFS `/app`. `perlLibrary` may be a path or array of paths containing Pure-Perl
modules. A root `cpanfile` is installed automatically with Carton, or with
cpanminus when Carton is unavailable, and cached below `.webdyne/cpan` until
`cpanfile` or `cpanfile.snapshot` changes. Commit `cpanfile.snapshot` for
reproducible deployments. Native extensions are rejected because host binaries
cannot run in WASM. Byte-identical modules already embedded in ZeroPerl are
omitted from the application library archive.

Optional WebDyne extensions are direct npm dependencies enabled explicitly in
`webdyne.extensions`. For example, a Cloudflare storage application installs
`@webdyne/webdyne-cloudflare@1` and configures:

```json
{
  "webdyne": {
    "extensions": {
      "@webdyne/webdyne-cloudflare": {
        "d1Bindings": ["DB"],
        "kvBindings": ["CACHE"],
        "r2Bindings": ["ASSETS"]
      }
    },
    "cloudflare": {
      "d1Databases": [{
        "binding": "DB",
        "databaseName": "webdyne-time",
        "databaseId": "CLOUDFLARE-DATABASE-ID"
      }],
      "kvNamespaces": [{
        "binding": "CACHE",
        "namespaceId": "CLOUDFLARE-KV-NAMESPACE-ID"
      }],
      "r2Buckets": [{
        "binding": "ASSETS",
        "bucketName": "my-webdyne-assets"
      }]
    }
  }
}
```

The builder reads the package's declarative extension manifest, mounts its
Perl modules at `/perl5/lib`, and emits a static provider import. It does not
scan undeclared dependencies or execute npm installation hooks.

The generated Wrangler configuration maps `d1Databases`, `kvNamespaces`, and
`r2Buckets` to provider bindings. KV entries also accept `previewNamespaceId`
and `remote`; R2 entries accept `previewBucketName`, `jurisdiction`, and
`remote`. Resource names and IDs stay in the application package rather than
the reusable extension.

### Incoming request cancellation

Generated Cloudflare configurations enable `enable_request_signal`. If you
maintain your own Wrangler configuration, include this flag in
`compatibility_flags` as well. The runtime uses `Request.signal` to stop a
disconnected SSE session before a later stream write can block the persistent
interpreter. A recent compatibility date alone does not enable this behaviour.


## Application startup (development)

The development runtime sends `lifespan.startup` through the PAGI application
when it lazily creates a Perl interpreter. This reaches WebDyne's existing
`handler_lifespan` stub. Requests wait for `lifespan.startup.complete`; concurrent
first requests share one startup, and warm requests reuse that interpreter.
Startup runs again if a failed interpreter is replaced.

Startup failure, premature application completion, or a missing acknowledgement
after 10 seconds fails waiting requests instead of serving a partially started
application. The timer cannot interrupt CPU-bound Perl that does not yield.
Diagnostics are logged and requests receive the normal runtime error response.

The host currently supplies startup dispatch only. It does not call shutdown
on retirement, copy lifespan state into requests, or expose Cloudflare service
capabilities to lifespan. Existing request-scoped D1/KV/R2 access is unchanged.
No setting is required for the default WebDyne stub.


### Optional lifespan callbacks (development)

Configure qualified Perl function names, without parentheses:

```json
{
  "webdyne": {
    "perlLibrary": "lib",
    "lifespan": {
      "startup": "My::App::startup",
      "shutdown": "My::App::shutdown"
    }
  }
}
```

Place the module in `lib/My/App.pm`. The existing `perlLibrary` packaging
mechanism makes it available through Perl's `@INC`; a CPAN or extension library
can also supply the module. Neither callback is required. Omit the key to disable
it; empty strings, nulls, unqualified names and Perl expressions are rejected.

Generated Wrangler configuration contains `WEBDYNE_STARTUP` and
`WEBDYNE_SHUTDOWN`. If you supply your own Wrangler configuration, set those
string bindings there: the scaffold preserves supplied configuration. Callback
settings are fixed for each interpreter generation.

The bootstrap loads the modules and resolves the named functions before creating
WebDyne. Each callback receives `($app_or, $scope_hr)`. A normal return succeeds;
a returned Future is awaited before acknowledgement. An exception or failed
Future produces the matching lifespan failure event. Missing modules/functions
fail bootstrap. The existing 10-second startup acknowledgement limit includes
callback execution after application loading. Callback code has a lifespan
scope, not a PSP request object or Cloudflare request capabilities.

Both names are loaded and passed to WebDyne, but the current Worker dispatches
only startup. A configured shutdown callback will not run until graceful
shutdown dispatch is implemented. State propagation and shared D1/KV/R2 objects
remain separate work.

**Runtime prerequisite:** version 1.0.5 embeds WebDyne 3.028 with callback
support. Older 1.0.4 binaries require an updated WebDyne library overlay when
callbacks are configured; the bootstrap reports missing support explicitly.

### Plain PAGI applications

Set `webdyne.entry` to `app.pagi` (or set `WEBDYNE_INDEX` directly). The file
is loaded once beneath `WEBDYNE_ROOT` and must return a PAGI application
coderef. It receives all request paths and scope types directly, including
lifespan startup, without loading WebDyne. The application must acknowledge
startup before HTTP, SSE or WebSocket requests can run. WebDyne-specific
startup/shutdown callback settings do not apply to this mode.

`init` now includes `*.pagi` in new `.assetsignore` files. Add the pattern
manually to existing custom files to keep application source out of static
uploads. WebDyne 3.028 is pinned for PSP applications and clears its own
request diagnostics; the bootstrap no longer calls `errclr()`.
