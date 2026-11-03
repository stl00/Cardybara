// Adapter unit tests against a scripted DevTools connection. No browser, no bank.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ALLOWED_METHODS,CdpConnection,SYNTHETIC_METHODS,assertAllowedCall,assertLoopbackUrl} from '../scripts/dev-collector/cdp.mjs';
import {assertDedicatedProfile,chromeArgs,openBrowser,parseActivePort} from '../scripts/dev-collector/chrome-launcher.mjs';
import {WALLET_TAB_ID,blockSignal,createChromeAdapter,createStorageArea,funcExpression,hostPermissions,tabIdFor} from '../scripts/dev-collector/chrome-adapter.mjs';
import {collectorGuard,collectorPlugin,watchedSource} from '../scripts/dev-collector/vite-plugin.mjs';
import {ORIGIN} from '../extension-next/providers.js';
import {trusted} from '../extension-next/protocol.js';

const root=fileURLToPath(new URL('..',import.meta.url)),extensionRoot=join(root,'extension-next');
const BANK='https://secure.chase.com/web/auth/dashboard#/dashboard/overview',TARGET='a'.repeat(32);
const flush=()=>new Promise(r=>setTimeout(r,5));

class FakeConn extends EventEmitter{
 constructor(){super();this.calls=[];this.frame={id:'F1',url:'about:blank',loaderId:'L1'};this.targets=[];this.world=10;this.evaluate=()=>({result:{value:'ok'}});}
 send(method,params={},sessionId){
  assertAllowedCall(method,params);this.calls.push({method,params,sessionId});
  switch(method){
   case 'Target.getTargets':return Promise.resolve({targetInfos:this.targets});
   case 'Target.createTarget':return Promise.resolve({targetId:TARGET});
   case 'Target.attachToTarget':return Promise.resolve({sessionId:'S1'});
   case 'Page.getFrameTree':return Promise.resolve({frameTree:{frame:this.frame}});
   case 'Page.createIsolatedWorld':return Promise.resolve({executionContextId:this.world++});
   case 'Runtime.evaluate':return Promise.resolve(this.evaluate(params));
   default:return Promise.resolve({});
  }
 }
 fire(method,params){this.emit('event',method,params,'S1');}
 commit(url,loaderId='L2'){const [base,hash]=url.split('#');this.frame={id:'F1',url:base,urlFragment:hash?'#'+hash:undefined,loaderId};this.fire('Page.frameNavigated',{frame:this.frame});}
 methods(name){return this.calls.filter(c=>c.method===name);}
}
function setup(options={}){
 const conn=new FakeConn(),wallet=[],blocked=[];
 const launches=[];
 const adapter=createChromeAdapter({extensionRoot,permittedHosts:['secure.chase.com'],notifyWallet:m=>wallet.push(m),onBlocked:b=>blocked.push(b),openBrowser:async o=>{launches.push(o);return conn;},...options});
 return {conn,wallet,blocked,launches,adapter,chrome:adapter.chrome};
}
async function bankTab(s){const tab=await s.chrome.tabs.create({url:BANK,active:false});s.conn.commit(BANK);s.conn.fire('Page.frameStoppedLoading',{frameId:'F1'});await flush();return tab;}

