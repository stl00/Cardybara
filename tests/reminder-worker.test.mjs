import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULT_SETTINGS,REMINDER_SENT_KEY,REMINDER_SETTINGS_KEY,buildSchedule,fireTime,mergeSent,pendingNotifications,publishSchedule} from '../src/reminders.js';
import {paymentItem,withPaymentMark} from '../src/paymentStates.js';
import {walletDay} from '../src/personalBenefits.js';
import {REMINDER_ALARM,REMINDER_LOG_KEY,REMINDER_SCHEDULE_KEY,dueNotifications,nextFireAt,readSchedule,reminderDay} from '../extension-next/reminder-core.js';
import {createReminderWorker} from '../extension-next/reminder-worker.js';
const asOf='2026-11-04',read='2026-11-03T15:00:00Z';
const card=(id,fields={})=>({id,bank:'Chase',name:'Synthetic '+id,currency:'USD',updated:'2026-11-03',fieldDates:Object.fromEntries(Object.keys(fields).map(k=>[k,read])),...fields});
const on={...DEFAULT_SETTINGS,enabled:true};
const phrases={bill:'Bill',credit:'Benefit',billSummary:'{0} bills',creditSummary:'{0} benefits',overdue:'{0} days late',dueToday:'due today',dueTomorrow:'due tomorrow',endsToday:'ends today',endsTomorrow:'ends tomorrow',later:'{0} days left',stale:'old reading'};
const plan=(cards,extra={})=>buildSchedule({cards,marks:[],events:[],settings:on,sent:[],asOf,phrases,...extra});
const fixture=JSON.parse(readFileSync(new URL('./fixtures/wallet-products.json',import.meta.url),'utf8')).cards;
const at=(day,hour=12)=>Date.UTC(...day.split('-').map((v,i)=>i===1?v-1:+v),hour+6);
const page=(values={})=>{const m=new Map(Object.entries(values));return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};};
const area=(values={})=>({values,writes:0,async get(keys){return Object.fromEntries([keys].flat().filter(k=>k in this.values).map(k=>[k,structuredClone(this.values[k])]));},async set(next){this.writes++;Object.assign(this.values,structuredClone(next));},async remove(key){delete this.values[key];}});
function fakeChrome({store=area(),notifications=true,failCreate=false}={}){
 const alarms=new Map(),shown=[],listeners={},event=name=>({addListener:f=>{(listeners[name]??=[]).push(f);}});
 return {store,alarms,shown,listeners,fire:(name,...args)=>(listeners[name]||[]).forEach(f=>f(...args)),chrome:{
  storage:{local:store,onChanged:event('changed')},runtime:{getURL:p=>'chrome-extension://x/'+p,onStartup:event('startup'),onInstalled:event('installed')},
  alarms:{onAlarm:event('alarm'),create:async(name,{when})=>{alarms.set(name,when);},clear:async name=>{alarms.delete(name);}},
  permissions:{onAdded:event('added')},
  ...(notifications?{notifications:{onClicked:event('clicked'),create:async(id,options)=>{if(failCreate)throw Error('blocked');shown.push({id,...options});},clear:async()=>true}}:{}),
 }};
}
const worker=(fake,now)=>createReminderWorker({chrome:fake.chrome,now:()=>now});
const seeded=(cards,extra)=>area({[REMINDER_SCHEDULE_KEY]:plan(cards,extra)});

