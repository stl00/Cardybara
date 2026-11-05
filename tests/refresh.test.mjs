import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichBank,sectionSummary,PARSER_SETTINGS} from '../extension-next/parser-client.js';
import {Engine} from '../extension-next/engine.js';
const cards=[{id:'card-one',bank:'Amex HK',tail:'12345',currency:'HKD'}];
const ctx={bank:'Amex HK',cards,tabId:2};
const modelItem={kind:'reward',cardId:'C1',key:'Membership Rewards',title:'Membership Rewards',value:123,currency:'points',date:'',status:'unknown',evidence:'[C1] Membership Rewards 123 points'};
function harness({enabled=true,consent=true,permission=true,failSecond=false}={}){
 let href='https://global.americanexpress.com/overview',reads=0,modelCalls=0,cancelled=false;
 const checkpoints=[],phases=[],navigations=[];
 globalThis.chrome={permissions:{contains:async()=>permission},storage:{local:{get:async()=>({[PARSER_SETTINGS]:{scope:'full',enabled,cloudConsent:consent}})}},tabs:{get:async()=>({url:href,id:2,status:'complete'})},scripting:{executeScript:async o=>{
  if(o.files)return [{documentId:'injected'}];
  if(o.func?.name==='amexReadMenu')return [{result:[]}];
  if(o.func?.name==='amexCards')return [{documentId:'doc'+reads,result:[]}];
  if(o.target.documentIds)return [{documentId:'doc'+reads,result:true}];reads++;
  return [{documentId:'doc'+reads,result:{blocks:[{id:'B1',text:'[C1] Membership Rewards 123 points'}],aliases:[{id:'C1',cardId:'card-one',currency:'HKD'}],links:reads===1?[{label:'Rewards',href:'https://global.americanexpress.com/rewards'}]:[],capturedAt:new Date().toISOString()}}];
 }}};
 globalThis.fetch=async(url,options)=>{if(url.endsWith('/status'))return {ok:true,json:async()=>({configured:true,provider:'deepseek'})};modelCalls++;if(failSecond&&modelCalls===2)return {ok:false};return {ok:true,json:async()=>({raw:{items:[modelItem],nextLinkId:modelCalls===1?'L1':null}})};};
 const io={current:async()=>!cancelled,progress:async p=>phases.push(p),checkpoint:async items=>checkpoints.push(structuredClone(items)),navigate:async url=>{navigations.push(url);href=url;}};
 return {io,checkpoints,phases,navigations,cancel:()=>cancelled=true,calls:()=>modelCalls};
}
test('unified refresh reads and checkpoints model records before moving to the next safe bank page',async()=>{
 const h=harness();const result=await enrichBank(ctx,h.io);assert.equal(result.pages,2);assert.equal(result.items.length,1);assert.equal(result.sections.reward.status,'updated');assert.equal(result.sections.offer.status,'not_found');assert.equal(h.checkpoints.length,2);assert.equal(h.navigations.length,2);assert.ok(h.phases.includes('reading_next_page'));
});
test('missing model permission and consent never send bank data and give a truthful partial reason',async()=>{
 for(const options of [{permission:false},{consent:false},{enabled:false}]){const h=harness(options),result=await enrichBank(ctx,h.io);assert.equal(h.calls(),0);assert.equal(result.items.length,0);assert.notEqual(result.sections.reward.status,'updated');}
});
test('cancellation after model completion rejects late data and blocks navigation',async()=>{
 const h=harness();const oldFetch=globalThis.fetch;globalThis.fetch=async(...args)=>{const response=await oldFetch(...args);if(args[0].endsWith('/parse'))h.cancel();return response;};const r=await enrichBank(ctx,h.io);assert.equal(r.error,'cancelled');assert.equal(h.checkpoints.length,0);assert.equal(h.navigations.length,0);
});
test('later-page failure retains already checkpointed observations and reports missing categories',async()=>{
 const h=harness({failSecond:true}),r=await enrichBank(ctx,h.io);assert.equal(r.items.length,1);assert.equal(r.sections.reward.status,'updated');assert.equal(r.sections.transaction.status,'parser_unavailable');assert.equal(h.checkpoints.length,1);
});
test('zero records do not imply a verified zero balance or empty offers list',()=>{
 const s=sectionSummary([]);assert.equal(s.card.count,0);assert.equal(s.card.status,'not_found');assert.equal(s.offer.status,'not_found');
});
test('checkpoint is bank/run scoped, survives cancellation and cannot revive a stopped refresh',async()=>{
 let state;let time=Date.now();const engine=new Engine({load:async()=>state,save:async s=>state=structuredClone(s),uuid:()=>crypto.randomUUID(),now:()=>time});
 await engine.start({type:'refresh',requestId:'bank-run',banks:['Amex HK'],cards},1);const claimed=await engine.claim();const bound=await engine.bind(claimed,2,true);let job=bound.run.jobs[0];await engine.loading({...job,generation:bound.run.generation});let captured=await engine.capture({...job,generation:bound.run.generation});job=captured.run.jobs[0];const scoped={...job,generation:captured.run.generation};
 const item={...modelItem,cardId:'card-one',bank:'Amex HK',region:'HK',capturedAt:new Date(time).toISOString()};
 await engine.progress(scoped,'understanding_page',sectionSummary([]));await engine.checkpoint(scoped,[item],sectionSummary([item]));await engine.cancel(1);
 assert.equal((await engine.load()).agentRecords.length,1);assert.equal(await engine.current(scoped),false);assert.equal(await engine.checkpoint(scoped,[{...item,value:999}],{}),null);assert.equal((await engine.load()).agentRecords[0].value,123);
});

