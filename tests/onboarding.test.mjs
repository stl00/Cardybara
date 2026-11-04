import test from 'node:test';
import assert from 'node:assert/strict';
import {newWalletCard,mergeWalletCards,withoutRemoved,withoutRemovedCards,removeWalletCard,liftRemoval,pendingRemovals,withoutLiveCard} from '../src/walletRegistry.js';
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
 assert.deepEqual(discoverVisibleCards('Chase',['en-US']),{status:'found',cards:[{tail:'1234',name:'Sapphire Reserve (...1234)'}],skipped:1});
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
 // SC HK prints no masked tail: signed-in pages are ready with or without registered cards, and a code prompt is not.
 const previousLocation=c.location;
 for(const [path,text,tails,ready] of [['/hk/nfs/ibank/landing.htm','Welcome',[],true],['/hk/nfs/ibank/landing.htm','Welcome',['4321'],true],['/hk/nfs/login.htm','Sign in',['4321'],false],['/hk/nfs/ibank/landing.htm','Enter your one-time password',['4321'],false]]){c.location={pathname:path};assert.equal(c.cardyGuidePageReady({bank:'SC HK',tails},{body:{innerText:text},querySelectorAll:()=>[]}),ready,path+text);}
 c.location=previousLocation;
 // The guide recognises the masked forms discovery accepts, on any bank.
 for(const [text,ready] of [['Visa ending in 1234',true],['信用卡 尾號 1234',true],['Visa 1234',false],['Pending 1234',false],['Spending 2030',false]])assert.equal(c.cardyGuidePageReady({bank:'BOA',tails:[]},{body:{innerText:text},querySelectorAll:s=>s==='input[type=password]'?[]:[el(text)]}),ready,text);
 assert.equal(c.cardyGuidePageReady({bank:'Chase',tails:['2345']},doc),true);
 doc.querySelectorAll=()=>[];assert.equal(c.cardyGuidePageReady({bank:'Chase',tails:[]},doc),false);
});

