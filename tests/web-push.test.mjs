// #381: Web Push reminders on the web wallet. The page sends the gateway fire times only; the service worker writes the
// text from the plan the page keeps in IndexedDB. Everything here is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {DEFAULT_SETTINGS,buildSchedule,publishSchedule} from '../src/reminders.js';
import {createWebPush,debounce,newDeviceId,pushSupport,pushTimes,readState,PUSH_STATE_KEY} from '../src/webPush.js';
import {PUSH_GENERIC_KEY,REMINDER_LOG_KEY,REMINDER_SCHEDULE_KEY,mirrorArea} from '../src/pushMirror.js';
import {handleClick,handlePush} from '../web/push-worker.js';
import {dueNotifications,readSchedule} from '../extension-next/reminder-core.js';
import {readFileSync} from 'node:fs';

const asOf='2026-11-04',read='2026-11-03T15:00:00Z',now=Date.parse('2026-11-04T15:00:00Z');
const card=(id,name,fields={})=>({id,bank:'Chase',name,currency:'USD',updated:'2026-11-03',fieldDates:Object.fromEntries(Object.keys(fields).map(k=>[k,read])),...fields});
const cards=[card('a','Synthetic Alpha 9999',{due:'2026-11-05',statement:123.45,last4:'9999'}),card('b','Synthetic Beta',{due:'2026-11-06'}),card('c','Synthetic Gamma',{feeDate:{month:11,day:9}})];
const settings={...DEFAULT_SETTINGS,enabled:true,billDays:7,feeDays:7};
const phrases={bill:'Bill reminder',credit:'Benefit reminder',billSummary:'{0} bills due',creditSummary:'{0} benefits ending',overdue:'{0} days past due',dueToday:'Due today',dueTomorrow:'Due tomorrow',endsToday:'Ends today',endsTomorrow:'Ends tomorrow',later:'{0} days left',stale:'Reading is old'};
const schedule=()=>buildSchedule({cards,marks:[],events:[],settings,sent:[],asOf,phrases});
const fakeStorage=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};

test('the fire-time list is the extension schedule\'s entries, as times and kind codes',()=>{
 const plan=schedule(),times=pushTimes(plan,now);
 assert.ok(plan.entries.length>=3);
 assert.equal(times.length,new Set(plan.entries.map(e=>Math.floor(e.fireAt/1000)+':'+(e.group==='credits'?'credit':e.id.startsWith('fee:')?'fee':'payment'))).size);
 for(const e of plan.entries){
  const kind=e.group==='credits'?'credit':e.id.startsWith('fee:')?'fee':'payment';
  assert.ok(times.some(t=>t.at===Math.floor(e.fireAt/1000)&&t.kind===kind),e.id);
 }
 assert.ok(times.some(t=>t.kind==='fee'));assert.ok(times.some(t=>t.kind==='payment'));
 assert.deepEqual(times,[...times].sort((a,b)=>a.at-b.at||(a.kind<b.kind?-1:1)));
});

test('the list is bounded to what the gateway accepts and carries nothing else',()=>{
 const entry=(n,extra={})=>({id:'bill:'+n,group:'bills',label:'x',fireAt:now+n*60000,...extra});
 const many=pushTimes({entries:Array.from({length:300},(_,n)=>entry(n))},now);
 assert.equal(many.length,200);
 assert.deepEqual(pushTimes({entries:[entry(1,{fireAt:now-3*86400000}),entry(2,{fireAt:now+401*86400000}),entry(3,{fireAt:NaN})]},now),[]);
 for(const t of pushTimes(schedule(),now))assert.deepEqual(Object.keys(t).sort(),['at','kind']);
});

