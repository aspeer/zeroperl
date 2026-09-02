import { MemoryFileSystem, ZeroPerl } from "./zeroperl.js";
import { gunzipSync } from "fflate";
import { unpackTar } from "modern-tar";
import pagiRunner from "../bin/pagi-runner.pl";
import webdyneApp from "../bin/webdyne-app.pl";
import futureIoZeroPerl from "../lib/Future/IO/Impl/ZeroPerl.pm";

const decoder = new TextDecoder();
const PERL_LIB_DIR = "/app/local/lib/perl5";
const PERL_COMPAT_LIB_DIR = "/app/perl-compat";
const VIRTUAL_ROOT = "/app/";
let workerAssets;

/** Validate a relative tar path before it becomes a virtual filesystem path. */
function virtualPath(name) {
  const normalized = name.replace(/\/+$/, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`Unsafe Perl VFS archive path: ${name}`);
  }
  // /htdocs is the document root seen by WebDyne::PAGI. Carton's libraries
  // remain private below /app/local.
  return normalized === "htdocs" || normalized.startsWith("htdocs/")
    ? `/${normalized}`
    : VIRTUAL_ROOT + normalized;
}

/** Decompress and extract a standard tar.gz archive into ZeroPerl's virtual filesystem. */
async function unpackPerlVfs(archive, fileSystem) {
  const entries = await unpackTar(gunzipSync(new Uint8Array(archive)), { strict: true });
  for (const { header, data } of entries) {
    const path = virtualPath(header.name);
    if (header.type === "directory") {
      fileSystem.ensureDir(path);
    } else if (header.type === "file" && data) {
      // WebDyne uses mtimes for compile-cache identity and the static
      // middleware uses them in ETags. Preserve the tar's stable timestamp;
      // a plain Blob has no lastModified and zeroperl-ts substitutes Date.now
      // for every stat call, defeating conditional GETs.
      const timestamp = header.mtime instanceof Date ? header.mtime.getTime() : 1;
      fileSystem.addFile(path, new File([data], path.split("/").at(-1), { lastModified: timestamp || 1 }));
    } else {
      throw new Error(`Unsupported Perl VFS tar entry: ${header.name}`);
    }
  }
}

/** Build the immutable virtual filesystem once for this Worker isolate. */
async function createPerlFileSystem() {
  const { htdocsVfsArchive, perlLibraryVfsArchive } = workerAssets;
  // /zeroperl must remain an explicit WASI preopen for the core filesystem
  // embedded in zeroperl.wasm. The Perl binary's configured @INC points there.
  // The root preopen exposes the document tree as well as /app. Do not add
  // /htdocs as a second nested preopen: zeroperl-ts currently resolves an
  // exact stat/open on such a nested preopen as `.` and Perl's `-d /htdocs`
  // consequently becomes false. WebDyne's indexer needs that predicate.
  const fileSystem = new MemoryFileSystem({ "/": "", "/zeroperl": "" });
  // Core Perl, WebDyne::PAGI, and their runtime dependencies are embedded in
  // the matching Wasm binary. This is only an optional application overlay.
  fileSystem.ensureDir(PERL_LIB_DIR);
  await unpackPerlVfs(perlLibraryVfsArchive, fileSystem);
  await unpackPerlVfs(htdocsVfsArchive, fileSystem);
  fileSystem.addFile("/app/perl-compat/Future/IO/Impl/ZeroPerl.pm", futureIoZeroPerl);
  fileSystem.addFile("/app/pagi-runner.pl", pagiRunner);
  fileSystem.addFile("/app/webdyne-app.pl", webdyneApp);
  return fileSystem;
}

let perlFileSystemPromise;
// The live interpreter is deliberately shared for the lifetime of a Worker
// isolate. Session routing below keeps the PAGI-visible state independent.
let persistentRuntimePromise;
let persistentPerl;
let persistentPerlQueue = Promise.resolve();
let persistentRuntimeResetPromise;
let persistentRuntimeGeneration = 1;
let persistentRuntimeConfigKey;
let nextPagiSessionId = 1;
let nextPagiErrorId = 1;
const pagiSessions = new Map();

/** Escape diagnostic text before placing it in the Worker fallback error page. */
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

