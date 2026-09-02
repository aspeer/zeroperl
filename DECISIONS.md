# ZeroPerl WebDyne decisions

## D001: Supported Perl release lines

Qualified standard artifacts target Perl 5.18.4, 5.36.3, and 5.44.0. Perl
5.24.4 is excluded because real WebDyne Chain/Template execution traps in
`_asyncjmp_longjmp` with both 32 KiB and 64 KiB capture buffers, despite
passing the low-level async probes.

## D002: WebDyne compatibility takes precedence

The canonical runtime embeds WebDyne 3.023, WebDyne::PAGI, PAGI::Tools
0.002002, their runtime dependencies, and the XS modules they require. Generic
PAGI compatibility is useful but is not a release gate.

## D003: Bridge ownership and distribution

JavaScript/Perl marshalling and Asyncify-aware resource disposal belong in
`zeroperl-ts`; Perl runtime and static-XS behaviour belong in this repository.
The versioned WebDyne npm distribution nevertheless carries the compiled
bridge, provider-neutral PAGI runtime, default Cloudflare adapter, and Perl
launchers so one package is sufficient to execute a PSP application. The
canonical editable bridge source remains `zeroperl-ts`; `js/zeroperl.js` is its
generated distribution artifact.

Cloudflare-service integrations such as D1 remain separate from the core host.

## D004: Mini artifact gate

A mini artifact will only be retained if its compressed WASM is at least 30%
smaller than the equivalent standard artifact while retaining required WebDyne
modules. The Perl 5.44.0 safe experiment retained the standard module and XS
surface and used compressed SFS embedding. It was 16.1% smaller raw but 7.3%
larger after gzip, so Milestone 1 does not publish a mini artifact. Repairing
the older trace-based XS-pruning path is out of scope because the product
requirement is to retain required WebDyne XS and nearly all core XS modules.

## D005: POSIX compatibility surface

The WASM runtime supplies the `POSIX::strftime` surface used by WebDyne without
claiming support for the complete core `POSIX` XS module.

## D006: Legacy XS ABI compatibility

Perl 5.18, 5.24, and 5.36 retain the core mathoms compatibility layer because
current WebDyne XS dependencies use legacy Perl ABI symbols on those releases.
Newer releases continue to build with `NO_MATHOMS`.

## D007: ExifTool is opt-in

ExifTool is not part of the WebDyne runtime deliverable and is excluded from
all standard artifacts. `BUILD_EXIFTOOL=true` remains available solely for
special-purpose builds and is not a release gate.

## D008: Asyncify capture headroom

The setjmp/Asyncify capture buffer is 64 KiB. It is separate from the 8 MiB
WebAssembly execution stack. Although the increase did not repair Perl 5.24.4,
it passed all retained versions and provides headroom for deeper WebDyne page
call stacks.

## D009: Embedded files have a stable nonzero modification time

Embedded SFS entries are immutable and report `st_mtime = 1`. A zero value is
ambiguous to callers that use a truthy modification time to distinguish a
successful `stat`; WebDyne does this when compiling its built-in index page.
The fixed epoch sentinel preserves deterministic artifacts without inventing a
build-time timestamp.

## D010: Version artifacts by Perl release and WebDyne build

Each supported Perl release line has an independently incremented positive
WebDyne build number. Local outputs retain the exact Perl version and build
number in every public filename. A release tag uses
`v<perl-version>-webdyne.<build-number>` and cannot be overwritten with
different bytes.

The npm package name contains the Perl version, for example
`@webdyne/zeroperl-webdyne-5.44.0`. Its SemVer major is the WebDyne build
number, so build 1 publishes as `1.0.0` and may be selected as `@1`. npm
packaging consumes qualified release bytes and does not rebuild the runtime.

GitHub attestations and SHA-256 manifests provide binary provenance and
integrity. Platform-specific executable signing is not applicable to a WASM
module. npm Trusted Publishing remains disabled until the package namespace
and OIDC publisher are configured.

## D011: Portable core with Cloudflare as the default provider

The npm runtime separates interpreter/VFS ownership, Fetch-to-PAGI transport,
and provider integration. Cloudflare is the only qualified provider and remains
the zero-configuration default. Its non-standard `WebSocketPair` and
`ExecutionContext.waitUntil()` behavior is confined to the Cloudflare adapter;
future providers must supply equivalent lifecycle and WebSocket capabilities
without changing the WebDyne runtime core.

Application repositories place their complete served tree in `app/` by
default. The source directory is configurable, but it always mounts at VFS
`/app`. Runtime helpers and optional Pure-Perl dependencies use `/perl5/bin`
and `/perl5/lib`; `/tmp` is writable and exposed as `TMPDIR`. The package may
generate Wrangler configuration during an explicit build/dev/check/deploy
command, but installation itself has no deployment side effects.
