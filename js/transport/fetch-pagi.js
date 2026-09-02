/** Escape diagnostic text before placing it in the fallback error page. */
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

/** Keep browser fallbacks and console summaries useful without unbounded traces. */
function diagnosticExcerpt(error, limit = 4096) {
  const message = String(error?.message ?? error);
  return message.length > limit ? `${message.slice(0, limit)}\n[diagnostic truncated]` : message;
}

/** Render a fallback only when WebDyne did not render its own error page. */
function createPagiFailureResponse(error) {
  const errorId = error?.pagiErrorId ?? "pagi-unknown";
  const detail = error?.pagiExpose
    ? `<pre>${escapeHtml(`[${error.pagiPhase ?? "application"}] ${diagnosticExcerpt(error)}`)}</pre>`
    : "";
  return new Response(`<!doctype html><title>WebDyne PAGI Runtime Error</title><h1>Internal Server Error</h1><p>Reference: ${escapeHtml(errorId)}</p>${detail}\n`, {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * Decode a URL path for PAGI's human-readable `path` field.
 *
 * The raw URL path is retained separately, so an invalid escape sequence can
 * safely fall back to its exact source value.
 */
function decodePagiPath(rawPath) {
  try {
    return decodeURIComponent(rawPath);
  } catch {
    return rawPath;
  }
}

/**
 * Convert a Fetch Request into the HTTP subset of a PAGI scope hash.
 *
 * The Fetch API does not expose the negotiated HTTP version or client TCP
 * address, so this transport uses HTTP/1.1 and omits `client`.
 */
export function buildPagiScope(request) {
  const url = new URL(request.url);
  const rawPath = url.pathname;
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  const acceptsSse = request.headers.get("accept")?.toLowerCase().includes("text/event-stream");
  const websocket = isWebSocketUpgrade(request);
  const subprotocols = (request.headers.get("sec-websocket-protocol") ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);

  return {
    // An EventSource request is an SSE PAGI connection; its initial ordinary
    // GET remains type=http so WebDyne can render the page itself.
    type: websocket ? "websocket" : (acceptsSse ? "sse" : "http"),
    pagi: {
      version: "0.4",
      spec_version: "0.3",
    },
    method: request.method,
    path: decodePagiPath(rawPath),
    raw_path: rawPath,
    query_string: url.search.startsWith("?") ? url.search.slice(1) : "",
    headers: [...request.headers].map(([name, value]) => [name, value]),
    scheme: websocket ? (url.protocol === "https:" ? "wss" : "ws") : url.protocol.slice(0, -1),
    http_version: "1.1",
    root_path: "",
    server: [url.hostname, Number(url.port || defaultPort)],
    // A Fetch host can return an ordinary HTTP response instead of a 101 before
    // accepting its WebSocketPair, which maps directly to PAGI's denial
    // response extension.
    extensions: websocket ? { "websocket.http.response": {} } : {},
    ...(websocket ? { subprotocols } : {}),
  };
}

/** Serialize the text-only, JavaScript-owned side of the PAGI scope boundary. */
function serializePagiScope(scope) {
  const wireValue = JSON.stringify(scope);
  if (typeof wireValue !== "string") throw new TypeError("PAGI scope is not JSON serializable");
  return wireValue;
}

/** Whether this Fetch request is asking its host to switch to WebSocket. */
function isWebSocketUpgrade(request) {
  return request.headers.get("upgrade")?.trim().toLowerCase() === "websocket";
}

/** Encode raw request bytes for the JSON-only host-function trial bridge. */
function base64Encode(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** Decode byte-bearing fields in the internal Perl-to-host wire envelope. */
function base64Decode(encoded) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Convert protocol header bytes to the Fetch API's string-based header boundary. */
function decodeHeaderBytes(encoded) {
  return new TextDecoder("iso-8859-1").decode(base64Decode(encoded));
}

/**
 * Turn a Fetch request body into pull-driven PAGI receive events.
 *
 * Non-empty body chunks use `more => 1` and are followed by a final empty
 * event with `more => 0`. This avoids reading ahead or buffering request data
 * merely to determine whether a chunk is the last one.
 */
/** Track a Fetch request's one-way client-disconnect transition. */
function createConnectionState(request) {
  let connected = !request.signal.aborted;
  let reason = connected ? null : "client_disconnect";
  const waiters = [];

  function disconnect(nextReason = "client_disconnect") {
    if (!connected) return;
    connected = false;
    reason = nextReason;
    for (const resolve of waiters.splice(0)) resolve(reason);
  }

  request.signal.addEventListener("abort", () => disconnect(), { once: true });

  return {
    status: () => ({ connected, reason }),
    disconnect,
    waitForDisconnect: async () => (connected
      ? new Promise((resolve) => waiters.push(resolve))
      : reason),
  };
}

/**
 * Own host timers for one Perl application invocation.
 *
 * Timer IDs associate a Perl sleep with its host-side timeout. Outstanding
 * timers are cancelled during interpreter teardown.
 */
function createTimerRegistry(deliver) {
  let nextId = 1;
  const timers = new Map();

  function cancel(timer) {
    clearTimeout(timer.handle);
    timers.delete(timer.id);
  }

  return {
    start(milliseconds) {
      if (!Number.isInteger(milliseconds) || milliseconds < 0) {
        throw new Error("Timer delay must be a non-negative integer number of milliseconds");
      }
      const id = nextId++;
      const timer = { id, handle: undefined };
      timer.handle = setTimeout(() => {
        if (!timers.delete(id)) return;
        void deliver(id).catch(() => {});
      }, milliseconds);
      timers.set(id, timer);
      return id;
    },
    cancel(id) {
      const timer = timers.get(id);
      if (timer) cancel(timer);
    },
    cancelAll() {
      for (const timer of timers.values()) cancel(timer);
    },
  };
}

function createHttpReceiveSource(request, connection) {
  let reader = request.body?.getReader();
  let requestEnded = false;

  return {
    async next() {
      if (!requestEnded) {
        if (!reader) {
          requestEnded = true;
          return { type: "http.request", body_base64: "", more: 0 };
        }

        const { done, value } = await reader.read();
        if (done) {
          reader.releaseLock();
          reader = undefined;
          requestEnded = true;
          return { type: "http.request", body_base64: "", more: 0 };
        }

        return { type: "http.request", body_base64: base64Encode(value), more: 1 };
      }

      const reason = await connection.waitForDisconnect();
      return { type: "http.disconnect", reason };
    },
  };
}

/** Turn an EventSource request into PAGI's SSE request and disconnect events. */
function createSseReceiveSource(request, connection) {
  let reader = request.body?.getReader();
  let requestEnded = false;

  return {
    async next() {
      if (!requestEnded) {
        if (!reader) {
          requestEnded = true;
          return { type: "sse.request", body_base64: "", more: 0 };
        }

        const { done, value } = await reader.read();
        if (done) {
          reader.releaseLock();
          reader = undefined;
          requestEnded = true;
          return { type: "sse.request", body_base64: "", more: 0 };
        }
        return { type: "sse.request", body_base64: base64Encode(value), more: 1 };
      }

      return { type: "sse.disconnect", reason: await connection.waitForDisconnect() };
    },
  };
}

/**
 * Bridge one accepted host WebSocket to pull-driven PAGI receive events.
 *
 * The connect event is deliberately queued first. Later message/close events
 * are buffered until Perl calls $receive, which preserves PAGI ordering even
 * if frames arrive before the application has resumed from its handshake.
 */
function createWebSocketReceiveSource(socket, connection) {
  const events = [{ type: "websocket.connect" }];
  const waiters = [];
  let disconnected = false;

  function push(event) {
    const resolve = waiters.shift();
    if (resolve) resolve(event);
    else events.push(event);
  }

  function disconnect(code, reason) {
    if (disconnected) return;
    disconnected = true;
    push({ type: "websocket.disconnect", code, reason });
    connection.disconnect(reason || "client_closed");
  }

  // Force binary frames into an immediate ArrayBuffer representation. This
  // avoids an asynchronous Blob conversion and retains receive-event order.
  socket.binaryType = "arraybuffer";
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      push({ type: "websocket.receive", text_base64: base64Encode(new TextEncoder().encode(event.data)) });
      return;
    }
    if (event.data instanceof ArrayBuffer) {
      push({ type: "websocket.receive", bytes_base64: base64Encode(new Uint8Array(event.data)) });
      return;
    }
    // binaryType=arraybuffer should make this unreachable, but turn an
    // unexpected host value into a normal protocol close rather than lose it.
    disconnect(1006, "unsupported_binary_frame");
  });
  socket.addEventListener("close", (event) => {
    disconnect(event.code || 1005, event.reason || "");
  });
  socket.addEventListener("error", () => disconnect(1006, "write_error"));
  void connection.waitForDisconnect().then((reason) => disconnect(1006, reason || "client_closed"));

  return {
    async next() {
      if (events.length > 0) return events.shift();
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

/** Queue pending PAGI $receive calls and satisfy them in source-event order. */
function createReceiveDispatcher(receiveSource, deliver, fail) {
  let nextId = 1;
  let pumping = false;
  let stopped = false;
  const pending = [];
  const cancelled = new Set();
  const bufferedEvents = [];

  function nextPendingId() {
    while (pending.length > 0) {
      const id = pending.shift();
      if (!cancelled.delete(id)) return id;
    }
    return undefined;
  }

  async function pump() {
    if (pumping || stopped) return;
    pumping = true;
    try {
      while (!stopped && pending.length > 0) {
        const id = nextPendingId();
        if (id === undefined) break;
        const event = bufferedEvents.shift() ?? await receiveSource.next();
        if (stopped) break;
        if (cancelled.delete(id)) {
          // A cancelled receive must not consume a real source event. Keep it
          // for the next live waiter, preserving the PAGI event order.
          bufferedEvents.unshift(event);
          continue;
        }
        await deliver(id, event);
      }
    } catch (error) {
      if (!stopped) fail(error);
    } finally {
      pumping = false;
      if (!stopped && pending.length > 0) void pump();
    }
  }

  return {
    register() {
      const id = nextId++;
      pending.push(id);
      void pump();
      return id;
    },
    cancel(id) {
      cancelled.add(id);
    },
    stop() {
      stopped = true;
      pending.length = 0;
    },
  };
}

/** Deliver AbortSignal completion to one or more Perl connection Futures. */
function createDisconnectDispatcher(connection, deliver, fail) {
  let nextId = 1;
  let stopped = false;
  const cancelled = new Set();

  return {
    register() {
      const id = nextId++;
      void connection.waitForDisconnect().then(
        (reason) => {
          if (!stopped && !cancelled.delete(id)) void deliver(id, reason).catch(fail);
        },
        (error) => { if (!stopped) fail(error); },
      );
      return id;
    },
    cancel(id) { cancelled.add(id); },
    stop() { stopped = true; },
  };
}

/**
 * Convert PAGI HTTP send events into one completed Fetch Response.
 *
 * Normal WebDyne pages produce a finite response, so retaining their chunks
 * until `more => 0` avoids chunked-stream framing for every ordinary request.
 * That is both simpler and compatible with HTTP/1.0 clients such as Apache
 * Bench. Actual long-lived protocols use their dedicated SSE and WebSocket
 * response sinks below.
 */
function createHttpResponseSink() {
  let started = false;
  let finished = false;
  let status;
  let headers;
  const bodyChunks = [];
  let bodyLength = 0;
  let resolveResponse;
  const response = new Promise((resolve) => { resolveResponse = resolve; });

  function validateHeaders(headers) {
    return Array.isArray(headers) && headers.every(
      (header) => Array.isArray(header) && header.length === 2 && header.every((value) => typeof value === "string"),
    );
  }

  function decodeResponseStart(event) {
    if (!Array.isArray(event.headers_base64)) {
      throw new Error("PAGI response start requires base64 header pairs");
    }
    const headers = event.headers_base64.map((header) => {
      if (!Array.isArray(header) || header.length !== 2 || !header.every((value) => typeof value === "string")) {
        throw new Error("PAGI response headers must be [name, value] byte pairs");
      }
      return header.map(decodeHeaderBytes);
    });
    if (!validateHeaders(headers)) throw new Error("Invalid decoded PAGI response headers");
    return headers;
  }

  function completeResponse() {
    // Fetch forbids even a zero-length body for these response statuses.
    // PAGI middleware correctly terminates them with an empty body event.
    if (status === 204 || status === 205 || status === 304) {
      resolveResponse(new Response(null, { status, headers }));
      return;
    }
    const body = new Uint8Array(bodyLength);
    let offset = 0;
    for (const chunk of bodyChunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    resolveResponse(new Response(body, { status, headers }));
  }

  return {
    response,
    get started() { return started; },
    get finished() { return finished; },
    async send(event) {
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        throw new Error("PAGI $send must receive an event hash");
      }

      if (event.type === "http.response.start") {
        if (started || finished) throw new Error("Invalid duplicate PAGI response start");
        if (!Number.isInteger(event.status) || event.status < 100 || event.status > 599) {
          throw new Error("PAGI response start requires an HTTP status");
        }
        if (event.trailers !== undefined && event.trailers !== 0 && event.trailers !== 1) {
          throw new Error("PAGI response start trailers must be 0 or 1");
        }
        if (event.trailers === 1) {
          throw new Error("HTTP response trailers are unsupported by the Fetch Response API");
        }
        headers = decodeResponseStart(event);
        status = event.status;
        started = true;
        return;
      }

      if (event.type === "http.response.trailers") {
        // Keep the byte-safe wire shape validated, but fail instead of silently
        // discarding data: Fetch Response cannot emit HTTP response trailers.
        decodeResponseStart(event);
        throw new Error("HTTP response trailers are unsupported by the Fetch Response API");
      }

      if (event.type === "http.response.body") {
        if (!started || finished) throw new Error("Invalid PAGI response body sequence");
        if (typeof event.body_base64 !== "string") {
          throw new Error("PAGI response body requires a base64 byte payload");
        }
        if (event.more !== undefined && event.more !== 0 && event.more !== 1) {
          throw new Error("PAGI response body more must be 0 or 1");
        }

        const chunk = base64Decode(event.body_base64);
        bodyChunks.push(chunk);
        bodyLength += chunk.length;
        if (event.more !== 1) {
          finished = true;
          completeResponse();
        }
        return;
      }

      throw new Error(`Unsupported PAGI send event: ${event.type}`);
    },
    async fail(error) {
      if (!started) {
        started = true;
        finished = true;
        resolveResponse(createPagiFailureResponse(error));
      } else if (!finished) {
        finished = true;
        // Ordinary HTTP is intentionally buffered, so no response has reached
        // the client yet and it is still safe to replace a partial response.
        resolveResponse(createPagiFailureResponse(error));
      }
    },
  };
}

/** Decode an internal base64 UTF-8 field used by the Perl SSE wire envelope. */
function decodeSseText(event, field, { required = false } = {}) {
  const encoded = event[`${field}_base64`];
  if (encoded === undefined && !required) return undefined;
  if (typeof encoded !== "string") throw new Error(`PAGI SSE ${field} must be UTF-8 text`);
  return new TextDecoder("utf-8", { fatal: true }).decode(base64Decode(encoded));
}

/** Format one SSE field, safely preserving multiline field values. */
function formatSseField(name, value) {
  return String(value).split(/\r\n|[\r\n]/).map((line) => `${name}: ${line}\n`).join("");
}

/** Serialize an sse.send event according to the EventStream wire format. */
function formatSseEvent(event) {
  let text = "";
  const id = decodeSseText(event, "id");
  const name = decodeSseText(event, "event");
  const data = decodeSseText(event, "data", { required: true });
  if (id !== undefined) text += formatSseField("id", id);
  if (name !== undefined) text += formatSseField("event", name);
  if (event.retry !== undefined) {
    if (!Number.isInteger(event.retry) || event.retry < 0) throw new Error("PAGI SSE retry must be a non-negative integer");
    text += formatSseField("retry", event.retry);
  }
  text += formatSseField("data", data);
  return `${text}\n`;
}

/** Convert PAGI SSE send events into a streaming text/event-stream Response. */
function createSseResponseSink(connection) {
  const encoder = new TextEncoder();
  let started = false;
  let finished = false;
  let writer;
  let keepalive;
  let resolveResponse;
  const response = new Promise((resolve) => { resolveResponse = resolve; });

  function clearKeepalive() {
    if (keepalive) clearTimeout(keepalive);
    keepalive = undefined;
  }

  function decodeHeaders(event) {
    if (event.headers_base64 === undefined) return [];
    if (!Array.isArray(event.headers_base64)) throw new Error("PAGI SSE headers must be base64 header pairs");
    return event.headers_base64.map((header) => {
      if (!Array.isArray(header) || header.length !== 2 || !header.every((value) => typeof value === "string")) {
        throw new Error("PAGI SSE headers must be [name, value] byte pairs");
      }
      return header.map(decodeHeaderBytes);
    });
  }

  function scheduleKeepalive(interval, comment) {
    clearKeepalive();
    if (interval === 0) return;
    const tick = async () => {
      if (finished) return;
      try {
        const text = comment.split(/\r\n|[\r\n]/).map((line) => `: ${line}\n`).join("");
        await writer.write(encoder.encode(`${text}\n`));
        keepalive = setTimeout(tick, interval);
      } catch {
        // A stream close/abort settles the normal PAGI disconnect path.
      }
    };
    keepalive = setTimeout(tick, interval);
  }

  return {
    response,
    get started() { return started; },
    get finished() { return finished; },
    async send(event) {
      if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("PAGI $send must receive an event hash");
      if (event.type === "sse.start") {
        if (started || finished) throw new Error("Invalid duplicate PAGI SSE start");
        if (!Number.isInteger(event.status) || event.status < 100 || event.status > 599) {
          throw new Error("PAGI SSE start requires an HTTP status");
        }
        const headers = new Headers(decodeHeaders(event));
        if (!headers.has("content-type")) headers.set("content-type", "text/event-stream; charset=utf-8");
        if (!headers.has("cache-control")) headers.set("cache-control", "no-cache");
        const stream = new TransformStream();
        writer = stream.writable.getWriter();
        // An EventSource/client close aborts the readable side of this
        // TransformStream. Convert that into the shared PAGI connection event.
        void writer.closed.catch(() => connection.disconnect());
        started = true;
        resolveResponse(new Response(stream.readable, { status: event.status, headers }));
        return;
      }

      if (!started || finished) throw new Error(`Invalid PAGI SSE event sequence: ${event.type}`);
      if (event.type === "sse.send") {
        await writer.write(encoder.encode(formatSseEvent(event)));
        return;
      }
      if (event.type === "sse.comment") {
        const comment = decodeSseText(event, "comment", { required: true });
        const text = comment.split(/\r\n|[\r\n]/).map((line) => `: ${line}\n`).join("");
        await writer.write(encoder.encode(`${text}\n`));
        return;
      }
      if (event.type === "sse.keepalive") {
        if (!Number.isFinite(event.interval) || event.interval < 0) throw new Error("PAGI SSE keepalive requires a non-negative interval");
        scheduleKeepalive(Math.round(event.interval * 1000), decodeSseText(event, "comment") ?? "");
        return;
      }
      if (event.type === "sse.close") {
        clearKeepalive();
        finished = true;
        await writer.close();
        return;
      }
      throw new Error(`Unsupported PAGI SSE send event: ${event.type}`);
    },
    async fail(error) {
      clearKeepalive();
      if (!started) {
        started = true;
        finished = true;
        resolveResponse(createPagiFailureResponse(error));
      } else if (!finished) {
        finished = true;
        await writer.abort(error);
      }
    },
  };
}

/** Decode optional WebSocket handshake headers from the Perl wire envelope. */
function decodeWebSocketHeaders(event) {
  if (event.headers_base64 === undefined) return [];
  if (!Array.isArray(event.headers_base64)) throw new Error("PAGI WebSocket headers must be base64 header pairs");
  return event.headers_base64.map((header) => {
    if (!Array.isArray(header) || header.length !== 2 || !header.every((value) => typeof value === "string")) {
      throw new Error("PAGI WebSocket headers must be [name, value] byte pairs");
    }
    return header.map(decodeHeaderBytes);
  });
}

/**
 * Convert PAGI websocket.* sends through a provider-supplied socket adapter.
 *
 * The response promise is settled only by accept or handshake rejection. That
 * lets Perl decide whether the upgrade becomes a 101 connection or a 403.
 */
function createWebSocketResponseSink(connection, webSocketAdapter) {
  if (!webSocketAdapter) {
    throw new Error("This provider does not support WebDyne PAGI WebSockets");
  }
  const { client, server } = webSocketAdapter.createPair();
  const receiveSource = createWebSocketReceiveSource(server, connection);
  let accepted = false;
  let started = false;
  let finished = false;
  let denialWriter;
  let resolveResponse;
  const response = new Promise((resolve) => { resolveResponse = resolve; });

  function rejectHandshake(status = 403, headers = [], body = "") {
    if (started) throw new Error("WebSocket handshake has already completed");
    started = true;
    finished = true;
    resolveResponse(new Response(body, { status, headers }));
  }

  return {
    response,
    receiveSource,
    get started() { return started; },
    get finished() { return finished; },
    async send(event) {
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        throw new Error("PAGI $send must receive an event hash");
      }
      if (event.type === "websocket.accept") {
        if (started) throw new Error("Invalid duplicate WebSocket accept");
        const headers = new Headers(decodeWebSocketHeaders(event));
        if (event.subprotocol !== undefined) {
          if (typeof event.subprotocol !== "string") throw new Error("PAGI WebSocket subprotocol must be text");
          headers.set("sec-websocket-protocol", event.subprotocol);
        }
        // Providers normally begin delivering frames only after accepting the
        // server endpoint. The adapter also owns the non-standard 101 response.
        webSocketAdapter.accept(server);
        accepted = true;
        started = true;
        resolveResponse(webSocketAdapter.createUpgradeResponse(client, headers));
        return;
      }

      if (event.type === "websocket.close") {
        const code = event.code ?? 1000;
        const reason = event.reason ?? "";
        if (!Number.isInteger(code) || typeof reason !== "string") {
          throw new Error("PAGI WebSocket close requires an integer code and text reason");
        }
        if (!accepted) {
          // PAGI defines a close during the handshake as a bare HTTP 403.
          rejectHandshake();
          return;
        }
        if (finished) throw new Error("Invalid duplicate WebSocket close");
        finished = true;
        server.close(code, reason);
        return;
      }

      if (event.type === "websocket.http.response.start") {
        if (started) throw new Error("Invalid WebSocket denial response after handshake completion");
        if (!Number.isInteger(event.status) || event.status < 100 || event.status > 599) {
          throw new Error("PAGI WebSocket denial response requires an HTTP status");
        }
        const stream = new TransformStream();
        denialWriter = stream.writable.getWriter();
        started = true;
        resolveResponse(new Response(stream.readable, {
          status: event.status,
          headers: decodeWebSocketHeaders(event),
        }));
        return;
      }

      if (event.type === "websocket.http.response.body") {
        if (!started || accepted || finished || !denialWriter) {
          throw new Error("Invalid PAGI WebSocket denial response body sequence");
        }
        if (typeof event.body_base64 !== "string") {
          throw new Error("PAGI WebSocket denial response body requires a base64 byte payload");
        }
        if (event.more !== undefined && event.more !== 0 && event.more !== 1) {
          throw new Error("PAGI WebSocket denial response body more must be 0 or 1");
        }
        await denialWriter.write(base64Decode(event.body_base64));
        if (event.more !== 1) {
          finished = true;
          await denialWriter.close();
        }
        return;
      }

      if (event.type === "websocket.keepalive") {
        throw new Error("PAGI WebSocket keepalive is unsupported by this provider adapter");
      }

      if (!accepted || finished) throw new Error(`Invalid PAGI WebSocket event sequence: ${event.type}`);
      if (event.type === "websocket.send") {
        const hasText = typeof event.text_base64 === "string";
        const hasBytes = typeof event.bytes_base64 === "string";
        if (hasText === hasBytes) throw new Error("PAGI WebSocket send requires exactly one text or byte payload");
        server.send(hasText
          ? new TextDecoder("utf-8", { fatal: true }).decode(base64Decode(event.text_base64))
          : base64Decode(event.bytes_base64));
        return;
      }
      throw new Error(`Unsupported PAGI WebSocket send event: ${event.type}`);
    },
    async fail(error) {
      if (!started) {
        started = true;
        finished = true;
        resolveResponse(createPagiFailureResponse(error));
      } else if (accepted && !finished) {
        finished = true;
        try { server.close(1011, "internal_error"); } catch { /* socket already closed */ }
      } else if (denialWriter && !finished) {
        finished = true;
        await denialWriter.abort(error);
      }
    },
  };
}

/** Create the Fetch-facing transport primitives for one PAGI request. */
export function createFetchPagiTransport(scope, request, { webSocketAdapter } = {}) {
  const connection = createConnectionState(request);
  const sink = scope.type === "websocket"
    ? createWebSocketResponseSink(connection, webSocketAdapter)
    : scope.type === "sse"
      ? createSseResponseSink(connection)
      : createHttpResponseSink();
  const receiveSource = scope.type === "websocket"
    ? sink.receiveSource
    : scope.type === "sse"
      ? createSseReceiveSource(request, connection)
      : createHttpReceiveSource(request, connection);
  return { connection, sink, receiveSource, response: sink.response };
}

export {
  createDisconnectDispatcher,
  createReceiveDispatcher,
  createTimerRegistry,
  diagnosticExcerpt,
  serializePagiScope,
};
