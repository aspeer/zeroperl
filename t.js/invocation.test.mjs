import test from 'node:test';
import assert from 'node:assert/strict';
import {createInvocationTransport} from '../js/transport/invocation.js';
import {durableObjects,durableWranglerConfig,configureDurableExtensions,durableWorkerSource} from '../scripts/durable-objects.mjs';

test('finite transport requires one result and closes its connection', async()=>{
  const t=createInvocationTransport();
  assert.throws(()=>t.result(),/without a result/);
  assert.throws(()=>t.sink.send({type:'http.response.start'}),/Invalid/);
  assert.throws(()=>t.receiveSource.next(),/do not receive/);
  t.sink.send({type:'invocation.result',value:{ok:true,result:null}});
  assert.deepEqual(t.result(),{ok:true,result:null});
  assert.throws(()=>t.sink.send({type:'invocation.result',value:1}),/duplicate/);
  t.close();
  assert.equal(await t.connection.waitForDisconnect(),'invocation_finished');
});

test('Durable Object configuration emits classes, SQLite declarations and native bindings',()=>{
  const defs=durableObjects([{binding:'ROOMS',className:'Room',perlPackage:'App::Room',methods:['read'],initialize:true},
    {binding:'REMOTE',className:'Remote',scriptName:'other-worker',native:true}]);
  const config=durableWranglerConfig(defs);
  assert.deepEqual(config.exports,{Room:{type:'durable-object',storage:'sqlite'}});
  assert.equal(config.durable_objects.bindings[1].script_name,'other-worker');
  const extensions=[{packageName:'@webdyne/webdyne-cloudflare',options:{kvBindings:['KV']}}];
  configureDurableExtensions(defs,extensions);
  assert.deepEqual(extensions[0].options.durableObjectBindings,['ROOMS','REMOTE']);
  assert.deepEqual(extensions[0].options.durableObjectNativeBindings,['REMOTE']);
  const source=durableWorkerSource(defs,'runtime','const webdyneExtensions = [factory({})];');
  assert.match(source,/export const Room/);
  assert.match(source,/createExtensions:.*return \[factory/);
  assert.doesNotMatch(source,/export const Remote/);
  for(const bad of [null,{},[{binding:'X',className:'Room'}],
    [{binding:'X',className:'Room',perlPackage:'App;die',methods:['read']}],
    [{binding:'X',className:'Room',perlPackage:'App',methods:['constructor']}],
    [defs[0],defs[0]]])assert.throws(()=>durableObjects(bad));
});

test('configured binding strings are merged as names, not characters',()=>{
  const objects=durableObjects([{binding:'ROOMS',className:'Room',perlPackage:'App',methods:['read']}]);
  const extensions=[{packageName:'@webdyne/webdyne-cloudflare',options:{durableObjectBindings:'OLD, REMOTE'}}];
  configureDurableExtensions(objects,extensions);
  assert.deepEqual(extensions[0].options.durableObjectBindings,['OLD','REMOTE','ROOMS']);
  assert.throws(()=>durableObjects([{binding:'X',className:'class',perlPackage:'App',methods:['read']}]),/Invalid/);
});
