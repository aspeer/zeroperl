# Examples

Each subdirectory is an independent application, with the same `package.json`
and `app/` layout as the WebDyne::Cloudflare examples.

| Directory | Demonstrates | Requires WebDyne::Cloudflare? |
| --- | --- | --- |
| [webdyne](webdyne/README.md) | PSP handlers, a GET form, escaped output and a public stylesheet | No |
| [pagi](pagi/README.md) | Native PAGI routing, JSON, HEAD and HTTP errors | No |
| [cloudflare-kv](cloudflare-kv/README.md) | WebDyne using a request-scoped Workers KV binding | Yes, explicitly installed and enabled |

## Install and run

Requires Node.js 24+ and npm. Copy one directory outside this checkout, then
install the released runtime from npm:

```sh
cp -R examples/webdyne /tmp/zeroperl-webdyne-example
cd /tmp/zeroperl-webdyne-example
npm install
npm run check
npm run dev
```

Use a fresh destination. Open the address printed by Wrangler (normally
`http://localhost:8787/`); stop it with Ctrl-C. Each example README includes its
own complete quick start and expected responses.

The examples require `@webdyne/webdyne-zeroperl` 1.0.9 or later in the 1.x
series. It includes WebDyne, PAGI, the Perl WASM runtime and Wrangler; a host
Perl installation or runtime rebuild is not needed. The command named
`webdyne-cloudflare` belongs to this runtime: using it does **not** require the
separate `@webdyne/webdyne-cloudflare` extension. Only `cloudflare-kv` installs
that extension (1.2.0+).

## Layout and development

- `package.json`: dependencies, scripts and application configuration.
- `app/`: Perl application source and public assets.
- `app/.assetsignore`: keeps server source in the Perl VFS and out of public assets.
- `.gitignore`: excludes dependencies, generated files and local environment files.
- `README.md`: setup and behavior for that application.

`npm run build` generates `.webdyne/`; `npm run check` builds and performs a
Wrangler deployment dry run. `npm run dev` builds and starts local development.
After editing Perl/PSP source, rebuild in another terminal or restart dev.
The compatibility date uses the runtime generator's default, matched to its bundled Wrangler.
Keep `.assetsignore` when copying an example. Commit the generated npm lockfile
in your own application to retain the dependency versions you tested.

These quick starts use [Wrangler local development](https://developers.cloudflare.com/workers/local-development/).
They need no Cloudflare login or hosted resources. The KV example uses local
storage. Before deploying it, configure an existing remote namespace and add
appropriate authorization for writes; its README explains the boundary.

See [WEBDYNE.md](../WEBDYNE.md) for runtime configuration, additional Perl
libraries, lifespan, and deployment. The broader
[WebDyne::Cloudflare examples](https://github.com/aspeer/pm-WebDyne-Cloudflare/tree/main/examples)
cover service integrations. Runtime regression fixtures remain under `t/`.
