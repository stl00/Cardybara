import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,realpathSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
const root=process.cwd(),hook=path.join(root,'scripts/hooks');
// All values are synthetic. Every repository here is a throwaway in the temp directory, with no global git config.
const LONG='7700123456',TAIL='4242',TEXT='Zebra Quokka',env={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
delete env.CARDYBARA_PRIVATE_NEEDLES;
// A test run from inside a git hook inherits these, and they would point every git call below at the real repository.
for(const key of Object.keys(env))if(/^GIT_/.test(key)&&!key.startsWith('GIT_CONFIG_'))delete env[key];
// Git prints the temp paths (for example "failed to push some refs to '/tmp/…/remote.git'"), and a random mkdtemp
// suffix or the system temp directory can contain a synthetic value. Replace those paths before checking that the
// message does not repeat a value, so the check only sees what the hook itself wrote.
function scrub(text,dir){
 let out=text||'';
 for(const p of [...new Set([dir,realpathSync(dir),tmpdir(),realpathSync(tmpdir())])].sort((a,b)=>b.length-a.length))out=out.split(p).join('<tmp>');
 return out;
}
function sandbox(t,values=[LONG,TAIL,TEXT],prefix=''){
 const dir=mkdtempSync(path.join(tmpdir(),'cardybara-scan-'+prefix));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const repo=path.join(dir,'repo'),remote=path.join(dir,'remote.git'),needles=path.join(dir,'needles.txt');
 const git=(...a)=>execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid',...a],{cwd:repo,env,encoding:'utf8',stdio:'pipe'});
 mkdirSync(repo);execFileSync('git',['init','-q','--bare',remote],{env});git('init','-q','-b','main');git('remote','add','origin',remote);
 if(values)writeFileSync(needles,values.join('\n')+'\n');
 const commit=(name,text,message='Add file')=>{mkdirSync(path.dirname(path.join(repo,name)),{recursive:true});writeFileSync(path.join(repo,name),text);git('add','-A','-f');git('commit','-q','-m',message);};
 const push=(extra={},...args)=>{const r=spawnSync('git',['-c','core.hooksPath='+hook,'-c','user.name=Test','-c','user.email=test@example.invalid','push',...(args.length&&!args[0].startsWith('-')?args:['origin','HEAD:main',...args])],{cwd:repo,env:{...env,CARDYBARA_PRIVATE_NEEDLES:needles,...extra},encoding:'utf8'});return {...r,stdout:scrub(r.stdout,dir),stderr:scrub(r.stderr,dir)};};
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
test('a temp path that happens to contain a value does not count as the message repeating it',t=>{
 // Regression for #139: the mkdtemp suffix is random and can contain the synthetic tail.
 for(const value of [TAIL,LONG]){const s=sandbox(t,undefined,`${value}-`);assert.ok(s.dir.includes(value));s.commit('a.txt',`id ${LONG}\n`);const r=s.push();refused(r,'a\\.txt');}
});
test('the release audit reports a tracked value by file name only',t=>{
 const s=sandbox(t);mkdirSync(path.join(s.repo,'scripts'));
 for(const f of ['audit-release.py','private_scan.py'])execFileSync('cp',[path.join(root,'scripts',f),path.join(s.repo,'scripts',f)]);
 s.commit('a.txt',`id ${LONG}\n`);
 const raw=spawnSync('python3',['scripts/audit-release.py'],{cwd:s.repo,env:{...env,CARDYBARA_PRIVATE_NEEDLES:s.needles},encoding:'utf8'});refused({...raw,stderr:scrub(raw.stderr,s.dir)},'a\\.txt');
 assert.equal(spawnSync('python3',['scripts/audit-release.py'],{cwd:s.repo,env,encoding:'utf8'}).status,0,'without values the audit is unchanged');
});
test('a value next to a comma or inside a CSV is still found',t=>{
 for(const text of [`Chase,${LONG},x`,`[100,${LONG}]`]){const s=sandbox(t);s.commit('a.csv',text+'\n');refused(s.push(),'a\\.csv');}
});
test('short tails in the bank masked forms count, and a word merely ending in "ending" does not',t=>{
 for(const text of [`"last4":"${TAIL}"`,`Sapphire (...${TAIL})`]){const s=sandbox(t);s.commit('a.txt',text+'\n');refused(s.push(),'a\\.txt');}
 const s=sandbox(t);s.commit('a.txt',`pending ${TAIL}\n`);assert.equal(s.push().status,0);
});
test('a commit already on another remote is still scanned for this one',t=>{
 const s=sandbox(t),other=path.join(s.dir,'private.git');execFileSync('git',['init','-q','--bare',other],{env});s.git('remote','add','private',other);
 s.commit('a.txt',`id ${LONG}\n`);assert.equal(s.push({},'private','HEAD:refs/heads/main','--no-verify').status,0);
 refused(s.push({},'origin','HEAD:refs/heads/fresh'),'a\\.txt');
});
test('every commit in a known range, a root commit and a merge are scanned',t=>{
 const range=sandbox(t);assert.equal(range.push().status,0);range.commit('a.txt',`id ${LONG}\n`);range.commit('b.txt','clean\n');refused(range.push(),'a\\.txt');
 const root=sandbox(t);root.git('checkout','-q','--orphan','other');root.commit('a.txt',`id ${LONG}\n`);refused(root.push(),'a\\.txt');
 const merge=sandbox(t);assert.equal(merge.push().status,0);merge.git('checkout','-q','-b','side');merge.commit('s.txt','clean\n');merge.git('checkout','-q','main');merge.commit('m.txt','clean\n');merge.git('merge','-q','--no-commit','--no-ff','side');writeFileSync(path.join(merge.repo,'evil.txt'),`id ${LONG}\n`);merge.git('add','-A');merge.git('commit','-q','-m','Merge');refused(merge.push(),'evil\\.txt');
});
test('committer, annotated tag and ref name are scanned, and a value in a file name is not printed',t=>{
 const c=sandbox(t);c.commit('a.txt','clean\n');c.git('-c',`user.email=${LONG}@example.invalid`,'commit','-q','--amend','--no-edit','--author=Test <test@example.invalid>');refused(c.push(),'commit details');
 const g=sandbox(t);g.git('tag','-a','v1','-m',`Note ${LONG}`);refused(g.push({},'origin','refs/tags/v1'),'tag');
 const r=sandbox(t);refused(r.push({},'origin',`HEAD:refs/heads/x-${LONG}`),'ref name');
 const n=sandbox(t);n.commit(`${TAIL}.txt`,`ending ${TAIL}\n`);const hidden=n.push();assert.notEqual(hidden.status,0);assert.match(hidden.stderr,/name withheld/);assert.equal(hidden.stderr.includes(TAIL),false);
});
test('a submodule entry neither crashes the scan nor blocks a clean push',t=>{
 const s=sandbox(t),head=s.git('rev-parse','HEAD').trim();s.git('update-index','--add','--cacheinfo',`160000,${head},vendored`);s.git('commit','-q','-m','Add gitlink');const r=s.push();assert.equal(r.status,0,r.stderr);
});
test('a five-digit tail after a mask or a dot is found, and a decimal fraction is not',t=>{
 const five='77001';
 for(const text of [`Platinum (...${five})`,`x.${five}`,`ending ${five}`]){const s=sandbox(t,[five]);s.commit('a.txt',text+'\n');const r=s.push();assert.notEqual(r.status,0,text);assert.equal(r.stderr.includes(five),false);}
 const s=sandbox(t,[five]);s.commit('a.txt',`rate 0.${five}\n`);assert.equal(s.push().status,0);
});
test('tags that wrap a file, a tree or another tag are scanned',t=>{
 const blob=sandbox(t);writeFileSync(path.join(blob.repo,'x.txt'),`id ${LONG}\n`);const sha=blob.git('hash-object','-w','x.txt').trim();blob.git('tag','held',sha);refused(blob.push({},'origin','refs/tags/held'),'tagged file');
 const tree=sandbox(t);tree.commit('a.txt',`id ${LONG}\n`);tree.git('tag','held','HEAD^{tree}');refused(tree.push({},'origin','refs/tags/held'),'a\\.txt');
 const nested=sandbox(t);nested.git('tag','-a','inner','-m',`Note ${LONG}`);nested.git('tag','-a','outer','-m','clean','inner');refused(nested.push({},'origin','refs/tags/outer'),'tag');
 const clean=sandbox(t);clean.git('tag','-a','v1','-m','clean');const r=clean.push({},'origin','refs/tags/v1');assert.equal(r.status,0,r.stderr);
});
test('refs from a different fetch address do not count as already pushed',t=>{
 const s=sandbox(t),other=path.join(s.dir,'public.git');execFileSync('git',['init','-q','--bare',other],{env});
 s.commit('a.txt',`id ${LONG}\n`);assert.equal(s.push({},'origin','HEAD:refs/heads/main','--no-verify').status,0);
 s.git('fetch','-q','origin');s.git('remote','set-url','--push','origin',other);
 refused(s.push({},'origin','HEAD:refs/heads/fresh'),'a\\.txt');
 const both=sandbox(t),extra=path.join(both.dir,'public.git'),own=both.git('remote','get-url','origin').trim();execFileSync('git',['init','-q','--bare',extra],{env});
 both.commit('a.txt',`id ${LONG}\n`);assert.equal(both.push({},'origin','HEAD:refs/heads/main','--no-verify').status,0);both.git('fetch','-q','origin');
 both.git('remote','set-url','--add','--push','origin',own);both.git('remote','set-url','--add','--push','origin',extra);
 refused(both.push({},'origin','HEAD:refs/heads/fresh'),'a\\.txt');
});
test('a commit on the same remote under another branch is not scanned again',t=>{
 const s=sandbox(t);s.commit('a.txt',`id ${LONG}\n`);assert.equal(s.push({},'origin','HEAD:refs/heads/main','--no-verify').status,0);s.git('fetch','-q','origin');
 const r=s.push({},'origin','HEAD:refs/heads/fresh');assert.equal(r.status,0,r.stderr);
});
