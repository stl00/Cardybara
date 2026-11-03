import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateModel} from '../extension-next/agent-core.js';
import {enrichBank,PARSER_SETTINGS} from '../extension-next/parser-client.js';
import {applyAgentRecords} from '../src/agentData.js';
import {mvpSummary} from '../extension-next/mvp.js';
const f=JSON.parse(fs.readFileSync(new URL('./fixtures/banks/chase-four-card-mvp.json',import.meta.url)));
const box={self:{}};vm.createContext(box);vm.runInContext(fs.readFileSync(new URL('../extension-next/reader.js',import.meta.url),'utf8'),box);
const reader=box.self.CardyReader,copy=x=>JSON.parse(JSON.stringify(x));
function detail(index){return copy(reader.chaseDetail(f.details[index],f.cards[index]).items);}
function snapshot(index,observations=detail(index)){
 return {bank:'Chase',region:'US',page:'https://secure.chase.com/web/auth/dashboard',capturedAt:new Date().toISOString(),aliases:[{id:'C1',cardId:f.cards[index].id,currency:'USD'}],blocks:observations.map(i=>({text:i.evidence})),links:[]};
}
test('four Chase card detail shapes validate without pooling, guessing years or conflating credit with debt',()=>{
 const records=f.cards.flatMap((_,index)=>{const raw=detail(index),r=validateModel({items:raw,nextLinkId:null},snapshot(index,raw));assert.deepEqual(r.rejected,[]);return r.items;});
 const result=applyAgentRecords({cards:f.cards},records);
 assert.equal(result.cards[0].balance,45.67);assert.equal(result.cards[0].statement,12.34);assert.equal(result.cards[0].statementClosing,30);assert.equal(result.cards[0].minimum,5);assert.equal(result.cards[0].due,'2030-11-19');assert.equal(result.cards[0].autopay,'on');
 assert.equal(result.cards[1].statement,0);assert.equal(result.cards[1].due,'2030-11-20');assert.equal(result.cards[2].due,'2030-11-21');
 assert.equal(result.cards[3].balance,-7.2);assert.equal(result.cards[3].statementClosing,-7.2);assert.equal(result.cards[3].due,undefined);assert.equal(result.cards[3].autopay,undefined);
 assert.deepEqual(result.rewardObservations.map(r=>r.amount),[1234,234,345,0]);assert.equal(new Set(result.rewardObservations.map(r=>r.card)).size,4);assert.ok(result.rewardObservations.every(r=>r.poolStatus==='unconfirmed'));
 for(let index=0;index<f.cards.length;index++)assert.equal(reader.chaseDetail(f.details[index],f.cards[(index+1)%4]).items.length,0);
});
test('one Chase MVP run checkpoints all four registered details and preserves missing fields as partial',async()=>{
 let url='https://secure.chase.com/web/auth/dashboard#/dashboard/overview',selected=-1;const visits=[],checkpoints=[];const previousChrome=globalThis.chrome,previousFetch=globalThis.fetch;
 globalThis.chrome={permissions:{contains:async()=>false},storage:{local:{get:async()=>({[PARSER_SETTINGS]:{enabled:false,scope:'mvp'}})}},tabs:{get:async()=>({id:2,url,status:'complete'})},scripting:{executeScript:async o=>{
  if(o.files||o.target.documentIds)return [{documentId:'synthetic-chase-doc',result:true}];
  if(o.func.name==='chaseCards'){
   if(o.args[0]==='list')return [{result:f.cards.map(c=>c.tail)}];
   if(o.args[0]==='select'){selected=f.cards.findIndex(c=>c.tail===o.args[1]);visits.push(f.cards[selected].id);url='https://secure.chase.com/web/auth/dashboard#/dashboard/summary/synthetic/CARD/BAC';return [{result:[o.args[1]]}];}
   return [{result:[]}];
  }
  if(o.func.name==='chaseOpenSection')assert.fail('MVP must not visit offers or benefits');
  assert.equal(o.func.name,'capturePage');
  const overview=new URL(url).hash.endsWith('/overview'),observations=overview?f.cards.map((c,index)=>({kind:'card',cardId:'C'+(index+1),key:'balance',title:'Current balance',value:index+1,currency:'USD',date:'',status:'unknown',evidence:'[C'+(index+1)+'] Current balance $'+(index+1)+'.00'})):detail(selected);
  const aliases=overview?f.cards.map((c,index)=>({id:'C'+(index+1),cardId:c.id,currency:c.currency})):[{id:'C1',cardId:f.cards[selected].id,currency:'USD'}];
  return [{documentId:'synthetic-chase-doc',result:{pageHref:url,capturedAt:new Date().toISOString(),aliases,observations,blocks:observations.map(i=>({text:i.evidence})),links:[],rulesComplete:true}}];
 }}};
 globalThis.fetch=async()=>assert.fail('Disabled cloud parsing cannot transmit Chase data');
 try{
  const r=await enrichBank({bank:'Chase',cards:f.cards,tabId:2},{current:async()=>true,progress:async()=>{},checkpoint:async records=>checkpoints.push(copy(records)),navigate:async href=>{url=href;}});
  assert.equal(r.error,null);assert.equal(r.pages,5);assert.deepEqual(visits,f.cards.map(c=>c.id));assert.equal(r.sections.reward.status,'updated');assert.equal(r.sections.card.status,'partial');assert.deepEqual(r.sections.card.coverage.at(-1).missing,['due']);assert.equal(r.rejected,0);
  for(const c of f.cards)assert.ok(checkpoints.some(records=>records.some(i=>i.cardId===c.id&&i.kind==='reward')));
  assert.ok(r.items.every(i=>['card','billing','reward'].includes(i.kind)));
 }finally{globalThis.chrome=previousChrome;globalThis.fetch=previousFetch;}
});

