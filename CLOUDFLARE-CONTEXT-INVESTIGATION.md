# Cloudflare request-context investigation (2026-09-05)

Status: bridge and provider corrections implemented. Local Perl 5.44.0
acceptance passes for the original context failure. Abrupt WebSocket termination
still produces a separate diagnostic; no publication or hosted deployment.

## Finding

After the Asyncify correction, the original provider still intermittently
loses request contexts under overlapping HTTP, SSE and WebSocket traffic.
Local workerd reports cross-request Promise continuation cancellation and
`Cannot perform I/O on behalf of a different request` (`SpanParent`). Requests
then time out, without the former invalid-result-handle WASM trap.

The provider registers completion with `waitUntil` for HTTP only. SSE writer
closure and WebSocket disconnection can end the connection before queued Perl
continuations and extension cleanup settle. The shared interpreter queue can
then depend on a continuation whose owning context has ended. This lifetime
explanation is strongly supported by the controlled experiment below; exact
workerd scheduling of the failing continuation has not been instrumented.

Cloudflare documents that continuations belonging to ended request contexts
are dropped with the enabled cross-request Promise handling flag:
https://developers.cloudflare.com/workers/configuration/compatibility-flags/
`waitUntil` allows cleanup after response completion/disconnection, subject to
its 30-second post-request limit:
https://developers.cloudflare.com/workers/runtime-apis/context/

## Proposed provider change

Register `context.waitUntil(dispatch.completion)` for every dispatch, keeping
response delivery unchanged. Update the adjacent comment accordingly. Retain
one persistent interpreter and its serialized entry queue. Do not disable
Cloudflare's cross-request Promise handling or move request-owned I/O globals.

## Controlled local evidence

Runtime: Perl 5.44.0 build 1, corrected generated bridge, Wrangler 4.127.1,
workerd 1.20260828.1. Same app, binaries and workload in both experiments.
Each round concurrently performs two HTTP requests, two completed SSE streams
and two WebSocket echo sessions followed by client close.

- Original provider: 13 completed rounds, then timeout and context/SpanParent
  errors. Earlier runs also failed intermittently, including after 56 rounds.
- Candidate: 200 rounds plus 1,000 rounds in one Worker; another fresh Worker
  passed 1,000 rounds with a separate WebSocket held open. Total: 2,200 rounds,
  13,200 short requests, with no context cancellation warnings.
- The held WebSocket echoed both initially and after 45 seconds, completed
  its close handshake, and subsequent HTTP passed.
- The original SSE-completion-to-WebSocket sequence also passed.

Temporary evidence and the proposed patch are in `/tmp/zeroperl-rootcause/`:
`lifetime-control-overlap.log`, `lifetime-control-worker.log`,
`lifetime-overlap.log`, `lifetime-overlap-1000.log`,
`lifetime-long-overlap.log`, `lifetime-long.log`, and
`cloudflare-lifetime-proposed.patch`. These temporary files are not release
artifacts and may be deleted by the operating system.

## Remaining qualification

Review and integrate the provider correction with an automated overlap gate.
Cover abruptly canceled SSE, abrupt WebSocket disconnect, slow binding I/O,
and cleanup that runs near the post-request timeout. Recheck D1/KV/R2 with
concurrent streams and confirm stability in a separately authorized hosted
Cloudflare test before declaring production readiness. Local successful stress
runs are evidence for the candidate, not proof of every request lifetime path.

## Implemented provider acceptance

The approved provider correction now registers every session completion with
`waitUntil`. The compiled bridge and provider source were copied into the local
acceptance installation, which rebuilt the Worker before testing.

- All 17 runtime JavaScript tests pass.
- `ROUNDS=1000 node tests/runtime/smoke-stream-overlap.mjs BASE_URL` passes:
  6,000 overlapping HTTP/SSE/WebSocket requests in the persistent interpreter.
- D1 (including 24 concurrent reads and 8 batch checks), KV and R2 operation
  and cleanup suites pass while overlap traffic runs.
- A separate WebSocket echoes initially and after 45 seconds; close handshake
  and subsequent HTTP pass.
- 200 cancellation rounds complete: 400 SSE reader cancellations, 400 forced
  WebSocket disconnects and 200 follow-up HTTP requests. No original cross-request
  Promise warning, SpanParent error or WASM memory trap appears. The SSE fixture
  is short-lived, so this does not certify long-running SSE cancellation.

Forced WebSocket termination emits one workerd 'hung and would never generate
a response' diagnostic per socket. Isolation with 20 SSE-only cancellations
produced no additional warnings; 20 WebSocket-only terminations produced 20.
HTTP service remains responsive. This is a distinct unresolved disconnect
behaviour; client-side pass results alone do not certify clean session teardown.
The diagnostic's origin and retained-session behaviour need investigation.

Evidence: `waituntil-worker.log`, `waituntil-overlap.log`, `waituntil-long.log`,
`waituntil-disconnect.log` and `waituntil-runtime-tests.log` under the temporary
evidence directory above. The overlap regression is retained in the repository.
No hosted testing was performed.

## Hung-request isolation

Reproduced forced-disconnect warnings on Perl 5.44 with temporary tracing.
`finishPagiSession` runs, the active JavaScript session map returns to zero, and
extension release completes. Subsequent HTTP remains healthy. This is evidence
against a stuck application session, not a comprehensive heap-leak measurement.

A standalone JavaScript WebSocket echo handler reproduces the same diagnostic
without loading Perl, WASM, WebDyne, a shared queue or waitUntil. It reproduces
on Wrangler 4.127.1 / workerd 1.20260828.1 and on 4.129.0 / 1.20260903.1.
A no-echo control also reproduces it. Explicit server close/error handlers merely
change the diagnostic to 'Network connection lost'; no workaround was retained.

The dependency-free fixture and client in `tests/runtime/hung-request` provide
an upstream reproduction. Its client also reproduces the WebDyne warning while
follow-up HTTP succeeds. Following forced disconnects, another 200 normal overlap
rounds pass. No production runtime changes are justified by these experiments.
All instrumentation and temporary handler changes were removed.

The remaining work is upstream/local-versus-hosted qualification. The warning
is unresolved, but is independently reproducible outside our interpreter. Do
not confuse it with the repaired bridge corruption or cross-request cancellation.
No upstream report, hosted deployment, merge or publication has been performed.

## Maintainer acceptance

The maintainer accepts the abrupt-disconnect diagnostic as a known limitation.
It is not by itself a release blocker. Hosted acceptance and long-lived SSE
cancellation testing remain outstanding; local evidence does not certify those
paths.


## Long-lived SSE cancellation correction (2026-09-06)

Unlike the accepted abrupt-WebSocket warning, a long-lived SSE cancellation
caused a real shared-interpreter queue stall. Without request signals, a later
SSE timer could await writer.write indefinitely after the client canceled.
Tracing showed entry into timer delivery without exit; subsequent HTTP queued
behind it. The existing request abort listener could not run because Cloudflare
requires the explicit `enable_request_signal` compatibility flag.

The generated Wrangler config now includes that flag. With it, disconnect
finishes the PAGI session and the queue continues. No new interpreter or bridge
change is needed. Custom Wrangler configs must include the same flag.
The retained smoke-stream-lifetime probe checks both a 45-second live connection
period and a 45-second post-cancellation health period. Final local package tests
and earlier hosted 3.026 tests pass. Exact-final hosted replay was blocked by
upload approval review. See RELEASE-QUALIFICATION.md for full evidence and limits.

Cloudflare documents the opt-in in its [request cancellation announcement](https://developers.cloudflare.com/changelog/post/2025-05-22-handle-request-cancellation/).
