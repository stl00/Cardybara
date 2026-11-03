import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {annualEnd,validateCostEvent,feeCycles,actualCost,creditValueForCycle,portfolioMetrics} from '../src/costTracking.js';
import {appendCostEvent,readCostEvents,importCostEvents} from '../src/costStore.js';
import {creditTasks,validatePersonalEvent,taskStatus} from '../src/personalBenefits.js';
import {appendBenefitEvent,readBenefitEvents} from '../src/personalStore.js';
import {readFileSync} from 'node:fs';
const cards=JSON.parse(readFileSync(new URL('./fixtures/wallet-products.json',import.meta.url))).cards;
globalThis.window=new EventTarget();
const fee={start:'2026-01-01',end:'2026-12-31',currency:'USD',listedFee:325,charged:325,refund:50,waiver:'partial',note:''};
const evt=(cardId,value,kind='fee',at='2026-01-01T12:00:00.000Z')=>validateCostEvent({schema:1,id:crypto.randomUUID(),kind,cardId,value,at,key:JSON.stringify(kind==='fee'?['fee',cardId,value.start]:['account',cardId])});
test('anniversary cycles handle leap days, impossible dates and missing facts',()=>{assert.equal(annualEnd('2024-02-29'),'2025-02-27');assert.equal(annualEnd('2026-10-28'),'2027-10-27');assert.equal(annualEnd('2026-02-30'),'');assert.equal(actualCost(evt('gold',{...fee,charged:null,refund:null})),null);assert.equal(actualCost(evt('gold',fee)),275);assert.equal(actualCost(evt('gold',{...fee,charged:0,refund:0,waiver:'full'})),0);assert.throws(()=>evt('gold',{...fee,refund:400}));assert.throws(()=>evt('gold',{...fee,start:'2026-02-30'}));});
test('debt never nets credit balances; currencies, absent limits and shared limits stay distinct',()=>{
 const input=[{id:'one',name:'one',bank:'Bank',currency:'USD',balance:100,available:900,creditLimit:1000,updated:'2026-10-20'},{id:'two',name:'two',bank:'Bank',currency:'USD',balance:-30,creditLimit:1000,updated:'2026-10-21'},{id:'three',name:'three',bank:'Other',currency:'HKD',balance:500,otherBalance:{CNY:-40}},{id:'four',name:'four',bank:'Bank',currency:'USD',balance:null,available:5000}];
 const configs=['one','two'].map(c=>evt(c,{creditLimit:1000,noPresetLimit:false,limitGroup:'shared'},'account'));
 const rows=portfolioMetrics(input,configs,[],'2026-10-28'),usd=rows.find(r=>r.currency==='USD');assert.equal(usd.debt,100);assert.equal(usd.creditBalance,30);assert.equal(usd.limit,1000);assert.equal(usd.limitMissing,1);assert.equal(usd.balanceMissing,1);assert.equal(rows.find(r=>r.currency==='HKD').debt,500);assert.equal(rows.find(r=>r.currency==='CNY').creditBalance,40);assert.deepEqual(usd.balanceDates,['2026-10-20','2026-10-21']);
 const conflict=[configs[0],evt('two',{creditLimit:1200,noPresetLimit:false,limitGroup:'shared'},'account')];assert.equal(portfolioMetrics(input,conflict,[],'2026-10-28')[0].limit,0);assert.equal(portfolioMetrics(input,conflict,[],'2026-10-28')[0].limitConflicts,1);
});
test('partial credits preserve explicit actual value, snapshots and prior periods',()=>{
 const task=creditTasks(cards,'2026-10-28').find(t=>t.cardId==='gold'),usage={amount:5,value:3,limit:task.limit,currency:task.currency,title:task.title,date:'2026-10-10'},e=validatePersonalEvent({schema:1,id:'usage',key:task.key,status:'partial',revisionId:task.revisionId,at:'2026-10-10T12:00:00.000Z',usage});
 assert.equal(taskStatus(task,[e]),'partial');const cycle=evt('gold',fee);assert.deepEqual(creditValueForCycle(cycle,[e]),{value:3,count:1,unvalued:0});const corrected={...e,id:'new',at:'2026-10-11T12:00:00.000Z',usage:{...usage,value:4}};assert.equal(creditValueForCycle(cycle,[e,corrected]).value,4);assert.equal(creditValueForCycle(evt('gold',{...fee,start:'2025-01-01',end:'2025-12-31'}),[e]).value,0);
 const unvalued={...e,usage:{...usage,value:null}};assert.equal(creditValueForCycle(cycle,[unvalued]).unvalued,1);const zero={...e,usage:{...usage,value:0}};assert.equal(creditValueForCycle(cycle,[zero]).count,1);assert.equal(creditValueForCycle(cycle,[zero]).value,0);
 assert.throws(()=>validatePersonalEvent({...e,usage:{...usage,value:8}}));assert.throws(()=>validatePersonalEvent({...e,usage:{...usage,date:'2026-09-01'}}));
});
test('fee ledger persists corrections, rejects overlaps, supports tombstones and idempotent import',async()=>{
 const first=await appendCostEvent('fee','test-card',fee);assert.equal(actualCost(feeCycles(await readCostEvents(),'test-card')[0]),275);
 await appendCostEvent('fee','test-card',{...fee,refund:100});assert.equal(actualCost(feeCycles(await readCostEvents(),'test-card')[0]),225);
 await assert.rejects(()=>appendCostEvent('fee','test-card',{...fee,start:'2026-06-01',end:'2027-05-31'}));
 await appendCostEvent('fee','test-card',{...fee,deleted:true});assert.equal(feeCycles(await readCostEvents(),'test-card').length,0);
 await appendCostEvent('fee','test-card',{...fee,start:'2026-06-01',end:'2027-05-31'});
 const rows=await readCostEvents();await importCostEvents({schema:1,events:rows});assert.equal((await readCostEvents()).length,rows.length);
 await assert.rejects(()=>importCostEvents({schema:1,events:[{...first,value:{...fee,charged:999}}]}));assert.equal((await readCostEvents()).length,rows.length);
 await assert.rejects(()=>importCostEvents({schema:1,events:[first,{bad:true}]}));assert.equal((await readCostEvents()).length,rows.length);
});
test('extended usage events commit valid observations and reject invalid writes without corrupting old ledger',async()=>{
 const task=creditTasks(cards,'2026-10-28').find(t=>t.cardId==='gold'),usage={amount:1,value:0.5,limit:task.limit,currency:task.currency,title:task.title,date:'2026-10-20'};
 await appendBenefitEvent(task.key,'partial',task.revisionId,{usage});const before=await readBenefitEvents();assert.equal(before.at(-1).usage.value,.5);
 await assert.rejects(()=>appendBenefitEvent(task.key,'partial',task.revisionId,{usage:{...usage,value:900}}));assert.equal((await readBenefitEvents()).length,before.length);
});
