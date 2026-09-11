import assert from "node:assert/strict";
import test from "node:test";
import { createLifespanTransport } from "../js/transport/lifespan.js";

test("lifespan waits for startup acknowledgement and keeps receive pending", async () => {
  const transport = createLifespanTransport();
  let ready = false;
  void transport.startup.then(() => { ready = true; });
  assert.equal(transport.scope.type, "lifespan");
  assert.equal("state" in transport.scope, false);
  assert.deepEqual(await transport.receiveSource.next(), { type: "lifespan.startup" });
  assert.equal(ready, false);
  let received = false;
  const pending = transport.receiveSource.next().then(() => { received = true; });
  transport.sink.send({ type: "lifespan.startup.complete" });
  await transport.startup;
  assert.equal(ready, true);
  assert.equal(received, false);
  assert.throws(() => transport.sink.send({ type: "lifespan.startup.complete" }), /Unexpected/);
  transport.close(new Error("retired"));
  await pending;
  assert.equal(transport.connection.status().connected, false);
  assert.equal(await transport.connection.waitForDisconnect(), "runtime_retired");
});

test("lifespan rejects invalid messages and preserves startup failure diagnostics", async () => {
  const transport = createLifespanTransport();
  const rejected = assert.rejects(transport.startup, /database unavailable/);
  assert.throws(() => transport.sink.send({ type: "lifespan.startup.complete" }), /Unexpected/);
  await transport.receiveSource.next();
  assert.throws(() => transport.sink.send({ type: "http.response.start" }), /Unexpected/);
  let failure;
  try {
    transport.sink.send({ type: "lifespan.startup.failed", message: "database unavailable" });
  } catch (error) { failure = error; }
  assert.match(failure.message, /database unavailable/);
  transport.sink.fail(failure);
  await rejected;
});

test("unsupported lifespan resolves startup and releases pending receives on retirement", async () => {
  const transport = createLifespanTransport();
  await transport.receiveSource.next();
  const pending = transport.receiveSource.next();
  assert.equal(transport.decline(), true);
  transport.close(new Error("retired"));
  assert.equal(await transport.startup, false);
  assert.equal(await pending, undefined);
  assert.equal(transport.decline(), false);
});

test("lifespan responses cannot subsequently be declined", async () => {
  for (const type of ["lifespan.startup.complete", "lifespan.startup.failed", "http.response.start"]) {
    const transport = createLifespanTransport();
    await transport.receiveSource.next();
    if (type === "lifespan.startup.complete") {
      transport.sink.send({ type });
      assert.equal(await transport.startup, true);
    } else {
      const rejected = assert.rejects(transport.startup, /retired/);
      assert.throws(() => transport.sink.send({ type }));
      transport.close(new Error("retired"));
      await rejected;
    }
    assert.equal(transport.decline(), false);
    transport.close(new Error("retired"));
  }
});
