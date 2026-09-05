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
 * Register every session completion so queued Perl work and extension cleanup
 * retain their request context after an HTTP response or stream closes.
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
      context.waitUntil(dispatch.completion);
      return dispatch.response;
    },
  };
}