import {chooseBankTab} from '../extension-next/bank-tabs.js';
test('bank refresh prefers a card-verified shared Amex dashboard over the login page',async()=>{
 const tabs=[{id:1,url:'https://www.americanexpress.com/zh-hk/account/login'},{id:2,url:'https://global.americanexpress.com/dashboard'},{id:3,url:'https://global.americanexpress.com/overview'}];
 const scripting={executeScript:async({target})=>[{result:target.tabId===2}]};
 assert.equal((await chooseBankTab('Amex HK',cards,tabs,scripting)).id,2);
 await assert.rejects(()=>chooseBankTab('Amex HK',cards,tabs,{executeScript:async()=>[{result:true}]}));
 assert.equal((await chooseBankTab('Amex HK',cards,tabs,{executeScript:async()=>[{result:false}]})).id,1);
});
test('a tab discovery accepts as signed in is used, even when its cards are not in headings',async()=>{
 const tab={id:7,url:'https://global.americanexpress.com/overview'},cards=[{id:'a',bank:'Amex US',tail:'12345'}];
 const scripting=found=>({executeScript:async o=>[{result:o.func.name==='discoverVisibleCards'?found:false}]});
 assert.equal((await chooseBankTab('Amex US',cards,[tab],scripting({status:'found',cards:[{tail:'12345',name:'x'}]})))?.verified,true,'not a sign-in page');
 assert.equal(await chooseBankTab('Amex US',cards,[tab],scripting({status:'found',cards:[{tail:'99999',name:'x'}]})),null,'another person\'s cards are not this wallet\'s');
 assert.equal(await chooseBankTab('Amex US',cards,[tab],scripting({status:'needs_login',cards:[]})),null);
 assert.equal((await chooseBankTab('Amex US',[],[tab],scripting({status:'found',cards:[{tail:'12345',name:'x'}]})))?.verified,true,'a first read with no registered card');
 // A dashboard the heading check accepts and a details page discovery also accepts: the dashboard is chosen, as before.
 const two=[{id:1,url:'https://secure.chase.com/web/auth/dashboard#/dashboard/overview'},{id:2,url:'https://secure.chase.com/web/auth/dashboard#/dashboard/details'}],chase=[{id:'c',bank:'Chase',tail:'1234'}];
 const mixed={executeScript:async o=>[{result:o.func.name==='discoverVisibleCards'?{status:'found',cards:[{tail:'1234',name:'x'}]}:o.target.tabId===1}]};
 assert.equal((await chooseBankTab('Chase',chase,two,mixed)).id,1,'no new ambiguity');
 await assert.rejects(()=>chooseBankTab('Chase',chase,two,{executeScript:async o=>[{result:o.func.name==='discoverVisibleCards'?{status:'found',cards:[{tail:'1234',name:'x'}]}:false}]}),/ambiguous_tabs/,'two tabs only discovery accepts are still ambiguous');
 assert.equal(await chooseBankTab('Amex US',cards,[tab],{executeScript:()=>new Promise(()=>{})}),null,'a tab that never answers is passed over');
});

