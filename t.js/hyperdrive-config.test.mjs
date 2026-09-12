import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveWebDyneExtensions} from '../scripts/extensions.mjs';
import {generatedWranglerConfig,main} from '../scripts/webdyne-cloudflare.mjs';

const manifest = {schemaVersion:1,perlLibrary:'lib',providers:{cloudflare:{module:'./cloudflare',factory:'base',variants:[{whenOption:'hyperdriveBindings',module:'./hyperdrive',factory:'postgres',compatibilityFlags:['nodejs_compat']}]}}};
async function fixture(callback) {
  const root=await mkdtemp(join(tmpdir(),'hyperdrive-config-'));
  try {
    const pkg=join(root,'node_modules/example'); await mkdir(join(pkg,'lib'),{recursive:true});
    await mkdir(join(root,'app')); await mkdir(join(root,'.webdyne'));
    await writeFile(join(root,'app/app.psp'),'hello');
    await writeFile(join(pkg,'package.json'),JSON.stringify({name:'example',version:'1.0.0',exports:{'./webdyne-extension.json':'./webdyne-extension.json'}}));
    await writeFile(join(pkg,'webdyne-extension.json'),JSON.stringify(manifest));
    await callback(root,pkg);
  } finally {await rm(root,{recursive:true,force:true});}
}
test('provider selection is opt-in and generated check includes compatibility requirements',()=>fixture(async root=>{
  const packageJson={name:'test',dependencies:{example:'1.0.0'},webdyne:{extensions:{example:{hyperdriveBindings:['DB']}},cloudflare:{hyperdrive:[{binding:'DB',id:'a'.repeat(32)}]}}};
  for(const options of [{},{hyperdriveBindings:[]}]) {
    const [extension]=await resolveWebDyneExtensions(root,packageJson,[{packageName:'example',options}]);
    assert.equal(extension.importSpecifier,'example/cloudflare'); assert.deepEqual(extension.compatibilityFlags,[]);
  }
  const [extension]=await resolveWebDyneExtensions(root,packageJson,[{packageName:'example',options:{hyperdriveBindings:['DB']}}]);
  assert.equal(extension.importSpecifier,'example/hyperdrive');
  await writeFile(join(root,'package.json'),JSON.stringify(packageJson));
  await main(['check'],root,async()=>{});
  assert.match(await readFile(join(root,'.webdyne/worker.js'),'utf8'),/example\/hyperdrive/);
  const config=JSON.parse(await readFile(join(root,'.webdyne/wrangler.jsonc'),'utf8'));
  assert.deepEqual(config.hyperdrive,[{binding:'DB',id:'a'.repeat(32)}]);
  assert.ok(config.compatibility_flags.includes('nodejs_compat'));
  assert.equal(config.observability.traces.enabled,true);
}));
test('invalid Hyperdrive deployment values rejected; explicit Wrangler files preserved',()=>fixture(async root=>{
  for(const hyperdrive of [{},[{binding:'DB',id:'invalid'}],[{binding:'DB',id:'a'.repeat(32),localConnectionString:'private'}],[{binding:'DB',id:'a'.repeat(32)},{binding:'DB',id:'b'.repeat(32)}]]) {
    await assert.rejects(generatedWranglerConfig(root,{packageJson:{},webdyne:{},cloudflare:{hyperdrive}},{entry:'app.psp'},join(root,'.webdyne')),/Hyperdrive|hyperdrive/);
  }
  const path=join(root,'wrangler.jsonc'); const original='{"name":"user-owned","main":"custom.js"}\n'; await writeFile(path,original);
  assert.equal(await generatedWranglerConfig(root,{cloudflare:{hyperdrive:'invalid'}},{},join(root,'.webdyne')),path);
  assert.equal(await readFile(path,'utf8'),original);
}));
test('declarative variants reject unsafe paths and multiple active alternatives',()=>fixture(async(root,pkg)=>{
  const copy=structuredClone(manifest); copy.providers.cloudflare.variants[0].module='./../escape';
  await writeFile(join(pkg,'webdyne-extension.json'),JSON.stringify(copy));
  const configured=[{packageName:'example',options:{hyperdriveBindings:['DB']}}];
  await assert.rejects(resolveWebDyneExtensions(root,{dependencies:{example:'1'}},configured),/invalid.*variant/);
  copy.providers.cloudflare.variants=[manifest.providers.cloudflare.variants[0],manifest.providers.cloudflare.variants[0]];
  await writeFile(join(pkg,'webdyne-extension.json'),JSON.stringify(copy));
  await assert.rejects(resolveWebDyneExtensions(root,{dependencies:{example:'1'}},configured),/multiple active/);
}));
