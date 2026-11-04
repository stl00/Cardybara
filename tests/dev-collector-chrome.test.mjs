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
import {boaCards} from '../extension-next/card-navigation.js';
import {discoverVisibleCards} from '../extension-next/discovery.js';
import {injectableStructureReport} from '../scripts/dev-collector/structure-report.js';
import {capturePage} from '../extension-next/agent-snapshot.js';

const extensionRoot=fileURLToPath(new URL('../extension-next',import.meta.url));
const manifest=JSON.parse(await readFile(join(extensionRoot,'manifest.json'),'utf8'));
const BANK='https://secure.chase.com/web/auth/dashboard#/dashboard/overview';
const until=async(fn,ms=25000)=>{const end=Date.now()+ms;for(;;){const v=await fn();if(v)return v;if(Date.now()>end)throw Error('until_timeout');await new Promise(r=>setTimeout(r,50));}};

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

test('generated Chase pages read the same however cards are named, counted or ordered',async()=>{
 const run=await start();
 const base=(tail,i)=>({internal:String(100+i),tail,balance:'$'+(10+i)+'.50',available:'$90.00',statement:'$4.25',closing:'$6.00',minimum:'$2.00',due:'Dec 3, 2031',points:String(1000+i)});
 const plain=[0,1].map(i=>({...base('300'+i,i),name:'Plain Card'}));
 const variants={renamed:plain.map((c,i)=>({...c,name:'Quokka Voyager '+i})),authorized:plain.map(c=>({...c,name:'Authorized User Card'})),business:plain.map(c=>({...c,name:'Zephyrine Business'})),reversed:[...plain].reverse(),many:Array.from({length:12},(_,i)=>({...base('40'+String(i).padStart(2,'0'),i),name:'Card '+i})),partner:plain.map(c=>({...c,name:'Plain Partner',partner:true,programme:'Zephyrine Trail Miles'}))};
 try{
  const {chrome}=run.adapter,events=[];chrome.tabs.onUpdated.addListener((id,c)=>events.push(c));
  const tab=await chrome.tabs.create({url:BANK,active:false});await until(()=>events.some(e=>e.status==='complete'));
  const exec=(func,args=[])=>chrome.scripting.executeScript({target:{tabId:tab.id},func,args}).then(r=>r[0].result);
  for(const [name,rows] of Object.entries(variants)){
   const mark=events.length;await exec(json=>{sessionStorage.setItem('synthetic-signed-in','1');sessionStorage.setItem('synthetic-cards',json);location.hash='#/dashboard/overview';location.reload();},[JSON.stringify(rows)]);
   await until(()=>events.slice(mark).some(e=>e.status==='complete'));await until(()=>exec(()=>/\/overview/.test(location.hash)&&!!document.getElementById('CARD_ACCOUNTS')));
   await chrome.scripting.executeScript({target:{tabId:tab.id},files:['reader.js']});
   const found=await exec(discoverVisibleCards,['Chase',['en-US']]);
   assert.deepEqual(found.cards.map(c=>c.tail),rows.map(r=>r.tail),name+': found every card and no checking account');
   const cards=rows.map(r=>({id:'c'+r.tail,bank:'Chase',tail:r.tail,currency:'USD'}));
   for(const row of rows.slice(0,3)){
    assert.deepEqual(await exec(chaseCards,['select',row.tail,cards]),[row.tail],name);
    const raw=await exec(capturePage,['Chase',cards,['c'+row.tail]]);assert.equal(raw.error,undefined,name);
    const got=Object.fromEntries(raw.observations.filter(i=>i.kind==='card').map(i=>[i.key,i.value]));
    assert.deepEqual(got,{balance:Number(row.balance.replace('$','')),statement:4.25,statementClosing:6,minimum:2},name+' '+row.tail);
    assert.ok(raw.observations.some(i=>i.key==='due'&&i.date==='2031-12-03'),name);
    const reward=raw.observations.find(i=>i.kind==='reward');
    if(row.partner){assert.equal(reward,undefined,name);assert.deepEqual(raw.notCollected,[{cardId:'C1',programme:'unnamed'}],name);}else assert.equal(reward.value,Number(row.points),name);
    await exec(()=>{location.hash='#/dashboard/overview';});await until(()=>exec(()=>!!document.getElementById('CARD_ACCOUNTS')));
   }
  }
  // Structure report: structure survives, and no name, tail or value does.
  const report=await exec(injectableStructureReport),dump=JSON.stringify(report);
  assert.ok(report.rows.length>0);assert.ok(dump.includes('accounts-name-link-button-#'));
  for(const secret of ['4000','4001','Card 0','10.50','$10','1000'])assert.ok(!dump.includes(secret),secret);
 }finally{await run.stop();}
});

test('collection scripts and the structure report still run under a strict page CSP',async()=>{
 const run=await start('csp');
 try{
  const {chrome}=run.adapter,events=[];chrome.tabs.onUpdated.addListener((id,c)=>events.push(c));
  const tab=await chrome.tabs.create({url:BANK,active:false});await until(()=>events.some(e=>e.status==='complete'));
  const exec=(func,args=[])=>chrome.scripting.executeScript({target:{tabId:tab.id},func,args}).then(r=>r[0].result);
  assert.equal(await exec(()=>1+1),2);
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['reader.js']});assert.equal(await exec(()=>typeof self.CardyReader?.read),'function');
  assert.equal((await exec(injectableStructureReport)).schema,1);
 }finally{await run.stop();}
});

