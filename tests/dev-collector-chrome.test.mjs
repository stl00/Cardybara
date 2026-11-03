// Real Chrome, synthetic page, no bank contact. Run with: npm run test:collector-chrome
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {networkInterfaces,tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SYNTHETIC_ARGS,SYNTHETIC_METHODS} from '../scripts/dev-collector/cdp.mjs';
import {openBrowser,parseActivePort} from '../scripts/dev-collector/chrome-launcher.mjs';
import {createChromeAdapter,hostPermissions} from '../scripts/dev-collector/chrome-adapter.mjs';
import {syntheticPrepareTab} from '../scripts/dev-collector/synthetic-bank.mjs';
import {chaseCards} from '../extension-next/chase-navigation.js';
import {capturePage} from '../extension-next/agent-snapshot.js';

const extensionRoot=fileURLToPath(new URL('../extension-next',import.meta.url));
const manifest=JSON.parse(await readFile(join(extensionRoot,'manifest.json'),'utf8'));
const BANK='https://secure.chase.com/web/auth/dashboard#/dashboard/overview';
const until=async(fn,ms=10000)=>{const end=Date.now()+ms;for(;;){const v=await fn();if(v)return v;if(Date.now()>end)throw Error('until_timeout');await new Promise(r=>setTimeout(r,50));}};

async function start(mode='page',onBlocked){
 const home=await mkdtemp(join(tmpdir(),'cardybara-collector-test-'));
 const adapter=createChromeAdapter({extensionRoot,storagePath:join(home,'storage.json'),permittedHosts:hostPermissions(manifest),prepareTab:syntheticPrepareTab(mode),onBlocked,
  openBrowser:({launch})=>openBrowser({profile:join(home,'profile'),launch,headless:true,noSandbox:process.platform==='linux',extraMethods:SYNTHETIC_METHODS,extraArgs:SYNTHETIC_ARGS})});
 const conn=await adapter.connect({launch:true});
 return {adapter,home,conn,async stop(){await conn.send('Browser.close').catch(()=>{});adapter.close();await new Promise(r=>setTimeout(r,300));await rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});}};
}

test('debugging port answers on loopback only',async()=>{
 const run=await start();
 try{
  const url=new URL(parseActivePort(await readFile(join(run.home,'profile/DevToolsActivePort'),'utf8')));
  assert.equal((await fetch('http://127.0.0.1:'+url.port+'/json/version')).status,200);
  const lan=Object.values(networkInterfaces()).flat().find(i=>i.family==='IPv4'&&!i.internal)?.address;
  if(lan)await assert.rejects(fetch('http://'+lan+':'+url.port+'/json/version',{signal:AbortSignal.timeout(2000)}));
 }finally{await run.stop();}
});

