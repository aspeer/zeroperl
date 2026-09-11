# ZeroPerl WebDyne decisions

These are the decisions which still describe the runtime. Superseded release
experiments and implementation diaries are retained in Git history.

## Compatibility and supported Perls

Preserve existing WebDyne behaviour and keep provider APIs outside the core.
Supported build lines are 5.18.4, 5.36.3 and 5.44.0. Perl 5.24.4 failed real
Chain/Template async execution even with a larger capture buffer, so it is
excluded. ExifTool is opt-in. The experimental mini build did not meet its
compressed-size gate and is not a release target.

Older Perls retain the ABI compatibility needed by the selected XS modules.
The Asyncify capture buffer is 64 KiB, separate from the 8 MiB WASM stack.
Embedded immutable files have nonzero mtime 1 so WebDyne can distinguish a
successful stat. Application VFS entries use the same epoch-second convention.
The lightweight POSIX facade supplies strftime without the complete POSIX XS.

## Runtime, bridge and provider ownership

The canonical bridge source is the aspeer zeroperl-ts repository, pinned as a
submodule. Generated `js/zeroperl.js` is refreshed from it. Keep marshalling
there, PAGI transport in the portable runtime, and Cloudflare execution-context
and WebSocket APIs in the provider adapter.

A bridge artifact refresh may reference a runtime release without repointing
the runtime gitlink for artifact-only bridge commits; otherwise provenance
would be circular. Verify bridge source equality when doing this.

Borrowed callback values remain valid until the host callback settles. Owned
returns transfer ownership, and destructive value operations retain temporary
state across async suspension. Asyncify reentry preserves the suspended C stack,
restores the root before export reentry, then restores the suspended pointer at
the rewound import. Both restores are needed across supported Perl versions.

## Application files and extensions

Host application directories are configurable but always mount at `/app`.
Launchers use `/perl5/bin`, optional Pure-Perl modules use `/perl5/lib`, and
`/tmp` is writable with TMPDIR preserved. Configuration is encoded as data,
not interpolated Perl source.

Extensions must be declared direct npm dependencies and enabled explicitly.
Their manifests supply Perl modules and static provider imports. Register once
per interpreter generation, attach capabilities per request, and clean up once
in reverse order. The separate WebDyne::Cloudflare package owns D1/KV/R2 APIs;
the CLI only translates resource configuration for generated Wrangler files.

`init` is explicit and preserves existing scripts and ignore files. It disables
WebDyne static serving and creates source ignore patterns, including `.pagi`.
The effective assets root's `.assetsignore` decides which files remain in VFS
and which Cloudflare serves. No ignore file means legacy full-VFS packaging.
Explicit assets arguments win. Nested/misspelled ignore files and a public
entry are rejected. Custom Wrangler files remain untouched.

`destroy` requires interactive full-Yes confirmation and retains Wrangler's
target/dependency checks. It skips builds and refuses bypass flags.

## CPAN and XS

Resolve CPAN dependencies once per target Perl into checked, versioned Carton
snapshots. Normal builds consume those archives in deployment mode. Static XS
recipes use the same sources and their matching Perl companions; they do not
select independent versions. Host native extensions cannot be application
library overlays.

The small application XS set includes Sub::Name, Params::Util,
Class::XSAccessor (including Array), Text::CSV_XS and Variable::Magic.
Variable::Magic's measured compressed cost was small and its asynchronous
callbacks passed qualification. Legacy target-specific fixes remain in the
build layer. See [BUILD.md](BUILD.md) for the current recipe and lock process.

## Persistent requests and lifespan

Retain each Cloudflare session's completion with `context.waitUntil`, including
stream cleanup after the connection closes. Enable `enable_request_signal` so
disconnected SSE cannot leave a later write blocking the interpreter.
The platform's ordinary request lifetime limits still apply.

WebDyne 3.028 clears its own request diagnostics. The bootstrap no longer calls
errclr at each request; this supersedes the earlier adapter workaround.

Startup goes through PAGI lifespan and gates the shared interpreter promise.
Concurrent first requests share startup. Failure retires the generation; a
later request can create another. The acknowledgement timeout is 10 seconds
of schedulable host time, not CPU interruption.

Named callbacks are supported by embedded WebDyne 3.028. Validated qualified
function names are loaded through modules, never evaluated as expressions.
The core owns callback execution and Future acknowledgement. The Worker sends
startup only; shutdown dispatch, state propagation and interpreter-lifetime
service capabilities remain future work.

A case-sensitive `.pagi` entry loads an application coderef once, receives all
paths/scopes and owns lifespan acknowledgement. It bypasses WebDyne loading,
PSP routing and WebDyne callback configuration.

## Releases and attribution

Project semver identifies a release; Perl versions select variants. Paired
annotated project-prefixed and v tags identify the same main commit. Only the
project-prefixed tag triggers the build/package/staging workflow. This replaces
earlier per-Perl build numbering and separate candidate workflows.

The unsuffixed npm package duplicates the newest supported Perl distribution.
Both names need independent Trusted Publishing setup and maintainer approval.
Staging is not public publication. See [RELEASING.md](RELEASING.md).

npm includes the Asyncify runtime and reviewed component notices, plus a link
to broader release evidence. The reactor and broad source-evidence archive stay
outside npm. This supersedes the temporary link-only licence experiment.
Packaging checks a reviewed inventory, the 500 KB notice budget and the 6 MB
compressed package budget. Additional Perl variants need their own inventories.

Local development tarballs reuse qualified runtime bytes, add a unique private
development version and record tooling provenance separately. They do not
change the binary's release identity or create tags.

## Documentation ownership

README preserves the fork introduction, credits and upstream instructions.
WEBDYNE is the application guide; service APIs/configuration belong in the
WebDyne::Cloudflare README. Build, test and release guides describe repeatable
procedures. PLANS and BACKLOG hold current work, not completed release diaries.

## Optional PAGI lifespan (2026-09-11)

The shared WASM host treats application return or exception before any lifespan
response as unsupported lifespan and continues on the same interpreter. Explicit
failure, invalid responses, timeout and interpreter failures remain fatal to
startup. No configuration switch is needed; WebDyne's callback handling stays
unchanged. The application completion callback owns this decision so host or
interpreter failures cannot be mistaken for an unsupported protocol.