test('Amex Canada is archived: off by default, code kept, and a wallet holding it keeps its records',async()=>{
 const {ACTIVE_BANKS,PROVIDERS}=await import('../extension-next/providers.js'),{visibleConnections,defaultRefreshBanks,newWalletCard,mergeWalletCards:merge,selectableBanks}=await import('../src/walletRegistry.js'),{REQUIRED_BANKS}=await import('../scripts/acceptance.mjs');
 const seed=JSON.parse(readFileSync(new URL('../public/data.example.json',import.meta.url),'utf8'));
 assert.ok(PROVIDERS['Amex CA'].archived);assert.ok(!ACTIVE_BANKS.includes('Amex CA'));assert.ok(!REQUIRED_BANKS.includes('Amex CA'));
 assert.ok(!seed.connections.some(c=>c.bank==='Amex CA'));assert.ok(!readFileSync(new URL('../scripts/package-standalone.py',import.meta.url),'utf8').includes("'Amex CA'"));
 for(const file of ['../src/WalletOnboarding.jsx','../src/CollectorPanel.jsx'])assert.match(readFileSync(new URL(file,import.meta.url),'utf8'),/ACTIVE_BANKS\.map/,file);
 const connections=[{bank:'Amex CA'},{bank:'Chase'}],held={id:'x',bank:'Amex CA'},chase={id:'y',bank:'Chase'};
 assert.deepEqual(visibleConnections({connections,cards:[chase]}).map(c=>c.bank),['Chase'],'hidden with no card');
 assert.deepEqual(visibleConnections({connections,cards:[held,chase]}).map(c=>c.bank),['Amex CA','Chase'],'kept for a holder');
 assert.deepEqual(defaultRefreshBanks([held,chase]),['Chase'],'never in a refresh-all');
 assert.equal(newWalletCard({bank:'Amex CA',name:'Existing Card',tail:'12345'}).bank,'Amex CA','an existing record stays valid');
 // An upgraded seed has no row for the bank; the wallet restores it from the held card, and only then.
 const card=newWalletCard({bank:'Amex CA',name:'Existing Card',tail:'12345'},'held-ca'),upgraded=merge({cards:[],connections:seed.connections},[card]);
 assert.deepEqual(visibleConnections(upgraded).map(c=>c.bank).filter(b=>b==='Amex CA'),['Amex CA']);assert.equal(upgraded.cards[0].id,'held-ca');
 assert.ok(!visibleConnections(merge({cards:[],connections:seed.connections},[])).some(c=>c.bank==='Amex CA'));
 // A wallet saved before a new bank was added still gets its row.
 assert.ok(merge({cards:[],connections:[{bank:'Chase'}]},[]).connections.some(c=>c.bank==='Citi US'));
 assert.match(readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8'),/getBankNames=\(\)=> \(\{'Citi US':'Citi'/,'Citi is in the wallet filter');
 assert.deepEqual(defaultRefreshBanks([held]),[],'only archived cards leave nothing to refresh');
 assert.deepEqual(selectableBanks(['Amex CA','Chase'],[chase]),['Chase']);assert.deepEqual(selectableBanks(['Amex CA','Chase'],[held]),['Amex CA','Chase']);
 for(const [file,use] of [['../src/main.jsx',/defaultRefreshBanks\(data\.cards\);if\(!banks\.length\)/],['../src/main.jsx',/selectableBanks\(Object\.keys\(bankNames\)/],['../src/BankConnections.jsx',/visibleConnections\(data\)\.map/],['../src/AgentPanel.jsx',/visibleConnections\(data\)\.map/]])assert.match(readFileSync(new URL(file,import.meta.url),'utf8'),use,file);
});

function engine(){let saved;const io={load:async()=>saved,save:async s=>saved=structuredClone(s),uuid:()=>crypto.randomUUID(),now:()=>Date.now()};return new Engine(io);}
const held=(id,bank,tail)=>({id,bank,tail,currency:PROVIDERS[bank].currency});
const reading=at=>({value:1,currency:'USD',status:'observed',capturedAt:at});
async function discoverOnce(e,cards,rows,owner=1){await e.start({type:'refresh',requestId:crypto.randomUUID(),banks:['Chase'],cards},owner);const job=await e.claim();const ctx={generation:(await e.load()).run.generation,attemptId:job.attemptId};const state=await e.discover(ctx,rows);await e.cancel(owner);return state;}
test('removing a card clears its records and discovery, and leaves every other card alone',async()=>{
 const e=engine();await discoverOnce(e,[],[{tail:'1111',name:'False find'},{tail:'2222',name:'Real find'}]);
 const s=await e.load(),at=new Date().toISOString();
 s.records={Chase:{'discovered-chase-1111':{balance:reading(at)},'discovered-chase-2222':{balance:reading(at)}},'Amex US':{'discovered-chase-1111':{balance:reading(at)}}};
 s.agentRecords=[{bank:'Chase',cardId:'discovered-chase-1111',key:'a'},{bank:'Chase',cardId:'discovered-chase-2222',key:'b'},{bank:'Amex US',cardId:'discovered-chase-1111',key:'c'}];
 await e.io.save(s);
 const after=await e.removeCard({bank:'Chase',cardId:'discovered-chase-1111',tail:'1111'},1);
 assert.deepEqual(after.discoveredCards.map(c=>c.tail),['2222']);
 assert.deepEqual(Object.keys(after.records.Chase),['discovered-chase-2222'],'the other card keeps its readings');
 assert.ok(after.records['Amex US']['discovered-chase-1111'],'another bank is untouched');
 assert.deepEqual(after.agentRecords.map(i=>i.key),['b','c']);
 const last=await e.removeCard({bank:'Chase',cardId:'discovered-chase-2222',tail:'2222'},1);assert.equal(last.records.Chase,undefined);
});
test('a removed false discovery does not return, but the same tail held in the wallet still reads',async()=>{
 const e=engine();await discoverOnce(e,[],[{tail:'1111',name:'False find'}]);
 await e.removeCard({bank:'Chase',cardId:'discovered-chase-1111',tail:'1111'},1);
 const again=await discoverOnce(e,[],[{tail:'1111',name:'False find'},{tail:'3333',name:'New find'}]);
 assert.deepEqual(again.discoveredCards.map(c=>c.tail),['3333']);assert.deepEqual(again.run.jobs[0].cards.map(c=>c.tail),['3333']);
 const manual=held('manual-one','Chase','1111');
 const added=await discoverOnce(e,[manual],[{tail:'1111',name:'Now real'}]);
 assert.deepEqual(added.run.jobs[0].cards.map(c=>c.id),['manual-one']);
});
test('a card cannot be removed while its bank is being read, or by a tab that does not own the run',async()=>{
 const e=engine();await e.start({type:'refresh',requestId:'run-one',banks:['Chase'],cards:[held('a','Chase','1111')]},1);
 await assert.rejects(e.removeCard({bank:'Chase',cardId:'a',tail:'1111'},1),/busy/);
 await assert.rejects(e.removeCard({bank:'Chase',cardId:'a',tail:'1111'},2),/not_run_owner/);
 const other=await e.removeCard({bank:'Amex US',cardId:'b',tail:'2222'},1);assert.equal(other.run.status,'running');
});
test('a same-bank duplicate tail excluded at start is not added back by discovery',async()=>{
 const e=engine(),state=await discoverOnce(e,[held('a','Chase','1111'),held('b','Chase','1111'),held('c','Chase','2222')],[{tail:'1111',name:'Either card'},{tail:'2222',name:'Other'},{tail:'4444',name:'New'}]);
 const job=state.run.jobs[0];
 assert.deepEqual(job.cards.map(c=>c.id),['c','discovered-chase-4444']);assert.deepEqual(job.excludedTails,['1111']);
 assert.deepEqual(state.discoveredCards.map(c=>c.tail),['4444']);
 const e2=engine(),other=await discoverOnce(e2,[held('a','Amex US','1111'),held('b','Amex US','1111')],[{tail:'1111',name:'Different bank, same tail'}]);
 assert.deepEqual(other.discoveredCards.map(c=>c.tail),['1111'],'scoped to the bank');
});
test('the protocol accepts a removal only for one well-formed card',()=>{
 const m={type:'remove-card',requestId:'remove-one',bank:'Chase',cardId:'card-1',tail:'1234'};assert.equal(request(m).cardId,'card-1');
 for(const change of [{bank:'Unknown'},{cardId:'../x'},{tail:'12'},{tail:'1234567890123456'},{extra:1}])assert.throws(()=>request({...m,...change}),JSON.stringify(change));
});
test('the wallet keeps a removal through reloads and discovery until the user adds the card back',()=>{
 const manual=newWalletCard({bank:'Chase',name:'Mistyped',tail:'1234'},'manual-one'),keep=newWalletCard({bank:'Chase',name:'Keep',tail:'5678'},'manual-two'),seed={id:'seed-one',bank:'Chase',tail:'9999',name:'Seed',region:'US',currency:'USD'};
 const first=removeWalletCard([manual,keep],[],manual);assert.deepEqual(first.registry.map(c=>c.id),['manual-two']);
 const next=removeWalletCard(first.registry,first.removed,seed);
 const base={cards:[seed,keep,{...seed,id:'seed-two',tail:'1234'}],connections:[]},kept=withoutRemoved(base,next.removed).cards.map(c=>c.id);
 assert.deepEqual(kept,['manual-two','seed-two'],'a seed row hides by id, and another held card sharing the tail stays');
 const found={id:'discovered-chase-1234',bank:'Chase',tail:'1234',identitySource:'bank-page'},other={...found,id:'discovered-chase-1111',tail:'1111'};
 assert.deepEqual(withoutRemovedCards([found,other],next.removed).map(c=>c.id),['discovered-chase-1111'],'late discovery does not bring it back');
 assert.deepEqual(liftRemoval(next.removed,[{bank:'Chase',tail:'1234'}]).map(r=>r.id),['seed-one'],'adding the tail back lifts only that removal');
 assert.deepEqual(pendingRemovals({records:{Chase:{'manual-one':{}}},discoveredCards:[]},next.removed).map(r=>r.id),['manual-one']);
 assert.deepEqual(pendingRemovals({records:{},discoveredCards:[{bank:'Chase',tail:'9999'}]},next.removed).map(r=>r.id),['seed-one']);
 assert.deepEqual(pendingRemovals({records:{},discoveredCards:[]},next.removed),[],'applied removals are not sent again');
 assert.deepEqual(pendingRemovals({run:{status:'running'},records:{Chase:{'manual-one':{}}},discoveredCards:[]},next.removed),[],'not sent during a run, when the worker would refuse');
 const typed=newWalletCard({bank:'Chase',name:'Correct name',tail:'9999'},'manual-new');assert.deepEqual(mergeWalletCards(withoutRemoved({cards:[seed]},next.removed),[typed]).cards.map(c=>c.id),['manual-new'],'a manual add of a removed seed tail shows the new card, not the seed row');
 const hidden={id:'discovered-chase-9999',bank:'Chase',tail:'9999',identitySource:'bank-page'};assert.deepEqual(removeWalletCard([hidden,keep],[],seed).registry.map(c=>c.id),['manual-two'],'a registry row hidden by the removed card goes with it');
 const live={Chase:{status:'updated',patches:[{id:'manual-one'},{id:'manual-two'}]}};assert.deepEqual(withoutLiveCard(live,manual).Chase.patches,[{id:'manual-two'}]);assert.equal(withoutLiveCard(live,seed),live);
});
test('the removal message reaches the worker through the page bridge',()=>{
 for(const bridge of ['extension-next/dashboard.js','scripts/dev-collector/page-bridge.js'])assert.match(readFileSync(bridge,'utf8'),/'remove-card'/,bridge);assert.match(readFileSync('extension-next/background.js','utf8'),/m\.type==='remove-card'/);
});
