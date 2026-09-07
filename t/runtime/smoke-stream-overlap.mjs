import assert from 'node:assert/strict';
const base = process.argv[2];
if (!base) throw new Error('Usage: node t/runtime/smoke-stream-overlap.mjs BASE_URL');
async function socketEcho(id){
 await new Promise((resolve,reject)=>{
  const socket=new WebSocket(new URL('ws.psp',base.replace(/^http/, 'ws')));
  let finished=false;
  const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);socket.close();error?reject(error):resolve();};
  const timer=setTimeout(()=>finish(new Error('echo timed out')),10000);
  socket.addEventListener('open',()=>socket.send(id));
  socket.addEventListener('message',event=>finish(String(event.data).startsWith(id+' ')?undefined:new Error('incorrect echo')),{once:true});
  socket.addEventListener('error',()=>finish(new Error('socket error')),{once:true});
  socket.addEventListener('close',()=>finish(new Error('closed before echo')),{once:true});
 });
}
async function http(){const r=await fetch(base,{signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);assert.match(await r.text(),/server-time/);}
async function sse(){const r=await fetch(new URL('sse.psp',base),{headers:{accept:'text/event-stream'},signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);const body=await r.text();assert.match(body,/event: ready/);assert.match(body,/event: done/);}
for(let i=0;i<Number(process.env.ROUNDS||20);i++){console.log('ROUND',i);await Promise.all([http(),sse(),socketEcho('a'+i),http(),sse(),socketEcho('b'+i)]);}
console.log('OVERLAP PASS',Number(process.env.ROUNDS||20),'rounds');