test('the client allowlist has no cookie, storage, network or input method and cannot run in the main world',()=>{
 for(const method of ['Network.getCookies','Network.getAllCookies','Network.enable','Storage.getCookies','Network.getResponseBody','Runtime.enable','Input.insertText','Page.captureScreenshot','Fetch.enable','Fetch.fulfillRequest','Browser.close'])assert.throws(()=>assertAllowedCall(method,{}),/not_allowed/,method);
 assert.throws(()=>assertAllowedCall('Runtime.evaluate',{expression:'document.cookie'}),/main_world/);
 assert.doesNotThrow(()=>assertAllowedCall('Runtime.evaluate',{expression:'1',contextId:7}));
 assert.ok(![...ALLOWED_METHODS,...SYNTHETIC_METHODS].some(m=>/^(Network|Storage|Input|Emulation)\./.test(m)||/cookie/i.test(m)),'no credential-adjacent domain, and no automation-masking Emulation');
});
test('a real connection enforces the allowlist before anything reaches the socket',async()=>{
 const socket=new EventEmitter();socket.sent=[];socket.send=m=>socket.sent.push(m);
 const conn=new CdpConnection(socket);
 assert.throws(()=>conn.send('Network.getCookies'),/not_allowed/);assert.equal(socket.sent.length,0);
 const pending=conn.send('Page.enable',{},'S');socket.emit('message',JSON.stringify({id:JSON.parse(socket.sent[0]).id,result:{done:true}}));assert.deepEqual(await pending,{done:true});
 const lost=conn.send('Page.enable');socket.emit('close');await assert.rejects(lost,/browser_disconnected/);await assert.rejects(conn.send('Page.enable'),/browser_disconnected/);
});
test('debugging endpoint and profile are confined',async()=>{
 assert.throws(()=>assertLoopbackUrl('ws://192.168.1.5:9222/devtools/browser/x'),/not_loopback/);
 assert.throws(()=>assertLoopbackUrl('ws://localhost:9222/x'),/not_loopback/);
 assert.throws(()=>parseActivePort('9222\n/devtools/page/x'),/invalid_active_port/);
 assert.equal(parseActivePort('9222\n/devtools/browser/abc-1\n'),'ws://127.0.0.1:9222/devtools/browser/abc-1');
 const args=chromeArgs('/tmp/profile');
 assert.ok(args.includes('--remote-debugging-address=127.0.0.1'));assert.ok(args.includes('--user-data-dir=/tmp/profile'));
 assert.ok(!args.some(a=>/remote-allow-origins|disable-blink-features|enable-automation|user-agent/.test(a)),'no origin wildcard and no detection-related flag');
 assert.throws(()=>assertDedicatedProfile(join(homedir(),'Library/Application Support/Google/Chrome/Default')),/personal_chrome_profile_refused/);
 const home=await mkdtemp(join(tmpdir(),'cardybara-launch-'));
 try{
  let spawned=0;const child=new EventEmitter();child.unref=()=>{};
  // launch:false only attaches; it must never start a browser.
  await assert.rejects(openBrowser({profile:home,launch:false,spawn:()=>{spawned++;return child;},connect:async()=>({})}));assert.equal(spawned,0);
  // An existing browser is reused so bank sessions survive a service restart.
  await writeFile(join(home,'DevToolsActivePort'),'9222\n/devtools/browser/abc\n');
  const urls=[];await openBrowser({profile:home,spawn:()=>{spawned++;return child;},connect:async u=>{urls.push(u);return {};}});assert.deepEqual(urls,['ws://127.0.0.1:9222/devtools/browser/abc']);assert.equal(spawned,0);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('host permissions come from the manifest and drop loopback like the release build',async()=>{
 const manifest=JSON.parse(await readFile(join(extensionRoot,'manifest.json'),'utf8')),hosts=hostPermissions(manifest);
 assert.ok(hosts.includes('secure.chase.com'));assert.ok(!hosts.some(h=>h.includes('127.0.0.1')));
});
test('the wallet is the extension\'s trusted sender regardless of the Vite port',async()=>{
 const s=setup();let sender;
 s.chrome.runtime.onMessage.addListener((m,from,reply)=>{sender=from;reply({ok:true});return true;});
 assert.deepEqual(await s.adapter.fromWallet({type:'hello'}),{ok:true});
 assert.equal(trusted(sender),true);assert.equal(sender.tab.id,WALLET_TAB_ID);
 assert.equal((await s.chrome.tabs.get(WALLET_TAB_ID)).url,ORIGIN+'/');
 assert.equal(s.launches.length,0,'hello and owner lookups must not start Chrome');
 await s.chrome.tabs.sendMessage(WALLET_TAB_ID,{channel:'cardybara-extension',type:'state'});assert.equal(s.wallet[0].type,'state');
 await assert.rejects(s.chrome.tabs.sendMessage(5,{}));
 const refused=setup();refused.chrome.runtime.onMessage.addListener(()=>false);assert.equal(await refused.adapter.fromWallet({type:'x'}),null);
});
test('tabs: create attaches before navigating, and URLs outside host permissions stay hidden',async()=>{
 const s=setup();
 await assert.rejects(s.chrome.tabs.create({url:'https://evil.test/'}),/not_permitted/);
 const updates=[];s.chrome.tabs.onUpdated.addListener((id,change,tab)=>updates.push({id,change,tab}));
 const tab=await s.chrome.tabs.create({url:BANK,active:false});
 assert.equal(tab.id,tabIdFor(TARGET));assert.ok(tab.id>WALLET_TAB_ID);assert.equal(tab.url,undefined);
 const order=s.conn.calls.map(c=>c.method);
 assert.deepEqual(s.conn.methods('Target.createTarget')[0].params,{url:'about:blank',background:true});
 assert.ok(order.indexOf('Page.enable')<order.indexOf('Page.navigate'));
 s.conn.fire('Page.frameStartedLoading',{frameId:'F1'});
 s.conn.commit('https://other.example/secret?x=1');
 s.conn.fire('Page.frameStoppedLoading',{frameId:'F1'});await flush();
 assert.deepEqual(updates.map(u=>u.change),[{status:'loading'},{},{status:'complete'}]);
 assert.equal((await s.chrome.tabs.get(tab.id)).url,undefined);
 await assert.rejects(s.chrome.tabs.update(tab.id,{url:'https://evil.test/'}),/not_permitted/);
 s.conn.commit(BANK,'L3');
 assert.equal(updates.at(-1).change.url,BANK);assert.equal((await s.chrome.tabs.get(tab.id)).url,BANK);
 assert.equal((await s.chrome.tabs.query({}))[0].url,BANK);
 await assert.rejects(s.chrome.tabs.get(999),/No tab/);
});
test('tabs: a reload right after create restarts the bank navigation and reports a new loading cycle',async()=>{
 const s=setup(),updates=[];s.chrome.tabs.onUpdated.addListener((id,change)=>updates.push(change));
 const tab=await s.chrome.tabs.create({url:BANK,active:false});
 s.conn.fire('Page.frameStartedLoading',{frameId:'F1'});updates.length=0;
 await s.chrome.tabs.reload(tab.id);
 assert.equal(s.conn.methods('Page.reload').length,0,'must not reload about:blank');
 assert.equal(s.conn.methods('Page.navigate').length,2);assert.deepEqual(updates,[{status:'loading'}]);
 s.conn.commit(BANK);s.conn.fire('Page.frameStoppedLoading',{frameId:'F1'});await flush();
 await s.chrome.tabs.reload(tab.id);assert.equal(s.conn.methods('Page.reload').length,1);
});
test('tabs: same-document navigation reports loading then complete, keeps the document, and hash is part of the URL',async()=>{
 const s=setup(),tab=await bankTab(s),updates=[];
 s.chrome.tabs.onUpdated.addListener((id,change)=>updates.push(change));
 const next=BANK.replace('overview','summary/1');
 s.conn.fire('Page.navigatedWithinDocument',{frameId:'F1',url:next});await flush();
 assert.deepEqual(updates,[{status:'loading',url:next},{status:'complete'}]);
 s.conn.fire('Page.navigatedWithinDocument',{frameId:'OTHER',url:'https://secure.chase.com/iframe'});await flush();assert.equal(updates.length,2);
 assert.equal((await s.chrome.tabs.get(tab.id)).url,next);
});
test('tabs: a route change during a page load does not report that load complete',async()=>{
 const s=setup(),updates=[];const tab=await s.chrome.tabs.create({url:BANK,active:false});
 s.chrome.tabs.onUpdated.addListener((id,change)=>updates.push(change));
 s.conn.fire('Page.frameStartedLoading',{frameId:'F1'});s.conn.commit(BANK);
 s.conn.fire('Page.navigatedWithinDocument',{frameId:'F1',url:BANK.replace('overview','logon')});await flush();
 assert.ok(!updates.some(u=>u.status==='complete'));assert.equal((await s.chrome.tabs.get(tab.id)).status,'loading');
 s.conn.fire('Page.frameStoppedLoading',{frameId:'F1'});await flush();assert.equal(updates.at(-1).status,'complete');
});
test('Chrome starts only on request: reads and tab lookups never launch it',async()=>{
 const s=setup();await s.chrome.tabs.query({});assert.deepEqual(s.launches.at(-1),{launch:false});
 await s.adapter.connect({launch:true});
 const again=setup({openBrowser:async({launch})=>{if(!launch)throw Error('no_browser');return new FakeConn();}});
 await assert.rejects(again.chrome.tabs.query({}),/no_browser/);await assert.rejects(again.chrome.tabs.create({url:BANK}),/no_browser/);
});
test('attach: interception is ready before callers continue, including tabs found after a restart',async()=>{
 const order=[];let release;const gate=new Promise(r=>{release=r;});
 const s=setup({prepareTab:async()=>{order.push('prepare');await gate;order.push('prepared');}});
 s.conn.targets=[{type:'page',targetId:TARGET,url:BANK}];
 const connected=s.adapter.connect();await flush();
 const query=s.chrome.tabs.query({}).then(tabs=>{order.push('query');return tabs;});await flush();
 assert.deepEqual(order,['prepare'],'a concurrent caller waits for enumeration');
 release();await connected;const tabs=await query;assert.deepEqual(order,['prepare','prepared','query']);assert.equal(tabs[0].url,undefined);
 // A detached session is attached again on next use.
 s.conn.fire('Page.frameNavigated',{frame:{id:'F1',url:BANK.split('#')[0],urlFragment:'#/dashboard/overview',loaderId:'L2'}});
 s.conn.emit('event','Target.detachedFromTarget',{sessionId:'S1'});
 const attaches=s.conn.methods('Target.attachToTarget').length;await s.chrome.scripting.executeScript({target:{tabId:tabs[0].id},func:()=>1}).catch(()=>{});
 assert.equal(s.conn.methods('Target.attachToTarget').length,attaches+1);
});
test('scripting waits for the document to parse before running, like document_idle',async()=>{
 const s=setup(),tab=await bankTab(s),seen=[];s.conn.evaluate=p=>{seen.push(p.expression);return {result:{}};};
 await s.chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>'body'});
 const parsed=seen.findIndex(e=>e.includes('DOMContentLoaded'));assert.ok(parsed>=0&&parsed<seen.findIndex(e=>e.includes("'body'")));
});
test('leaving the bank hosts mid-read is reported with the host only',async()=>{
 const s=setup(),tab=await bankTab(s);s.conn.commit('https://www.other.example/path?secret=1','L7');
 assert.deepEqual(s.blocked,[{tabId:tab.id,host:'www.other.example',reason:'left_permitted_hosts'}]);
});
test('tabs: closing a tab or losing Chrome fires onRemoved',async()=>{
 const s=setup(),removed=[];s.chrome.tabs.onRemoved.addListener(id=>removed.push(id));
 const tab=await bankTab(s);
 s.conn.fire('Target.targetDestroyed',{targetId:TARGET});assert.deepEqual(removed,[tab.id]);
 let stopped=0;const lost=setup({onBrowserLost:async()=>{stopped++;assert.equal(gone.length,0,'run stops before tabs are reported closed');}}),gone=[];lost.chrome.tabs.onRemoved.addListener(id=>gone.push(id));const other=await bankTab(lost);lost.conn.emit('close');await flush();assert.deepEqual(gone,[other.id]);assert.equal(stopped,1);
});
test('scripting: func, args and results cross in an isolated world with document scoping',async()=>{
 const s=setup(),tab=await bankTab(s);
 const expressions=[];s.conn.evaluate=p=>{expressions.push(p);return {result:{value:{sum:5}}};};
 const [row]=await s.chrome.scripting.executeScript({target:{tabId:tab.id},func:(a,b)=>({sum:a+b}),args:[2,3]});
 assert.deepEqual(row,{documentId:'L2',frameId:0,result:{sum:5}});
 const last=expressions.at(-1);assert.equal(last.expression,funcExpression((a,b)=>({sum:a+b}),[2,3]));assert.equal(last.contextId,10);assert.equal(last.returnByValue,true);assert.equal(last.awaitPromise,true);
 assert.equal(s.conn.methods('Page.createIsolatedWorld').length,1);
 assert.equal(s.conn.methods('Runtime.addBinding')[0].params.executionContextId,10,'binding reaches only the isolated context');
 await s.chrome.scripting.executeScript({target:{tabId:tab.id,documentIds:['L2']},func:()=>1});
 assert.equal(s.conn.methods('Page.createIsolatedWorld').length,1,'one world per document keeps reader state');
 await assert.rejects(s.chrome.scripting.executeScript({target:{tabId:tab.id,documentIds:['OLD']},func:()=>1}),/No document/);
 s.conn.commit(BANK,'L9');
 const [fresh]=await s.chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>1});assert.equal(fresh.documentId,'L9');assert.equal(s.conn.methods('Page.createIsolatedWorld').length,2);
 s.conn.evaluate=()=>({exceptionDetails:{exception:{description:'TypeError: self.CardyReader is undefined\n at x'}}});
 await assert.rejects(s.chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>1}),/CardyReader/);
});
test('scripting: files load from source each time and stay inside the extension folder',async()=>{
 const s=setup(),tab=await bankTab(s),seen=[];s.conn.evaluate=p=>{seen.push(p.expression);return {result:{}};};
 const [row]=await s.chrome.scripting.executeScript({target:{tabId:tab.id},files:['bank-tabs.js']});
 assert.equal(row.result,null);assert.equal(seen.at(-1),await readFile(join(extensionRoot,'bank-tabs.js'),'utf8'));
 await assert.rejects(s.chrome.scripting.executeScript({target:{tabId:tab.id},files:['../package.json']}),/invalid_script_path/);
});
test('scripting: refuses a page outside host permissions, like Chrome',async()=>{
 const s=setup(),tab=await bankTab(s);s.conn.commit('https://other.example/','L5');
 await assert.rejects(s.chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>'must-not-run'}),/Cannot access/);
 assert.equal(s.conn.methods('Runtime.evaluate').filter(c=>c.params.expression.includes('must-not-run')).length,0);
});
test('page messages: only the tab\'s current isolated context is a sender',async()=>{
 const s=setup(),tab=await bankTab(s),seen=[];
 s.chrome.runtime.onMessage.addListener((m,sender,reply)=>{seen.push({m,sender});reply({ok:true});return true;});
 await s.chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>1});
 const call=(executionContextId,payload)=>s.conn.fire('Runtime.bindingCalled',{name:'__cardybaraDevSend',executionContextId,payload});
 call(99,JSON.stringify({id:1,message:{type:'guide-state'}}));await flush();assert.equal(seen.length,0);
 s.conn.fire('Runtime.bindingCalled',{name:'other',executionContextId:10,payload:'{}'});await flush();assert.equal(seen.length,0);
 call(10,'x'.repeat(70000));await flush();assert.equal(seen.length,0);
 call(10,JSON.stringify({id:7,message:{type:'guide-state'}}));await flush();
 assert.deepEqual(seen[0].sender,{id:'cardybara-dev-collector',tab:{id:tab.id},frameId:0,url:BANK});
 assert.match(s.conn.methods('Runtime.evaluate').at(-1).params.expression,/__cardybaraDevReply\(7,\{"ok":true\}\)/);
});
test('block signal: refusals stop the run, a login page does not',async()=>{
 assert.equal(blockSignal({status:403,title:'x'}),'http_403');assert.equal(blockSignal({status:429}),'http_429');
 assert.equal(blockSignal({status:200,title:'Access Denied'}),'block_page');assert.equal(blockSignal({status:200,title:'Just a moment...'}),'block_page');
 assert.equal(blockSignal({status:200,title:'Sign in'}),null);assert.equal(blockSignal({status:302}),null);assert.equal(blockSignal(),null);
 const s=setup();s.conn.evaluate=p=>p.expression.includes('responseStatus')?{result:{value:{status:403,title:'x'}}}:{result:{}};
 const tab=await s.chrome.tabs.create({url:BANK,active:false});s.conn.commit(BANK);s.conn.fire('Page.frameStoppedLoading',{frameId:'F1'});s.conn.fire('Page.frameStoppedLoading',{frameId:'F1'});await flush();await flush();
 assert.deepEqual(s.blocked,[{tabId:tab.id,host:'secure.chase.com',reason:'http_403'}]);
 const fine=setup();fine.conn.evaluate=p=>p.expression.includes('responseStatus')?{result:{value:{status:200,title:'Sign in'}}}:{result:{}};await bankTab(fine);await flush();assert.deepEqual(fine.blocked,[]);
});
test('alarms fire once; storage is private, atomic and returns copies',async()=>{
 const s=setup(),fired=[];s.chrome.alarms.onAlarm.addListener(a=>fired.push(a.name));
 await s.chrome.alarms.create('a',{when:Date.now()+1});await s.chrome.alarms.create('b',{when:Date.now()+1});await s.chrome.alarms.create('b',{when:Date.now()+100000});
 await new Promise(r=>setTimeout(r,20));assert.deepEqual(fired,['a']);assert.equal(await s.chrome.alarms.clear('b'),true);
 const home=await mkdtemp(join(tmpdir(),'cardybara-store-'));
 try{
  const path=join(home,'nested/storage.json'),area=createStorageArea(path),value={n:{x:1}};
  await area.set({k:value});value.n.x=2;const read=await area.get('k');assert.equal(read.k.n.x,1);read.k.n.x=3;assert.equal((await area.get('k')).k.n.x,1);
  assert.equal((await stat(path)).mode&0o777,0o600);
  assert.deepEqual(await createStorageArea(path).get(['k','missing']),{k:{n:{x:1}}});
  assert.deepEqual(await area.get({missing:7}),{missing:7});
  await area.remove('k');assert.deepEqual(await createStorageArea(path).get(null),{});
 }finally{await rm(home,{recursive:true,force:true});}
});
test('collector routes reject other sites and hosts',()=>{
 const req=headers=>({socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:8784',...headers}});
 assert.equal(collectorGuard({...req({}),socket:{remoteAddress:'192.168.1.5'}},8784),'not_loopback');
 assert.equal(collectorGuard(req({}),8784),null);
 assert.equal(collectorGuard(req({origin:'http://127.0.0.1:8784','sec-fetch-site':'same-origin'}),8784),null);
 assert.equal(collectorGuard(req({host:'evil.test'}),8784),'invalid_host');
 assert.equal(collectorGuard(req({origin:'https://evil.test'}),8784),'origin_not_allowed');
 assert.equal(collectorGuard(req({'sec-fetch-site':'cross-site'}),8784),'cross_site');
 assert.equal(collectorGuard(req({'sec-fetch-site':'same-site'}),8784),'cross_site');
});
test('collector code stays out of builds and packages',()=>{
 const plugin=collectorPlugin({env:{}});
 assert.equal(plugin.apply,'serve');
 assert.deepEqual(collectorPlugin({env:{CARDYBARA_DEV_COLLECTOR:'0'}}).transformIndexHtml(),[]);
 assert.equal(watchedSource(join(extensionRoot,'background.js')),true);assert.equal(watchedSource(join(root,'scripts/dev-collector/service.mjs')),true);
 assert.equal(watchedSource(join(root,'src/main.jsx')),false);assert.equal(watchedSource(join(extensionRoot,'manifest.json')),false);
 // No shipped source may reference the collector.
 const refs=spawnSync('git',['grep','-lE','dev-collector|__cardybara/collector|__cardybaraDev','--','src','extension-next','public','index.html'],{cwd:root,encoding:'utf8'});
 assert.equal(refs.stdout,'',refs.stdout);
});
test('package audit fails if collector code reaches a package',async()=>{
 const home=await mkdtemp(join(tmpdir(),'cardybara-audit-'));
 try{
  const bad=join(home,'bad.zip');
  execFileSync('python3',['-c',"import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],'w');z.writestr('assets/x.js','fetch(\"/__cardybara/collector/message\")');z.close()",bad]);
  const r=spawnSync('python3',['scripts/audit-release.py','--package','--package-file='+bad],{cwd:root,encoding:'utf8'});
  assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/Dev-only collector code in package: assets\/x\.js/);
  const named=join(home,'named.zip');
  execFileSync('python3',['-c',"import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],'w');z.writestr('scripts/dev-collector/service.mjs','x');z.close()",named]);
  const n=spawnSync('python3',['scripts/audit-release.py','--package','--package-file='+named],{cwd:root,encoding:'utf8'});
  assert.notEqual(n.status,0);assert.match(n.stdout+n.stderr,/Dev-only collector code in package/);
 }finally{await rm(home,{recursive:true,force:true});}
});
