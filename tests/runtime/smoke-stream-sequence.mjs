import assert from 'node:assert/strict';
const base = process.argv[2];
if (!base) throw new Error('Usage: node tests/runtime/smoke-stream-sequence.mjs BASE_URL');
const response = await fetch(new URL('sse.psp', base), {
  headers: {accept: 'text/event-stream'}, signal: AbortSignal.timeout(10000),
});
assert.equal(response.status, 200);
const events = await response.text();
assert.match(events, /event: ready/);
assert.match(events, /event: done/);
const endpoint = new URL('ws.psp', base);
endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
await new Promise((resolve, reject) => {
  const socket = new WebSocket(endpoint);
  let settled = false;
  const finish = error => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    socket.close();
    error ? reject(error) : resolve();
  };
  const timeout = setTimeout(() => finish(new Error('WebSocket timed out after SSE completion')), 10000);
  socket.addEventListener('open', () => socket.send('stream-sequence'));
  socket.addEventListener('message', event => {
    finish(typeof event.data === 'string' && event.data.startsWith('stream-sequence ')
      ? undefined : new Error('Unexpected WebSocket echo'));
  }, {once: true});
  socket.addEventListener('error', () => finish(new Error('WebSocket failed after SSE completion')), {once: true});
  socket.addEventListener('close', () => finish(new Error('WebSocket closed before echo')), {once: true});
});
console.log('SSE completion followed by WebSocket echo passed');
