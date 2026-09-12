import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionManager } from "../js/runtime/extensions.js";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";

// Wrangler imports Perl launchers as text. Supply that same asset behavior in
// Node so the dispatch lifecycle can be tested without running a WASM binary.
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (/\.(pl|pm)$/.test(url)) {
      return { format: "module", shortCircuit: true,
        source: `export default ${JSON.stringify(readFileSync(new URL(url), "utf8"))};` };
    }
    return nextLoad(url, context);
  },
});
const { createWebDyneRuntime } = await import("../js/runtime/webdyne-runtime.js");
hooks.deregister();

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("release revokes all scopes immediately and shares one asynchronous completion", async () => {
  const close = deferred();
  const events = [];
  const manager = createExtensionManager([
    { attachScope: () => () => { events.push("first"); } },
    { attachScope: () => ({ release: () => { events.push("second"); return close.promise; } }) },
  ]);
  const release = await manager.attachScope({});
  const completion = release();
  assert.deepEqual(events, ["second", "first"]);
  assert.equal(release(), completion);
  let finished = false;
  void completion.then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  close.resolve();
  await completion;
  assert.equal(finished, true);
});

test("all cleanups run and synchronous and asynchronous failures are retained", async () => {
  const first = new Error("first");
  const second = new Error("second");
  let finalRan = false;
  const manager = createExtensionManager([
    { attachScope: () => () => { finalRan = true; } },
    { attachScope: () => () => { throw first; } },
    { attachScope: () => async () => { throw second; } },
  ]);
  const release = await manager.attachScope({});
  await assert.rejects(release(), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(new Set(error.errors), new Set([first, second]));
    return true;
  });
  assert.equal(finalRan, true);
});

test("partial attachment failure awaits resource closure and preserves both failures", async () => {
  const close = deferred();
  const setupError = new Error("setup");
  const closeError = new Error("close");
  const manager = createExtensionManager([
    { attachScope: () => () => close.promise },
    { attachScope: () => { throw setupError; } },
  ]);
  const attachment = manager.attachScope({});
  let settled = false;
  void attachment.catch(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  close.reject(closeError);
  await assert.rejects(attachment, (error) => {
    assert.deepEqual(error.errors, [setupError, closeError]);
    return true;
  });
});

test("cleanup deadline signals forced closure and late rejection remains observed", async () => {
  const close = deferred();
  let signal;
  let aborts = 0;
  const manager = createExtensionManager([
    { attachScope: () => ({ release(context) {
      signal = context.signal;
      signal.addEventListener("abort", () => { aborts += 1; }, { once: true });
      return close.promise;
    } }) },
  ], { cleanupTimeoutMs: 10 });
  const release = await manager.attachScope({});
  await assert.rejects(release(), { name: "ExtensionCleanupTimeoutError" });
  assert.equal(signal.aborted, true);
  assert.equal(aborts, 1);
  await assert.rejects(release(), { name: "ExtensionCleanupTimeoutError" });
  close.reject(new Error("late close failure"));
  await new Promise((resolve) => setImmediate(resolve));
});

test("request completion owns cleanup even when attachment fails before Perl starts", async (t) => {
  t.mock.method(console, "error", () => {});
  const close = deferred();
  const setupError = new Error("attachment failed");
  const runtime = createWebDyneRuntime({
    zeroperlModule: new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
    appVfsArchive: new ArrayBuffer(0),
    perlLibraryVfsArchive: new ArrayBuffer(0),
    extensions: [
      { attachScope: () => () => close.promise },
      { attachScope: () => { throw setupError; } },
    ],
  });
  const dispatch = runtime.dispatch(new Request("https://example.test/"), {});
  assert.ok(dispatch.completion instanceof Promise);
  let settled = false;
  void dispatch.completion.catch(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  close.resolve();
  await assert.rejects(dispatch.completion, setupError);
  const response = await dispatch.response;
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /attachment failed/);
});


test("extension context advertises awaited cleanup without mutating caller context", async () => {
  const context = { scope: { extensions: {} } };
  let observed;
  const manager = createExtensionManager([{ attachScope: value => { observed = value; } }]);
  const release = await manager.attachScope(context);
  assert.deepEqual(observed.lifecycle, { asyncCleanup: true });
  assert.equal(observed.scope, context.scope);
  assert.equal(context.lifecycle, undefined);
  await release();
});
