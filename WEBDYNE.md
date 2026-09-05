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
| `@webdyne/webdyne-zeroperl-5.44.0@1.0.0` | Versioned Perl WASM, embedded WebDyne modules, compiled bridge, PAGI runtime and deployment CLI | WebDyne applications |
| `@aspeer/zeroperl-ts@1.1.0` | ESM/CommonJS bridge, TypeScript declarations and bundled WASM | JavaScript/TypeScript applications embedding Perl directly |

The normal Asyncify WASM and pre-Asyncify reactor are separate artifacts;
applications using the TypeScript bridge must select the Asyncify version.
Installing the npm package does not deploy an application; build/dev/check/deploy
are explicit commands.

This WebDyne integration fork builds the last patch releases of three qualified
release lines: **5.18.4**, **5.36.3**, and **5.44.0**.

## Runtime contents

This is the canonical ZeroPerl runtime for WebDyne::PAGI WASM targets. It
consolidates upstream fork improvements, embeds WebDyne 3.023 and PAGI::Tools
0.002002 with their runtime dependencies, and statically compiles the XS
modules needed by WebDyne, plus Sub::Name, Params::Util, Class::XSAccessor
(including its array accessors), Text::CSV_XS and Variable::Magic for common
application code. A normal PSP application therefore does not need a
separate Perl library archive. The versioned npm package also includes the
compiled JavaScript bridge, provider-neutral PAGI runtime, default Cloudflare
adapter, Perl launchers, and application VFS builder required to serve PSP
files without another WebDyne checkout.

## Cloudflare package usage

Install the Perl 5.44.0 runtime from npm using
`@webdyne/webdyne-zeroperl-5.44.0@1`. Put the complete application tree below
`app/`, including the default `app/app.psp`, then install the runtime:

```bash
npm install @webdyne/webdyne-zeroperl-5.44.0@1
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
