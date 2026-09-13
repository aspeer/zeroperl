# Pagi::ZeroPerl::Runner

Internal persistent-session runner used by the portable WebDyne runtime. It owns
Perl session Futures and connects their send/receive, disconnect and timer events
to registered JavaScript host functions. Application entrypoints receive a scope,
receive callback and send callback, and return a Future.

`start_session(id, scope_json, entrypoint)` validates the entrypoint as a qualified
Perl function name and lazily requires its package if not already loaded. The
normal WebDyne application is preloaded; finite invocation adapters can instead
live in an installed extension package. A function name is never evaluated as
Perl source. The existing session registry, Future completion and error path are
shared by both modes.

`deliver_receive`, `deliver_timer`, and connection/disconnect delivery resume the
owning session under its current-session identity. `abort_session` removes failed
session state; JavaScript owns extension capability revocation and awaited cleanup.
These functions form an internal runtime ABI, not an application API. See
`js/runtime/webdyne-runtime.js.md` for finite invocation setup and result events.
