# WebDyne form and static assets

## Quick start

Requires Node.js 24+ and npm. From the repository root, copy into a fresh directory:

```sh
cp -R examples/webdyne /tmp/zeroperl-webdyne-example
cd /tmp/zeroperl-webdyne-example
npm install
npm run check
npm run dev
```

Open the local address printed by Wrangler, normally `http://localhost:8787/`.
Stop with Ctrl-C. `check` builds and dry-runs the Worker; it does not deploy.
After changing Perl source, run `npm run build` or restart `npm run dev`.

## What to expect

Open `/` to see **Hello, visitor!**. Enter `Alice` to see **Hello, Alice!**.
The GET form places the name in the query string; nothing is saved. Input is
limited to 80 characters server-side and entity-encoded before rendering, so
`<b>Alice</b>` appears as text rather than markup. Empty input uses `visitor`.

`app/app.psp` uses a named handler and render parameters. `app/style.css` is
served as a public asset; `.assetsignore` keeps the PSP source private.
`webdyne.static` is false because the asset service serves the stylesheet.

```sh
curl 'http://localhost:8787/?name=Alice'
curl http://localhost:8787/style.css
```

This application needs only the ZeroPerl runtime package. WebDyne and its
Perl dependencies are bundled; WebDyne::Cloudflare is not required.

See the [examples overview](../README.md) for shared layout and runtime details.
