import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULT_SETTINGS,billReminders,creditReminders,normalizeSettings,pendingNotifications,pruneSent,readSent,readSettings,REMINDER_SETTINGS_KEY} from '../src/reminders.js';
import {paymentItem,withPaymentMark} from '../src/paymentStates.js';
import {creditTasks} from '../src/personalBenefits.js';
import {translations as i18nCatalog} from '../src/i18n/index.js';
const asOf='2026-11-04',read='2026-11-03T15:00:00Z';
const card=(id,fields={})=>({id,bank:'Chase',name:'Synthetic '+id,currency:'USD',updated:'2026-11-03',fieldDates:Object.fromEntries(Object.keys(fields).map(k=>[k,read])),...fields});
const on={...DEFAULT_SETTINGS,enabled:true};
const run=(cards,extra={})=>pendingNotifications({cards,marks:[],events:[],settings:on,sent:[],asOf,...extra});
const fixture=JSON.parse(readFileSync(new URL('./fixtures/wallet-products.json',import.meta.url),'utf8')).cards;

test('reminders are off by default and hide amounts by default',()=>{
 assert.equal(DEFAULT_SETTINGS.enabled,false);assert.equal(DEFAULT_SETTINGS.showAmounts,false);
 assert.equal(normalizeSettings(null).enabled,false);assert.equal(normalizeSettings({enabled:'yes'}).enabled,false);
 assert.equal(readSettings({getItem(){throw Error('blocked')}}).enabled,false);
 assert.deepEqual(readSettings({getItem:k=>k===REMINDER_SETTINGS_KEY?'{"enabled":true,"billDays":99}':null}),{...DEFAULT_SETTINGS,enabled:true});
 assert.deepEqual(pendingNotifications({cards:[card('a',{due:'2026-11-05'})],marks:[],events:[],settings:DEFAULT_SETTINGS,sent:[],asOf}),[]);
});
test('only a bill inside its lead time fires',()=>{
 assert.deepEqual(billReminders([card('near',{due:'2026-11-07'}),card('far',{due:'2026-11-08'})],[],on,asOf).map(r=>r.name),['Synthetic near']);
 assert.equal(billReminders([card('far',{due:'2026-11-08'})],[],{...on,billDays:7},asOf).length,1);
});
test('handled, autopay, no-payment, unread, yearless and nothing-billed bills never fire',()=>{
 const due=card('h',{due:'2026-11-05'}),marks=withPaymentMark([],paymentItem(due,[],asOf).key);
 assert.deepEqual(billReminders([due],marks,on,asOf),[]);
 for(const fields of [{due:'2026-11-05',autopay:'on'},{due:'2026-11-01',autopay:'on'},{paymentStatus:'No payment due'},{},{statement:40},{duePartial:'11月31日'},{statement:0,minimum:0,due:'2026-11-05'}])
  assert.deepEqual(billReminders([card('x',fields)],[],on,asOf),[],JSON.stringify(fields));
});
test('an old autopay reading no longer counts as covering the bill',()=>{
 const aged=f=>{const c=card('a',f);c.fieldDates.autopay='2026-06-01T15:00:00Z';return c;};
 assert.equal(billReminders([aged({due:'2026-11-03',autopay:'on'})],[],on,asOf)[0].kind,'overdue');
 assert.equal(billReminders([aged({due:'2026-11-05',autopay:'on'})],[],on,asOf)[0].kind,'bill');
 assert.deepEqual(billReminders([aged({due:'2026-12-20',autopay:'on'})],[],on,asOf),[],'outside the lead time');
 assert.equal(billReminders([aged({duePartial:'11月5日',autopay:'on'})],[],on,asOf)[0].kind,'bill','a yearless date is timed from its inferred year');
 assert.deepEqual(billReminders([aged({duePartial:'Smarch 5',autopay:'on'})],[],on,asOf),[],'a month and day that cannot be read still cannot be timed');
});
test('an old passed date does not fire, and an old upcoming date is flagged',()=>{
 const old=f=>{const c=card('o',f);for(const k of Object.keys(c.fieldDates))c.fieldDates[k]='2026-09-01T15:00:00Z';return c;};
 assert.deepEqual(billReminders([old({due:'2026-10-01'})],[],on,asOf),[]);
 assert.equal(billReminders([old({due:'2026-11-05'})],[],on,asOf)[0].stale,true);
});
test('no amount appears unless the user asks for it',()=>{
 const c=card('a',{due:'2026-11-05',statement:123.45});
 assert.ok(!JSON.stringify(run([c])).includes('123.45'));
 assert.equal(run([c],{settings:{...on,showAmounts:true}})[0].statement,123.45);
 const many=[1,2,3,4].map(n=>card('m'+n,{due:'2026-11-05',statement:987}));
 const summary=run(many,{settings:{...on,showAmounts:true}});assert.equal(summary.length,1);assert.equal(summary[0].type,'bill-summary');assert.equal(summary[0].count,4);assert.ok(!JSON.stringify(summary).includes('987'));assert.ok(!JSON.stringify(summary).includes('Synthetic'));
});
test('each bill reminds once per cycle, and passing the due date is a separate reminder',()=>{
 const c=card('a',{due:'2026-11-05'}),first=run([c]);assert.equal(first.length,1);
 const sent=first.flatMap(i=>i.ids.map(id=>({id,day:asOf})));assert.deepEqual(run([c],{sent}),[]);
 assert.equal(run([card('a',{due:'2026-12-05'})],{sent,asOf:'2026-12-04'}).length,1,'a new due date reminds again');
 const late=run([c],{sent,asOf:'2026-11-07'});assert.equal(late.length,1);assert.equal(late[0].type,'overdue');
});
test('credits remind while unconfirmed or partly used, not once used or skipped',()=>{
 const asOfEnd='2026-11-29',tasks=creditTasks(fixture,asOfEnd),monthly=tasks.find(t=>t.period.end==='2026-11-30'),event=status=>({id:status,key:monthly.key,status,revisionId:monthly.revisionId,at:'2026-11-20T00:00:00.000Z'});
 const has=events=>creditReminders(fixture,events,on,asOfEnd).some(r=>r.id===`credit:${monthly.key}`);
 assert.equal(has([]),true);assert.equal(has([event('partial')]),true);assert.equal(has([event('used')]),false);assert.equal(has([event('skipped')]),false);
 assert.ok(creditReminders(fixture,[],on,'2026-11-05').every(r=>r.days<=3));
});
test('choosing only one kind leaves the other silent',()=>{
 const c=card('a',{due:'2026-11-05'});assert.deepEqual(run([c],{settings:{...on,bills:false}}),[]);
 assert.deepEqual(pendingNotifications({cards:fixture,marks:[],events:[],settings:{...on,credits:false},sent:[],asOf:'2026-11-29'}).filter(i=>i.type.startsWith('credit')),[]);
});
test('the sent log tolerates damage and stays bounded',()=>{
 assert.deepEqual(readSent({getItem:()=>'not json'}),[]);assert.deepEqual(readSent({getItem:()=>'[{"id":"a","day":"2026-11-01"},{"id":1}]'}),[{id:'a',day:'2026-11-01'}]);
 assert.deepEqual(pruneSent([{id:'old',day:'2026-01-01'},{id:'new',day:'2026-11-01'}],asOf).map(r=>r.id),['new']);
});
test('notifications stay optional in the package and every string has translations',()=>{
 const build=readFileSync(new URL('../scripts/build-release.py',import.meta.url),'utf8'),manifest=JSON.parse(readFileSync(new URL('../extension-next/manifest.json',import.meta.url),'utf8'));
 assert.ok(!manifest.permissions.includes('notifications'));assert.deepEqual(manifest.optional_permissions,['notifications']);assert.doesNotMatch(build,/optional_permissions/,'the package inherits the manifest and must not list it twice');
 const ui=readFileSync(new URL('../src/ReminderSettings.jsx',import.meta.url),'utf8'),catalog=i18nCatalog;
 for(const [,key] of ui.matchAll(/t\('([^']+)'/g))for(const language of ['en-US','zh-TW'])assert.ok(catalog[language][key],`${language}: ${key}`);
});
test('a yearless bank date reminds on the date its read day implies',()=>{
 const c=card('y',{duePartial:'Jan 2'});c.fieldDates.duePartial='2026-12-29T15:00:00Z';
 assert.deepEqual(billReminders([c],[],on,'2026-12-30').map(r=>[r.id,r.days]),[[`bill:${JSON.stringify(['y','date','2027-01-02'])}`,3]]);
 assert.deepEqual(billReminders([c],[],on,'2026-12-29'),[],'outside the lead time');
});
