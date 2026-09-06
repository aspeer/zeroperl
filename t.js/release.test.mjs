import test from 'node:test';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {versionParts, nextVersion, prepareRelease, validateRelease} from '../tools/release.mjs';

const prefix='aspeer-zeroperl';
test('version selection increments patch and honors newer release tags', () => {
 assert.equal(nextVersion('1.0.0',[],prefix),'1.0.1');
 assert.equal(nextVersion('1.0.1',['aspeer-zeroperl_1.0.9','v1.0.9'],prefix),'1.0.10');
 assert.equal(nextVersion('1.0.1',[],prefix,'1.1.0'),'1.1.0');
 assert.throws(()=>nextVersion('1.0.1',[],prefix,'1.0.1'));
 for(const value of ['1.00.1','1.0.1-beta','1.0','1.0.9007199254740992']) assert.throws(()=>versionParts(value));
});
function fixture(fn){
 const root=mkdtempSync(join(tmpdir(),'zeroperl-release-test-'));
 const repo=join(root,'repo');mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 git('init','-b','main');git('config','user.email','release-test@example.invalid');git('config','user.name','Release Test');
 mkdirSync(join(repo,'release'));writeFileSync(join(repo,'release/versions.json'),JSON.stringify({version:'1.0.0',perlVersions:['5.44.0']}));
 git('add','.');git('commit','-m','Initial');git('init','--bare',join(root,'remote.git'));git('remote','add','github',join(root,'remote.git'));git('push','-u','github','main');
 try{fn(repo,git);}finally{rmSync(root,{recursive:true,force:true});}
}
test('release creates matching annotated tags, commits version, and never pushes',()=>fixture((repo,git)=>{
 const remoteBefore=git('ls-remote','github','refs/heads/main');
 prepareRelease(repo);
 assert.equal(JSON.parse(readFileSync(join(repo,'release/versions.json'))).version,'1.0.1');
 assert.equal(validateRelease(repo,'aspeer-zeroperl_1.0.1'),'1.0.1');
 assert.equal(git('status','--porcelain'),'');
 assert.equal(git('ls-remote','github','refs/heads/main'),remoteBefore);
 assert.equal(git('ls-remote','github','refs/tags/*'),'');
 assert.throws(()=>validateRelease(repo,'v1.0.1'));
 git('tag','-d','v1.0.1');git('tag','v1.0.1');
 assert.throws(()=>validateRelease(repo,'aspeer-zeroperl_1.0.1'),/annotated/);
}));
test('dirty tree and feature branch cannot prepare a release',()=>fixture((repo,git)=>{
 writeFileSync(join(repo,'untracked'),'test');assert.throws(()=>prepareRelease(repo),/working-tree/);
 rmSync(join(repo,'untracked'));git('switch','-c','feature');assert.throws(()=>prepareRelease(repo),/main/);
}));
test('existing alias is refused before committing a release',()=>fixture((repo,git)=>{
 git('tag','-a','v1.0.1','-m','Reserved');const before=git('rev-parse','HEAD');
 assert.throws(()=>prepareRelease(repo),/already exists/);assert.equal(git('rev-parse','HEAD'),before);
 assert.equal(JSON.parse(readFileSync(join(repo,'release/versions.json'))).version,'1.0.0');
}));
test('alias pointing at another commit fails release validation',()=>fixture((repo,git)=>{
 prepareRelease(repo);git('tag','-d','v1.0.1');git('tag','-a','v1.0.1','HEAD~1','-m','Wrong');
 assert.throws(()=>validateRelease(repo,'aspeer-zeroperl_1.0.1'),/does not match/);
}));

test('TypeScript releases update package and lock versions together',()=>fixture((repo,git)=>{
 rmSync(join(repo,'release'),{recursive:true});
 writeFileSync(join(repo,'package.json'),JSON.stringify({name:'@aspeer/zeroperl-ts',version:'1.1.0'}));
 writeFileSync(join(repo,'package-lock.json'),JSON.stringify({version:'1.1.0',packages:{'':{version:'1.1.0'}}}));
 git('add','-A');git('commit','-m','TypeScript fixture');
 prepareRelease(repo);
 assert.equal(validateRelease(repo,'aspeer-zeroperl-ts_1.1.1'),'1.1.1');
 const lock=JSON.parse(readFileSync(join(repo,'package-lock.json')));
 assert.equal(lock.version,'1.1.1');assert.equal(lock.packages[''].version,'1.1.1');
}));

test('staging input rejects changed bytes before any registry access',()=>{
 const dir=mkdtempSync(join(tmpdir(),'zeroperl-stage-test-'));
 try {
  const archive=join(dir,'fixture.tgz'), inventory=join(dir,'pack.json');
  writeFileSync(archive,'verified tarball bytes');
  const record={name:'@example/fixture',version:'1.0.1',filename:'fixture.tgz',integrity:'sha512-'+createHash('sha512').update(readFileSync(archive)).digest('base64')};
  writeFileSync(inventory,JSON.stringify([record]));
  const run=()=>execFileSync(process.execPath,[fileURLToPath(new URL('../tools/stage-package.mjs',import.meta.url)),archive,inventory,'--check-only'],{encoding:'utf8',stdio:'pipe'});
  assert.match(run(),/Verified staging input/);
  writeFileSync(archive,'tampered tarball bytes');assert.throws(run);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
