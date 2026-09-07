/** Startup-only PAGI transport. The application remains suspended until retirement. */
export function createLifespanTransport() {
  let delivered = false;
  let acknowledged = false;
  let closed = false;
  let resolveStartup;
  let rejectStartup;
  let releaseReceive;
  let releaseDisconnect;
  const startup = new Promise((resolve, reject) => {
    resolveStartup = resolve;
    rejectStartup = reject;
  });
  const pendingReceive = new Promise((resolve) => { releaseReceive = resolve; });
  const disconnected = new Promise((resolve) => { releaseDisconnect = resolve; });

  function close(error) {
    if (closed) return;
    closed = true;
    rejectStartup(error);
    // Session dispatchers are stopped before these pending waits are released.
    releaseReceive(undefined);
    releaseDisconnect("runtime_retired");
  }

  return {
    scope: { type: "lifespan", pagi: { version: "0.4", spec_version: "0.3" } },
    startup,
    close,
    connection: {
      status: () => ({ connected: !closed, reason: closed ? "runtime_retired" : null }),
      waitForDisconnect: () => disconnected,
    },
    receiveSource: {
      next() {
        if (delivered) return pendingReceive;
        delivered = true;
        return Promise.resolve({ type: "lifespan.startup" });
      },
    },
    sink: {
      send(event) {
        if (closed || !delivered || acknowledged) throw new Error("Unexpected PAGI lifespan event");
        if (event.type === "lifespan.startup.failed") {
          throw new Error(`PAGI lifespan startup failed: ${event.message ?? "no message"}`);
        }
        if (event.type !== "lifespan.startup.complete") {
          throw new Error(`Unexpected PAGI lifespan event: ${event.type}`);
        }
        acknowledged = true;
        resolveStartup();
      },
      fail: close,
    },
  };
}
