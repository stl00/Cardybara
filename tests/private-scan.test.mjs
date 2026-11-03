import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
const root=process.cwd(),hook=path.join(root,'scripts/hooks');
// All values are synthetic. Every repository here is a throwaway in the temp directory, with no global git config.
const LONG='7700123456',TAIL='4242',TEXT='Zebra Quokka',env={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
delete env.CARDYBARA_PRIVATE_NEEDLES;
function sandbox(t,values=[LONG,TAIL,TEXT]){
 const dir=mkdtempSync(path.join(tmpdir(),'cardybara-scan-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const repo=path.join(dir,'repo'),remote=path.join(dir,'remote.git'),needles=path.join(dir,'needles.txt');
 const git=(...a)=>execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid',...a],{cwd:repo,env,encoding:'utf8',stdio:'pipe'});
 mkdirSync(repo);execFileSync('git',['init','-q','--bare',remote],{env});git('init','-q','-b','main');git('remote','add','origin',remote);
 if(values)writeFileSync(needles,values.join('\n')+'\n');
 const commit=(name,text,message='Add file')=>{mkdirSync(path.dirname(path.join(repo,name)),{recursive:true});writeFileSync(path.join(repo,name),text);git('add','-A','-f');git('commit','-q','-m',message);};
 const push=(extra={},...args)=>spawnSync('git',['-c','core.hooksPath='+hook,'push','origin','HEAD:main',...args],{cwd:repo,env:{...env,CARDYBARA_PRIVATE_NEEDLES:needles,...extra},encoding:'utf8'});
 commit('README.md','clean\n');
 return {dir,repo,needles,git,commit,push};
}
const refused=(r,file)=>{assert.notEqual(r.status,0,r.stderr);assert.match(r.stderr,new RegExp(file));for(const value of [LONG,TAIL,TEXT])assert.equal(r.stderr.includes(value),false,'message must not repeat a value');};
test('the hook ships executable and clean pushes pass',t=>{
 assert.ok(statSync(path.join(hook,'pre-push')).mode&0o100);
 const s=sandbox(t),r=s.push();assert.equal(r.status,0,r.stderr);assert.match(r.stdout+r.stderr,/PASS: owner private value scan/);
});
test('a value in a pushed file blocks the push and names the file only',t=>{
 for(const [name,text] of [['a.txt',`id ${LONG}\n`],['b.txt',`card ending in ${TAIL}\n`],['c.txt','Holder zebra quokka\n']]){const s=sandbox(t);s.commit(name,text);refused(s.push(),name);}
});
test('a value in history blocks the push even after a later commit removes it',t=>{
 const s=sandbox(t);s.commit('a.txt',`id ${LONG}\n`);s.commit('a.txt','clean\n');refused(s.push(),'a.txt');
});
test('a value in a commit message or file name blocks the push',t=>{
 const s=sandbox(t);s.commit('a.txt','clean\n',`Note ${LONG}`);refused(s.push(),'commit details');
 const n=sandbox(t);n.commit(`notes-${LONG}.txt`,'clean\n');const r=n.push();assert.notEqual(r.status,0);assert.match(r.stderr,/a file name/);assert.equal(r.stderr.includes(LONG),false);
});
test('only commits not yet on the remote are scanned',t=>{
 const s=sandbox(t);s.commit('a.txt',`id ${LONG}\n`);assert.equal(s.push({},'--no-verify').status,0);
 s.commit('b.txt','clean\n');const r=s.push();assert.equal(r.status,0,r.stderr);
});
test('short numbers count only where a card tail is written',t=>{
 for(const text of [`annual fee $${TAIL}`,`version 1.${TAIL}`,`width: ${TAIL}px`,`id 9${TAIL}1`,`"${TAIL}"`,`a${TAIL}`]){const s=sandbox(t);s.commit('a.txt',text+'\n');const r=s.push();assert.equal(r.status,0,text+': '+r.stderr);}
 for(const text of [`ending ${TAIL}`,`Ends in ${TAIL}`,`尾号${TAIL}`,`尾號 ${TAIL}`,`末四位：${TAIL}`,`•••• ${TAIL}`,`xxxx${TAIL}`,`****-${TAIL}`]){const s=sandbox(t);s.commit('a.txt',text+'\n');refused(s.push(),'a.txt');}
});
test('long values and words match whole, not inside a longer token',t=>{
 for(const text of [`1${LONG}`,`${LONG}9`,`0.${LONG}`,'ZebraQuokkas','Zebra Quokka2']){const s=sandbox(t);s.commit('a.txt',text+'\n');const r=s.push();assert.equal(r.status,0,text+': '+r.stderr);}
});
test('the hook fails closed without a usable values file',t=>{
 const s=sandbox(t);s.commit('a.txt','clean\n');
 assert.match(s.push({CARDYBARA_PRIVATE_NEEDLES:''}).stderr,/no values file/);
 assert.match(s.push({CARDYBARA_PRIVATE_NEEDLES:path.join(s.dir,'missing.txt')}).stderr,/not found/);
 writeFileSync(s.needles,'\n  \n');assert.match(s.push().stderr,/is empty/);
 const inside=path.join(s.repo,'needles.txt');writeFileSync(inside,LONG+'\n');assert.match(s.push({CARDYBARA_PRIVATE_NEEDLES:inside}).stderr,/outside the repository/);
 assert.equal(spawnSync('git',['ls-remote','--heads','origin'],{cwd:s.repo,env,encoding:'utf8'}).stdout,'','nothing reached the remote');
});
test('git config can name the values file',t=>{
 const s=sandbox(t);s.git('config','cardybara.privateNeedles',s.needles);s.commit('a.txt',`id ${LONG}\n`);refused(s.push({CARDYBARA_PRIVATE_NEEDLES:''}),'a.txt');
});
function zip(file,entries){execFileSync('python3',['-c',"import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED) as z:\n for n,b in json.loads(sys.argv[2]).items():z.writestr(n,b)",file,JSON.stringify(entries)]);}
test('a built package ZIP is scanned too',t=>{
 const s=sandbox(t);mkdirSync(path.join(s.repo,'release'));writeFileSync(path.join(s.repo,'.gitignore'),'release/\n');s.git('add','.gitignore');s.git('commit','-q','-m','Ignore');
 const package_=path.join(s.repo,'release','c.zip');
 zip(package_,{'a.js':`fee ${TAIL}`,'logo.png':LONG});assert.equal(s.push().status,0,'short number and binary member pass');
 zip(package_,{'assets/a.js':`x=${LONG}`});refused(s.push(),'c\\.zip:assets/a\\.js');
});
test('the release audit reports a tracked value by file name only',t=>{
 const s=sandbox(t);mkdirSync(path.join(s.repo,'scripts'));
 for(const f of ['audit-release.py','private_scan.py'])execFileSync('cp',[path.join(root,'scripts',f),path.join(s.repo,'scripts',f)]);
 s.commit('a.txt',`id ${LONG}\n`);
 const r=spawnSync('python3',['scripts/audit-release.py'],{cwd:s.repo,env:{...env,CARDYBARA_PRIVATE_NEEDLES:s.needles},encoding:'utf8'});refused(r,'a\\.txt');
 assert.equal(spawnSync('python3',['scripts/audit-release.py'],{cwd:s.repo,env,encoding:'utf8'}).status,0,'without values the audit is unchanged');
});
