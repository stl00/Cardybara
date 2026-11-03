import test from 'node:test';
import assert from 'node:assert/strict';
import {newWalletCard,mergeWalletCards} from '../src/walletRegistry.js';
import {PROVIDERS} from '../extension-next/providers.js';
import {request} from '../extension-next/protocol.js';
import {normalizeDiscoveredCards,discoverVisibleCards} from '../extension-next/discovery.js';
import {Engine} from '../extension-next/engine.js';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('a brand-new wallet can connect each bank without importing a backup',()=>{
 for(const bank of Object.keys(PROVIDERS)){
  assert.equal(request({type:'refresh',requestId:'fresh-user',banks:[bank],cards:[]}).banks[0],bank);
  const card=newWalletCard({bank,name:'My credit card',tail:'1234'});
  assert.equal(card.currency,PROVIDERS[bank].currency);assert.equal(card.region,PROVIDERS[bank].region);
  assert.equal(card.balance,undefined);assert.equal(card.minimum,undefined);assert.equal(card.updated,undefined);
 }
 assert.throws(()=>request({type:'refresh',requestId:'x',banks:['unknown'],cards:[]}));
 assert.throws(()=>request({type:'refresh',requestId:'x',banks:['Chase'],cards:[],cardId:'missing'}));
});
test('manual identity validates only masked tails, preserves observed data, and scopes duplicates by bank',()=>{
 const card=newWalletCard({bank:'Chase',name:'Sapphire Reserve',tail:'1234'},'manual-one');
 const base={cards:[{...card,balance:98,fieldDates:{balance:'2026-10-20'}}]};
 const duplicate={...card,id:'discovered-chase-1234',name:'Different display name'};
 const other=newWalletCard({bank:'Amex US',name:'Gold',tail:'1234'},'other-one');
 const merged=mergeWalletCards(base,[duplicate,other]);assert.equal(merged.cards.length,2);assert.equal(merged.cards[0].balance,98);
 for(const fields of [{tail:'1234567890123456'},{tail:'12'},{name:'1234 5678 9012 3456'},{name:'<script>'},{bank:'Unknown'}])assert.throws(()=>newWalletCard({bank:'Chase',name:'Test card',tail:'1234',...fields}));
});
test('discovery never creates monetary values or replaces existing card identities',async()=>{
 let saved;const io={load:async()=>saved,save:async s=>saved=structuredClone(s),uuid:()=>crypto.randomUUID(),now:()=>Date.now()};
 const e=new Engine(io);await e.start({type:'refresh',requestId:'new-user',banks:['Chase'],cards:[]},1);
 const claim=await e.claim();let state=await e.bind(claim,2,true);const j=state.run.jobs[0];await e.loading({...j,generation:state.run.generation});state=await e.capture({...j,generation:state.run.generation});
 const ctx={...state.run.jobs[0],generation:state.run.generation};
 state=await e.discover(ctx,[{tail:'1234',name:'Sapphire Reserve (...1234)'},{tail:'1234',name:'Sapphire Reserve (...1234)'}]);
 assert.equal(state.discoveredCards.length,1);assert.equal(state.run.jobs[0].cards.length,1);assert.deepEqual(state.records,{});
 const restarted=new Engine(io);const recovered=await restarted.recover();assert.equal(recovered.run.status,'interrupted');assert.equal(recovered.discoveredCards[0].tail,'1234');
 assert.equal(await restarted.discover(ctx,[{tail:'5678',name:'Other'}]),null);
});
test('discovery rejects unsafe payloads and separates countries with equal tails',()=>{
 const rows=[{tail:'12345',name:'Platinum •••• 12345'},{tail:'1234567890123456',name:'Unsafe'},{tail:'7777',name:'Full 1234 5678 9012 3456'},{tail:'8888',name:'Wrong',balance:0}];
 const hk=normalizeDiscoveredCards('Amex HK',rows),ca=normalizeDiscoveredCards('Amex CA',rows);assert.equal(hk.length,1);assert.equal(hk[0].currency,'HKD');assert.notEqual(hk[0].id,ca[0].id);
 assert.throws(()=>normalizeDiscoveredCards('Unknown',[]));
});
test('DOM discovery ignores login fields, full numbers, deposit accounts and wrong Amex region',()=>{
 const el=text=>({innerText:text,getClientRects:()=>[{}]});let login=false;
 globalThis.getComputedStyle=()=>({visibility:'visible'});
 globalThis.document={documentElement:{lang:'en-US'},querySelectorAll:selector=>selector==='input[type=password]'?(login?[el('')]:[]):selector==='*'?[]:[el('Sapphire Reserve (...1234)'),el('Checking (...9999)'),el('Credit card 1234567890123456 •••• 1111')]};
 assert.deepEqual(discoverVisibleCards('Chase',['en-US']),{status:'found',cards:[{tail:'1234',name:'Sapphire Reserve (...1234)'}]});
 assert.equal(discoverVisibleCards('Amex HK',['en-HK']).status,'ambiguous');
 login=true;assert.equal(discoverVisibleCards('Chase',['en-US']).status,'needs_login');
 delete globalThis.document;delete globalThis.getComputedStyle;
});
test('extension bridge correlates failed worker replies so the refresh button can recover',async()=>{
 const code=readFileSync(new URL('../src/extensionBridge.js',import.meta.url),'utf8');
 for(const failure of ['reject','reply']){
  let receive;const sent=[],origin='chrome-extension://'+'a'.repeat(32);
  const window={postMessage:m=>sent.push(m),addEventListener:(name,fn)=>receive=fn};
  const chrome={runtime:{id:'a'.repeat(32),onMessage:{addListener:()=>{}},sendMessage:async()=>{if(failure==='reject')throw Error('worker unavailable');return {ok:false,error:'storage full'};}},tabs:{getCurrent:async()=>({id:1})}};
  vm.runInNewContext(code,{window,location:{origin,protocol:'chrome-extension:'},chrome});
  await receive({source:window,origin,data:{channel:'cardybara-dashboard',type:'refresh',requestId:'fresh-user-request'}});
  assert.equal(sent[0].ok,false);assert.equal(sent[0].requestId,'fresh-user-request');
 }
});
test('Chase discovers every product in the credit-card group, including IHG and nicknames, but never deposits',()=>{
 const el=text=>({innerText:text,getClientRects:()=>[{}]});const credits=[el('IHG Premier (...2345)'),el('My daily spending (...3456)')];
 globalThis.getComputedStyle=()=>({visibility:'visible'});
 globalThis.document={documentElement:{lang:'en-US'},getElementById:id=>id==='CARD_ACCOUNTS'?{}:null,querySelectorAll:s=>s==='input[type=password]'||s==='*'?[]:s.startsWith('#CARD_ACCOUNTS')?credits:[...credits,el('CHASE CHECKING (...4567)')]};
 assert.deepEqual(discoverVisibleCards('Chase',['en-US']).cards.map(c=>c.tail),['2345','3456']);
 delete globalThis.document;delete globalThis.getComputedStyle;
});
test('bank guide resumes a new wallet after login without already knowing its card tails',()=>{
 const el=text=>({innerText:text,getClientRects:()=>[{}]});let password=true;
 const doc={body:{innerText:'Credit cards\nIHG Premier (...2345)'},querySelectorAll:s=>s==='input[type=password]'?(password?[el('')]:[]):s.startsWith('#CARD_ACCOUNTS')?[el('IHG Premier (...2345)')]:[]};
 const c={self:{CardyGuide:{mount:()=>{throw Error('old guide')}}},getComputedStyle:()=>({visibility:'visible'})};vm.createContext(c);vm.runInContext(readFileSync(new URL('../extension-next/guide.js',import.meta.url),'utf8'),c);assert.equal(c.self.CardyGuide.build,'new-user-2');
 assert.equal(c.cardyGuidePageReady({bank:'Chase',tails:[]},doc),false);password=false;
 assert.equal(c.cardyGuidePageReady({bank:'Chase',tails:[]},doc),true);
 assert.equal(c.cardyGuidePageReady({bank:'Chase',tails:['9999']},doc),false);
 // The guide recognises the masked forms discovery accepts, on any bank.
 for(const [text,ready] of [['Visa ending in 1234',true],['信用卡 尾號 1234',true],['Visa 1234',false]])assert.equal(c.cardyGuidePageReady({bank:'BOA',tails:[]},{body:{innerText:text},querySelectorAll:s=>s==='input[type=password]'?[]:[el(text)]}),ready,text);
 assert.equal(c.cardyGuidePageReady({bank:'Chase',tails:['2345']},doc),true);
 doc.querySelectorAll=()=>[];assert.equal(c.cardyGuidePageReady({bank:'Chase',tails:[]},doc),false);
});