/** Identify a development request where a concise diagnostic is safe to show. */
function showFailureDetails(request) {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/** Select textual WebDyne Worker bindings for Perl's process-wide WASI environment. */
function webdynePerlEnvironment(env = {}) {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([name, value]) => name.startsWith("WEBDYNE_") && typeof value === "string")
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

/** Parse Worker bindings into the fixed configuration of one Perl runtime. */
function webdyneRuntimeConfig(env = {}) {
  const flag = (value, fallback = 0) => {
    if (value === undefined) return fallback;
    return /^(?:1|true|yes|on)$/i.test(String(value)) ? 1 : 0;
  };
  const root = typeof env.WEBDYNE_ROOT === "string" && env.WEBDYNE_ROOT.startsWith("/")
    ? env.WEBDYNE_ROOT
    : "/htdocs";
  const index = env.WEBDYNE_INDEX === "1" ? 1
    : typeof env.WEBDYNE_INDEX === "string" && env.WEBDYNE_INDEX.length > 0
      ? env.WEBDYNE_INDEX
      : "index.psp";
  return {
    root,
    index,
    static: flag(env.WEBDYNE_STATIC),
    conf: flag(env.WEBDYNE_CONF),
    perlEnv: webdynePerlEnvironment(env),
  };
}

/** Attach a stable diagnostic ID without exposing request data in logs or responses. */
function describePagiFailure(session, error, phase = "application") {
  const normalized = error instanceof Error ? error : new Error(String(error));
  normalized.pagiErrorId ??= `pagi-${nextPagiErrorId++}`;
  normalized.pagiPhase ??= phase;
  normalized.pagiExpose ??= session?.showFailureDetails === true;
  return normalized;
}

/** Keep browser fallbacks and console summaries useful without unbounded traces. */
function diagnosticExcerpt(error, limit = 4096) {
  const message = String(error?.message ?? error);
  return message.length > limit ? `${message.slice(0, limit)}\n[diagnostic truncated]` : message;
}

/** Render the Worker fallback only when WebDyne did not render its own error page. */
function createPagiFailureResponse(error) {
  const errorId = error?.pagiErrorId ?? "pagi-unknown";
  const detail = error?.pagiExpose
    ? `<pre>${escapeHtml(`[${error.pagiPhase ?? "application"}] ${diagnosticExcerpt(error)}`)}</pre>`
    : "";
  return new Response(`<!doctype html><title>WebDyne PAGI Worker Error</title><h1>Internal Server Error</h1><p>Reference: ${escapeHtml(errorId)}</p>${detail}\n`, {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/** Lazily initialize and share the immutable Perl filesystem within this Worker isolate. */
function getPerlFileSystem() {
  perlFileSystemPromise ??= createPerlFileSystem();
  return perlFileSystemPromise;
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
 * Convert a Worker Request into the HTTP subset of a PAGI scope hash.
 *
 * Cloudflare Workers do not expose the negotiated HTTP version or client TCP
 * address, so this small simulation uses HTTP/1.1 and omits `client`.
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
    // A Worker can return an ordinary HTTP response instead of a 101 before
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

/** Whether this Fetch request is asking the Worker to switch to WebSocket. */
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

/** Decode the byte-bearing fields in the internal Perl-to-Worker wire envelope. */
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
 * Turn a Worker request body into pull-driven PAGI receive events.
 *
 * Non-empty body chunks use `more => 1` and are followed by a final empty
 * event with `more => 0`. This avoids reading ahead or buffering request data
 * merely to determine whether a chunk is the last one.
 */
/** Track a Worker request's one-way client-disconnect transition. */
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
 * Own Worker timers for one Perl application invocation.
 *
 * Timer IDs associate a Perl sleep with its Worker-side timeout. Outstanding
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
 * Bridge one accepted Worker WebSocket to pull-driven PAGI receive events.
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
    // unexpected Worker value into a normal protocol close rather than lose it.
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
 * Convert PAGI HTTP send events into one completed Worker Response.
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
          throw new Error("HTTP response trailers are unsupported by the Cloudflare Workers Response API");
        }
        headers = decodeResponseStart(event);
        status = event.status;
        started = true;
        return;
      }

      if (event.type === "http.response.trailers") {
        // Keep the byte-safe wire shape validated, but fail instead of silently
        // discarding data: Workers currently cannot emit HTTP response trailers.
        decodeResponseStart(event);
        throw new Error("HTTP response trailers are unsupported by the Cloudflare Workers Response API");
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
 * Convert PAGI websocket.* sends to Cloudflare's WebSocketPair interface.
 *
 * The response promise is settled only by accept or handshake rejection. That
 * lets Perl decide whether the upgrade becomes a 101 connection or a 403.
 */
function createWebSocketResponseSink(connection) {
  const [client, server] = Object.values(new WebSocketPair());
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
        // Accept before exposing the client endpoint: Workers begins delivering
        // frames only after accept(), while the 101 response completes upgrade.
        server.accept();
        accepted = true;
        started = true;
        resolveResponse(new Response(null, { status: 101, headers, webSocket: client }));
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
        throw new Error("PAGI WebSocket keepalive is unsupported by the Cloudflare Workers WebSocket API");
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

/** Enter one runtime generation exclusively; calls are short session turns. */
function enqueuePersistentPerl(session, name, buildArgs) {
  const generation = session.runtimeGeneration;
  const task = persistentPerlQueue.then(async () => {
    if (session.finished) return;
    // A reset fails every session in the old generation. A queued stale turn
    // must quietly disappear rather than touch a replacement interpreter.
    if (!persistentPerl || generation !== persistentRuntimeGeneration) return;
    let values;
    try {
      values = buildArgs(persistentPerl);
      await persistentPerl.call(name, values.args, "void");
      // A Perl eval may deliberately catch an exception while ZeroPerl's
      // native last-error buffer still retains it. The wrapped turn returned
      // normally, so clear that bridge-only diagnostic before the next
      // request. Escaping JS/Wasm failures reject above and reset the runtime.
      persistentPerl.clearError();
    } finally {
      values?.dispose();
    }
  });
  // A rejected ZeroPerl entry can leave Asyncify/Wasm state unusable. Keep the
  // queue settling, but retire the whole generation rather than reusing it.
  persistentPerlQueue = task.catch(() => undefined);
  return task.catch((error) => {
    const failure = describePagiFailure(session, error, `perl.${name}`);
    void resetPersistentRuntime(failure);
    throw error;
  });
}

/** Stop all Worker-side event sources belonging to one finished connection. */
function stopPagiSession(session) {
  session.receiveDispatcher?.stop();
  session.disconnectDispatcher?.stop();
  session.timers?.cancelAll();
  pagiSessions.delete(session.id);
}

function finishPagiSession(session) {
  if (session.finished) return;
  session.finished = true;
  stopPagiSession(session);
  if (!session.sink.started || (!session.sink.finished && session.connection.status().connected)) {
    session.reject(new Error("PAGI app completed without a final response event"));
  } else {
    session.resolve();
  }
}

/** Schedule Perl-side cleanup without requiring the failed session to be live. */
function abortPersistentSession(session) {
  if (!persistentPerl || session.runtimeGeneration !== persistentRuntimeGeneration) return;
  const generation = session.runtimeGeneration;
  const task = persistentPerlQueue.then(async () => {
    if (!persistentPerl || generation !== persistentRuntimeGeneration) return;
    const sessionValue = persistentPerl.createInt(session.id);
    try {
      await persistentPerl.call("Pagi::ZeroPerl::Runner::abort_session", [sessionValue], "void");
      persistentPerl.clearError();
    } finally {
      sessionValue.dispose();
    }
  });
  persistentPerlQueue = task.catch(() => undefined);
  void task.catch((error) => resetPersistentRuntime(describePagiFailure(session, error, "perl.abort_session")));
}

function failPagiSession(session, error, { abort = true } = {}) {
  if (session.finished) return;
  session.finished = true;
  stopPagiSession(session);
  const normalized = describePagiFailure(session, error);
  if (abort) abortPersistentSession(session);
  console.error("PAGI session failed", {
    errorId: normalized.pagiErrorId,
    phase: normalized.pagiPhase,
    method: session.scope?.method,
    path: session.scope?.raw_path,
    message: diagnosticExcerpt(normalized, 1024),
  });
  session.reject(normalized);
  void session.sink.fail(normalized);
}

/** Dispose a poisoned interpreter and fail all sessions that depended on it. */
function resetPersistentRuntime(error) {
  if (persistentRuntimeResetPromise) return persistentRuntimeResetPromise;

  const oldPerl = persistentPerl;
  const poisonedGeneration = persistentRuntimeGeneration;
  persistentPerl = undefined;
  persistentRuntimePromise = undefined;
  persistentRuntimeConfigKey = undefined;
  persistentRuntimeGeneration += 1;
  // Any turn that was already pending belongs to the old runtime. A trap has
  // unwound the active call, so a fresh queue is safe for the next generation.
  persistentPerlQueue = Promise.resolve();

  for (const session of [...pagiSessions.values()]) {
    if (session.runtimeGeneration === poisonedGeneration) {
      failPagiSession(session, error, { abort: false });
    }
  }

  persistentRuntimeResetPromise = Promise.resolve().then(() => {
    try { oldPerl?.dispose(); } catch (disposeError) {
      console.error("Unable to dispose poisoned ZeroPerl runtime", disposeError);
    }
  }).finally(() => {
    persistentRuntimeResetPromise = undefined;
  });
  return persistentRuntimeResetPromise;
}

/** Look up a live session or fail a Perl host call with a useful error. */
function sessionForHost(idValue) {
  const session = pagiSessions.get(idValue.toInt());
  if (!session || session.finished) throw new Error("PAGI session is no longer active");
  return session;
}

/** Register bridge functions once: arguments select the destination session. */
function registerPersistentHostFunctions(perl) {
  perl.registerFunction("worker_send_event", async (sessionId, eventJson) => {
    const session = sessionForHost(sessionId);
    if (!session.connection.status().connected) throw new Error("PAGI client disconnected");
    await session.sink.send(JSON.parse(eventJson.toString()));
    return perl.createUndef();
  });
  perl.registerFunction("worker_receive_register", (sessionId) => (
    perl.createInt(sessionForHost(sessionId).receiveDispatcher.register())
  ));
  perl.registerFunction("worker_receive_cancel", (sessionId, receiveId) => {
    sessionForHost(sessionId).receiveDispatcher.cancel(receiveId.toInt());
    return perl.createUndef();
  });
  perl.registerFunction("worker_disconnect_register", (sessionId) => (
    perl.createInt(sessionForHost(sessionId).disconnectDispatcher.register())
  ));
  perl.registerFunction("worker_disconnect_cancel", (sessionId, disconnectId) => {
    sessionForHost(sessionId).disconnectDispatcher.cancel(disconnectId.toInt());
    return perl.createUndef();
  });
  perl.registerFunction("worker_connection_status", (sessionId) => {
    const session = pagiSessions.get(sessionId.toInt());
    return perl.createString(JSON.stringify(session?.connection.status() ?? {
      connected: false,
      reason: "session_finished",
    }));
  });
  perl.registerFunction("worker_timer_start", (sessionId, milliseconds) => (
    perl.createInt(sessionForHost(sessionId).timers.start(milliseconds.toInt()))
  ));
  perl.registerFunction("worker_timer_cancel", (sessionId, timerId) => {
    sessionForHost(sessionId).timers.cancel(timerId.toInt());
    return perl.createUndef();
  });
  perl.registerFunction("worker_application_finished", (sessionId, statusJson) => {
    const session = pagiSessions.get(sessionId.toInt());
    if (!session || session.finished) return perl.createUndef();
    const status = JSON.parse(statusJson.toString());
    if (status.error) {
      const failure = describePagiFailure(
        session,
        new Error(status.error),
        `application.${status.phase ?? "finish"}`,
      );
      failPagiSession(session, failure);
      // A failed Future can leave framework globals (for example WebDyne's
      // error stack) dirty even when no Wasm trap occurred. Wait for the
      // current host call to return before disposing its interpreter.
      void persistentPerlQueue.then(() => resetPersistentRuntime(failure));
    }
    else finishPagiSession(session);
    return perl.createUndef();
  });
}

/** Create and bootstrap exactly one interpreter for this Worker isolate. */
async function createPersistentRuntime(config) {
  const generation = persistentRuntimeGeneration;
  const { perlEnv, ...applicationConfig } = config;
  const perl = await ZeroPerl.create({
    fileSystem: await getPerlFileSystem(),
    wasmModule: workerAssets.zeroperlModule,
    env: perlEnv,
    stdout: (chunk) => console.log("zeroperl:", typeof chunk === "string" ? chunk : decoder.decode(chunk)),
    stderr: (chunk) => console.error("zeroperl:", typeof chunk === "string" ? chunk : decoder.decode(chunk)),
  });
  try {
    const libraryPath = await perl.eval(
      `unshift @INC, ${JSON.stringify(PERL_COMPAT_LIB_DIR)}, ${JSON.stringify(PERL_LIB_DIR)};`,
    );
    if (!libraryPath.success) throw new Error(libraryPath.error);
    persistentPerl = perl;
    registerPersistentHostFunctions(perl);
    const configJson = JSON.stringify(applicationConfig);
    const configure = await perl.eval(
      `require JSON::PP; $Pagi::WebDyne::CONFIG = JSON::PP->new->decode(${JSON.stringify(configJson)});`,
    );
    if (!configure.success) throw new Error(configure.error);
    for (const file of ["/app/pagi-runner.pl", "/app/webdyne-app.pl"]) {
      const load = await perl.runFile(file);
      if (!load.success) throw new Error(load.error);
    }
    return { perl, generation };
  } catch (error) {
    persistentPerl = undefined;
    perl.dispose();
    throw error;
  }
}

async function persistentRuntime(config) {
  if (persistentRuntimeResetPromise) await persistentRuntimeResetPromise;
  const configKey = JSON.stringify(config);
  if (persistentRuntimeConfigKey && persistentRuntimeConfigKey !== configKey) {
    throw new Error("WebDyne runtime bindings changed within one Worker isolate");
  }
  persistentRuntimeConfigKey ??= configKey;
  persistentRuntimePromise ??= createPersistentRuntime(config).catch((error) => {
    persistentRuntimePromise = undefined;
    persistentRuntimeConfigKey = undefined;
    throw error;
  });
  return persistentRuntimePromise;
}

/** Build one Worker-side PAGI session before starting it in the shared Perl. */
function createPagiSession(scope, request, sink, connection) {
  let resolve;
  let reject;
  const session = {
    id: nextPagiSessionId++,
    scope,
    sink,
    connection,
    finished: false,
    runtimeGeneration: undefined,
    showFailureDetails: showFailureDetails(request),
    completion: new Promise((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; }),
    resolve: () => resolve(),
    reject: (error) => reject(error),
  };
  const receiveSource = scope.type === "websocket"
    ? sink.receiveSource
    : scope.type === "sse"
      ? createSseReceiveSource(request, connection)
      : createHttpReceiveSource(request, connection);
  session.receiveDispatcher = createReceiveDispatcher(
    receiveSource,
    (receiveId, event) => queueReceive(session, receiveId, event),
    (error) => failPagiSession(session, error),
  );
  session.disconnectDispatcher = createDisconnectDispatcher(
    connection,
    (disconnectId, reason) => queueDisconnect(session, disconnectId, reason),
    (error) => failPagiSession(session, error),
  );
  session.timers = createTimerRegistry((timerId) => queueTimer(session, timerId));
  return session;
}

function queueReceive(session, receiveId, event) {
  if (session.finished) return Promise.resolve();
  return enqueuePersistentPerl(session, "Pagi::ZeroPerl::Runner::deliver_receive", (perl) => {
    const sessionValue = perl.createInt(session.id);
    const receiveValue = perl.createInt(receiveId);
    const eventValue = perl.createString(JSON.stringify(event));
    return {
      args: [sessionValue, receiveValue, eventValue],
      dispose: () => { sessionValue.dispose(); receiveValue.dispose(); eventValue.dispose(); },
    };
  });
}

function queueTimer(session, timerId) {
  if (session.finished) return Promise.resolve();
  return enqueuePersistentPerl(session, "Pagi::ZeroPerl::Runner::deliver_timer", (perl) => {
    const sessionValue = perl.createInt(session.id);
    const timerValue = perl.createInt(timerId);
    return {
      args: [sessionValue, timerValue],
      dispose: () => { sessionValue.dispose(); timerValue.dispose(); },
    };
  });
}

function queueDisconnect(session, disconnectId, reason) {
  if (session.finished) return Promise.resolve();
  return enqueuePersistentPerl(session, "Pagi::ZeroPerl::Connection::deliver_disconnect", (perl) => {
    const sessionValue = perl.createInt(session.id);
    const disconnectValue = perl.createInt(disconnectId);
    const reasonValue = perl.createString(reason);
    return {
      args: [sessionValue, disconnectValue, reasonValue],
      dispose: () => { sessionValue.dispose(); disconnectValue.dispose(); reasonValue.dispose(); },
    };
  });
}

/** Start a session; its completion is signalled later by the Perl app Future. */
async function startPersistentSession(scope, request, sink, connection, runtimeConfig) {
  const session = createPagiSession(scope, request, sink, connection);
  pagiSessions.set(session.id, session);
  try {
    const runtime = await persistentRuntime(runtimeConfig);
    session.runtimeGeneration = runtime.generation;
    await enqueuePersistentPerl(session, "Pagi::ZeroPerl::Runner::start_session", (perl) => {
      const sessionValue = perl.createInt(session.id);
      // Pass request data across the ABI as an owned wire value. WebDyne is
      // free to decorate its Perl hash, and all resulting Perl destruction
      // then occurs inside the wrapped start_session export. Disposing a
      // natively projected hash from JavaScript can otherwise run Perl magic
      // through ZeroPerl's unwrapped zeroperl_value_free export.
      const scopeValue = perl.createString(serializePagiScope(scope));
      const entrypointValue = perl.createString("Pagi::WebDyne::application");
      return {
        args: [sessionValue, scopeValue, entrypointValue],
        dispose: () => {
          sessionValue.dispose();
          scopeValue.dispose();
          entrypointValue.dispose();
        },
      };
    });
    return session.completion;
  } catch (error) {
    failPagiSession(session, error);
    throw error;
  }
}

/** Start a Perl app and expose its protocol response as soon as it begins. */
function dispatchPagi(scope, request, runtimeConfig) {
  const connection = createConnectionState(request);
  const sink = scope.type === "websocket"
    ? createWebSocketResponseSink(connection)
    : scope.type === "sse"
      ? createSseResponseSink(connection)
      : createHttpResponseSink();
  const completion = startPersistentSession(scope, request, sink, connection, runtimeConfig).catch((error) => {
    // Session failures are logged with a bounded, structured diagnostic by
    // failPagiSession(). Preserve unexpected bootstrap failures without
    // duplicating multi-page Perl traces in Wrangler's console.
    if (!error?.pagiErrorId) console.error("PAGI application failed:", error);
  });
  return { response: sink.response, completion };
}

/**
 * Receive a request, simulate its PAGI scope, and dispatch it to the Perl
 * application with a PAGI-compatible asynchronous $send coderef.
 */
export function createWebDyneWorker({
  zeroperlModule,
  htdocsVfsArchive,
  perlLibraryVfsArchive,
}) {
  if (workerAssets) throw new Error("createWebDyneWorker may only be called once per Worker module");
  if (!(zeroperlModule instanceof WebAssembly.Module)) {
    throw new TypeError("zeroperlModule must be an imported WebAssembly.Module");
  }
  if (!(htdocsVfsArchive instanceof ArrayBuffer)) {
    throw new TypeError("htdocsVfsArchive must be an imported ArrayBuffer");
  }
  if (!(perlLibraryVfsArchive instanceof ArrayBuffer)) {
    throw new TypeError("perlLibraryVfsArchive must be an imported ArrayBuffer");
  }
  workerAssets = { zeroperlModule, htdocsVfsArchive, perlLibraryVfsArchive };

  return {
    fetch(request, env, context) {
      const scope = buildPagiScope(request);
      const dispatch = dispatchPagi(scope, request, webdyneRuntimeConfig(env));
      // Streaming SSE and WebSocket Responses own this event's lifetime.
      // Keeping their unbounded application Futures in waitUntil makes local
      // Workers treat a normal client close as a hung request. Ordinary HTTP
      // still waits for its Perl session to finish after the Response returns.
      if (scope.type === "http") context.waitUntil(dispatch.completion);
      return dispatch.response;
    },
  };
}
