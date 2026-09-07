// Standalone Cloudflare reproduction: no Perl, WASM, dependencies or waitUntil.
export default {
  fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('healthy');
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    server.addEventListener('message', event => server.send(event.data));
    return new Response(null, {status: 101, webSocket: client});
  },
};
