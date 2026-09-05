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
`@webdyne/webdyne-zeroperl-5.44.0`. Its SemVer major is the WebDyne build
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

## D012: Resolve provider extensions explicitly from npm

The runtime package does not embed optional Cloudflare services. Applications
name extensions under `webdyne.extensions` and must also declare them as direct
production dependencies. A versioned manifest identifies the package's Perl
library and static provider export; dependency scanning and npm install hooks
are deliberately avoided.

The provider-neutral lifecycle registers host functions for every interpreter
generation and attaches request capabilities with guaranteed cleanup. The
Cloudflare deployment helper may translate provider-owned configuration such
as `d1Databases` into Wrangler fields without moving that behavior into the
portable runtime. `kvNamespaces` and `r2Buckets` follow the same boundary: the
helper maps application-owned identifiers and local/remote flags to Wrangler,
while the separately installed extension owns the Perl and JavaScript service
behavior.


## D013: First public release uses the consolidated implementations

The user confirmed preparing candidates from the latest implementation branches
for eventual main merges. Review fixes remain on `codex/first-release-review`.
The npm runtime and standalone bridge are separate distributions with separate
versions; both need matching runtime qualification. No publication or merge is
implied by preparing a public package manifest.

Bootstrap JSON is encoded as UTF-8 hexadecimal data in a Perl pack expression,
so configuration is never interpreted as interpolated Perl source. Library
files matching the embedded prefix are omitted only when no configured library
supplies differing bytes for that module path.

## D010: Callback ownership and asynchronous replacement

Callback arguments are borrowed until the host callback settles. The C
callback captures a returned argument's SV before freeing argument handles;
an independent returned wrapper transfers its owned reference without an
extra increment. The bridge invalidates returned owned wrappers and expired
borrowed wrappers and rejects cross-interpreter returns.

Array/hash/scalar replacements use the same asyncjmp boundary as release.
The bridge retains temporary values and names through completion and preserves
the synchronous path when no destructor suspends. Direct value APIs do not
promise support for tied/overloaded magic; evaluate those operations in Perl.

Generated npm metadata follows the existing MIT runtime source license. The
Apache bridge license and notice are included separately, and embedded
interpreter/dependency attribution must accompany the qualified artifacts.

## D011: Preserve live C frames through Asyncify rewind

The corrected bridge uses three stack-pointer phases: preserve the suspended
C stack while awaiting the host promise; restore the root before re-entering
the exported C wrapper; restore the suspended pointer at the rewound import
before resuming its C continuation. Finally restore the root on export exit.

Keeping the suspended pointer through export re-entry made the untransformed
C wrapper read a different result context from the one its callback wrote.
Restoring only the root repaired results but broke rejected-callback recovery
on older Perl versions. Both restores are required. The correction passes
scalar/list results, repeated yields, host allocations and rejection recovery
on Perl 5.18.4, 5.36.3 and 5.44.0 without rebuilding the WASM binaries.

Scalar replacement also drains its own Perl temporary scope. Perl 5.18 may
mortalize the old reference, so omitting this scope postpones DESTROY beyond
the setter's completion.

## D012: Resolve CPAN versions once per target Perl

`make cpanfile.snapshot` reconciles dependencies under the selected native Perl;
`make cpanfile.snapshot-update` starts a fresh resolution. The default comes
from `release/defaults.mk`. Versioned Carton snapshots are the sole selection
of CPAN distribution versions. Companion metadata binds inputs and archives
by checksum. Normal builds install in deployment mode and XS recipes consume
the same archives; recipes only describe target compilation and patches.
Snapshots differ by Perl version because core modules and compatible dependency
versions differ. Full toolchain/byte-for-byte reproducibility is outside this
change. Publication remains a separate user decision.

## D014: Include a small base set of application XS modules

The approved base additions are Sub::Name 0.28, Params::Util 1.102,
Class::XSAccessor 1.19 (including Array), Text::CSV_XS 1.64 and
Variable::Magic 0.65. The snapshots retain existing selections; only Perl
5.18 additionally needs the Pure Perl XSLoader 0.24 distribution. Variable::Magic
has no external C library or non-core runtime dependencies.

Retain Variable::Magic: removing its archive, bootstrap and embedded companions
from the otherwise identical Perl 5.44 build reduces raw WASM by 27,791 bytes
and gzip-9 by 194 bytes. Compressed deltas depend on whole-program optimization
and compression and are not additive module sizes. The all-five measurement
binary is byte-identical to qualified build 8. Removing the complete batch
reduces it by 210,258 raw bytes and 58,048 gzip-9 bytes.

Params::Util's native dynamic-loading probes are bypassed only for WASI;
target compilation and execution qualify the static implementation. Normalize
module source permissions before executable stripping, since the upstream
Params::Util.pm has its executable bit set. This also restores four existing
runtime module files that were previously stripped. The locked XSLoader update
may replace Perl 5.18's older Pure Perl loader without changing core XS objects.

Build 8 is qualified on 5.18.4, 5.36.3 and 5.44.0, including asynchronous
Variable::Magic set/free callbacks and the existing lifecycle checks. See
TESTS.md for artifact sizes and evidence. Publication and consumer package
refreshes remain separate from these local runtime candidates.

## D013: Release source references across the runtime and bridge

The runtime pins the tested bridge implementation commit. The bridge can then
record the clean runtime release manifest in a subsequent artifact-only commit.
Repointing the runtime gitlink for every bundled-runtime refresh would create
a circular provenance dependency. Validate that bridge source and the generated
runtime bridge remain identical across that artifact-only refresh.

## D014: Clear WebDyne diagnostics at application request entry

Final local Worker acceptance reproduced a caught D1 batch constraint error
appearing in the next unrelated KV request. WebDyne 3.023 retains that message
in its process-wide diagnostic stack even when the API handler recovers.
The WebDyne-specific adapter calls the public `WebDyne::Util::errclr()` API
before invoking each new application request. This prevents cross-request
error leakage while preserving errors raised by the current request. The
provider-neutral PAGI runner and generic TypeScript bridge remain unchanged.
The core framework's treatment of caught exceptions within one request remains
an upstream follow-up; this compatibility fix establishes a clean request entry.

## Retain Cloudflare completion for every session

Register HTTP, SSE and WebSocket session completion with `context.waitUntil`.
A connection closing can precede queued Perl work and extension cleanup. The
provider must retain the originating request context through that completion
to avoid canceled cross-request continuations. Response delivery and the single
persistent interpreter remain unchanged. The normal Cloudflare post-request
execution limit still applies; no compatibility flag is disabled.
