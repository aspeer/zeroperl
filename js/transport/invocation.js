/** A finite result channel; it owns no HTTP request or response stream. */
export function createInvocationTransport() {
  let closed = false;
  let sent = false;
  let value;
  let disconnect;
  const disconnected = new Promise(resolve => { disconnect = resolve; });
  return {
    connection: {
      status: () => ({ connected: !closed, reason: closed ? "invocation_finished" : null }),
      waitForDisconnect: () => disconnected,
    },
    receiveSource: { next() { throw new Error("Finite invocations do not receive PAGI events"); } },
    sink: {
      get started() { return sent; },
      get finished() { return sent; },
      send(event) {
        if (closed || sent || event.type !== "invocation.result" || !Object.hasOwn(event, "value")) {
          throw new Error("Invalid or duplicate invocation result");
        }
        value = event.value;
        sent = true;
      },
      fail() {},
    },
    result() {
      if (!sent) throw new Error("Invocation completed without a result");
      return value;
    },
    close() { closed = true; disconnect("invocation_finished"); },
  };
}
