// Executes the production MV3 worker with synthetic Chrome/page adapters only.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {STATE_KEY} from '../extension-next/engine.js';import {PARSER_SETTINGS} from '../extension-next/parser-client.js';
const f=JSON.parse(fs.readFileSync(new URL('./fixtures/banks/amex-hk-mvp.json',import.meta.url))),sandbox={self:{}};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(new URL('../extension-next/reader.js',import.meta.url),'utf8'),sandbox);const reader=sandbox.self.CardyReader;
async function runFlow(failStatements=false,incompleteBilling=false){
 const cards=[f.card,{id:'another-unseen-product',bank:'Amex HK',tail:'24680',currency:'HKD'}];let receive,selected=cards[0],href='https://global.americanexpress.com/dashboard',doc=1;const store={[PARSER_SETTINGS]:{scope:'mvp',enabled:false}},listeners={},visits=[],phases=[];const own='chrome-extension://hk-worker/index.html',listener=n=>({addListener:fn=>listeners[n]=fn});
 globalThis.chrome={runtime:{id:'hk-worker',getURL:p=>'chrome-extension://hk-worker/'+p,onMessage:{addListener:f=>receive=f},sendMessage:async()=>{}},permissions:{contains:async()=>false},storage:{local:{get:async k=>({[k]:store[k]}),set:async v=>{Object.assign(store,structuredClone(v));if(v[STATE_KEY]?.run?.jobs[0]?.phase)phases.push(v[STATE_KEY].run.jobs[0].phase)},remove:async k=>delete store[k],setAccessLevel:async()=>{}}},alarms:{onAlarm:listener('alarm'),create:async()=>{}},tabs:{onUpdated:listener('updated'),onRemoved:listener('removed'),query:async()=>[{id:2,url:href}],get:async id=>({id,url:id===1?own:href,status:'complete'}),update:async(id,o)=>{if(o.url){if(failStatements&&selected===cards[0]&&new URL(o.url).pathname==='/activity/statements')throw Error('navigation_timeout');href=o.url;doc++;visits.push({path:new URL(href).pathname,card:selected.id});listeners.updated?.(2,{status:'loading'},{id:2,url:href});listeners.updated?.(2,{status:'complete'},{id:2,url:href})}return {id,url:href}},sendMessage:async()=>{}},scripting:{executeScript:async o=>{
  if(o.files)return [{documentId:'doc'+doc}];
  if(o.func?.name==='amexClickReadLink')return [{result:false}];
  if(o.func?.name==='renderedBankPage')return [{result:{href,ready:true}}];
  if(o.func?.name==='amexCards'){if(o.args[0]==='list')return [{result:cards.map(c=>c.tail)}];if(o.args[0]==='select'){selected=cards.find(c=>c.tail===o.args[1]);return [{result:[selected.tail]}]};return [{result:[]}];}
  if(o.func?.name==='amexReadMenu')return [{result:[]}];
  if(o.func?.name==='capturePage'){
   const path=new URL(href).pathname,heading='Unknown product ••••'+selected.tail;
   const text=incompleteBilling?(path==='/rewards'?heading+'\nMembership Rewards\n'+(selected===cards[0]?'0':'700'):heading+(selected===cards[0]?'\n總結欠\nHK$0.00\n暫時毋須付款':'\n總結欠\nHK$45.00\n最低還款\nHK$12.00\n請於此日期或之前付款\n11月 23日')):path==='/dashboard'?f.text.split('\n還款到期日')[0].replaceAll(f.card.tail,selected.tail):path==='/rewards'?heading+'\nMembership Rewards\n'+(selected===cards[0]?'0':'700'):heading+'\n還款到期日\n2026年11月6日';
   const page=path==='/dashboard'?'overview':path==='/rewards'?'rewards':'billing',observations=JSON.parse(JSON.stringify(reader.amexHkMvp(text,selected,page))).map(i=>({...i,evidence:"[C1]\n"+i.evidence}));
   const links=path==='/dashboard'?[{label:'積分',href:'https://global.americanexpress.com/rewards'},{label:'下載您的月結單',href:'https://global.americanexpress.com/activity/statements'},{label:'優惠',href:'https://global.americanexpress.com/offers'}]:[];
   return [{documentId:'doc'+doc,result:{pageHref:href,capturedAt:new Date().toISOString(),aliases:[{id:'C1',cardId:selected.id,currency:'HKD'}],blocks:[{text:'[C1]\n'+text},...observations.map(i=>({text:i.evidence}))],observations,links,rulesComplete:true}}];
  }
  if(o.args?.length===3)return [{documentId:'doc'+doc,result:{status:'partial',patches:[{id:cards[0].id,locale:'zh-HK',capturedAt:new Date().toISOString(),fields:{balance:123.45}}]}}];
  return [{documentId:'doc'+doc,result:true}];
 }}};chrome.storage.session=chrome.storage.local;
 const oldFetch=globalThis.fetch;globalThis.fetch=async()=>assert.fail('No cloud/API calls are needed for complete rule fixtures');
 try{
  await import('../extension-next/background.js?hk-two-card-flow-'+failStatements+'-'+incompleteBilling);const reply=await new Promise(resolve=>receive({type:'refresh',requestId:'hk-mvp-flow',banks:['Amex HK'],cards,ownerTabId:1},{id:'hk-worker',url:own},resolve));assert.equal(reply.ok,true);
  const end=Date.now()+5000;while(store[STATE_KEY]?.run?.status==='running'&&Date.now()<end)await new Promise(r=>setTimeout(r,10));
  const state=store[STATE_KEY],job=state.run.jobs[0];assert.equal(state.run.status,'complete');assert.equal(job.status,failStatements||incompleteBilling?'partial':'updated');if(failStatements)assert.equal(job.readError,'navigation_timeout');assert.equal(job.sections.card.coverage.length,2);assert.equal(job.sections.card.coverage.every(c=>c.complete),!failStatements&&!incompleteBilling);assert.ok(job.sections.reward.coverage.every(c=>c.complete));
  const rewards=state.agentRecords.filter(i=>i.kind==='reward');assert.equal(rewards.length,2);assert.deepEqual(rewards.map(i=>i.value).sort((a,b)=>a-b),[0,700]);assert.ok(state.agentRecords.every(i=>['card','billing','reward'].includes(i.kind)));assert.ok(!visits.some(v=>v.path.includes('offers')));assert.ok(visits.some(v=>v.path==='/activity/statements'));assert.ok(visits.some(v=>v.card===cards[1].id&&v.path==='/rewards'));assert.ok(phases.includes('understanding_page'));assert.equal(job.rejected,0);return {state,cards};
 }finally{globalThis.fetch=oldFetch}
}
test('HK worker reads two arbitrary products, navigates rewards and statements, validates and persists every MVP field without a model',()=>runFlow());
test('a failed optional billing page preserves the first card and continues reading the next card',()=>runFlow(true));

import {applyAgentRecords} from '../src/agentData.js';
test('HK worker persists explicit no-payment and yearless due on separate cards and reports partial coverage',async()=>{
 const {state,cards}=await runFlow(false,true),records=state.agentRecords;
 const data=applyAgentRecords({cards},records);
 assert.equal(data.cards[0].paymentStatus,'暫時毋須付款');assert.equal(data.cards[0].minimum,undefined);assert.equal(data.cards[0].due,undefined);
 assert.equal(data.cards[1].duePartial,'11月 23日');assert.equal(data.cards[1].due,undefined);assert.equal(data.cards[1].minimum,12);
 assert.ok(data.cards.every(c=>Object.values(c.fieldDates).every(d=>Number.isFinite(Date.parse(d)))));
 assert.ok(state.run.jobs[0].sections.card.coverage.every(c=>c.missing.includes('due')));
});
