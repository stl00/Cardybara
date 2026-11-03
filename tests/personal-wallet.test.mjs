import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {readFileSync} from 'node:fs';
import {creditTasks,taskStatus,reminderTasks,creditCalendar,validatePersonalEvent} from '../src/personalBenefits.js';
import {readBenefitEvents,appendBenefitEvent,importBenefitEvents} from '../src/personalStore.js';
import {parseLocalIntent,validateIntent,recommendCards,searchBenefits} from '../src/spendAdvisor.js';
import {parseAdvisorIntent} from '../scripts/advisor-model.mjs';
const cards=JSON.parse(readFileSync(new URL('./fixtures/wallet-products.json',import.meta.url),'utf8')).cards;
globalThis.window=new EventTarget();
test('credit list uses actual current cycles, no future Canadian / unverified IHG grants',()=>{
 const tasks=creditTasks(cards,'2026-10-28');assert.ok(tasks.length>10);assert.ok(tasks.every(t=>t.period.start<='2026-10-28'&&t.period.end>='2026-10-28'));
 assert.ok(!tasks.some(t=>t.cardId==='chase-b'&&t.title.includes('新版')));
 assert.equal(tasks.find(t=>t.cardId==='ms-platinum'&&t.title==='Uber Cash').limit,15);
 assert.equal(creditTasks(cards,'2026-12-01').find(t=>t.cardId==='ms-platinum'&&t.title==='Uber Cash').limit,35);
 const monthly=tasks.find(t=>t.cardId==='gold'&&t.title==='每月餐饮抵扣');assert.equal(monthly.limit,10);assert.equal(taskStatus(monthly,[]),'unknown');
 const november=creditTasks(cards,'2026-11-01').find(t=>t.ruleId===monthly.ruleId&&t.cardId===monthly.cardId);assert.notEqual(monthly.key,november.key);
 assert.equal(taskStatus(november,[{id:'x',key:monthly.key,status:'used',revisionId:monthly.revisionId,at:'2026-10-28T12:00:00Z'}]),'unknown');
});
test('ledger appends, supports undo, imports idempotently and rejects malformed backup atomically',async()=>{
 const task=creditTasks(cards,'2026-10-28')[0];const initial=(await readBenefitEvents()).length;
 await appendBenefitEvent(task.key,'used',task.revisionId);assert.equal(taskStatus(task,await readBenefitEvents()),'used');
 await appendBenefitEvent(task.key,'unknown',task.revisionId);const events=await readBenefitEvents();assert.equal(events.length,initial+2);assert.equal(taskStatus(task,events),'unknown');
 await assert.rejects(()=>importBenefitEvents({schema:1,events:[{...events[0],status:'skipped'}]}));assert.equal((await readBenefitEvents()).length,events.length);
 await importBenefitEvents({schema:1,events});assert.equal((await readBenefitEvents()).length,events.length);
 await assert.rejects(()=>importBenefitEvents({schema:1,events:[events[0],{bad:true}]}));assert.equal((await readBenefitEvents()).length,events.length);
 assert.equal(taskStatus({...task,revisionId:'changed'},events),'unknown');
 assert.throws(()=>validatePersonalEvent({schema:99}),/invalid/);
});
test('older imported history cannot override a later user mark',()=>{
 const task=creditTasks(cards,'2026-10-28')[0],event={schema:1,key:task.key,revisionId:task.revisionId};
 assert.equal(taskStatus(task,[{...event,id:'new',status:'used',at:'2026-10-28T14:00:00Z'},{...event,id:'old',status:'unused',at:'2026-10-28T13:00:00Z'}]),'used');
});
test('reminders and calendar exclude handled tasks and keep currencies separate',()=>{
 const tasks=creditTasks(cards,'2026-10-28'),one=tasks[0],events=[{id:'done',key:one.key,revisionId:one.revisionId,status:'used',at:'2026-10-28T14:00:00Z'}];
 assert.ok(!reminderTasks(tasks,events,'2026-10-28').some(t=>t.key===one.key));
 const cal=creditCalendar(tasks,events);
 const moved=creditCalendar(tasks,[],3,{now:new Date('2026-10-28T22:00:00Z')});assert.match(moved,/DTSTART:20261028T221000Z/);assert.match(cal,/BEGIN:VCALENDAR/);assert.match(cal,/BEGIN:VALARM/);assert.ok(!cal.replace(/\r\n /g,'').includes(encodeURIComponent(one.key)+'@cardybara'));
});
test('advice clarifies missing context and never equates raw MR / UR with dollars',()=>{
 assert.equal(recommendCards(cards,parseLocalIntent('在餐厅花100用哪张')).kind,'clarify');
 const result=recommendCards(cards,{intent:'recommend',category:'dining',country:'US',currency:'USD',amount:100},{asOf:'2026-10-28'});
 assert.equal(result.winner.cardId,'freedom');assert.equal(result.winner.reward,3);
 assert.equal(result.candidates.find(c=>c.cardId==='reserve').reward,300);assert.equal(result.candidates.find(c=>c.cardId==='gold').reward,400);assert.equal(result.candidates.find(c=>c.cardId==='gold').conditional,true);
 assert.ok(result.candidates.every(c=>c.currency==='USD'));assert.equal(result.candidates.find(c=>c.cardId==='aspire').rewardLabel,'Hilton Honors');assert.equal(result.candidates.find(c=>c.cardId==='aspire').reward,700);assert.equal(result.candidates.find(c=>c.cardId==='atmos').rewardLabel,'Atmos Rewards');
 const large=recommendCards(cards,{intent:'recommend',category:'supermarket',country:'US',currency:'USD',amount:10000},{asOf:'2026-10-28'});assert.equal(large.candidates.find(c=>c.cardId==='blue').reward,null);
 assert.ok(!recommendCards(cards,{intent:'recommend',category:'dining',country:'HK',currency:'HKD',amount:100},{asOf:'2026-10-28'}).candidates.some(c=>c.cardId==='gold'));
});
test('AI output is allowlisted and model request has no wallet payload',async()=>{
 let request;const output=await parseAdvisorIntent({DEEPSEEK_API_KEY:'test-only'},'在美国餐厅花100美元用哪张卡',async(url,options)=>{request={url,...options};return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({intent:'recommend',category:'dining',country:'US',currency:'USD',amount:100,query:'test'})}}]})};});
 assert.equal(output.amount,100);assert.match(request.url,/^https:\/\/api.deepseek.com\//);assert.ok(!request.body.includes('cards'));assert.ok(!request.body.includes('balances'));
 assert.throws(()=>validateIntent({intent:'transfer-money'}),/invalid_intent/);
 assert.equal(validateIntent({intent:'recommend',category:'fake',amount:-1}).category,null);
 await assert.rejects(()=>parseAdvisorIntent({DEEPSEEK_API_KEY:'test',DEEPSEEK_BASE_URL:'https://wrong.test'},'test'));
 const rules=searchBenefits('我有哪些Hilton酒店福利',cards,'2026-10-28');assert.ok(rules.length);assert.ok(rules.every(r=>/hilton/i.test(r.content.title+' '+r.content.summary+' '+r.programmeIds.join(' '))));
});
