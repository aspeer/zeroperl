import assert from 'node:assert/strict';
import net from 'node:net';
import {randomBytes} from 'node:crypto';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:8898/');
if (base.protocol !== 'http:') throw new Error('This local TCP reproducer requires an http:// URL');
const rounds = Number(process.env.ROUNDS ?? 20);
assert.ok(Number.isSafeInteger(rounds) && rounds > 0);

async function terminateSocket() {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({host: base.hostname, port: Number(base.port || 80)});
    let headers = '';
    let upgraded = false;
    socket.setTimeout(10000, () => socket.destroy(new Error('WebSocket upgrade timeout')));
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.write(`GET ${base.pathname}${base.search} HTTP/1.1\r\nHost: ${base.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    socket.on('data', chunk => {
      if (upgraded) return;
      headers += chunk.toString('latin1');
      if (!headers.includes('\r\n\r\n')) return;
      if (!headers.startsWith('HTTP/1.1 101 ')) {
        socket.destroy(new Error(`Upgrade failed: ${headers.split('\r\n')[0]}`));
        return;
      }
      upgraded = true;
      // Send one masked text frame, then drop TCP without a WebSocket Close frame.
      const mask = randomBytes(4);
      const payload = Buffer.from('disconnect');
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, payload]), () => socket.destroy());
    });
    socket.once('close', () => upgraded ? resolve() : reject(new Error('Closed before upgrade')));
  });
}

for (let round = 0; round < rounds; round++) {
  await terminateSocket();
  const response = await fetch(new URL('/', base), {signal: AbortSignal.timeout(10000)});
  assert.equal(response.status, 200);
  await response.text();
}
console.log(`${rounds} forced disconnects completed; follow-up HTTP remained healthy. Inspect Worker logs for hung-request diagnostics.`);
