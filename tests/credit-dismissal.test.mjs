import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {readFileSync} from 'node:fs';
import {creditTasks,taskStatus,reminderTasks,creditCalendar,validatePersonalEvent,dismissKey,dismissedKeys,activeTasks,dismissedCredits} from '../src/personalBenefits.js';
import {readBenefitEvents,appendBenefitEvent,importBenefitEvents} from '../src/personalStore.js';
import {creditView} from '../src/creditView.js';
import {DEFAULT_SETTINGS,creditReminders,pendingNotifications,buildSchedule} from '../src/reminders.js';
import {referenceCards,creditMark,planIds,decisionIds} from '../evals/fixtures.mjs';
import {queryCredits} from '../src/creditQuery.js';
import {chooseCard} from '../src/cardDecision.js';
import {renderCreditAnswer} from '../src/creditAnswer.js';
import {SYSTEM} from '../src/chatProtocol.js';
// Synthetic wallet only: fixture cards and made-up marks, no one's real usage.
globalThis.window=new EventTarget();
const cards=JSON.parse(readFileSync(new URL('./fixtures/wallet-products.json',import.meta.url),'utf8')).cards;
const DAY='2026-10-28',on={...DEFAULT_SETTINGS,enabled:true,creditDays:7};
const dismissal=(cardId,ruleId,status,at='2026-10-21T00:00:00.000Z')=>({schema:1,id:`${status}-${cardId}-${at}`,key:dismissKey(cardId,ruleId),status,at,revisionId:null});
const mark=(task,status,at='2026-10-20T00:00:00.000Z')=>({schema:1,id:`${status}-${task.key}`,key:task.key,status,at,revisionId:task.revisionId});
const dining=()=>creditTasks(cards,DAY).find(t=>t.cardId==='gold'&&t.title==='每月餐饮抵扣');

test('a dismissal is its own event shape, and other marks cannot borrow it',()=>{
 const task=dining(),ok=dismissal(task.cardId,task.ruleId,'dismissed');
 assert.deepEqual(validatePersonalEvent(ok),ok);
 assert.equal(validatePersonalEvent(dismissal(task.cardId,task.ruleId,'restored')).status,'restored');
 // A cycle key cannot carry a dismissal, a card-and-rule key cannot carry a cycle mark, and a dismissal has no usage or revision.
 assert.throws(()=>validatePersonalEvent({...ok,key:task.key}),/invalid/);
 assert.throws(()=>validatePersonalEvent({...ok,status:'used'}),/invalid/);
 assert.throws(()=>validatePersonalEvent({...ok,revisionId:task.revisionId}),/invalid/);
 assert.throws(()=>validatePersonalEvent({...ok,usage:{amount:1}}),/invalid/);
 assert.throws(()=>validatePersonalEvent({...ok,key:JSON.stringify([task.cardId,'not-a-rule'])}),/invalid/);
});

test('a dismissed credit leaves reminders, the to-do list and the calendar until restored',()=>{
 const tasks=creditTasks(cards,DAY),task=dining(),off=[dismissal(task.cardId,task.ruleId,'dismissed')];
 assert.ok(reminderTasks(tasks,[],DAY,7).some(t=>t.key===task.key),'it reminds before the dismissal');
 assert.ok(!reminderTasks(tasks,off,DAY,7).some(t=>t.key===task.key));
 assert.ok(!activeTasks(tasks,off).some(t=>t.key===task.key));
 assert.equal(activeTasks(tasks,off).length,tasks.length-1,'only that credit on that card is dismissed');
 assert.ok(!creditCalendar(tasks,off).replace(/\r\n /g,'').includes(encodeURIComponent(task.key)+'@cardybara'));
 assert.ok(creditCalendar(tasks,[]).replace(/\r\n /g,'').includes(encodeURIComponent(task.key)+'@cardybara'));
 // It is out of every view: to-do, handled and all.
 for(const state of ['todo','done','all'])assert.ok(!creditView(tasks,off,DAY,{state}).rows.some(r=>r.task.key===task.key),state);
 // Next cycle too: the dismissal is not per cycle.
 const next=creditTasks(cards,'2026-11-28').find(t=>t.ruleId===task.ruleId&&t.cardId===task.cardId);assert.notEqual(next.key,task.key);
 assert.ok(!reminderTasks(creditTasks(cards,'2026-11-28'),off,'2026-11-28',7).some(t=>t.key===next.key));
 // It is listed where it can be restored.
 assert.deepEqual(dismissedCredits(cards,off).map(d=>[d.cardId,d.ruleId,d.title]),[[task.cardId,task.ruleId,'每月餐饮抵扣']]);
 assert.deepEqual(dismissedCredits(cards.filter(c=>c.id!=='gold'),off),[]);
});