test('verified empty categories require explicit observations from every registered card',()=>{
 const cs=[...cards,{...cards[0],id:'two'}];
 assert.equal(sectionSummary([],'not_found',[{kind:'offer',cardId:cards[0].id}],cs).offer.status,'not_found');
 assert.equal(sectionSummary([],'not_found',cs.map(c=>({kind:'offer',cardId:c.id})),cs).offer.status,'checked_empty');
});

import {snapshotBatches} from '../extension-next/parser-client.js';
test('long offer pages split into bounded evidence-preserving requests',()=>{
 const blocks=Array.from({length:26},(_,i)=>({id:'B'+i,text:'x'.repeat(900)}));
 const result=snapshotBatches({bank:'Amex HK',aliases:[],links:[],blocks});
 assert.equal(result.length,6);assert.deepEqual(result.flatMap(s=>s.blocks),blocks);
 assert.ok(result.every(s=>s.blocks.reduce((n,b)=>n+b.text.length,0)<=5000));
});
test('one bank refresh visits both registered Amex cards and retains separate points observations',async()=>{
 const two=[...cards,{...cards[0],id:'card-two',tail:'67890'}];let selected=0,href='https://global.americanexpress.com/dashboard',doc=0;
 globalThis.chrome={permissions:{contains:async()=>true},storage:{local:{get:async()=>({[PARSER_SETTINGS]:{scope:'full',enabled:true,cloudConsent:true}})}},tabs:{get:async()=>({url:href})},scripting:{executeScript:async o=>{
  if(o.files)return [{documentId:'injected'}];
  if(o.func?.name==='amexReadMenu')return [{result:[]}];
  if(o.func?.name==='amexCards'){if(o.args[0]==='close')return [{result:[]}];if(o.args[0]==='list')return [{result:['12345','67890']}];selected=1;return [{result:['67890']}];}
  if(o.target.documentIds)return [{documentId:'d'+doc,result:true}];doc++;return [{documentId:'d'+doc,result:{aliases:[{id:'C1',cardId:two[selected].id,currency:'HKD'}],blocks:[{id:'B1',text:`[C1] Membership Rewards ${selected?456:123} points`}],links:[],capturedAt:new Date().toISOString()}}];
 }}};
 globalThis.fetch=async url=>({ok:true,json:async()=>url.endsWith('/status')?{configured:true}:{raw:{items:[{...modelItem,value:selected?456:123,evidence:`[C1] Membership Rewards ${selected?456:123} points`}],nextLinkId:null}}});
 const result=await enrichBank({...ctx,cards:two},{current:async()=>true,progress:async()=>{},checkpoint:async()=>{},navigate:async u=>{href=u;}});
 assert.equal(result.pages,2);assert.deepEqual(result.items.map(i=>[i.cardId,i.value]),[['card-one',123],['card-two',456]]);
});
test('money checkpoints survive a later page failure and a guided retry resets the prior model phase',async()=>{
 let state,time=Date.now();const e=new Engine({load:async()=>state,save:async s=>state=structuredClone(s),uuid:()=>crypto.randomUUID(),now:()=>time});
 await e.start({type:'refresh',requestId:'money-checkpoint',banks:['Amex HK'],cards},1);const c=await e.claim();await e.bind(c,2,true);await e.loading(c);let s=await e.capture(c);let j={...s.run.jobs[0],generation:s.run.generation};
 await e.checkpointRead(j,{status:'updated',patches:[{id:cards[0].id,fields:{balance:0},locale:'zh-HK',capturedAt:new Date(time).toISOString()}]});
 await e.progress(j,'understanding_page',sectionSummary([],'reading'));await e.fail(j,'load_error',{stage:'validate_result',code:'reader_exception'});
 s=await e.load();assert.equal(s.records['Amex HK'][cards[0].id].balance.value,0);assert.equal(s.run.jobs[0].sections.offer.status,'load_error');assert.equal(s.run.jobs[0].phase,'complete');
 s=await e.guide({runId:s.run.id,attemptId:j.attemptId},2,'read');assert.equal(s.run.jobs[0].enrichmentStartedAt,undefined);assert.equal(s.run.jobs[0].sections,undefined);assert.equal(s.run.jobs[0].diagnostic,undefined);
});
test('rule observations are rejected before saving when the captured bank document changes',async()=>{
 const h=harness();const oldScript=chrome.scripting.executeScript,oldGet=chrome.tabs.get;let changed=false;
 chrome.scripting.executeScript=async o=>{const r=await oldScript(o);if(o.func?.name==='capturePage'){r[0].result.observations=[modelItem];changed=true;}return r;};
 chrome.tabs.get=async id=>changed?{url:'https://global.americanexpress.com/benefits'}:oldGet(id);
 const result=await enrichBank(ctx,h.io);assert.equal(result.error,'document_changed');assert.equal(h.checkpoints.length,0);assert.equal(h.calls(),0);
});

