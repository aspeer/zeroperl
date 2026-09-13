# WebDyne with the optional Cloudflare KV extension

## Quick start

Requires Node.js 24+ and npm. From the repository root, copy into a fresh directory:

```sh
cp -R examples/cloudflare-kv /tmp/zeroperl-cloudflare-kv-example
cd /tmp/zeroperl-cloudflare-kv-example
npm install
npm run check
npm run dev
```

Open the local address printed by Wrangler, normally `http://localhost:8787/`.
Stop with Ctrl-C. `check` builds and dry-runs the Worker; it does not deploy.
After changing Perl source, run `npm run build` or restart `npm run dev`.

## What to expect

**This example requires WebDyne::Cloudflare.** Its `package.json` installs
`@webdyne/webdyne-cloudflare` 1.2.0+ alongside ZeroPerl 1.0.9+, enables the
extension and explicitly allows the `CACHE` binding. The other examples do
not need this package.

Open `/`: initially there is no greeting. Press **Save greeting** to POST a
fixed value, then refresh to read it. GET requests do not write. The service
object is created from the current request scope and is never cached globally.
The page escapes the value before rendering it.

```sh
curl http://localhost:8787/
curl -d save=1 http://localhost:8787/
curl http://localhost:8787/
```

Wrangler supplies local KV storage; no namespace provisioning, account login,
secret, or database setup is required. Local state lives below `.webdyne/` in
the generated configuration's Wrangler state directory. KV updates may take
time to become visible, so this is not a transactional counter example.

For deployment, set `webdyne.cloudflare.kvNamespaces` to an existing namespace,
for example `[{"binding":"CACHE","namespaceId":"YOUR_KV_NAMESPACE_ID"}]`, and follow
[the extension configuration guide](https://github.com/aspeer/pm-WebDyne-Cloudflare#configuration).
The binding-only configuration here is for the local quick start. Do not deploy
the demonstration write form unchanged: add application authentication and
request authorization first.

See the [examples overview](../README.md) for shared layout and runtime details.
