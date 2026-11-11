import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {paymentGroup,paymentItem,paymentView,paymentRank,paymentKey,paymentCycle,withPaymentMark,withoutPaymentMark,mergePaymentMarks,readPaymentMarks,PAYMENT_MARKS_KEY,VISIBLE_ITEMS,isHandled} from '../src/paymentStates.js';
const today='2026-11-04',read='2026-11-03T15:00:00Z';
const card=(fields={},id='a')=>({id,bank:'Chase',name:'Synthetic '+id,currency:'USD',updated:'2026-11-03',fieldDates:Object.fromEntries(Object.keys(fields).map(k=>[k,read])),...fields});
const item=(fields,marks=[])=>paymentItem(card(fields),marks,today);

test('each payment state stays distinct',()=>{
 assert.equal(item({due:'2026-11-02',statement:10}).state,'overdue');
 assert.equal(item({due:'2026-11-06',statement:10}).state,'due');
 assert.equal(item({due:'2026-11-06'}).soon,true);
 assert.equal(item({due:'2026-11-30'}).soon,false);
 assert.equal(item({due:'2026-11-06',autopay:'on'}).state,'autopay');
 assert.equal(item({autopay:'on'}).state,'autopay');
 assert.equal(item({duePartial:'11月6日'}).state,'due','a yearless bank date gets its year from the read day');
 assert.equal(item({duePartial:'11月31日'}).state,'yearless','only a month and day that cannot be read stay yearless');
 assert.equal(item({paymentStatus:'No payment due'}).state,'no_payment');
 assert.equal(item({}).state,'unknown');
});
test('unknown amounts stay unknown and amounts alone do not invent a due date',()=>{
 const none=item({});assert.equal(none.card.statement,undefined);assert.equal(none.card.minimum,undefined);assert.equal(none.readAt,null);assert.equal(none.autopay,'unknown');assert.equal(none.canMark,false);
 const amounts=item({statement:50});assert.equal(amounts.state,'unknown');assert.equal(amounts.cycle,null);
 assert.equal(item({statement:0,due:'2026-11-06'}).card.statement,0,'a read zero is kept as read');
});
test('a yearless date takes its year from the read day, not today',()=>{
 const inferred=item({duePartial:'Nov 6'});assert.deepEqual(inferred.cycle,{kind:'date',date:'2026-11-06',field:'duePartial',inferred:true,label:'Nov 6'});assert.equal(inferred.days,2);assert.equal(inferred.soon,true);
 assert.equal(paymentKey(inferred.card,inferred.cycle),JSON.stringify(['a','date','2026-11-06']));
 // Read on 20 December: still January of the next year when looked at in February.
 const late=card({duePartial:'Jan 15',statement:10});late.fieldDates.duePartial=late.fieldDates.statement='2026-12-20T18:00:00Z';
 const feb=paymentItem(late,[],'2027-02-01');assert.equal(feb.cycle.date,'2027-01-15');assert.equal(feb.state,'stale','an old reading is not called overdue');
 assert.equal(paymentItem(late,[],'2026-12-21').days,25);
 const unread=item({duePartial:'Smarch 6'});assert.deepEqual(unread.cycle,{kind:'yearless',field:'duePartial',label:'Smarch 6'});assert.equal(unread.days,null);assert.equal(unread.soon,false);
 assert.ok(!paymentKey(unread.card,unread.cycle).includes('2026'));
 for(const bad of ['2026-02-30','11/06','2026-13-01'])assert.equal(paymentCycle(card({due:bad})),null,bad);
});
test('the latest reading decides between a full date and a yearless one',()=>{
 const c=card({due:'2026-11-06',duePartial:'12月6日'});c.fieldDates.due='2026-10-01T00:00:00Z';assert.deepEqual(paymentCycle(c),{kind:'date',date:'2026-12-06',field:'duePartial',inferred:true,label:'12月6日'});
 c.fieldDates.due='2026-11-04T00:00:00Z';assert.deepEqual(paymentCycle(c),{kind:'date',date:'2026-11-06',field:'due'},'a full date from the bank wins');
});
test('old readings are labelled, and an old reading is not called overdue',()=>{
 const old=f=>{const c=card(f);for(const k of Object.keys(c.fieldDates))c.fieldDates[k]='2026-10-01T15:00:00Z';return paymentItem(c,[],today);};
 assert.equal(old({due:'2026-11-06'}).state,'due');assert.equal(old({due:'2026-11-06'}).stale,true);
 assert.equal(old({due:'2026-10-20'}).state,'stale');
 assert.equal(old({paymentStatus:'No payment due'}).state,'no_payment');assert.equal(old({paymentStatus:'No payment due'}).stale,true);
 assert.equal(item({due:'2026-11-06'}).stale,false);
 const mixed=card({due:'2026-11-06',statement:5});mixed.fieldDates.statement='2026-10-01T15:00:00Z';const row=paymentItem(mixed,[],today);assert.equal(row.stale,true);assert.equal(row.readAt,'2026-10-01','the oldest field on the row is the one shown');
 const undated=card({due:'2026-11-06'});undated.fieldDates={};delete undated.updated;const none=paymentItem(undated,[],today);assert.equal(none.readAt,null);assert.equal(none.stale,true);
});
test('a bank no-payment statement replaces an older due date',()=>{
 const c=card({due:'2026-11-06',minimum:25,paymentStatus:'No payment due'});c.fieldDates.due=c.fieldDates.minimum='2026-10-01T15:00:00Z';
 const row=paymentItem(c,[],today);assert.equal(row.state,'no_payment');assert.equal(row.canMark,false);
});
test('autopay does not hide a passed due date, but ranks below an unpaid one',()=>{
 const covered=item({due:'2026-11-02',autopay:'on'}),plain=item({due:'2026-11-02'});assert.equal(covered.state,'overdue');assert.ok(paymentRank(plain)<paymentRank(covered));
});
test('overview shows the most urgent bills first and rolls up the rest',()=>{
 const cards=[card({},'unknown1'),card({},'unknown2'),card({paymentStatus:'No payment due'},'none'),card({due:'2026-11-30'},'later'),card({duePartial:'11月6日'},'inferred'),card({due:'2026-11-05'},'tomorrow'),card({due:'2026-11-09'},'soon'),card({due:'2026-11-01'},'late'),card({due:'2026-11-05',autopay:'on'},'auto')];
 const view=paymentView(cards,[],today);
 assert.deepEqual(view.top.map(i=>i.card.id),['late','tomorrow','inferred','soon']);assert.equal(view.top.length,VISIBLE_ITEMS);
 assert.deepEqual(view.rest.map(i=>i.card.id),['later','auto','none','unknown1','unknown2']);
 assert.deepEqual(view.refresh.map(i=>i.card.id),['unknown1','unknown2']);assert.equal(view.urgent,4);assert.equal(view.action,5);
 assert.deepEqual(paymentView([],[],today).top,[]);
});
test('handled applies to one cycle and comes back for the next bill',()=>{
 const c=card({due:'2026-11-06'}),key=paymentItem(c,[],today).key,marks=withPaymentMark([],key,'2026-11-04T10:00:00.000Z');
 const view=paymentView([c],marks,today);assert.equal(view.top.length,0);assert.equal(view.handled.length,1);assert.equal(view.action,0);
 assert.equal(paymentItem(card({due:'2026-12-06'}),marks,today).handled,false);
 assert.equal(paymentItem(c,withoutPaymentMark(marks,key),today).handled,false);
 assert.equal(withPaymentMark(marks,key).length,1,'marking twice keeps one mark');
});
test('a yearless mark does not silently cover the same date next year',()=>{
 const key=JSON.stringify(['a','yearless','11月6日']),marks=[{key,at:'2026-11-01T00:00:00.000Z'}];
 assert.equal(isHandled(key,marks,'2026-11-20'),true);assert.equal(isHandled(key,marks,'2027-11-01'),false);
 // A mark made on the label before years were inferred still covers the inferred date, within the same window.
 assert.equal(item({duePartial:'11月6日'},marks).handled,true);
 const legacy=item({duePartial:'11月6日'},marks);assert.equal(legacy.legacyKey,key);
 assert.equal(item({duePartial:'11月6日'},withoutPaymentMark(marks,legacy.key,legacy.legacyKey)).handled,false,'undo clears a mark made before the year was inferred');
 const next=card({duePartial:'11月6日'});next.fieldDates.duePartial='2027-11-01T15:00:00Z';assert.equal(paymentItem(next,marks,'2027-11-02').handled,false);
});
test('marks tolerate damaged storage and backup restore rejects malformed files',()=>{
 const store=value=>({getItem:k=>k===PAYMENT_MARKS_KEY?value:null}),good={key:JSON.stringify(['a','date','2026-11-06']),at:'2026-11-04T10:00:00.000Z'};
 assert.deepEqual(readPaymentMarks(store('not json')),[]);assert.deepEqual(readPaymentMarks(store(JSON.stringify([good,{key:'x',at:'y'},null]))),[good]);
 assert.deepEqual(readPaymentMarks({getItem(){throw Error('blocked')}}),[]);
 assert.throws(()=>mergePaymentMarks([],{schema:1,marks:[good,{key:'bad',at:'2026-11-04T10:00:00.000Z'}]}),/invalid_payment_backup/);
 assert.throws(()=>mergePaymentMarks([],{schema:2,marks:[]}),/invalid_payment_backup/);
 const later={...good,at:'2026-11-05T10:00:00.000Z'};assert.deepEqual(mergePaymentMarks([later],{schema:1,marks:[good]}),[later]);
});
test('an unusable or future reading date counts as unknown, not fresh',()=>{
 for(const bad of ['2026-13-01','not a date','2099-01-01T00:00:00Z']){
  const c=card({due:'2026-11-01'});c.fieldDates.due=bad;const row=paymentItem(c,[],today);
  assert.equal(row.readAt,null,bad);assert.equal(row.stale,true,bad);assert.equal(row.state,'stale',bad);
 }
});
test('only the due date reading decides overdue, and the old field is still labelled',()=>{
 const c=card({due:'2026-11-03',autopay:'off',statement:5});c.fieldDates.autopay='2026-09-01T15:00:00Z';
 const row=paymentItem(c,[],today);assert.equal(row.state,'overdue');assert.equal(row.stale,true);assert.equal(row.readAt,'2026-09-01');
 assert.deepEqual(paymentView([c],[],today).top.map(i=>i.card.id),['a']);
});
test('a statement read as zero is not a bill to act on, and is not called no payment due',()=>{
 for(const fields of [{statement:0,minimum:0,due:'2026-11-05'},{statement:0,due:'2026-11-01'},{statement:-3,minimum:0,due:'2026-11-05',autopay:'on'}]){
  const row=item(fields);assert.equal(row.state,'nothing_billed');assert.equal(row.canMark,false);assert.equal(paymentView([row.card],[],today).action,0);
 }
 assert.equal(item({statement:0,minimum:25,due:'2026-11-05'}).state,'due','a read minimum still has to be paid');
 assert.equal(item({minimum:0,due:'2026-11-05'}).state,'due','an unread statement is not zero');
 const older=card({statement:0,due:'2026-11-05'});older.fieldDates.statement='2026-09-01T15:00:00Z';assert.equal(paymentItem(older,[],today).state,'due','an older zero statement does not hide a newer due date');
 const undated=card({statement:0,due:'2026-11-05'});undated.fieldDates.statement='not a date';assert.equal(paymentItem(undated,[],today).state,'due');
});
test('old readings are filtered with the rollup they are counted in',()=>{
 const old=card({autopay:'on',due:'2026-11-20'});for(const k of Object.keys(old.fieldDates))old.fieldDates[k]='2026-09-01T15:00:00Z';
 assert.equal(paymentGroup(paymentItem(old,[],today)),'unknown');assert.equal(paymentGroup(item({autopay:'on'})),'autopay');
 assert.equal(paymentGroup(item({statement:0})),'nothing_billed','never filed under the bank saying no payment is due');
});
test('a mark dated in the future is ignored so it cannot outlive its cycle',()=>{
 const future={key:JSON.stringify(['a','yearless','11月6日']),at:'2099-01-01T00:00:00.000Z'};
 assert.deepEqual(readPaymentMarks({getItem:()=>JSON.stringify([future])}),[]);
 assert.throws(()=>mergePaymentMarks([],{schema:1,marks:[future]}),/invalid_payment_backup/);
 assert.equal(isHandled(future.key,[future],today),false);
});
test('the assistant keeps the wallet read-only and has all its strings in three languages',()=>{
 const ui=readFileSync(new URL('../src/PaymentAssistant.jsx',import.meta.url),'utf8'),catalog=JSON.parse(readFileSync(new URL('../src/translations.json',import.meta.url),'utf8'));
 const keys=[...ui.matchAll(/t\('([^']+)'/g),...ui.matchAll(/\['[a-z_]+','([^']+)'\]/g)].map(m=>m[1]);assert.ok(keys.length>20);
 for(const key of keys)for(const language of ['en-US','zh-TW'])assert.ok(catalog[language][key],`${language}: ${key}`);
 assert.doesNotMatch(ui,/fetch\(|sendCollector|postMessage/,'marking a bill only touches local storage');
});
