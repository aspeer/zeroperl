# WebDyne runtime

`createWebDyneRuntime(options)` creates one isolated, persistent ZeroPerl
interpreter on demand. Required assets are `zeroperlModule`, `appVfsArchive` and
`perlLibraryVfsArchive`. Extensions implement the existing register/attachScope
lifecycle. Each short interpreter entry is exclusive; sessions can otherwise
await events independently. Cloudflare bindings remain in JavaScript.

The default `mode: "pagi"` provides `dispatch(request, bindings)`, returning
`{response, completion, type}`. Completion includes asynchronous extension cleanup.
The provider must retain that completion according to its platform lifecycle.

## Finite invocations (1.0.13)

Use `mode: "invocation"` for non-HTTP event hosts, then call:

```js
await runtime.invoke({
  scope, bindings, entrypoint: "My::Adapter::application", invocation
});
```

`entrypoint` must be a qualified Perl function name. The runner lazily requires
its package if the function has not yet been loaded. It receives the same
scope/receive/send calling convention as a PAGI application and must return a
Future. The finite transport permits exactly one
`{type: "invocation.result", value: ...}` send event. It does not receive HTTP or
WebSocket events. `invoke` resolves to that value only after the application and
all extension cleanup complete. Missing/duplicate results and invalid events fail.

`invocation` is JavaScript-only metadata passed to extensions' attachScope hook;
it is not serialized into Perl. Extensions may install expiring capabilities in
the scope. The host must supply a fresh scope for every invocation. Failures during
partial attachment still await already-attached cleanup.

Invocation mode loads the session runner and Future::IO timer adapter but does not
start the WebDyne HTTP application or its long-lived PAGI lifespan session. This
avoids fabricating an HTTP request for RPC or future finite event adapters.

`dispose()` retires the interpreter generation and fails dependent sessions; it
is intended for an owning host that has finished/awaited invocation cleanup. It is
not a substitute for awaiting invocations or their cleanup, and does not promise
a platform shutdown hook. Hosts retaining application initialization state must
clear it when discarding a failed runtime. The runtime can lazily create another
interpreter after disposal, so hosts should normally discard that runtime object.

Durable Object ownership, complete-invocation serialization, method allowlists,
initialization and RPC encoding belong to WebDyne::Cloudflare, not this portable
runtime. It contains no Durable Object API calls. Ordinary PAGI behavior remains
the default. No WASM ABI changes are required for finite invocation support.
