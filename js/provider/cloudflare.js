import { createWebDyneRuntime } from "../runtime/webdyne-runtime.js";

/** Isolate Cloudflare's non-standard WebSocketPair API from the Fetch transport. */
function createCloudflareWebSocketAdapter() {
  return {
    createPair() {
      const [client, server] = Object.values(new WebSocketPair());
      return { client, server };
    },
    accept(server) {
      server.accept();
    },
    createUpgradeResponse(client, headers) {
      return new Response(null, { status: 101, headers, webSocket: client });
    },
  };
}

/**
 * Create the default Cloudflare Workers provider around the portable runtime.
 *
 * Ordinary HTTP completion is registered with waitUntil so Perl cleanup can
 * finish after response construction. Streaming SSE and WebSocket sessions
 * own their request lifetime and must not be retained as background tasks.
 */
export function createCloudflareWorker(options) {
  // Keep packages generated before the `/app` migration working while the
  // public createWebDyneWorker alias is retained. New callers use appVfsArchive.
  const appVfsArchive = options.appVfsArchive ?? options.htdocsVfsArchive;
  const runtime = createWebDyneRuntime({
    ...options,
    appVfsArchive,
    webSocketAdapter: createCloudflareWebSocketAdapter(),
  });

  return {
    fetch(request, env, context) {
      const dispatch = runtime.dispatch(request, env);
      if (dispatch.type === "http") context.waitUntil(dispatch.completion);
      return dispatch.response;
    },
  };
}