function pushEnv({permission='granted',times}={}){
 const calls=[],storage=fakeStorage();
 const sub={toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/synthetic',keys:{p256dh:'P'.repeat(87),auth:'A'.repeat(22)}}),unsubscribe:async()=>{calls.push(['unsubscribe']);return true;}};
 let current=null;
 const nav={serviceWorker:{ready:Promise.resolve({pushManager:{subscribe:async o=>{calls.push(['subscribe',o.userVisibleOnly,o.applicationServerKey.length]);current=sub;return sub;},getSubscription:async()=>current}})}};
 const fetchFn=async(url,init)=>{calls.push([init.method,url,init.body?JSON.parse(init.body):null]);return url.endsWith('/v1/push/key')?new Response(JSON.stringify({publicKey:'BAEB'.repeat(21)+'BAE'}),{status:200}):new Response('{}',{status:200});};
 const Notification={permission,requestPermission:async()=>{calls.push(['permission']);return 'granted';}};
 return {calls,storage,push:createWebPush({gateway:'https://gateway.test',fetchFn,storage,nav,win:{},Notification,random:n=>new Uint8Array(n).fill(7)})};
}

test('enabling subscribes with the gateway key; the PUT holds a device id, the subscription and times only',async()=>{
 const {push,calls,storage}=pushEnv({permission:'default'});
 await push.enable();
 assert.deepEqual(calls.map(c=>c[0]),['permission','GET','subscribe']);
 assert.equal(calls[2][1],true);
 const times=pushTimes(schedule(),now);
 assert.equal(await push.sync(times),true);
 const put=calls.find(c=>c[0]==='PUT');
 assert.equal(put[1],'https://gateway.test/v1/push');
 assert.deepEqual(Object.keys(put[2]).sort(),['device','subscription','times']);
 assert.match(put[2].device,/^[A-Za-z0-9_-]{22,43}$/);
 const text=JSON.stringify(put[2]);
 for(const secret of ['Synthetic','Alpha','9999','123.45','2026-11','USD','Chase'])assert.ok(!text.includes(secret),secret);
 assert.equal(await push.sync(times),false,'an unchanged list is not sent again');
 assert.equal(await push.sync(times.slice(1)),true);
 assert.equal(readState(storage).subscribed,true);
});

test('turning reminders off deletes the device; no cards deletes it too and a later card sends it again',async()=>{
 const {push,calls,storage}=pushEnv();
 await push.enable();await push.sync(pushTimes(schedule(),now));
 assert.equal(await push.forget(),true);
 const del=calls.find(c=>c[0]==='DELETE');
 assert.deepEqual(Object.keys(del[2]),['device']);
 assert.equal(await push.forget(),false,'nothing left to delete');
 assert.equal(await push.sync(pushTimes(schedule(),now)),true,'a card added later sends the list again');
 await push.disable();
 assert.equal(calls.filter(c=>c[0]==='DELETE').length,2);
 assert.ok(calls.some(c=>c[0]==='unsubscribe'));
 assert.equal(storage.getItem(PUSH_STATE_KEY),null);
 assert.equal(push.active(),false);
});

test('a refused permission subscribes nothing',async()=>{
 const env=pushEnv({permission:'default'});
 const denied=createWebPush({gateway:'https://gateway.test',fetchFn:async()=>{throw Error('no network call expected');},storage:env.storage,nav:{serviceWorker:{ready:new Promise(()=>{})}},win:{},Notification:{permission:'default',requestPermission:async()=>'denied'}});
 await assert.rejects(denied.enable(),/push_denied/);
 assert.equal(denied.active(),false);
});

test('device ids have the shape the gateway accepts, and iOS needs the Home Screen first',()=>{
 assert.match(newDeviceId(),/^[A-Za-z0-9_-]{22}$/);
 assert.notEqual(newDeviceId(),newDeviceId());
 const base={nav:{serviceWorker:{},userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'},win:{PushManager:{}},Notification:{}};
 assert.equal(pushSupport(base),'install');
 assert.equal(pushSupport({...base,nav:{...base.nav,standalone:true}}),'ready');
 assert.equal(pushSupport({...base,win:{PushManager:{},matchMedia:()=>({matches:true})}}),'ready');
 assert.equal(pushSupport({nav:{serviceWorker:{},userAgent:'Mozilla/5.0 (X11; Linux)'},win:{PushManager:{}},Notification:{}}),'ready');
 assert.equal(pushSupport({nav:{userAgent:'Mozilla/5.0 (X11; Linux)'},win:{},Notification:{}}),'unsupported');
});

test('debounce keeps only the last call',()=>{
 const timers=[],ran=[];
 const d=debounce(v=>ran.push(v),1000,{set:fn=>timers.push(fn)&&timers.length,clear:id=>{timers[id-1]=null;}});
 d(1);d(2);d(3);
 for(const fn of timers)fn?.();
 assert.deepEqual(ran,[3]);
});

// --- service worker, on a synthetic wallet plan in (fake) IndexedDB ---
async function mirror(plan){
 const area=mirrorArea();
 await area.set({[REMINDER_SCHEDULE_KEY]:plan,[PUSH_GENERIC_KEY]:{title:'Cardybara',body:'Open the wallet to see what is due soon.'}});
 return area;
}
const shown=()=>{const list=[];return {list,show:async(title,body,tag)=>{list.push({title,body,tag});}};};

test('a push shows the wallet\'s reminder text, the same as the extension worker',async()=>{
 const plan=schedule(),area=await mirror(plan),out=shown();
 const at=Math.max(...plan.entries.map(e=>e.fireAt));
 await handlePush({area,show:out.show,now:at});
 const expected=dueNotifications(readSchedule(plan),[],at);
 assert.ok(expected.length>=1);
 assert.deepEqual(out.list.map(n=>[n.title,n.body,n.tag]),expected.map(n=>[n.title,n.message,n.id]));
 assert.ok(out.list.some(n=>n.body.includes('Synthetic Alpha 9999')||n.body.includes('Synthetic Beta')||n.body.includes('bills')),'the text names the wallet\'s own card (or summarises)');
 // The sent log is kept, so a second push does not repeat them.
 const log=(await area.get([REMINDER_LOG_KEY]))[REMINDER_LOG_KEY];
 assert.ok(log.length>=1);
 const again=shown();
 await handlePush({area,show:again.show,now:at});
 assert.deepEqual(again.list.map(n=>n.title),['Cardybara'],'nothing due now: the generic line');
});

test('the text follows the language the page saved, and a push with no plan shows a generic line',async()=>{
 const zh={...phrases,bill:'账单提醒',dueTomorrow:'明天到期',dueToday:'今天到期',later:'还有 {0} 天'};
 const plan=buildSchedule({cards:[cards[0]],marks:[],events:[],settings,sent:[],asOf,phrases:zh});
 const area=await mirror(plan),out=shown();
 await handlePush({area,show:out.show,now:plan.entries[0].fireAt});
 assert.equal(out.list[0].title,'账单提醒');
 assert.match(out.list[0].body,/Synthetic Alpha 9999 · /);
 await area.remove(REMINDER_SCHEDULE_KEY);await area.remove(PUSH_GENERIC_KEY);
 const bare=shown();
 await handlePush({area,show:bare.show,now:plan.entries[0].fireAt});
 assert.deepEqual(bare.list.map(n=>n.tag),['cardybara-push']);
 assert.ok(bare.list[0].title&&bare.list[0].body);
});

test('the page publishes the plan into the same store with publishSchedule, and off removes it',async()=>{
 const storage=fakeStorage();storage.setItem('cardybara-reminders-v1',JSON.stringify(settings));
 const area=mirrorArea();
 const plan=await publishSchedule({area,storage,granted:true,cards,marks:[],events:[],asOf,phrases});
 assert.equal((await area.get([REMINDER_SCHEDULE_KEY]))[REMINDER_SCHEDULE_KEY].entries.length,plan.entries.length);
 storage.setItem('cardybara-reminders-v1',JSON.stringify({...settings,enabled:false}));
 assert.equal(await publishSchedule({area,storage,granted:true,cards,marks:[],events:[],asOf,phrases}),null);
 assert.deepEqual(await area.get([REMINDER_SCHEDULE_KEY]),{});
});

test('a click focuses the open wallet or opens one',async()=>{
 const calls=[];
 const win={url:'https://wallet.test/#cards',focus:async()=>calls.push('focus'),navigate:async u=>calls.push(['navigate',u])};
 await handleClick({origin:'https://wallet.test',clients:{matchAll:async()=>[win],openWindow:async u=>calls.push(['open',u])}});
 assert.deepEqual(calls,['focus',['navigate','https://wallet.test/#overview']]);
 calls.length=0;
 await handleClick({origin:'https://wallet.test',clients:{matchAll:async()=>[],openWindow:async u=>calls.push(['open',u])}});
 assert.deepEqual(calls,[['open','https://wallet.test/#overview']]);
});

test('the web platform has Web Push, the extension and dev builds do not use it',()=>{
 const src=readFileSync(new URL('../src/platform/web.js',import.meta.url),'utf8');
 assert.match(src,/get push\(\)/);
 assert.match(src,/export const dev=\{[\s\S]*notifications:\{worker:false\}/);
});

// #445: a tapped reminder opens its card. The id stays local: it is in the page's plan and the notification, never in the gateway body.
import {cardHash,cardRouteId} from '../src/cardRoute.js';
const memArea=init=>{const m={...init};return {get:async ks=>Object.fromEntries(ks.filter(k=>k in m).map(k=>[k,m[k]])),set:async o=>void Object.assign(m,o),remove:async k=>void delete m[k]};};

test('entries carry the local card id; the id and card details never reach the gateway body',async()=>{
 const plan=schedule();
 assert.equal(plan.entries.find(e=>e.id.startsWith('fee:')).cardId,'c');
 assert.deepEqual(plan.entries.filter(e=>e.id.startsWith('bill:')).map(e=>e.cardId).sort(),['a','b']);
 assert.ok(readSchedule(plan).entries.every(e=>typeof e.cardId==='string'));
 const {push,calls}=pushEnv({permission:'default'});
 await push.enable();await push.sync(pushTimes(plan,now));
 const body=JSON.stringify(calls.find(c=>c[0]==='PUT')[2]);
 for(const secret of ['"cardId"','Synthetic','9999','123.45','"a"','"b"','"c"'])assert.ok(!body.includes(secret),secret);
});

test('a click on a single reminder opens that card; summaries and cardless entries open the overview',async()=>{
 const plan=schedule(),shown=[];
 await handlePush({area:memArea({[REMINDER_SCHEDULE_KEY]:plan}),show:async(t,b,tag,url)=>shown.push({tag,url}),now});
 const fee=shown.find(s=>s.tag.startsWith('fee:'));
 assert.equal(fee.url,'/'+cardHash('c'));
 assert.equal(cardRouteId(fee.url.slice(1)),'c');
 const bill=shown.find(s=>s.tag.startsWith('bill:'));
 assert.equal(cardRouteId(bill.url.slice(1)),plan.entries.find(e=>e.id===bill.tag).cardId);
 const opened=[];
 await handleClick({origin:'https://wallet.test',url:fee.url,clients:{matchAll:async()=>[],openWindow:async u=>opened.push(u)}});
 assert.deepEqual(opened,['https://wallet.test/#card/c']);
 // many due at once: one summary, no card
 const many={...plan,entries:Array.from({length:4},(_,n)=>({id:'bill:x'+n,group:'bills',label:'x',fireAt:now-1000,firstDay:'2026-11-04',lastDay:'2026-11-09',targetDay:'2026-11-06',cardId:'c'+n}))};
 const s2=[];await handlePush({area:memArea({[REMINDER_SCHEDULE_KEY]:many}),show:async(t,b,tag,url)=>s2.push(url),now});
 assert.deepEqual(s2,['/#overview']);
 // hostile or missing urls fall back
 for(const url of [undefined,'https://evil.test/','//evil.test'])await handleClick({origin:'https://wallet.test',url,clients:{matchAll:async()=>[],openWindow:async u=>opened.push(u)}});
 assert.deepEqual(opened.slice(1),Array(3).fill('https://wallet.test/#overview'));
});

test('card routes round-trip and reject other hashes',()=>{
 assert.equal(cardRouteId(cardHash('a b/c')),'a b/c');
 for(const h of ['','#overview','#card/','#card/%E0%A4%A'])assert.equal(cardRouteId(h),null);
});