test('HSBC same-URL card switching reads each registered card and its detail overlay',async()=>{
 const cards=[{id:'red',bank:'HSBC HK',tail:'1234',currency:'HKD'},{id:'gold',bank:'HSBC HK',tail:'5678',currency:'HKD'}];let selected=0,panel=false,panels=0;const checkpoints=[];
 const href='https://www.hsbc.com.hk/online/dashboard/';
 globalThis.chrome={permissions:{contains:async()=>true},storage:{local:{get:async()=>({[PARSER_SETTINGS]:{scope:'full',enabled:true,cloudConsent:true}})}},tabs:{get:async()=>({id:2,url:href,status:'complete'})},scripting:{executeScript:async o=>{
  if(o.files)return [{documentId:'injected'}];
  if(o.target.documentIds)return [{documentId:'hsbc-doc',result:true}];
  if(o.func.name==='hsbcCards'){if(o.args[0]==='list')return [{result:['1234','5678']}];if(o.args[0]==='select'){selected=cards.findIndex(c=>c.tail===o.args[1]);panel=false;return [{result:[o.args[1]]}];}return [{result:[]}];}
  if(o.func.name==='hsbcMoreDetails'){panel=true;panels++;return [{result:true}];}
  const card=cards[selected],evidence='[C1] Account balance '+(selected?'-25.00':'10.00')+' HKD';const observations=[{kind:'card',cardId:'C1',key:'balance',title:'Account balance',value:selected?25:-10,currency:'HKD',date:'',status:'unknown',evidence}];
  if(panel)observations.push({kind:'billing',cardId:'C1',key:'due',title:'Payment due date',value:null,currency:'HKD',date:'2026-11-02',status:'unknown',evidence:'[C1] Payment due date 02 Nov 2026'});
  return [{documentId:'hsbc-doc',result:{pageHref:href,aliases:[{id:'C1',cardId:card.id,currency:'HKD'}],blocks:observations.map((x,i)=>({id:'B'+i,text:x.evidence})),observations,links:[],capturedAt:'2026-10-26T12:00:00Z'}}];
 }}};
 globalThis.fetch=async url=>({ok:true,json:async()=>url.endsWith('/status')?{configured:true,provider:'deepseek'}:{raw:{items:[],nextLinkId:null}}});
 const result=await enrichBank({bank:'HSBC HK',cards,tabId:2},{current:async()=>true,progress:async()=>{},checkpoint:async r=>checkpoints.push(structuredClone(r)),navigate:async()=>assert.fail('same-URL account controls should handle card navigation')});
 assert.equal(result.error,null);assert.equal(result.pages,4);assert.equal(panels,2);assert.equal(result.items.length,4);assert.equal(result.items.filter(i=>i.kind==='billing').length,2);assert.deepEqual(new Set(result.items.map(i=>i.cardId)),new Set(['red','gold']));assert.ok(checkpoints.length>=4);
});
test('Citi opens each card by a click and waits for the page, then returns to the summary',async()=>{
 const summary='https://online.citi.com/US/ag/dashboard/summary',detail='https://online.citi.com/US/ag/dashboard/credit-card';
 const cards=[{id:'a',bank:'Citi US',tail:'2345',currency:'USD'},{id:'b',bank:'Citi US',tail:'6789',currency:'USD'}];let url=summary,card=null;const arrivals=[],back=[];
 globalThis.chrome={permissions:{contains:async()=>true},storage:{local:{get:async()=>({[PARSER_SETTINGS]:{scope:'mvp',enabled:false,cloudConsent:false}})}},tabs:{get:async()=>({id:2,url,status:'complete'})},scripting:{executeScript:async o=>{
  if(o.files)return [{documentId:'injected'}];
  if(o.target.documentIds&&o.func?.name!=='capturePage')return [{documentId:'citi-doc',result:true}];
  if(o.func.name==='citiCards'){if(o.args[0]==='list')return [{result:['2345','6789']}];if(o.args[0]==='select'){card=cards.find(c=>c.tail===o.args[1]);return [{result:{arriving:detail,tail:o.args[1]}}];}return [{result:[]}];}
  if(url===summary)return [{documentId:'citi-doc',result:{pageHref:url,aliases:[],blocks:[{id:'B1',text:'Summary'}],observations:[],links:[],capturedAt:'2030-01-01T00:00:00Z'}}];
  const evidence='[C1] Current Balance $1.00';
  return [{documentId:'citi-doc',result:{pageHref:url,aliases:[{id:'C1',cardId:card.id,currency:'USD'}],blocks:[{id:'B1',text:evidence}],observations:[{kind:'card',cardId:'C1',key:'balance',title:'Current Balance',value:1,currency:'USD',date:'',status:'unknown',evidence}],links:[],capturedAt:'2030-01-01T00:00:00Z'}}];
 }}};
 globalThis.fetch=async()=>({ok:true,json:async()=>({configured:false})});
 const result=await enrichBank({bank:'Citi US',cards,tabId:2},{current:async()=>true,progress:async()=>{},checkpoint:async()=>{},arrive:async href=>{arrivals.push(href);url=href;},navigate:async href=>{back.push(href);url=href;}});
 assert.equal(result.error,null);assert.deepEqual(arrivals,[detail,detail],'the click decides, never a direct address');assert.ok(back.length>=1&&back.every(h=>h===summary),'only ever back to the summary, never to the card page');
 assert.deepEqual(new Set(result.items.map(i=>i.cardId)),new Set(['a','b']));
});
test('Amex US opens the first card from its tile and switches the rest in place, with no page load',async()=>{
 const overview='https://global.americanexpress.com/overview',detail='https://global.americanexpress.com/dashboard?account_key=synthetic';
 const cards=[{id:'a',bank:'Amex US',tail:'12345',currency:'USD'},{id:'b',bank:'Amex US',tail:'67890',currency:'USD'}];let url=overview,card=null;const picked=[];
 globalThis.chrome={permissions:{contains:async()=>true},storage:{local:{get:async()=>({[PARSER_SETTINGS]:{scope:'mvp',enabled:false,cloudConsent:false}})}},tabs:{get:async()=>({id:2,url,status:'complete'})},scripting:{executeScript:async o=>{
  if(o.files)return [{documentId:'injected'}];
  if(o.target.documentIds&&o.func?.name!=='capturePage')return [{documentId:'amex-doc',result:true}];
  if(o.func.name==='amexCards'){if(o.args[0]==='list')return [{result:['12345','67890']}];if(o.args[0]==='select'){picked.push(o.args[1]);url=detail;card=cards.find(c=>c.tail===o.args[1]);return [{result:[o.args[1]]}];}return [{result:[]}];}
  if(url===overview)return [{documentId:'amex-doc',result:{pageHref:url,aliases:[],blocks:[{id:'B1',text:'Overview'}],observations:[],links:[],capturedAt:'2030-01-01T00:00:00Z'}}];
  const evidence='[C1] Total Balance $1.00';
  return [{documentId:'amex-doc',result:{pageHref:url,aliases:[{id:'C1',cardId:card.id,currency:'USD'}],blocks:[{id:'B1',text:evidence}],observations:[{kind:'card',cardId:'C1',key:'balance',title:'Total Balance',value:1,currency:'USD',date:'',status:'unknown',evidence}],links:[],capturedAt:'2030-01-01T00:00:00Z'}}];
 }}};
 globalThis.fetch=async()=>({ok:true,json:async()=>({configured:false})});
 const navigated=[];
 const result=await enrichBank({bank:'Amex US',cards,tabId:2},{current:async()=>true,progress:async()=>{},checkpoint:async()=>{},navigate:async href=>{navigated.push(href);url=href;}});
 assert.equal(result.error,null);assert.deepEqual(picked,['12345','67890']);
 assert.ok(!navigated.slice(0,-1).includes(overview),'no page load between cards');
 assert.deepEqual(new Set(result.items.map(i=>i.cardId)),new Set(['a','b']));
});
test('one registered Amex US card named on the overview still opens from its tile',async()=>{
 const overview='https://global.americanexpress.com/overview',detail='https://global.americanexpress.com/dashboard?account_key=synthetic',card={id:'a',bank:'Amex US',tail:'12345',currency:'USD'};let url=overview;const picked=[];
 globalThis.chrome={permissions:{contains:async()=>true},storage:{local:{get:async()=>({[PARSER_SETTINGS]:{scope:'mvp',enabled:false,cloudConsent:false}})}},tabs:{get:async()=>({id:2,url,status:'complete'})},scripting:{executeScript:async o=>{
  if(o.files)return [{documentId:'injected'}];
  if(o.target.documentIds&&o.func?.name!=='capturePage')return [{documentId:'amex-doc',result:true}];
  if(o.func.name==='amexCards'){if(o.args[0]==='list')return [{result:['12345']}];if(o.args[0]==='select'){picked.push(o.args[1]);url=detail;return [{result:[o.args[1]]}];}return [{result:[]}];}
  return [{documentId:'amex-doc',result:{pageHref:url,aliases:[{id:'C1',cardId:'a',currency:'USD'}],blocks:[{id:'B1',text:'[C1] Page'}],observations:[],links:[],capturedAt:'2030-01-01T00:00:00Z'}}];
 }}};
 globalThis.fetch=async()=>({ok:true,json:async()=>({configured:false})});
 const result=await enrichBank({bank:'Amex US',cards:[card],tabId:2},{current:async()=>true,progress:async()=>{},checkpoint:async()=>{},navigate:async href=>{url=href;}});
 assert.equal(result.error,null);assert.deepEqual(picked,['12345'],'the tile is clicked, so the card page is read');
});
test('rules keep running without model setup or cloud consent',async()=>{
 const h=harness({enabled:false,consent:false,permission:false}),execute=chrome.scripting.executeScript;
 chrome.scripting.executeScript=async o=>{const result=await execute(o);if(o.func?.name==='capturePage')result[0].result.observations=[modelItem];return result;};
 const result=await enrichBank(ctx,h.io);assert.equal(h.calls(),0);assert.equal(result.items.length,1);assert.equal(result.items[0].method,'rules');assert.equal(result.sections.reward.status,'updated');
});
test('one Chase refresh reads both cards, their scoped rewards, offers and benefits without a model',async()=>{
 const cards=[{id:'c1',bank:'Chase',tail:'1111',currency:'USD'},{id:'c2',bank:'Chase',tail:'2222',currency:'USD'}];let selected=0,url='https://secure.chase.com/web/auth/dashboard#/dashboard/overview',cloudCalls=0;const visited=[],savedRewards=new Set();
 globalThis.chrome={permissions:{contains:async()=>true},storage:{local:{get:async()=>({[PARSER_SETTINGS]:{scope:'full',enabled:false,cloudConsent:false}})}},tabs:{get:async()=>({url,id:2,status:'complete'})},scripting:{executeScript:async o=>{
  if(o.files||o.target.documentIds)return [{documentId:'chase-doc',result:true}];
  if(o.func.name==='chaseCards'){const action=o.args[0];if(action==='list')return [{result:cards.map(c=>c.tail)}];if(action==='select'){selected=cards.findIndex(c=>c.tail===o.args[1]);url='https://secure.chase.com/web/auth/dashboard#/dashboard/summary/fixture/CARD/BAC';return [{result:[o.args[1]]}];}return [{result:[]}];}
  if(o.func.name==='chaseOpenSection'){assert.equal(savedRewards.size,2,'read and persist every card reward before visiting offers or benefits');const section=o.args[0];url='https://secure.chase.com/web/auth/dashboard#/dashboard/'+(section==='offers'?'merchantOffers/offer-hub':'benefits/hub');visited.push(section);return [{result:true}];}
  const route=new URL(url).hash,overview=route.endsWith('/overview'),isOffer=route.includes('merchantOffers'),isBenefit=route.includes('benefits');
  const aliases=overview?cards.map((c,i)=>({id:'C'+(i+1),cardId:c.id,currency:'USD'})):[{id:'C1',cardId:cards[selected].id,currency:'USD'}];
  const observations=overview?cards.map((c,i)=>({kind:'card',cardId:'C'+(i+1),key:'balance',title:'Current balance',value:10+i,currency:'USD',date:'',status:'unknown',evidence:'[C'+(i+1)+'] Current balance $'+(10+i)+'.00'})):isOffer?[{kind:'offer',cardId:'C1',key:'fixture',title:'Shop',value:null,currency:'USD',date:'',status:'available',evidence:'[C1] Shop 5% cash back Add Offer'}]:isBenefit?[{kind:'benefit',cardId:'C1',key:'entitlement',title:'Fixture membership*',value:null,currency:'USD',date:'',status:'unknown',evidence:'[C1] Fixture membership*'}]:[{kind:'reward',cardId:'C1',key:'Ultimate Rewards',title:'Ultimate Rewards',value:100+selected,currency:'points',date:'',status:'unknown',evidence:'[C1] Ultimate Rewards '+(100+selected)}];
  return [{documentId:'chase-doc',result:{pageHref:url,aliases,observations,blocks:observations.map(i=>({text:i.evidence})),links:[],capturedAt:new Date().toISOString(),rulesComplete:true,coverage:isOffer?[{kind:'offer',cardId:cards[selected].id,view:'all',expected:1}]:[]}}];
 }}};
 globalThis.fetch=async u=>{if(!u.endsWith('/status'))cloudCalls++;return {ok:true,json:async()=>({configured:false})};};
 const result=await enrichBank({bank:'Chase',cards,tabId:2},{current:async()=>true,progress:async()=>{},checkpoint:async items=>{for(const i of items)if(i.kind==='reward')savedRewards.add(i.cardId);},navigate:async u=>{url=u;}});
 assert.equal(result.error,null);assert.equal(result.pages,9);assert.equal(result.items.length,8);assert.deepEqual(visited,['offers','benefits','offers','benefits']);assert.equal(result.sections.offer.status,'updated');assert.equal(cloudCalls,0);
});