test('injects in an isolated world, tracks documents and answers a page script through the guide channel',async()=>{
 const run=await start();
 try{
  const {chrome}=run.adapter,events=[];
  chrome.tabs.onUpdated.addListener((id,change)=>events.push(change));
  const tab=await chrome.tabs.create({url:BANK,active:false});
  await until(()=>events.some(e=>e.status==='complete')&&chrome.tabs.get(tab.id).then(t=>t.url===BANK));
  assert.ok(events.some(e=>e.status==='loading'));
  const [{documentId,result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:(a,b)=>({sum:a+b,href:location.href,pageVar:typeof root}),args:[2,3]});
  assert.equal(result.sum,5);assert.equal(result.href,BANK);assert.ok(documentId);
  assert.equal(result.pageVar,'object','isolated world still sees the DOM id global');
  // Isolated from the page's own script variables.
  const [{result:cards}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>typeof cards});
  assert.equal(cards,'undefined');
  // State persists across injections in one document, as reader.js requires.
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['reader.js']});
  const [{result:reader}]=await chrome.scripting.executeScript({target:{tabId:tab.id,documentIds:[documentId]},func:()=>typeof self.CardyReader?.observe});
  assert.equal(reader,'function');
  // guide.js channel: chrome.runtime.sendMessage from the isolated world reaches onMessage with a bound sender.
  let sender=null;
  chrome.runtime.onMessage.addListener((m,s,reply)=>{sender=s;reply({echo:m.type});return true;});
  const [{result:answer}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>chrome.runtime.sendMessage({type:'probe'})});
  assert.deepEqual(answer,{echo:'probe'});assert.equal(sender.tab.id,tab.id);assert.equal(sender.frameId,0);assert.equal(sender.url,BANK);
  // A same-document route change keeps the document and reports the new URL.
  const hash=BANK.replace('overview','other');
  await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{history.pushState(null,'','#/dashboard/other');}});
  await until(()=>events.some(e=>e.url===hash));
  const [{documentId:same}]=await chrome.scripting.executeScript({target:{tabId:tab.id,documentIds:[documentId]},func:()=>true});assert.equal(same,documentId);
  // A hash-only tabs.update is same-document and must still end in complete.
  const routed=BANK.replace('overview','routed'),mark=events.length;
  await chrome.tabs.update(tab.id,{url:routed});
  await until(()=>events.slice(mark).some(e=>e.status==='complete'));
  assert.equal((await chrome.tabs.get(tab.id)).url,routed);assert.equal((await chrome.tabs.get(tab.id)).status,'complete');
  // A reload creates a new document and rejects stale document IDs.
  const before=events.length;await chrome.tabs.reload(tab.id);
  await until(()=>events.slice(before).some(e=>e.status==='complete'));
  await assert.rejects(until(async()=>{await chrome.scripting.executeScript({target:{tabId:tab.id,documentIds:[documentId]},func:()=>true});return false;},3000),/No document with id/);
  // Closing the tab fires onRemoved.
  let removed=null;chrome.tabs.onRemoved.addListener(id=>{removed=id;});
  await run.conn.send('Target.closeTarget',{targetId:(await run.conn.send('Target.getTargets')).targetInfos.find(t=>t.url.startsWith('https://secure.chase.com')).targetId});
  await until(()=>removed===tab.id);
 }finally{await run.stop();}
});

test('a no-payment banner left over from the previous card does not land on the next card',async()=>{
 const run=await start();
 try{
  const {chrome}=run.adapter,events=[];chrome.tabs.onUpdated.addListener((id,c)=>events.push(c));
  const tab=await chrome.tabs.create({url:BANK,active:false});await until(()=>events.some(e=>e.status==='complete'));
  const exec=(func,args=[])=>chrome.scripting.executeScript({target:{tabId:tab.id},func,args}).then(r=>r[0].result);
  const mark=events.length;await exec(()=>{sessionStorage.setItem('synthetic-signed-in','1');sessionStorage.setItem('synthetic-leftover-notice','1');location.reload();});
  await until(()=>events.slice(mark).some(e=>e.status==='complete'));await until(()=>exec(()=>!!document.getElementById('accounts-name-link-button-300')));
  await exec(()=>{});await chrome.scripting.executeScript({target:{tabId:tab.id},files:['reader.js']});
  const cards=[{id:'cash',bank:'Chase',tail:'5678',currency:'USD'},{id:'plain',bank:'Chase',tail:'9012',currency:'USD'}];
  const read=async(tail,id)=>{assert.deepEqual(await exec(chaseCards,['select',tail,cards]),[tail]);const raw=await exec(capturePage,['Chase',cards,[id]]);assert.equal(raw.error,undefined);return raw.observations.map(i=>i.key);};
  const back=()=>exec(()=>{location.hash='#/dashboard/overview';});
  assert.ok((await read('5678','cash')).includes('paymentStatus'),'the card that shows the banner keeps it');
  await back();await until(()=>exec(()=>!!document.getElementById('accounts-name-link-button-300')));
  const next=await read('9012','plain');
  assert.ok(next.includes('balance'));assert.ok(!next.includes('paymentStatus'),'the leftover banner must not apply');
 }finally{await run.stop();}
});

test('reports a refused bank response as blocked',async()=>{
 const blocked=[];const run=await start('blocked',b=>blocked.push(b));
 try{
  await run.adapter.chrome.tabs.create({url:BANK,active:false});
  await until(()=>blocked.length);
  assert.equal(blocked[0].host,'secure.chase.com');assert.equal(blocked[0].reason,'http_403');
 }finally{await run.stop();}
});