test('restoring brings the credit back with its earlier per-cycle mark intact',()=>{
 const tasks=creditTasks(cards,DAY),task=dining();
 const events=[mark(task,'used'),dismissal(task.cardId,task.ruleId,'dismissed'),dismissal(task.cardId,task.ruleId,'restored','2026-10-22T00:00:00.000Z')];
 assert.equal(dismissedKeys(events).size,0);assert.deepEqual(dismissedCredits(cards,events),[]);
 assert.equal(taskStatus(task,events),'used');
 const view=creditView(tasks,events,DAY,{state:'done'});assert.equal(view.rows.find(r=>r.task.key===task.key).status,'used');
 // The latest dismissal event wins, whatever order the log is in.
 assert.equal(dismissedKeys([...events].reverse()).size,0);
 assert.equal(dismissedKeys([...events,dismissal(task.cardId,task.ruleId,'dismissed','2026-10-23T00:00:00.000Z')]).size,1);
});

test('notifications and the worker schedule skip a dismissed credit',()=>{
 const task=dining(),off=[dismissal(task.cardId,task.ruleId,'dismissed')],id='credit:'+task.key;
 const asOf=task.period.end;
 assert.ok(creditReminders(cards,[],on,asOf).some(r=>r.id===id));
 assert.ok(!creditReminders(cards,off,on,asOf).some(r=>r.id===id));
 const ids=events=>pendingNotifications({cards,marks:[],events,settings:{...on,creditDays:1},sent:[],asOf}).flatMap(n=>n.ids);
 assert.ok(ids([]).includes(id));assert.ok(!ids(off).includes(id));
 const plan=events=>buildSchedule({cards,marks:[],events,settings:on,sent:[],asOf:DAY,phrases:{}}).entries.map(e=>e.id);
 assert.ok(plan([]).includes(id));assert.ok(!plan(off).includes(id));
});

test('dismissals export and import with the other marks, and an older backup still imports',async()=>{
 const task=dining();
 await appendBenefitEvent(task.key,'unused',task.revisionId);
 await appendBenefitEvent(dismissKey(task.cardId,task.ruleId),'dismissed',null);
 const exported={schema:1,events:await readBenefitEvents()};
 assert.ok(dismissedKeys(exported.events).has(dismissKey(task.cardId,task.ruleId)));
 // A fresh browser imports the backup and ends up in the same state.
 await new Promise((resolve,reject)=>{const req=indexedDB.deleteDatabase('cardybara-personal');req.onsuccess=resolve;req.onerror=reject;});
 assert.deepEqual(await readBenefitEvents(),[]);
 await importBenefitEvents(JSON.parse(JSON.stringify(exported)));
 const restored=await readBenefitEvents();
 assert.deepEqual(dismissedCredits(cards,restored).map(d=>d.ruleId),[task.ruleId]);
 assert.equal(taskStatus(task,restored),'unused');
 // Importing again is idempotent; restoring appends and keeps the cycle mark.
 await importBenefitEvents(exported);assert.equal((await readBenefitEvents()).length,2);
 await appendBenefitEvent(dismissKey(task.cardId,task.ruleId),'restored',null);
 const after=await readBenefitEvents();assert.equal(dismissedKeys(after).size,0);assert.equal(taskStatus(task,after),'unused');
 // A backup from before dismissals existed has only cycle marks and imports unchanged.
 await importBenefitEvents({schema:1,events:[mark(task,'skipped','2026-10-19T00:00:00.000Z')]});
 assert.equal(dismissedKeys(await readBenefitEvents()).size,0);
});