test('MVP default reads every Chase card reward and never enters offers or benefits',async()=>{
 const cards=[{id:'c1',bank:'Chase',tail:'1111',currency:'USD'},{id:'c2',bank:'Chase',tail:'2222',currency:'USD'}];let selected=0,url='https://secure.chase.com/web/auth/dashboard#/dashboard/overview',cloudCalls=0;const visited=[],savedRewards=new Set();
 globalThis.chrome={permissions:{contains:async()=>true},storage:{local:{get:async()=>({[PARSER_SETTINGS]:{enabled:false,cloudConsent:false}})}},tabs:{get:async()=>({url,id:2,status:'complete'})},scripting:{executeScript:async o=>{
  if(o.files||o.target.documentIds)return [{documentId:'chase-doc',result:true}];
  if(o.func.name==='chaseCards'){const action=o.args[0];if(action==='list')return [{result:cards.map(c=>c.tail)}];if(action==='select'){selected=cards.findIndex(c=>c.tail===o.args[1]);url='https://secure.chase.com/web/auth/dashboard#/dashboard/summary/fixture/CARD/BAC';return [{result:[o.args[1]]}];}return [{result:[]}];}
  if(o.func.name==='chaseOpenSection'){assert.equal(savedRewards.size,2,'read and persist every card reward before visiting offers or benefits');const section=o.args[0];url='https://secure.chase.com/web/auth/dashboard#/dashboard/'+(section==='offers'?'merchantOffers/offer-hub':'benefits/hub');visited.push(section);return [{result:true}];}
  const route=new URL(url).hash,overview=route.endsWith('/overview'),isOffer=route.includes('merchantOffers'),isBenefit=route.includes('benefits');
  const aliases=overview?cards.map((c,i)=>({id:'C'+(i+1),cardId:c.id,currency:'USD'})):[{id:'C1',cardId:cards[selected].id,currency:'USD'}];
  const observations=overview?cards.map((c,i)=>({kind:'card',cardId:'C'+(i+1),key:'balance',title:'Current balance',value:10+i,currency:'USD',date:'',status:'unknown',evidence:'[C'+(i+1)+'] Current balance $'+(10+i)+'.00'})):isOffer?[{kind:'offer',cardId:'C1',key:'fixture',title:'Shop',value:null,currency:'USD',date:'',status:'available',evidence:'[C1] Shop 5% cash back Add Offer'}]:isBenefit?[{kind:'benefit',cardId:'C1',key:'entitlement',title:'Fixture membership*',value:null,currency:'USD',date:'',status:'unknown',evidence:'[C1] Fixture membership*'}]:[{kind:'reward',cardId:'C1',key:'Ultimate Rewards',title:'Ultimate Rewards',value:100+selected,currency:'points',date:'',status:'unknown',evidence:'[C1] Ultimate Rewards '+(100+selected)}];
  return [{documentId:'chase-doc',result:{pageHref:url,aliases,observations,blocks:observations.map(i=>({text:i.evidence})),links:[],capturedAt:new Date().toISOString(),rulesComplete:true,coverage:isOffer?[{kind:'offer',cardId:cards[selected].id,view:'all',expected:1}]:[]}}];
 }}};
 globalThis.fetch=async u=>{if(!u.endsWith('/status'))cloudCalls++;return {ok:true,json:async()=>({configured:false})};};
 const result=await enrichBank({bank:'Chase',cards,tabId:2},{current:async()=>true,progress:async()=>{},checkpoint:async items=>{for(const i of items)if(i.kind==='reward')savedRewards.add(i.cardId);},navigate:async u=>{url=u;}});
 assert.equal(result.error,null);assert.equal(result.scope,'mvp');assert.equal(result.pages,3);assert.equal(result.items.length,4);assert.deepEqual(visited,[]);assert.deepEqual(Object.keys(result.sections).sort(),['card','reward']);assert.equal(result.sections.reward.status,'updated');assert.equal(result.sections.card.status,'partial');assert.equal(cloudCalls,0);
});
