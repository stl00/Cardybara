// The friends beta (stl00/Cardybara#197): a build scoped by release.json "banks" connects only Chase and Amex US.
// Other banks stay in the code, hidden: never offered in the wallet or popup, and refused by the collector.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {scopeSource,scopeBanks,buildScopePlugin} from '../scripts/build-scope.mjs';
import {artifactBanks,validateAcceptance,REQUIRED_BANKS} from '../scripts/acceptance.mjs';
import {BUILD_BANKS} from '../extension-next/build-scope.js';
import {ACTIVE_BANKS,PROVIDERS,CONNECTABLE_BANKS,SCOPED,connectable,scopedBanks,bankOrder} from '../extension-next/providers.js';
import {visibleConnections,selectableBanks,selectableRegions,defaultRefreshBanks} from '../src/walletRegistry.js';

const BETA=['Chase','Amex US'];
const release=JSON.parse(readFileSync(new URL('../release.json',import.meta.url),'utf8'));

// A copy of extension-next with build-scope.js written as a build writes it, so the real worker modules load scoped.
async function scopedExtension(t,banks){
 const dir=mkdtempSync(path.join(tmpdir(),'cardybara-scope-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 cpSync(new URL('../extension-next/',import.meta.url),dir,{recursive:true});
 writeFileSync(path.join(dir,'build-scope.js'),scopeSource({banks}));
 const load=name=>import(pathToFileURL(path.join(dir,name)).href);
 return {providers:await load('providers.js'),protocol:await load('protocol.js')};
}

test('source and tests keep every bank; only a build writes a scope',()=>{
 assert.equal(BUILD_BANKS,null);assert.equal(SCOPED,false);assert.deepEqual(CONNECTABLE_BANKS,ACTIVE_BANKS);
 for(const bank of Object.keys(PROVIDERS))assert.equal(connectable(bank),true,bank);
 assert.equal(scopeSource({}),'export const BUILD_BANKS=null;\nexport const BUILD_SCOPE="cardybara-scope:all";\n');
 assert.equal(scopeSource({banks:BETA}),'export const BUILD_BANKS=["Chase","Amex US"];\nexport const BUILD_SCOPE="cardybara-scope:Chase,Amex US";\n');
 assert.ok(readFileSync(new URL('../extension-next/build-scope.js',import.meta.url),'utf8').endsWith(scopeSource(null)),'the source file is the unscoped build text');
});

test('the beta release is scoped to Chase and Amex US, with its notes in the package',()=>{
 assert.equal(release.channel,'beta');assert.deepEqual(scopeBanks(release),BETA);
 assert.match(release.label,/^\d+\.\d+\.\d+-beta\.\d+$/);
 assert.ok(readFileSync(new URL('../'+release.notes,import.meta.url),'utf8').includes(release.label),'release notes name this label');
});

test('the release builder writes the same scope text as Vite and the dev extension builder',()=>{
 const py=execFileSync('python3',['-c',"import json,sys\ncfg=json.loads(sys.argv[1])\nscope=cfg.get('banks') if isinstance(cfg.get('banks'),list) else None\nsys.stdout.write('export const BUILD_BANKS='+json.dumps(scope,separators=(',',':'),ensure_ascii=False)+';\\nexport const BUILD_SCOPE='+json.dumps('cardybara-scope:'+(','.join(scope) if scope else 'all'),ensure_ascii=False)+';\\n')",JSON.stringify(release)],{encoding:'utf8'});
 assert.equal(py,scopeSource(release));
 const builder=readFileSync(new URL('../scripts/build-release.py',import.meta.url),'utf8');
 assert.ok(builder.includes("json.dumps(scope,separators=(',',':'),ensure_ascii=False)"),'build-release.py uses the shared formula');
 const root=new URL('../',import.meta.url),plugin=buildScopePlugin(root,{all:false});
 assert.equal(plugin.transform('x','/repo/extension-next/build-scope.js').code,scopeSource(release));
 assert.equal(plugin.transform('x','/repo/src/other.js'),null);
 assert.equal(plugin.apply,'build','npm run dev keeps every bank, like the Node dev collector');
 assert.match(readFileSync(new URL('../src/ReleaseNotes.jsx',import.meta.url),'utf8'),/data-build-scope=\{BUILD_SCOPE\}/,'the wallet bundle keeps the scope marker the package audit checks');
 assert.equal(buildScopePlugin(root,{all:true}).transform('x','/repo/extension-next/build-scope.js').code,scopeSource(null));
 assert.match(readFileSync(new URL('../scripts/build-dev-extension.mjs',import.meta.url),'utf8'),/writeFile\(join\(work,SCOPE_FILE\),scopeSource\(/);
});

test('a beta build offers only Chase and Amex US, Chase first',async t=>{
 const {providers}=await scopedExtension(t,BETA);
 assert.equal(providers.SCOPED,true);assert.deepEqual(providers.CONNECTABLE_BANKS,BETA);
 for(const bank of Object.keys(PROVIDERS))assert.equal(providers.connectable(bank),BETA.includes(bank),bank);
 // The other banks are hidden, not deleted.
 assert.deepEqual(Object.keys(providers.PROVIDERS),Object.keys(PROVIDERS));assert.deepEqual(providers.ACTIVE_BANKS,ACTIVE_BANKS);
 assert.deepEqual(bankOrder(ACTIVE_BANKS).slice(0,2),BETA);
});

test('the dev schedule reads only the banks the build connects',()=>{
 const dev=readFileSync(new URL('../extension-dev/background-dev.js',import.meta.url),'utf8');
 assert.doesNotMatch(dev,/ACTIVE_BANKS/);assert.match(dev,/activeBanks:CONNECTABLE_BANKS/);
});

test('a beta build refuses to start or turn on any other bank',async t=>{
 const {protocol}=await scopedExtension(t,BETA);
 for(const bank of BETA)assert.deepEqual(protocol.request({type:'refresh',requestId:'beta',banks:[bank],cards:[]}).banks,[bank]);
 assert.deepEqual(protocol.request({type:'refresh',requestId:'beta',banks:BETA,cards:[]}).banks,BETA);
 for(const bank of ACTIVE_BANKS.filter(b=>!BETA.includes(b))){
  assert.throws(()=>protocol.request({type:'refresh',requestId:'beta',banks:[bank],cards:[]}),/bank_not_offered/,bank);
  assert.throws(()=>protocol.request({type:'refresh',requestId:'beta',banks:['Chase',bank],cards:[]}),/bank_not_offered/,bank);
  assert.throws(()=>protocol.request({type:'connect',requestId:'beta',bank}),/bank_not_offered/,bank);
  // Turning off or clearing a bank's stored readings stays possible.
  for(const type of ['disconnect','clear'])assert.equal(protocol.request({type,requestId:'beta',bank}).bank,bank);
 }
 assert.throws(()=>protocol.request({type:'refresh',requestId:'beta',banks:['Amex CA'],cards:[]}),/bank_not_offered/);
});

test('the page parser checks the build scope before touching a tab',()=>{
 assert.match(readFileSync(new URL('../extension-next/agent-runtime.js',import.meta.url),'utf8'),/!PROVIDERS\[bank\]\|\|!connectable\(bank\)/);
});

test('the wallet shows only the beta banks, and keeps a manual card of another bank',()=>{
 const connections=ACTIVE_BANKS.map(bank=>({bank,note:''})),hsbc={id:'m1',bank:'HSBC HK',region:'HK'},chase={id:'c1',bank:'Chase',region:'US'};
 assert.deepEqual(visibleConnections({connections,cards:[]},BETA).map(c=>c.bank),BETA);
 assert.deepEqual(visibleConnections({connections,cards:[hsbc]},BETA).map(c=>c.bank),BETA,'a held card does not make its bank connectable');
 assert.deepEqual(defaultRefreshBanks([hsbc,chase],BETA),['Chase']);
 assert.deepEqual(selectableBanks(ACTIVE_BANKS,[],BETA).sort(),[...BETA].sort());
 assert.deepEqual(selectableBanks(ACTIVE_BANKS,[hsbc],BETA).sort(),[...BETA,'HSBC HK'].sort(),'its card can still be filtered');
 assert.deepEqual(selectableRegions(['US','HK','CA'],[],BETA),['US']);
 assert.deepEqual(selectableRegions(['US','HK','CA'],[hsbc],BETA),['US','HK']);
 // Unscoped (alpha, source): every active bank, Chase and Amex US first; archived only for a holder.
 assert.deepEqual(visibleConnections({connections,cards:[]},null).map(c=>c.bank),bankOrder(ACTIVE_BANKS));
 assert.deepEqual(selectableRegions(['US','HK','CA'],[],null),['US','HK']);
 assert.deepEqual(defaultRefreshBanks([hsbc,chase],null).sort(),['Chase','HSBC HK']);
 assert.deepEqual(scopedBanks(['Chase','Nowhere']),['Chase']);
});

test('a beta candidate is accepted on its own banks, read from the ZIP',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'cardybara-scope-zip-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const zip=(name,text)=>{const file=path.join(dir,name);execFileSync('python3',['-c',"import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr('build-scope.js',sys.argv[2])",file,text]);return readFileSync(file);};
 assert.deepEqual(artifactBanks(zip('beta.zip',scopeSource({banks:BETA}))),BETA);
 assert.deepEqual(artifactBanks(zip('all.zip',scopeSource(null))),REQUIRED_BANKS);
 for(const bad of ['export const BUILD_BANKS=[];\n','export const BUILD_BANKS=["Chase","Chase"];\n','export const BUILD_BANKS=["Amex CA"];\n','export const X=1;\n'])assert.throws(()=>artifactBanks(zip('bad.zip',bad)),String(bad));
 // A report with only Chase and Amex US banks still fails the full gate's bank list, and names the missing banks.
 const result=validateAcceptance({banks:{}},{sha256:'a'.repeat(64),runtimeBuild:'b',sourceCommit:'c'.repeat(40),banks:BETA});
 assert.ok(result.errors.some(e=>e.startsWith('Chase: real bank acceptance missing')));
 assert.ok(!result.errors.some(e=>e.startsWith('HSBC HK:')),'a beta candidate is not held to banks it cannot connect');
});

test('beta screens never ask for a model key or name a model provider',()=>{
 // What a beta tester sees: the hosted invite-code path, the chat, card recognition, bank connections, onboarding and the release page.
 const read=f=>readFileSync(new URL('../src/'+f,import.meta.url),'utf8');
 const hostedOnly=read('ModelKeySettings.jsx');
 const hostedCopy=[...hostedOnly.matchAll(/hostedFailures=\{([^}]*)\}/g)].map(m=>m[1]).join('')+hostedOnly.slice(hostedOnly.indexOf('const privacy=hosted'),hostedOnly.indexOf(':<Paragraph type="secondary">'));
 assert.ok(hostedCopy.length>200);
 for(const [file,text] of [['ModelKeySettings.jsx hosted copy',hostedCopy],...['ChatAdvisor.jsx','ReleaseNotes.jsx','WalletOnboarding.jsx','CardProductPicker.jsx'].map(f=>[f,read(f)])]){
  for(const s of [...text.matchAll(/t\((['"])((?:(?!\1).)*)\1/g)].map(m=>m[2]))assert.doesNotMatch(s,/密钥|服务商|DeepSeek|API|[^a-z]key\b/i,`${file}: ${s}`);
 }
 const connections=read('BankConnections.jsx');
 assert.match(connections,/\{!internal\(\)&&<Paragraph[^>]*>\{t\('本机调试服务可在设置中连接，无需在扩展填写密钥。'\)\}/,'the local-service note is only for the localhost dev page');
 assert.doesNotMatch(connections,/statuses=\{[^}]*密钥/,'bank status text names no key');
});
