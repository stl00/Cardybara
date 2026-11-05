import test from 'node:test';
import './helpers/provider-fake.mjs';
import assert from 'node:assert/strict';
import {PARSER_SETTINGS} from '../extension-next/parser-client.js';
import {STATE_KEY} from '../extension-next/engine.js';

test('real worker preserves the queued activity page after switching to registered offers',async()=>{
 let receive,href='https://global.americanexpress.com/dashboard',doc=1;const store={[PARSER_SETTINGS]:{scope:'full',enabled:true,cloudConsent:true}},listeners={},visits=[];
 const listener=name=>({addListener:f=>listeners[name]=f});
 const own='chrome-extension://worker-fixture/index.html';
 const reward={kind:'reward',cardId:'C1',key:'Membership Rewards',title:'Membership Rewards',value:20,currency:'points',date:'',status:'unknown',evidence:'[C1] Membership Rewards 20'};
 const offer=title=>({kind:'offer',cardId:'C1',key:'',title,value:null,currency:'CAD',date:'2026-12-31',status:'available',evidence:`[C1] ${title} Available Expires 2026-12-31`});
 globalThis.chrome={runtime:{id:'worker-fixture',getURL:p=>'chrome-extension://worker-fixture/'+p,onMessage:{addListener:f=>receive=f},sendMessage:async()=>{}},permissions:{contains:async()=>true},storage:{local:{get:async k=>({[k]:store[k]}),set:async s=>Object.assign(store,structuredClone(s)),remove:async k=>{delete store[k]},setAccessLevel:async()=>{}}},alarms:{onAlarm:listener('alarm'),create:async()=>{}},tabs:{onUpdated:listener('updated'),onRemoved:listener('removed'),query:async()=>[{id:2,url:href}],get:async id=>({id,url:id===1?own:href,status:'complete'}),update:async(id,options)=>{if(options.url){href=options.url;doc++;visits.push(new URL(href).pathname);listeners.updated?.(2,{status:'loading'},{id:2,url:href});listeners.updated?.(2,{status:'complete'},{id:2,url:href});}return {id,url:href};},sendMessage:async()=>{}},scripting:{executeScript:async o=>{
  if(o.files)return [{documentId:'doc'+doc}];
  if(o.func?.name==='amexClickReadLink')return [{result:false}];
  if(o.func?.name==='renderedBankPage')return [{result:{href,ready:true}}];
  const name=o.func?.name;
  if(name==='amexReadMenu')return [{result:[]}];
  if(name==='amexCards')return [{documentId:'doc'+doc,result:o.args[0]==='list'?['12345']:[]}];
  if(name==='amexSavedOffers'){if(new URL(href).pathname==='/offers'){href='https://global.americanexpress.com/offers/enrolled';visits.push('/offers/enrolled');return [{result:true}];}return [{result:false}];}
  if(name==='capturePage'){
   const path=new URL(href).pathname,observations=path==='/dashboard'?[reward]:path==='/offers'?[offer('Shop A')]:path==='/offers/enrolled'?[{...offer('Shop B'),status:'added',evidence:'[C1] Shop B Added to Card Expires 2026-12-31'}]:[];
   const links=path==='/dashboard'?[{label:'Offers',href:'https://global.americanexpress.com/offers'},{label:'View Transactions',href:'https://global.americanexpress.com/activity?cycleIndex=0'}]:[];
   return [{documentId:'doc'+doc,result:{pageHref:href,observations,coverage:path==='/offers'?[{kind:'offer',cardId:'fixture',view:'available',expected:1}]:path==='/offers/enrolled'?[{kind:'offer',cardId:'fixture',view:'added',expected:1}]:[],aliases:[{id:'C1',cardId:'fixture',currency:'CAD'}],blocks:observations.length?observations.map((i,n)=>({id:'B'+n,text:i.evidence})):[{id:'B0',text:'Merchant 2026-10-03 CAD 10.00 posted'}],links,capturedAt:new Date().toISOString()}}];
  }
  if(o.args?.length===3)return [{documentId:'doc'+doc,result:{status:'updated',patches:[{id:'fixture',fields:{balance:123},locale:'en-CA',capturedAt:new Date().toISOString()}]}}];
  if(o.target.documentIds)return [{documentId:'doc'+doc,result:true}];
  return [{documentId:'doc'+doc,result:true}];
 }}};chrome.storage.session=chrome.storage.local;
 globalThis.fetch=async(url,options)=>({ok:true,json:async()=>url.endsWith('/status')?{configured:true}:{raw:{items:new URL(JSON.parse(options.body).snapshot.page).pathname==='/activity'?[{kind:'transaction',cardId:'C1',key:'',title:'Merchant',value:10,currency:'CAD',date:'2026-10-03',status:'posted',evidence:'Merchant 2026-10-03 CAD 10.00 posted'}]:[],nextLinkId:null}}});
 await import('../extension-next/background.js?unified-worker-fixture');
 const reply=await new Promise(resolve=>receive({type:'refresh',requestId:'unified-worker',ownerTabId:1,banks:['Amex CA'],cards:[{id:'fixture',bank:'Amex CA',tail:'12345',currency:'CAD'}]},{id:'worker-fixture',url:own},resolve));assert.equal(reply.ok,true);
 const deadline=Date.now()+5000;while(Date.now()<deadline&&store[STATE_KEY]?.run?.status==='running')await new Promise(r=>setTimeout(r,20));
 assert.equal(store[STATE_KEY]?.run?.status,'complete');
 assert.equal(store[STATE_KEY]?.records['Amex CA']?.fixture?.balance.value,123);
 assert.ok(visits.includes('/offers/enrolled'));
 assert.ok(visits.includes('/activity'),'registered-offer reading must not discard the queued transaction page');
 assert.equal(store[STATE_KEY].agentRecords.filter(i=>i.kind==='offer').length,2);
 assert.equal(store[STATE_KEY].agentRecords.filter(i=>i.kind==='transaction').length,1);
 assert.equal(store[STATE_KEY].run.jobs[0].sections.offer.status,'updated');assert.equal(store[STATE_KEY].run.jobs[0].sections.offer.expected,2);
});