test('a Chase run with an explicit no-payment card completes its coverage and leaves minimum and due unknown',async()=>{
 const card=f.cards[3],page={title:card.name+' (...'+card.tail+')',fields:{currentBalance:'$12.00','remainingStatementBalance-dataItem':'Remaining statement balance\n$0.00','ultimateRewards-dataItem':'Ultimate Rewards® points\n0'},paymentNotices:["Success:\nYou don't have a payment due right now."]};
 const raw=copy(reader.chaseDetail(page,card).items),{items}=validateModel({items:raw,nextLinkId:null},snapshot(3,raw));
 const coverage=mvpSummary(items,[card]);
 assert.deepEqual(coverage.card.coverage[0],{cardId:card.id,missing:[],complete:true,notApplicable:['minimum','due'],reason:"You don't have a payment due right now."});
 assert.equal(coverage.card.status,'updated');
 const c=applyAgentRecords({cards:[card]},items).cards[0];assert.equal(c.minimum,undefined);assert.equal(c.due,undefined);assert.equal(c.paymentStatus,"You don't have a payment due right now.");
 // The same page without the statement stays partial and reports what is missing.
 const silent=copy(reader.chaseDetail({...page,paymentNotices:[]},card).items),plain=validateModel({items:silent,nextLinkId:null},snapshot(3,silent)).items;
 assert.deepEqual(mvpSummary(plain,[card]).card.coverage[0].missing,['minimum','due']);assert.equal(mvpSummary(plain,[card]).card.status,'partial');
});
test('Chase explicit no-payment banner becomes a dated status without fabricating minimum, due or AutoPay',()=>{
 const p={...f.details[3],fields:{currentBalance:'$12.00','remainingStatementBalance-dataItem':'Remaining statement balance\n$0.00'},paymentNotices:["Success:\nYou don't have a payment due right now."]};
 const raw=copy(reader.chaseDetail(p,f.cards[3]).items),r=validateModel({items:raw,nextLinkId:null},snapshot(3,raw));assert.deepEqual(r.rejected,[]);
 const c=applyAgentRecords({cards:[f.cards[3]]},r.items).cards[0];assert.equal(c.paymentStatus,"You don't have a payment due right now.");assert.ok(c.fieldDates.paymentStatus);assert.equal(c.statement,0);assert.equal(c.balance,12);
 for(const key of ['minimum','due','autopay'])assert.equal(c[key],undefined);
 for(const change of [{fields:{'remainingStatementBalance-dataItem':'Remaining statement balance\n$0.00'}},{paymentNotices:["If you make a payment, you don't have a payment due right now."]},{paymentNotices:[]},{fields:{...p.fields,'minimumPaymentDue-dataItem':'Minimum payment due\n$1.00'}},{fields:{...p.fields,'nextPaymentDueDate-dataItem':'Payment due date\nNov 22'}}]){
  assert.ok(!reader.chaseDetail({...p,...change},f.cards[3]).items.some(i=>i.key==='paymentStatus'));
 }
});
