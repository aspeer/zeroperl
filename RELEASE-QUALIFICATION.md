# Final release qualification — 2026-09-06

The first-release artifacts include WebDyne **3.026**, pinned exactly in
`cpanfile` and all three target snapshots. Builds use clean runtime source
`b08c545bb740d2093b8858a09be9e7a3a0b3cc04` and bridge implementation
`7e91d2cfd3e2c42c3d5ecb97cf81d739f8d83a71`. Subsequent qualification-document
and bridge-manifest commits do not change the tested implementation. The runtime
submodule remains pinned to that implementation to avoid circular references
between its source revision and the TypeScript package's runtime manifest.

## Artifacts and checks

| Perl | Runtime npm version | Main WASM SHA-256 |
| --- | --- | --- |
| 5.18.4 | 1.0.0 | `9e501db352a83e6febfebacda619bee95ba004d4be0c8ec18bece0725fe3b207` |
| 5.36.3 | 1.0.0 | `1f98d2a301b0885ddefa94cdd808db151176fd369ede72ac50d51d34d3e90380` |
| 5.44.0 | 1.0.0 | `bd59be6cc0a4b0efbbad83ccdf34606b812e651acb4a256f30e1890034bbde61` |

Each target passed locked CPAN/XS versions (including WebDyne and WebDyne::PAGI
3.026 and Carp >= 1.50), XS magic checks, 24 lifecycle checks, 100 Asyncify
re-entry rounds, embedded/core modules, Socket, 11 C ABI release cases,
notice integrity, artifact checksums, exact 38-file npm archive inventory and
npm publication dry-run. Both standard and reactor artifacts were generated.
The persistent Cloudflare acceptance below uses the standard 5.44 artifact.

The TypeScript package `@aspeer/zeroperl-ts@1.1.0` bundles this exact 5.44
artifact. Declaration and bundle builds, 160 Bun tests (266 assertions),
24 lifecycle checks, 100 Asyncify rounds, 47-file package inspection, installed
Node ESM/CJS and NodeNext consumers, and npm publication dry-run all pass.

Additional checks: 17 runtime JavaScript tests; 164 native SFS assertions and
17 generator tests; shell/workflow lint; Perl loader syntax and 22 native
regression/CPAN-lock assertions using matching Perl 5.44 and WebDyne 3.026 in
the native build container. Host Perl XS installations were incompatible with
the host's recent Perl upgrade; the matching container supplied native evidence.

## Persistent Cloudflare interpreter

A separate application installed the final 5.44 npm archive and passed:

- WebDyne 3.026 / Perl 5.44.0 verification through an HTTP version endpoint.
- 45 seconds of live SSE and WebSocket traffic, cancellation/close, then
  another 45 seconds of healthy HTTP requests.
- 1,000 mixed HTTP/SSE/WebSocket rounds (6,000 requests), then sequential
  SSE completion and WebSocket echo.
- 20 abrupt WebSocket disconnects with healthy follow-up HTTP. The previously
  accepted upstream hung-request warning remains; it also reproduces without Perl.
- D1 HTML/JSON/insert/recovery, 24 concurrent reads and 8 atomic batch checks;
  KV and R2 operations and cleanup, alongside live streams.

Long-lived SSE cancellation initially exposed a separate real queue stall.
Generated Wrangler configurations now enable `enable_request_signal`, allowing
the existing abort listener to deliver PAGI disconnect and release the session.
Custom Wrangler configurations must enable this flag too; see WEBDYNE.md.

Earlier hosted Cloudflare preview tests with WebDyne 3.026 and this configuration
fix passed the same 45+45-second lifetime test and 100 overlap rounds (600
requests). That preview used an earlier 3.026 binary. Repeating the hosted test
with the exact final rebuilt binary was rejected by automatic approval review
because it uploads package/application content to Cloudflare. Thus the final
binary has local acceptance; exact-final hosted acceptance still needs explicit
upload approval. Hosted D1/KV/R2 were not exercised. No production Worker was
modified. These results do not certify browser, Deno or Windows deployments.

## Integration and publication

The user authorized local main integration after these checks. The corresponding
commits contain the final manifest and this qualification record. No push or npm
publication is performed. The release may prioritize Perl 5.44 even though all
three local build/qualification targets passed.

Before publication, obtain the user's publication approval, confirm public
source/submodule access and publisher permissions, host the manifest-matched
artifacts, and configure the TypeScript artifact base URL. npm dry-run verifies
packaging; it does not prove publish permissions. Repeat exact-final hosted
acceptance when the Cloudflare upload is approved.

Local build/qualification logs are `/tmp/zeroperl-3026-final-build-<perl>.log`
and `/tmp/zeroperl-3026-final-qualify-<perl>.log`. Final-package local evidence
is `/tmp/zeroperl-3026-package-{lifetime,overlap,disconnect}.log`. These temporary
logs supplement this committed record; they are not distributed artifacts.
