# Abrupt WebSocket disconnect: standalone Cloudflare reproduction

This Worker contains no Perl, WASM, WebDyne, dependencies or `waitUntil` calls.
It reproduces the diagnostic seen when a TCP connection disappears without a
WebSocket close handshake:

> The Workers runtime canceled this request because it detected that your Worker's code had hung and would never generate a response.

Using an installed Wrangler CLI, from the repository root:

```sh
wrangler dev --config t/runtime/hung-request/wrangler.json --local --ip 127.0.0.1 --port 8898
node t/runtime/hung-request/smoke.mjs http://127.0.0.1:8898/
```

The dependency-free Node client performs 20 WebSocket handshakes, sends masked
text frames, drops each TCP connection without a Close frame, and verifies
that subsequent HTTP requests still succeed. `ROUNDS` changes the count.
Its successful exit establishes service responsiveness, not absence of warnings;
inspect Wrangler logs separately. Use a dedicated local test Worker.

Observed on macOS with Wrangler 4.127.1 / workerd 1.20260828.1 and independently
with Wrangler 4.129.0 / workerd 1.20260903.1, compatibility date 2026-08-27.
The new-version standalone test emits the diagnostic for each forced disconnect.
Removing the server's echo also reproduces it. Explicit server close handlers
change the diagnostic to `Network connection lost`; they do not provide a clean
resolution. No such workaround is incorporated into the runtime.

Expected: abnormal network loss should close the connection without reporting
that application code could never generate a response; the 101 upgrade has
already completed. Actual: a hung-request diagnostic appears while subsequent
requests succeed. This is suitable for an upstream report; none has been sent.
Hosted Cloudflare behaviour has not been tested.

The same client can target `/ws.psp` in a local WebDyne fixture installation.
Transient runtime tracing confirmed application completion, session map removal
(back to zero), and extension release after forced disconnects on Perl 5.44.
Normal overlap still passes after the disconnect reproduction.