for(const [bank,url,cards,want] of [
 ['Citi US','https://www.citi.com/',['2345','6789'],[{balance:1234.56,available:8765.44,statement:321,minimum:35,due:'2030-12-19'},{balance:67.89,available:4932.11,statement:0}]],
 ['SC HK','https://retail.sc.com/hk/nfs/login.htm',['4321','8765'],[{balance:1234.56,available:8765.44,statement:321,minimum:35,due:'2030-12-19'},{balance:67.89,available:4932.11,statement:0}]]
])test('capture scopes each '+bank+' card on one page and reads its billing fields',async()=>{
 const run=await start();
 try{
  const {chrome}=run.adapter,events=[];chrome.tabs.onUpdated.addListener((id,c)=>events.push(c));
  const tab=await chrome.tabs.create({url,active:false});await until(()=>events.some(e=>e.status==='complete'));
  const exec=(func,args=[])=>chrome.scripting.executeScript({target:{tabId:tab.id},func,args}).then(r=>r[0].result);
  await exec(()=>{document.getElementById('sign-in').click();});
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['reader.js']});
  const found=await exec(discoverVisibleCards,[bank,bank==='SC HK'?['zh-HK']:['en-US']]);assert.deepEqual([...new Set(found.cards.map(c=>c.tail))],cards);
  const list=cards.map(tail=>({id:'c'+tail,bank,tail,currency:bank==='SC HK'?'HKD':'USD'}));
  const raw=await exec(capturePage,[bank,list,[]]);assert.equal(raw.error,undefined);
  for(const [i,tail] of cards.entries()){
   const alias=raw.aliases.find(a=>a.cardId==='c'+tail).id,got=Object.fromEntries(raw.observations.filter(o=>o.cardId===alias&&o.key!=='paymentStatus').map(o=>[o.key,o.key==='due'?o.date:o.value]));
   assert.deepEqual(got,want[i],tail);
  }
  assert.ok(!raw.observations.some(o=>o.kind==='reward'),'rewards are out of scope for these banks');
  assert.ok(raw.observations.some(o=>o.key==='paymentStatus'&&o.cardId===raw.aliases.find(a=>a.cardId==='c'+cards[1]).id));
 }finally{await run.stop();}
});

test('BOA: cards come from the Credit cards group, and billing from each card\'s detail page',async()=>{
 const run=await start();
 try{
  const {chrome}=run.adapter,events=[];chrome.tabs.onUpdated.addListener((id,c)=>events.push(c));
  const tab=await chrome.tabs.create({url:'https://secure.bankofamerica.com/myaccounts/brain/redirect.go',active:false});await until(()=>events.some(e=>e.status==='complete'));
  const exec=(func,args=[])=>chrome.scripting.executeScript({target:{tabId:tab.id},func,args}).then(r=>r[0].result);
  let mark=events.length;await exec(()=>{document.getElementById('sign-in').click();});await until(()=>exec(()=>!!document.getElementById('account-card-container-1')).catch(()=>false));
  const found=await exec(discoverVisibleCards,['BOA',['en-US']]);assert.deepEqual(found.cards,[{tail:'1234',name:'Synthetic Numbat Visa'},{tail:'5678',name:'Synthetic Bilby Visa'}],'no deposit account');
  const cards=found.cards.map(c=>({id:'c'+c.tail,bank:'BOA',tail:c.tail,currency:'USD'}));
  assert.deepEqual(await exec(boaCards,['list',null]),['1234','5678']);
  for(const [tail,want] of [['1234',{balance:1234.56,available:8765.44,creditLimit:10000,minimum:35,statement:321}],['5678',{balance:67.89,available:4932.11,creditLimit:10000,statement:0}]]){
   const {href}=await exec(boaCards,['select',tail]);assert.match(href,/target=acctDetails/);
   mark=events.length;await chrome.tabs.update(tab.id,{url:href});await until(()=>events.slice(mark).some(e=>e.status==='complete'));await until(()=>exec(()=>!!document.getElementById('credit-1')).catch(()=>false));
   await chrome.scripting.executeScript({target:{tabId:tab.id},files:['reader.js']});
   const raw=await exec(capturePage,['BOA',cards,['c'+tail]]);assert.equal(raw.error,undefined,tail);assert.deepEqual(raw.aliases.map(a=>a.cardId),['c'+tail]);
   assert.deepEqual(Object.fromEntries(raw.observations.filter(o=>o.kind==='card').map(o=>[o.key,o.value])),want,tail);
   assert.equal(raw.observations.find(o=>o.key==='duePartial')?.title,tail==='1234'?'Dec 19':undefined,'the year is never assumed');assert.ok(!raw.observations.some(o=>o.key==='due'));
   mark=events.length;await chrome.tabs.update(tab.id,{url:'https://secure.bankofamerica.com/accounts-home/'});await until(()=>events.slice(mark).some(e=>e.status==='complete'));await until(()=>exec(()=>!!document.getElementById('account-card-container-1')).catch(()=>false));
  }
  assert.deepEqual(await exec(boaCards,['select','0001']),[],'a deposit account is not selectable');
  // A slow app: the document is ready long before the card list and the heading are.
  mark=events.length;await exec(()=>{sessionStorage.setItem('synthetic-slow','1');location.reload();});await until(()=>events.slice(mark).some(e=>e.status==='complete'));
  const slow=await exec(boaCards,['select','1234']);assert.match(slow.href,/card=1234/);
  mark=events.length;await chrome.tabs.update(tab.id,{url:slow.href});await until(()=>events.slice(mark).some(e=>e.status==='complete'));
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['reader.js']});
  const raw=await exec(capturePage,['BOA',cards,['c1234']]);assert.equal(raw.error,undefined);assert.ok(raw.observations.some(o=>o.key==='balance'));
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