const {CSR,EDIT}=planIds,{GOLD,GOLD_DINING}=decisionIds;
const cardOf=productId=>referenceCards.find(c=>c.productId===productId);
const plan=(events,use='hotel')=>queryCredits({use,when:'12月'},{cards:referenceCards,events,day:'2026-11-04'});
const all=result=>Object.entries(result.groups).flatMap(([group,items])=>items.map(i=>({group,...i})));

test('query_credits puts a dismissed credit in its own group, never used or unused',()=>{
 const title='The Edit 酒店抵扣',used=creditMark(CSR,EDIT,'2026-01-01','2026-12-31','unused');
 const off=dismissal(cardOf(CSR).id,EDIT,'dismissed');
 const before=plan([used]);assert.equal(before.groups.markedUnused.filter(i=>i.title===title).length,1);assert.deepEqual(before.groups.dismissedByUser,[]);
 const r=plan([used,off]),rows=all(r).filter(i=>i.title===title&&i.card===cardOf(CSR).name);
 assert.deepEqual(rows.map(i=>i.group),['dismissedByUser']);
 assert.equal(rows[0].status,'dismissed-by-user');assert.equal(rows[0].publicLimit,undefined);assert.equal(rows[0].cycle,undefined);
 assert.equal(r.groupCounts.dismissedByUser,1);assert.match(r.statusMeaning['dismissed-by-user'],/neither used nor unused/);
 assert.ok(!r.needsEnrollmentOrChannel.some(x=>x.title===title&&x.card===cardOf(CSR).name));
 // Restoring puts it back in the group its own mark decides.
 const back=plan([used,off,dismissal(cardOf(CSR).id,EDIT,'restored','2026-10-22T00:00:00.000Z')]);
 assert.equal(back.groups.markedUnused.filter(i=>i.title===title).length,1);assert.deepEqual(back.groups.dismissedByUser,[]);
 // The fallback answer and the prompt both name the group without calling it used or unused.
 assert.match(renderCreditAnswer(r,'12月酒店 credit 还有吗'),/你标记为不再提醒/);
 assert.match(renderCreditAnswer(r,'hotel credits in December?'),/You chose to stop reminders for these/);
 assert.match(SYSTEM,/dismissedByUser means the user chose to stop reminders/);
});

test('choose_card counts no value for a dismissed credit',()=>{
 const wallet={cards:referenceCards,day:'2026-11-05'},grubhub={category:'dining',amount:30,currency:'USD',country:'US',merchant:'Grubhub'};
 const unused=creditMark(GOLD,GOLD_DINING,'2026-11-01','2026-11-30','unused'),gold=cardOf(GOLD);
 const row=r=>r.rows.find(x=>x.card===gold.name);
 const counted=chooseCard(grubhub,{...wallet,events:[unused]});
 assert.deepEqual(row(counted).countedCredit,{title:'每月餐饮抵扣',value:10});
 const off=chooseCard(grubhub,{...wallet,events:[unused,dismissal(gold.id,GOLD_DINING,'dismissed')]});
 assert.equal(row(off).countedCredit,null);assert.ok(!row(off).credits.some(c=>c.title==='每月餐饮抵扣'));assert.ok(row(counted).credits.some(c=>c.title==='每月餐饮抵扣'));
 assert.ok(!off.couldChange.some(c=>c.title==='每月餐饮抵扣'));
 assert.ok(off.choice.value<counted.choice.value||off.choice.card!==counted.choice.card);
});
