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
