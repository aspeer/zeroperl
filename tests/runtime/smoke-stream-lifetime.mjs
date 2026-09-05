import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
const base=process.argv[2];
if (!base) throw new Error('Usage: node tests/runtime/smoke-stream-lifetime.mjs BASE_URL');
const socket=new WebSocket(new URL('ws.psp',base.replace(/^http/,'ws')));
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
async function echo(text){
 const reply=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('echo timeout')),10000);socket.addEventListener('message',e=>{clearTimeout(timer);resolve(String(e.data));},{once:true});});
 socket.send(text);assert.ok((await reply).startsWith(text+' '));
}
await echo('initial');
const response=await fetch(new URL('sse-long.psp',base),{headers:{accept:'text/event-stream'},signal:AbortSignal.timeout(65000)});
assert.equal(response.status,200);
const reader=response.body.getReader();
let data='';const decoder=new TextDecoder();let ticks=0;
const end=Date.now()+45000;
while(Date.now()<end){const chunk=await reader.read();assert.equal(chunk.done,false,'stream stays open');data+=decoder.decode(chunk.value);ticks++;}
assert.match(data,/event: ready/);assert.match(data,/event: tick/);assert.ok(ticks>10);
await reader.cancel();await echo('after45seconds');
const closed=new Promise(resolve=>socket.addEventListener('close',resolve,{once:true}));socket.close();await closed;
await delay(1000);
for(let i=0;i<5;i++){const r=await fetch(base,{signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);await r.text();}
for(let i=0;i<9;i++){await delay(5000);const r=await fetch(base,{signal:AbortSignal.timeout(5000)});assert.equal(r.status,200);await r.text();}
console.log('PASS: 45s live SSE and WebSocket, cancellation/close, and 45s of subsequent HTTP health checks');