test('the worker uses the wallet calendar and its alarm is not mistaken for a bank timeout',()=>{
 assert.equal(reminderDay(Date.now()),walletDay());
 assert.ok(!REMINDER_ALARM.startsWith('cardybara:'),'background.js fails a bank job for any cardybara: alarm');
});
test('the worker is wired at the service worker top level, and notifications stay optional',()=>{
 const source=readFileSync(new URL('../extension-next/background.js',import.meta.url),'utf8'),manifest=JSON.parse(readFileSync(new URL('../extension-next/manifest.json',import.meta.url),'utf8'));
 assert.match(source,/^createReminderWorker\(\{chrome\}\)\.listen\(\);$/m);
 assert.ok(manifest.permissions.includes('alarms'));assert.ok(!manifest.permissions.includes('notifications'));assert.deepEqual(manifest.optional_permissions,['notifications']);
});
test('reminders fire with no wallet page open and only when due',async()=>{
 const c=card('a',{due:'2026-11-10'}),schedule=plan([c]),[entry]=schedule.entries;
 assert.equal(entry.firstDay,'2026-11-07','three days before the due date');
 assert.equal(entry.fireAt,fireTime('2026-11-07'));
 const early=fakeChrome({store:seeded([c])});await worker(early,at('2026-11-05')).tick();
 assert.deepEqual(early.shown,[]);assert.equal(early.alarms.get(REMINDER_ALARM),entry.fireAt,'waits on an alarm');
 const due=fakeChrome({store:early.store});await worker(due,entry.fireAt).tick();
 assert.equal(due.shown.length,1);assert.equal(due.shown[0].id,entry.id);assert.equal(due.shown[0].title,'Bill');assert.equal(due.shown[0].message,'Synthetic a · 3 days left');assert.match(due.shown[0].iconUrl,/icons\/128\.png$/);
});
test('an alarm or a new schedule wakes the worker, and other events do not',async()=>{
 const f=fakeChrome({store:seeded([card('a',{due:'2026-11-05'})])}),w=createReminderWorker({chrome:f.chrome,now:()=>at('2026-11-04')});w.listen();
 f.fire('alarm',{name:'cardybara:some-bank-attempt'});f.fire('changed',{[REMINDER_LOG_KEY]:{}},'local');f.fire('changed',{[REMINDER_SCHEDULE_KEY]:{}},'session');
 await w.tick();const after=f.shown.length;assert.equal(after,1);
 f.store.values[REMINDER_LOG_KEY]=[];f.fire('alarm',{name:REMINDER_ALARM});await w.tick();
 assert.equal(f.shown.length,2,'a cleared log fires again, proving the alarm reached the worker');
});
test('nothing fires twice, even when wake-ups arrive together or the worker restarts',async()=>{
 const f=fakeChrome({store:seeded([card('a',{due:'2026-11-05'})])}),now=at('2026-11-04'),w=worker(f,now);
 await Promise.all([w.tick(),w.tick(),w.tick()]);assert.equal(f.shown.length,1);
 await worker(f,now+3600000).tick();assert.equal(f.shown.length,1,'a new worker reads the stored log');
 assert.deepEqual(f.store.values[REMINDER_LOG_KEY],[{id:f.shown[0].id,day:asOf}]);
});
test('the page and the worker share one dedupe log',async()=>{
 const c=card('a',{due:'2026-11-05'}),store=area({[REMINDER_LOG_KEY]:[{id:plan([c]).entries[0].id,day:asOf}]}),storage=page({[REMINDER_SETTINGS_KEY]:JSON.stringify(on)});
 const published=await publishSchedule({area:store,storage,granted:true,cards:[c],marks:[],events:[],asOf,phrases});
 assert.deepEqual(published.entries.map(e=>e.id.split(':')[0]),['overdue'],'sent by the worker, so not planned again; passing the date is a separate reminder');
 assert.equal(JSON.parse(storage.getItem(REMINDER_SENT_KEY)).length,1,'the page keeps a copy');
 const shownByPage=page({[REMINDER_SETTINGS_KEY]:JSON.stringify(on),[REMINDER_SENT_KEY]:JSON.stringify([{id:plan([c]).entries[0].id,day:asOf}])});
 assert.deepEqual((await publishSchedule({area:area(),storage:shownByPage,granted:true,cards:[c],marks:[],events:[],asOf,phrases})).entries.map(e=>e.id.split(':')[0]),['overdue'],'shown by the page, so the worker never sees it');
 assert.deepEqual(mergeSent([{id:'a',day:'2026-11-01'}],[{id:'a',day:'2026-11-02'},{id:'b',day:'2026-11-02'}]).map(r=>r.id),['a','b']);
});
test('a bill marked handled stops firing once the page has synced, and undoing brings it back',async()=>{
 const c=card('a',{due:'2026-11-10'}),store=area(),storage=page({[REMINDER_SETTINGS_KEY]:JSON.stringify(on)}),args={area:store,storage,granted:true,cards:[c],events:[],asOf,phrases};
 await publishSchedule({...args,marks:[]});
 const f=fakeChrome({store});await worker(f,at('2026-11-05')).tick();assert.ok(f.alarms.has(REMINDER_ALARM));
 const marks=withPaymentMark([],paymentItem(c,[],asOf).key);
 await publishSchedule({...args,marks});
 await worker(f,at('2026-11-05')).tick();assert.ok(!f.alarms.has(REMINDER_ALARM),'nothing left to wake for');
 await worker(f,at('2026-11-08')).tick();assert.deepEqual(f.shown,[]);
 await publishSchedule({...args,marks:[]});await worker(f,at('2026-11-08')).tick();assert.equal(f.shown.length,1);
});
test('an unchanged plan is not written again, so a sync does not wake the worker',async()=>{
 const store=area(),args={area:store,storage:page({[REMINDER_SETTINGS_KEY]:JSON.stringify(on)}),granted:true,cards:[card('a',{due:'2026-11-05'})],marks:[],events:[],asOf,phrases};
 await publishSchedule(args);await publishSchedule(args);assert.equal(store.writes,1);
});
test('off, or without the permission, no plan stays stored and nothing fires',async()=>{
 const c=card('a',{due:'2026-11-05'});
 for(const [settings,granted] of [[DEFAULT_SETTINGS,true],[on,false]]){
  const store=seeded([c]);assert.equal(await publishSchedule({area:store,storage:page({[REMINDER_SETTINGS_KEY]:JSON.stringify(settings)}),granted,cards:[c],marks:[],events:[],asOf,phrases}),null);
  assert.ok(!(REMINDER_SCHEDULE_KEY in store.values));
  const f=fakeChrome({store});f.alarms.set(REMINDER_ALARM,1);await worker(f,at(asOf)).tick();assert.deepEqual(f.shown,[]);assert.ok(!f.alarms.has(REMINDER_ALARM));
 }
});
test('without the permission nothing is logged, so the reminder can still fire when it returns',async()=>{
 const store=seeded([card('a',{due:'2026-11-05'})]),denied=fakeChrome({store,notifications:false}),w=createReminderWorker({chrome:denied.chrome,now:()=>at(asOf)});w.listen();
 await w.tick();assert.ok(!(REMINDER_LOG_KEY in store.values));assert.ok(!denied.alarms.has(REMINDER_ALARM));
 const back=fakeChrome({store});await worker(back,at(asOf)).tick();assert.equal(back.shown.length,1);
 const failed=fakeChrome({store:seeded([card('a',{due:'2026-11-05'})]),failCreate:true});await worker(failed,at(asOf)).tick();assert.ok(!(REMINDER_LOG_KEY in failed.store.values),'a failed send is not recorded as sent');
});
test('no amount reaches storage unless the user asks for it',()=>{
 const c=card('a',{due:'2026-11-05',statement:123.45,balance:678.9,minimum:25});
 const hidden=JSON.stringify(plan([c]));for(const value of ['123.45','678.9','25'])assert.ok(!hidden.includes(value),value);
 const shown=plan([c],{settings:{...on,showAmounts:true}});assert.match(shown.entries[0].amount,/^USD 123/);
 assert.match(dueNotifications(shown,[],at(asOf))[0].message,/USD 123/);
 const many=[1,2,3,4].map(n=>card('m'+n,{due:'2026-11-05',statement:987})),summary=dueNotifications(plan(many,{settings:{...on,showAmounts:true}}),[],at(asOf));
 assert.equal(summary.length,1);assert.equal(summary[0].message,'4 bills');assert.ok(!JSON.stringify(summary).includes('987'));assert.ok(!JSON.stringify(summary).includes('Synthetic'));
});
test('a late send counts days from today, and a past window is dropped for the overdue reminder',()=>{
 const schedule=plan([card('a',{due:'2026-11-10'})]),bill=schedule.entries.find(e=>e.id.startsWith('bill:')),overdue=schedule.entries.find(e=>e.id.startsWith('overdue:'));
 assert.equal(bill.lastDay,'2026-11-10');assert.equal(overdue.firstDay,'2026-11-11');
 assert.equal(dueNotifications(schedule,[],at('2026-11-09'))[0].message,'Synthetic a · due tomorrow');
 const late=dueNotifications(schedule,[],at('2026-11-13'));assert.deepEqual(late.map(n=>n.id),[overdue.id]);assert.equal(late[0].message,'Synthetic a · 3 days late');
 assert.deepEqual(dueNotifications(schedule,[],at('2026-12-20')),[],'an old reading no longer shows the bill is unpaid');
 assert.equal(nextFireAt(schedule,[],at('2026-12-20')),null);
});
test('the plan agrees with what the page would decide on each coming day',()=>{
 const cards=[...fixture,card('a',{due:'2026-11-10'}),card('b',{due:'2026-11-20',autopay:'on'}),card('h',{due:'2026-11-25'})],marks=withPaymentMark([],paymentItem(cards.at(-1),[],asOf).key);
 const started=performance.now(),schedule=buildSchedule({cards,marks,events:[],settings:{...on,billDays:7,creditDays:7},sent:[],asOf,phrases}),ms=performance.now()-started;
 assert.ok(ms<2000,`planning took ${ms} ms`);assert.ok(schedule.entries.length>0);
 for(const n of [0,1,5,6,7,16,17,30,59]){
  const day=new Date(Date.parse(asOf+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  const expected=pendingNotifications({cards,marks,events:[],settings:{...on,billDays:7,creditDays:7},sent:[],asOf:day}).flatMap(i=>i.ids).sort();
  const planned=schedule.entries.filter(e=>e.firstDay<=day&&day<=e.lastDay).map(e=>e.id).sort();
  assert.deepEqual(planned,expected,day);
 }
});
test('reminders fire at 9am local, never before the wallet day starts',()=>{
 const zone=process.env.TZ;
 try{
  process.env.TZ='America/Chicago';assert.equal(new Date(fireTime('2026-11-10')).getHours(),9);
  process.env.TZ='America/Los_Angeles';assert.equal(new Date(fireTime('2026-11-10')).getHours(),9);
  process.env.TZ='Asia/Hong_Kong';const hk=fireTime('2026-11-10');assert.equal(reminderDay(hk),'2026-11-10','9am in Hong Kong is still the day before in Chicago');assert.equal(new Date(hk).getHours(),14);
 }finally{if(zone===undefined)delete process.env.TZ;else process.env.TZ=zone;}
});
test('a damaged schedule or log fires nothing and does not throw',async()=>{
 for(const bad of [null,'x',{schema:99,enabled:true,entries:[],phrases:{}},{schema:1,enabled:false,entries:[],phrases:{}},{schema:1,enabled:true,entries:'x',phrases:{}}])assert.equal(readSchedule(bad),null);
 const good=plan([card('a',{due:'2026-11-05'})]);good.entries.push({id:1},{id:'x',group:'bills',label:'x',fireAt:'soon',firstDay:asOf,lastDay:asOf,targetDay:asOf});
 assert.equal(readSchedule(good).entries.length,2,'the bill and its later overdue entry remain');
 const f=fakeChrome({store:area({[REMINDER_SCHEDULE_KEY]:good,[REMINDER_LOG_KEY]:'broken'})});await worker(f,at(asOf)).tick();assert.equal(f.shown.length,1);
});
test('clicking a reminder opens or focuses the wallet',async()=>{
 const f=fakeChrome();let created,updated;f.chrome.tabs={query:async()=>[],create:async o=>{created=o;},update:async(id,o)=>{updated={id,...o};}};
 await worker(f,0).clicked('n');assert.equal(created.url,'chrome-extension://x/index.html#overview');
 f.chrome.tabs.query=async()=>[{id:7,windowId:1}];await worker(f,0).clicked('n');assert.equal(updated.id,7);assert.equal(updated.active,true);
});
