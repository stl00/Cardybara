import {BUILD_ID} from '../extension-next/build-info.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';import fs from 'node:fs';
import {Engine} from '../extension-next/engine.js';
import {allowed,guidedPage} from '../extension-next/providers.js';
import {request,trusted,validateRead,refreshCard} from '../extension-next/protocol.js';
import {collectorSnapshot} from '../src/collector.js';
const bankCards=[{id:'chase-one',bank:'Chase',tail:'1234',currency:'USD'},{id:'chase-two',bank:'Chase',tail:'5678',currency:'USD'}];
const input=(id='run-1',cards=bankCards,banks=['Chase'])=>({type:'refresh',requestId:id,banks,cards});
function fixture(){let saved;let fail=false;let n=0;const io={load:async()=>structuredClone(saved),save:async s=>{if(fail)throw Error('quota');saved=structuredClone(s);},uuid:()=>`token-${++n}`,now:()=>1800000000000};return {engine:new Engine(io),io,fail:v=>fail=v};}
async function capturing(f){await f.engine.start(input(),10);let c=await f.engine.claim();await f.engine.bind(c,20,false);await f.engine.loading(c);const s=await f.engine.capture(c);return {...c,...s.run.jobs[0]};}
const read=(id='chase-one',value=0)=>({status:'updated',patches:[{id,fields:{balance:value},locale:'en-US',capturedAt:new Date(1800000000000).toISOString()}]});
test('exact origin, top frame and bank region boundaries',()=>{assert.equal(trusted({tab:{id:1},frameId:0,url:'http://127.0.0.1:8766/#overview'}),true);for(const url of ['http://127.0.0.1:8767','https://example.com'])assert.equal(trusted({tab:{id:1},frameId:0,url}),false);assert.equal(trusted({tab:{id:1},frameId:1,url:'http://127.0.0.1:8766'}),false);assert.equal(allowed('Amex HK','https://www.americanexpress.com/en-us/account/login'),false);assert.equal(allowed('Amex HK','https://www.americanexpress.com/zh-hk/account/login'),true);assert.equal(allowed('Chase','https://secure.chase.com.evil.test/'),false);assert.equal(allowed('Chase','https://secure.chase.com/logout'),false);});
test('reject invalid, duplicate, oversized, foreign-card scopes',()=>{for(const m of [{...input(),banks:['unknown']},{...input(),cards:[...bankCards,bankCards[0]]},{...input(),cardId:'other'},{...input(),cards:[{...bankCards[0],currency:'HKD'}]},{...input(),password:'bad'},{...input(),requestId:'x'.repeat(73132)}])assert.throws(()=>request(m));assert.equal(request({...input(),cardId:'chase-one'}).cardId,'chase-one');});
test('duplicate starts serialize; single capture winner; exact card scope',async()=>{const f=fixture();const starts=await Promise.allSettled([f.engine.start(input(),10),f.engine.start(input('run-2'),10)]);assert.equal(starts.filter(x=>x.status==='fulfilled').length,1);const c=await f.engine.claim();await f.engine.bind(c,20,false);await f.engine.loading(c);const captures=await Promise.all([f.engine.capture(c),f.engine.capture(c)]);assert.equal(captures.filter(Boolean).length,1);const job=captures.find(Boolean).run.jobs[0];const result=validateRead({status:'updated',patches:[...read().patches,...read('chase-two',12).patches]},{...job,cardId:'chase-one'},f.io.now());assert.equal(result.patches.length,1);});
test('cancel then retry cannot accept old results or different owner cancel',async()=>{const f=fixture(),old=await capturing(f);await assert.rejects(f.engine.cancel(11));await f.engine.cancel(10);await f.engine.start(input('new-run'),10);assert.equal(await f.engine.finish(old,read()),null);assert.deepEqual((await f.engine.load()).records,{});});
test('worker restart interrupts pending and retains successful observations',async()=>{const f=fixture(),ctx=await capturing(f);await f.engine.finish(ctx,read('chase-one',21));await f.engine.start(input('new-run'),10);await f.engine.claim();const reboot=new Engine(f.io);const recovered=await reboot.recover();assert.equal(recovered.run.status,'interrupted');assert.equal(recovered.run.jobs[0].status,'interrupted');assert.equal(recovered.records.Chase['chase-one'].balance.value,21);assert.equal(await reboot.claim(),null);});
test('storage failure never commits success; unknown schema preserved',async()=>{const f=fixture(),ctx=await capturing(f);f.fail(true);await assert.rejects(f.engine.finish(ctx,read()));f.fail(false);const s=await f.engine.load();assert.deepEqual(s.records,{});assert.equal(s.run.jobs[0].status,'capturing');const e=new Engine({...f.io,load:async()=>({schema:999})});await assert.rejects(e.recover(),/unsupported_storage/);});
test('navigation generation, closed tab, timeout and stale capture rejection',async()=>{for(const status of ['navigation_changed','tab_closed','timeout']){const f=fixture(),ctx=await capturing(f);await f.engine.fail(ctx,status);assert.equal(await f.engine.finish(ctx,read()),null);assert.deepEqual((await f.engine.load()).records,{});}const f=fixture(),ctx=await capturing(f);await f.engine.finish({...ctx,navigation:999},read());assert.deepEqual((await f.engine.load()).records,{});});
test('0 is observed, missing remains unknown; stale fields and wrong currency rejected',async()=>{const f=fixture(),ctx=await capturing(f);const s=await f.engine.finish(ctx,read());const v=s.records.Chase['chase-one'].balance;assert.equal(v.value,0);assert.equal(v.currency,'USD');assert.equal(v.adapterVersion,'1.1.0');assert.equal(s.records.Chase['chase-one'].statement,undefined);for(const raw of [{status:'updated',patches:[{...read().patches[0],capturedAt:'2000-01-01T00:00:00Z'}]},read('foreign'),{status:'updated',patches:[{...read().patches[0],fields:{minimum:-2}}]}])assert.throws(()=>validateRead(raw,ctx,f.io.now()));});
test('disconnect prevents new jobs; clear removes bank records; export schema validates',async()=>{const f=fixture(),ctx=await capturing(f);await f.engine.finish(ctx,read('chase-one',8));let s=await f.engine.bank('Chase','disconnect',10);assert.equal(s.records.Chase,undefined);await assert.rejects(f.engine.start(input('again'),10),/disabled/);await f.engine.bank('Chase','connect',10);await f.engine.start(input('again'),10);s=await f.engine.load();const snap={schema:2,revision:s.revision,records:{},disabled:s.disabled,run:{id:s.run.id,status:s.run.status,jobs:s.run.jobs}};assert.deepEqual(collectorSnapshot(snap,bankCards).Chase.patches,[]);assert.equal(collectorSnapshot(snap,bankCards).Chase.status,'queued');assert.throws(()=>collectorSnapshot({...snap,records:{evil:{}}},bankCards));});
const context={self:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../extension-next/reader.js',import.meta.url),'utf8'),context);const parser=context.self.CardyReader;
test('English/French Canadian currency formats, negatives and separators',()=>{for(const [s,c,l,n]of [['-$23.74','USD','en-US',-23.74],['HK$-6,208.65','HKD','en-HK',-6208.65],['1 234,56 $','CAD','fr-CA',1234.56],['0.00','USD','en-US',0],['23.74 CR','USD','en-US',-23.74]])assert.equal(parser.money(s,c,l),n);for(const s of ['1,23.45','$not available','5000','CAD 9.00'])assert.equal(parser.money(s,'USD','en-US'),null);});
test('non-US adapter: Traditional/Simplified/English and safe dual currency handling',()=>{const card={id:'hk-test',tail:'4321',currency:'HKD'};for(const [label,locale]of [['現時結餘','zh-HK'],['当前余额','zh-CN'],['Current balance','en-HK']]){const p=parser.parseAccount(`Card 4321\n${label}\nHK$1,234.56`,'HSBC HK',card,locale,'2026-10-23T00:00:00Z');assert.equal(p.fields.balance,-1234.56);}assert.equal(parser.parseAccount('Card 4321\nCurrent balance\nHK$9.00\nCNY 1.00','HSBC HK',card,'en-HK','2026-10-23T00:00:00Z'),null);assert.equal(parser.parseAccount('Card 4321\nCurrent balance\nHK$9.00\nCurrent balance\nHK$8.00','HSBC HK',card,'en-HK','2026-10-23T00:00:00Z'),null);});
test('French Canadian labelled account and foreign tail produce isolated patches',()=>{const c={id:'ca-test',tail:'9876',currency:'CAD'};const p=parser.parseAccount('Card 9876\nSolde actuel\n1 234,56 $\nPaiement minimum\n25,00 $','Amex CA',c,'fr-CA','2026-10-23T00:00:00Z');assert.equal(p.fields.balance,1234.56);assert.equal(p.fields.minimum,25);assert.equal(parser.parseAccount('Card 1234\nSolde actuel\n1 234,56 $','Amex CA',c,'fr-CA','2026-10-23T00:00:00Z'),null);});
test('tail collisions and multi-account containers cannot select a card',()=>{const a={id:'a',tail:'1234'},b={id:'b',tail:'1234'},c={id:'c',tail:'5678'};assert.equal(parser.identify('ending 1234',[a,b]),null);assert.equal(parser.identify('ending 1234 and 5678',[a,c]),null);assert.equal(parser.identify('ending 12345',[a]),null);assert.equal(parser.identify('ending 1234',[a,c]),'a');});
test('deadline rejects a valid but late result even before an alarm fires',async()=>{const f=fixture(),ctx=await capturing(f);f.engine.io={...f.io,now:()=>1800000120000};const s=await f.engine.finish(ctx,read());assert.equal(s.run.jobs[0].status,'timeout');assert.deepEqual(s.records,{});});
test('Dashboard validates each observation and rejects unknown currency or adapter metadata',()=>{const f={value:7,currency:'USD',capturedAt:new Date().toISOString(),source:{issuer:'Chase',region:'US',page:'account-overview'},locale:'en-US',adapterVersion:'1.1.0',status:'observed'};const s={schema:2,revision:1,run:null,disabled:[],records:{Chase:{'chase-one':{balance:f}}}};assert.equal(collectorSnapshot(s,bankCards).Chase.patches[0].fields.balance,7);for(const patch of [{currency:'HKD'},{adapterVersion:'evil'},{status:'guessed'},{value:'7'},{capturedAt:'2000x'}])assert.throws(()=>collectorSnapshot({...s,records:{Chase:{'chase-one':{balance:{...f,...patch}}}}},bankCards));});
test('contradictory success fields on a failed read are rejected',()=>assert.throws(()=>validateRead({...read(),status:'needs_login'},{bank:'Chase',cards:bankCards,startedAt:1800000000000},1800000000000)));
test('bridge bootstraps after the Dashboard has already mounted',async()=>{const emitted=[],handlers={};const origin='http://127.0.0.1:8766';const window={postMessage:m=>emitted.push(m),addEventListener:(k,f)=>handlers[k]=f};window.top=window;const chrome={runtime:{sendMessage:async()=>({ok:true,version:'1.1.0',state:{schema:2}}),onMessage:{addListener:()=>{}}}};const c={window,chrome,location:{origin},crypto:{randomUUID:()=> 'boot'},JSON};vm.createContext(c);vm.runInContext(fs.readFileSync(new URL('../extension-next/dashboard.js',import.meta.url),'utf8'),c);await new Promise(r=>setImmediate(r));assert.equal(emitted[0].type,'ready');assert.equal(emitted[0].version,'1.1.0');assert.equal(emitted[0].state.schema,2);});
test('Chase DOM bindings isolate accounts even when labels are in Shadow DOM',()=>{const rows=[{name:'Example Freedom (...1234)',fields:{balance:'$12.00\nDetails',available:'Available credit\n$1,234.56',statement:'Last statement balance\n$8.00',minimum:'$4.00'}},{name:'Example Quest (...5678)',fields:{balance:'-$7.20\nDetails',available:'Available credit\n$200.00'}}];const r=parser.chaseBindings(rows,bankCards,'2026-10-23T00:00:00Z');assert.equal(r.patches.length,2);assert.equal(r.patches[0].fields.balance,12);assert.equal(r.patches[0].fields.minimum,4);assert.equal(r.patches[1].fields.balance,-7.2);assert.equal(r.patches[1].fields.minimum,undefined);assert.equal(parser.chaseBindings([...rows,rows[0]],bankCards,'2026-10-23T00:00:00Z').patches.length,1);assert.equal(parser.chaseBindings(rows,[{...bankCards[0],tail:'9999'}],'2026-10-23T00:00:00Z').patches.length,0);});
test('a stale complete event cannot start capture before the new loading event',async()=>{const f=fixture();await f.engine.start(input(),10);const ctx=await f.engine.claim();await f.engine.bind(ctx,20,false);assert.equal(await f.engine.capture(ctx),null);await f.engine.loading(ctx);assert.equal((await f.engine.capture(ctx)).run.jobs[0].status,'capturing');});

test('bank reload during capture retries new document and rejects old results and errors',async()=>{const f=fixture(),old=await capturing(f);const navigating=await f.engine.loading(old);const next={...old,...navigating.run.jobs[0]};assert.equal(next.status,'navigating');assert.ok(next.navigation>old.navigation);assert.equal(next.deadline,old.deadline);assert.equal(await f.engine.finish(old,read('chase-one',999)),null);assert.equal(await f.engine.fail(old,'load_error'),null);assert.equal(await f.engine.capture(old),null);const capture=await f.engine.capture(next);const current={...next,...capture.run.jobs[0]};await f.engine.finish(current,read('chase-one',12));assert.equal((await f.engine.load()).records.Chase['chase-one'].balance.value,12);});

test('guided retry is bound to original run and bank tab; stale/cancelled guides cannot read',async()=>{const f=fixture(),old=await capturing(f);await f.engine.finish(old,{status:'needs_login',patches:[]});const ref={runId:old.runId,attemptId:old.attemptId};await assert.rejects(f.engine.guide(ref,999,'read'));await assert.rejects(f.engine.guide({...ref,runId:'foreign'},20,'read'));const s=await f.engine.guide(ref,20,'read'),j=s.run.jobs[0];assert.equal(j.status,'navigating');assert.equal(j.loadStarted,true);assert.notEqual(j.attemptId,old.attemptId);assert.equal(await f.engine.finish(old,read('chase-one',999)),null);await f.engine.cancel(10);await assert.rejects(f.engine.guide({runId:s.run.id,attemptId:j.attemptId},20,'read'));});
test('guided login never blocks other banks and cannot preempt an active read',async()=>{const f=fixture();await f.engine.start(input('multi',[...bankCards,{id:'hk-one',bank:'HSBC HK',tail:'4321',currency:'HKD'}],['Chase','HSBC HK']),10);let ctx=await f.engine.claim();await f.engine.bind(ctx,20,false);await f.engine.loading(ctx);let c=await f.engine.capture(ctx);ctx={...ctx,...c.run.jobs[0]};await f.engine.finish(ctx,{status:'needs_login',patches:[]});assert.equal((await f.engine.claim()).bank,'HSBC HK');await assert.rejects(f.engine.guide({runId:ctx.runId,attemptId:ctx.attemptId},20,'read'),/busy/);});
test('stopping a guide preserves readings and prevents automatic retry',async()=>{const f=fixture(),old=await capturing(f);await f.engine.finish(old,read('chase-one',21));const ref={runId:old.runId,attemptId:old.attemptId};const s=await f.engine.guide(ref,20,'stop');assert.equal(s.records.Chase['chase-one'].balance.value,21);assert.equal(s.run.jobs[0].status,'cancelled');await assert.rejects(f.engine.guide(ref,20,'read'));});
test('guided retry expires and rejects a disconnected bank',async()=>{const f=fixture(),old=await capturing(f);await f.engine.finish(old,{status:'needs_login',patches:[]});const ref={runId:old.runId,attemptId:old.attemptId};f.engine.io={...f.io,now:()=>f.io.now()+900001};await assert.rejects(f.engine.guide(ref,20,'read'),/expired/);f.engine.io=f.io;await f.engine.bank('Chase','disconnect',10);await assert.rejects(f.engine.guide(ref,20,'read'));});
test('shared Amex overview is scoped to a bound guided bank, not arbitrary origins',()=>{assert.equal(guidedPage('Amex HK','https://global.americanexpress.com/overview'),true);for(const url of ['https://evil.test/overview','https://global.americanexpress.com/logout','https://global.americanexpress.com/anything','http://global.americanexpress.com/overview','https://global.americanexpress.com:444/overview'])assert.equal(guidedPage('Amex HK',url),false);assert.equal(guidedPage('Chase','https://global.americanexpress.com/overview'),false);});

test('equal tails on separate bank hosts retain their own registered identities',async()=>{const f=fixture();await f.engine.start(input('collision',[...bankCards,{id:'other-bank',bank:'BOA',tail:'1234',currency:'USD'}]),10);const s=await f.engine.load();assert.deepEqual(s.run.jobs[0].cards.map(c=>c.id),['chase-one','chase-two']);});

test('HK script locale tags resolve to the registered bank locales',()=>{
 assert.equal(parser.resolveLocale('zh-Hant-HK',['zh-HK','zh-CN','en-HK']),'zh-HK');
 assert.equal(parser.resolveLocale('en_HK',['zh-HK','zh-CN','en-HK']),'en-HK');
 assert.equal(parser.resolveLocale('fr-CA',['zh-HK','zh-CN','en-HK']),null);
 assert.equal(parser.resolveLocale('', ['zh-HK','en-HK']),null);
});
test('HK labels with punctuation, split currency and Amex Traditional labels',()=>{
 const c={id:'hk',tail:'4321',currency:'HKD'};
 const p=parser.parseAccount('Card 4321\n目前結餘：\nHKD\n1,234.56\n可用信用額\nHK$\n9,000.00\n最低還款金額：HK$25.00','Amex HK',c,'zh-HK','2026-10-23T00:00:00Z');
 assert.equal(p.fields.balance,1234.56);assert.equal(p.fields.available,9000);assert.equal(p.fields.minimum,25);
 const h=parser.parseAccount('Card 4321\n目前結餘 (港元)：\nHKD\n1,234.56','HSBC HK',c,'zh-HK','2026-10-23T00:00:00Z');assert.equal(h.fields.balance,-1234.56);
});
test('split currency must never let CNY or another field become an HKD balance',()=>{
 const c={id:'hk',tail:'4321',currency:'HKD'};
 for(const text of ['Card 4321\nCurrent balance\nCNY\n1,234.56','Card 4321\nCurrent balance\n1,234.56\nCAD','Card 4321\nCurrent balance\nAvailable credit\nHK$1,234.56']){
  const p=parser.parseAccount(text,'Amex HK',c,'en-HK','2026-10-23T00:00:00Z');assert.ok(!p||p.fields.balance===undefined);
 }
});
test('live HK Amex layout: total debt label and split decimal text',()=>{
 const c={id:'hk',tail:'4321',currency:'HKD'};
 for(const amount of ['HK$0 .00','HK$0\n.00']){
  const p=parser.parseAccount(`The Platinum Card\n•••• 4321\n月結單結欠\n${amount}\n總結欠\n${amount}\n可用信用額\nHK$54,321 .00`,'Amex HK',c,'zh-HK','2026-10-23T00:00:00Z');
  assert.equal(p.fields.balance,0);assert.equal(p.fields.statementClosing,0);assert.equal(p.fields.available,54321);
 }
 assert.equal(parser.money('HK$12 34.56','HKD','zh-HK'),null);
});
test('Amex active card heading binds separately placed widgets on long pages',()=>{
 const cards=[{id:'hk',bank:'Amex HK',tail:'4321',currency:'HKD'},{id:'other',bank:'Amex HK',tail:'9876',currency:'HKD'}];
 const body='The Platinum Card\n•••• 4321\n總結欠\nHK$0 .00\n可用信用額\nHK$54,321 .00\n'+'Unrelated offer text\n'.repeat(1000);
 const p=parser.parseAmexOverview(body,'The Platinum Card\n•••• 4321',cards,'zh-HK','2026-10-23T00:00:00Z');assert.equal(p.fields.balance,0);assert.equal(p.fields.available,54321);
 assert.equal(parser.parseAmexOverview(body,'The Platinum Card',cards,'zh-HK','2026-10-23T00:00:00Z'),null);
 assert.equal(parser.parseAmexOverview(body+'\nOther card 9876','•••• 4321',cards,'zh-HK','2026-10-23T00:00:00Z'),null);
});
test('Amex DOM renders currency, integer and cents as three separate lines',()=>{
 const card={id:'hk',tail:'4321',currency:'HKD'};
 const p=parser.parseAccount('Card 4321\n總結欠\nHK$\n0\n.00\n月結單結欠\nHK$\n0\n.00\n可用信用額\nHK$\n54,321\n.00','Amex HK',card,'zh-HK','2026-10-23T00:00:00Z');
 assert.equal(p.fields.balance,0);assert.equal(p.fields.statementClosing,0);assert.equal(p.fields.available,54321);
});
test('live Amex tooltip helper text between labels and their monetary values',()=>{
 const c={id:'hk',tail:'4321',currency:'HKD'};
 const p=parser.parseAccount('Card 4321\n月結單結欠\nMore info on statement_balance_tooltip\nHK$0.00\n總結欠\nMore info on total_balance_tooltip\nHK$0.00\n可用信用額\nMore info on available_credit_tooltip\nHK$54,321.00','Amex HK',c,'zh-HK','2026-10-23T00:00:00Z');
 assert.equal(p.fields.balance,0);assert.equal(p.fields.statementClosing,0);assert.equal(p.fields.available,54321);assert.equal(p.fields.minimum,undefined);
});
test('HSBC account-row Balance label, trailing currency and debt convention',()=>{
 const card={id:'hsbc',tail:'4321',currency:'HKD'};
 for(const [value,expected]of [['-1,585.69 HKD',1585.69],['6,208.65 HKD',-6208.65],['0.00 HKD',0]]){
  const p=parser.parseAccount(`HSBC Credit Card\nAccount ending 4321\nBalance\n${value}`,'HSBC HK',card,'en-HK','2026-10-23T00:00:00Z');assert.equal(p.fields.balance||0,expected);
 }
 assert.equal(parser.parseAccount('Card 4321\nBalance\n9.00 HKD','Amex HK',card,'en-HK','2026-10-23T00:00:00Z'),null);
});
test('stored readings retain their card count after a different bank run replaces the job',()=>{
 const now=new Date().toISOString();
 const snapshot={schema:2,revision:1,disabled:[],run:null,records:{Chase:{'chase-one':{balance:{value:0,currency:'USD',capturedAt:now,status:'observed',source:{issuer:'Chase',region:'US',page:'account-overview'},locale:'en-US',adapterVersion:'1.1.0'}}}}};
 const live=collectorSnapshot(snapshot,bankCards);assert.equal(live.Chase.receivedCount,1);assert.equal(live.Chase.patches[0].fields.balance,0);
});
test('return-to-bank command accepts a registered bank but never an arbitrary tab ID',()=>{
 assert.equal(request({type:'focus-bank',requestId:'return-bank',bank:'Chase'}).bank,'Chase');
 assert.throws(()=>request({type:'focus-bank',requestId:'return-bank',bank:'Chase',tabId:999}));
 assert.throws(()=>request({type:'focus-bank',requestId:'return-bank',bank:'unknown'}));
});
test('registered offer lists are read-only destinations while enrollment actions remain forbidden',()=>{
 assert.equal(guidedPage('Amex CA','https://global.americanexpress.com/offers/enrolled'),true);
 for(const path of ['/offers/enroll','/offers/enrolled/activate','/payments/pay'])assert.equal(guidedPage('Amex CA','https://global.americanexpress.com'+path),false);
});

import {exportCollectorState} from '../extension-next/export-state.js';
test('extension export includes reward observations and task progress while excluding settings and keys',()=>{
 const state={records:{Chase:{card:{balance:{value:0,capturedAt:'2026-10-27T23:00:36Z'}}}},agentRecords:[{bank:'Chase',kind:'reward',cardId:'card',value:35612,capturedAt:'2026-10-27T23:01:00Z'}],run:{status:'complete',jobs:[{bank:'Chase',sections:{reward:{status:'partial',count:1}}}]},revision:10,settings:{key:'SECRET'},apiKey:'SECRET'};
 const exported=exportCollectorState(state,'2026-10-27T23:02:00Z');assert.equal(exported.agentRecords[0].value,35612);assert.equal(exported.run.jobs[0].sections.reward.status,'partial');assert.equal(exported.records.Chase.card.balance.value,0);assert.equal(exported.records.Chase.card.balance.capturedAt,'2026-10-27T23:00:36Z');assert.ok(!JSON.stringify(exported).includes('SECRET'));exported.agentRecords[0].value=1;assert.equal(state.agentRecords[0].value,35612);
});

test('verified per-card reward completion survives worker restart while old unscoped status migrates',async()=>{
 const f=fixture(),ctx=await capturing(f);await f.engine.finish(ctx,read(),{items:[],pages:5,sections:{reward:{status:'updated',count:2,readCards:2,expectedCards:2}},error:null});const reboot=new Engine(f.io);assert.equal((await reboot.recover()).run.jobs[0].sections.reward.status,'updated');
 const old=await f.engine.load();delete old.run.jobs[0].sections.reward.readCards;await f.io.save(old);assert.equal((await reboot.recover()).run.jobs[0].sections.reward.status,'partial');
});
test('later bank runs preserve the previous partial read diagnostic in complete exports',async()=>{
 const f=fixture(),ctx=await capturing(f);await f.engine.finish(ctx,read(),{items:[],pages:4,sections:{reward:{status:'partial',count:1}},error:'card_not_identified'});await f.engine.start(input('later-run'),10);const out=exportCollectorState(await f.engine.load());assert.equal(out.lastBankJobs.Chase.readError,'card_not_identified');assert.equal(out.lastBankJobs.Chase.sections.reward.count,1);
});

test('export distinguishes the executing worker build from the popup build',()=>{
 const old=exportCollectorState({records:{},agentRecords:[]});assert.equal(old.runtimeBuild,null);assert.equal(old.exporterBuild,BUILD_ID);const current=exportCollectorState({runtimeBuild:BUILD_ID});assert.equal(current.runtimeBuild,current.exporterBuild);
});

test('a refresh carries a checked card name to the job, so reward coverage can match a co-brand',async()=>{
 const named=[{...bankCards[0],name:'Sapphire Preferred® Card'},bankCards[1]];
 assert.deepEqual(request(input('named',named)).cards[0].name,'Sapphire Preferred® Card');
 for(const name of ['','x'.repeat(101),'<b>Card</b>','Card 1234 5678 9012 3456',42])assert.throws(()=>request(input('bad-name',[{...bankCards[0],name}])),/invalid_card/,String(name));
 // The wallet sends a name only when it passes the same check; anything else is left out rather than failing the refresh.
 assert.deepEqual(refreshCard({...bankCards[0],name:'Card 1234 5678 9012 3456',art:'x.png'}),bankCards[0]);
 assert.deepEqual(refreshCard({...bankCards[0],name:'Freedom Card'}),{...bankCards[0],name:'Freedom Card'});
 const f=fixture();const s=await f.engine.start(input('named',named),10);assert.equal(s.run.jobs[0].cards[0].name,'Sapphire Preferred® Card');
});
