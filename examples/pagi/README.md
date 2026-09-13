# Native PAGI HTTP application

## Quick start

Requires Node.js 24+ and npm. From the repository root, copy into a fresh directory:

```sh
cp -R examples/pagi /tmp/zeroperl-pagi-example
cd /tmp/zeroperl-pagi-example
npm install
npm run check
npm run dev
```

Open the local address printed by Wrangler, normally `http://localhost:8787/`.
Stop with Ctrl-C. `check` builds and dry-runs the Worker; it does not deploy.
After changing Perl source, run `npm run build` or restart `npm run dev`.

## What to expect

`app/app.pagi` returns an async application coderef receiving the scope,
receive callback and send callback. It sends PAGI response events directly;
it does not load WebDyne or use PSP routing. `Future::AsyncAwait` and `JSON::PP`
are bundled in the runtime, so no CPAN installation or WebDyne::Cloudflare
package is required.

| Request | Result |
| --- | --- |
| `GET /` | 200 text greeting |
| `GET /info` | 200 JSON with application, method and path |
| `HEAD /info` | 200 JSON content type with no response body |
| `GET /missing` | 404 text response |
| `POST /` | 405 with `Allow: GET, HEAD` |

```sh
curl -i http://localhost:8787/
curl -i http://localhost:8787/info
curl -I http://localhost:8787/info
curl -i http://localhost:8787/missing
curl -i -X POST http://localhost:8787/
```

Use the port printed by Wrangler if different. All paths reach the PAGI app;
there is no PSP filename lookup. The example drains and discards request bodies without buffering them; it does
not stream responses or accept WebSockets. It declines optional lifespan by returning
without an acknowledgement; the runtime logs this once per interpreter and
continues to serve HTTP. Request data stays in invocation-local variables.

See the [examples overview](../README.md) for shared layout and runtime details.
