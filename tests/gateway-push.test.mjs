// Web Push reminders (stl00/Cardybara#380): body validation, no invite code, replacement, expiry, 410 cleanup,
// the cron sending only what is due, and nothing stored beyond id, subscription, times and kinds. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,chmodSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {webcrypto} from 'node:crypto';
import {localGateway} from '../gateway/src/local.mjs';
import {ROUTES} from '../gateway/src/gateway.js';
import {parsePut,sendDuePushes,PUSH_PREFIX,EXPIRY_SECONDS,validEndpoint,MAX_TIMES} from '../gateway/src/push.js';
import {generateVapid} from '../scripts/gateway-vapid.mjs';
import {HOUR_SQL,WEEK_SQL,SILENCE_SQL} from '../gateway/src/alerts.js';
import {PUSH_DOUBLES} from '../gateway/src/metrics.js';
import worker from '../gateway/src/worker.js';

const ORIGIN='chrome-extension://'+'a'.repeat(32);
// What an extension build from before 2026-11-16 may still send; ignored.
const CODE='cdy_'+'test-only-'.padEnd(43,'a');
const DEVICE='D'.repeat(22),OTHER_DEVICE='E'.repeat(22);
const ENDPOINT='https://fcm.googleapis.com/fcm/send/synthetic-endpoint-0001';
const KEYS={p256dh:'B'.repeat(87),auth:'C'.repeat(22)};
const T0=Date.parse('2026-11-16T12:00:00Z'),SEC=Math.floor(T0/1000);
const vapid=await generateVapid();
const base=(over={})=>({device:DEVICE,subscription:{endpoint:ENDPOINT,keys:{...KEYS}},times:[{at:SEC+3600,kind:'payment'},{at:SEC+86400,kind:'fee'}],...over});
function setup({now=()=>T0,vars={}}={}){
 const logs=[],g=localGateway({vars:{ALLOWED_ORIGINS:ORIGIN,VAPID_PRIVATE_KEY:vapid.private,VAPID_PUBLIC_KEY:vapid.public,...vars},log:l=>logs.push(l),now:()=>now()});
 return {...g,logs};
}
const req=(method,path,body,{code=null,origin=ORIGIN,raw}={})=>new Request('https://gateway.test'+path,{method,headers:{...(origin?{Origin:origin}:{}),...(code?{Authorization:'Bearer '+code}:{}),'Content-Type':'application/json'},...(body!==undefined||raw!==undefined?{body:raw??JSON.stringify(body)}:{})});
const put=(g,body,opts)=>g.handle(req('PUT',ROUTES.push,body,opts));
const errorOf=async r=>(await r.json()).error.code;
const stored=g=>[...g.env.INVITES.data.entries()].filter(([k])=>k.startsWith(PUSH_PREFIX));

test('PUT stores a device and replaces its whole list of fire times',async()=>{
 const g=await setup();
 const r=await put(g,base());assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'stored',times:2});
 assert.equal(stored(g).length,1);
 const r2=await put(g,base({times:[{at:SEC+7200,kind:'credit'}]}));assert.equal(r2.status,200);
 assert.equal(stored(g).length,1);
 assert.deepEqual(JSON.parse(stored(g)[0][1]).times,[{at:SEC+7200,kind:'credit'}],'the old list is gone, not merged');
 // An empty list is allowed: it clears every reminder but keeps the device registered.
 assert.equal((await put(g,base({times:[]}))).status,200);
 assert.deepEqual(JSON.parse(stored(g)[0][1]).times,[]);
 // Duplicates collapse, order is by time.
 await put(g,base({times:[{at:SEC+9000,kind:'fee'},{at:SEC+100,kind:'payment'},{at:SEC+100,kind:'payment'}]}));
 assert.deepEqual(JSON.parse(stored(g)[0][1]).times,[{at:SEC+100,kind:'payment'},{at:SEC+9000,kind:'fee'}]);
});

test('nothing is stored besides device id, subscription, fire times and kinds',async()=>{
 const g=await setup();
 await put(g,base());
 const [key,value]=stored(g)[0];
 assert.equal(key,PUSH_PREFIX+DEVICE);
 const record=JSON.parse(value);
 assert.deepEqual(Object.keys(record).sort(),['subscription','times']);
 assert.deepEqual(Object.keys(record.subscription).sort(),['endpoint','keys']);
 assert.deepEqual(Object.keys(record.subscription.keys).sort(),['auth','p256dh']);
 for(const t of record.times)assert.deepEqual(Object.keys(t).sort(),['at','kind']);
 assert.deepEqual(Object.keys(g.env.INVITES.meta.get(key)).sort(),['exp','next']);
 // No code, address or client id is part of the record.
 assert.ok(!value.includes(CODE)&&!value.includes('t01'));
});

test('no invite code is needed; an old client that sends one still works, and an unlisted origin gets nothing',async()=>{
 const g=await setup();
 assert.equal((await put(g,base())).status,200);assert.equal(stored(g).length,1);
 assert.equal((await put(g,base({device:OTHER_DEVICE}),{code:CODE})).status,200,'a code is ignored');
 assert.equal((await g.handle(req('DELETE',ROUTES.push,{device:OTHER_DEVICE}))).status,200);assert.equal(stored(g).length,1);
 assert.equal((await put(g,base(),{origin:'https://evil.example'})).status,403);
 const open=await g.handle(req('GET',ROUTES.pushKey,undefined));assert.equal(open.status,200);assert.deepEqual(await open.json(),{publicKey:vapid.public});
 assert.equal((await g.handle(req('GET',ROUTES.pushKey,undefined,{origin:'https://evil.example'}))).status,403);
});

test('strict body checks',async()=>{
 const g=await setup();
 const bad=[
  ['extra key',{...base(),note:'x'}],['missing times',(({times,...r})=>r)(base())],['array body',[]],
  ['device too short',base({device:'short'})],['device bad characters',base({device:'a/b'.padEnd(22,'a')})],
  ['subscription extra key',base({subscription:{endpoint:ENDPOINT,keys:KEYS,expirationTime:null}})],
  ['http endpoint',base({subscription:{endpoint:ENDPOINT.replace('https','http'),keys:KEYS}})],
  ['endpoint at an arbitrary host',base({subscription:{endpoint:'https://evil.example/push',keys:KEYS}})],
  ['endpoint with a lookalike host',base({subscription:{endpoint:'https://fcm.googleapis.com.evil.example/x',keys:KEYS}})],
  ['endpoint with credentials',base({subscription:{endpoint:'https://user:pw@fcm.googleapis.com/x',keys:KEYS}})],
  ['endpoint on a port',base({subscription:{endpoint:'https://fcm.googleapis.com:8443/x',keys:KEYS}})],
  ['p256dh wrong length',base({subscription:{endpoint:ENDPOINT,keys:{...KEYS,p256dh:'B'.repeat(10)}}})],
  ['auth not base64url',base({subscription:{endpoint:ENDPOINT,keys:{...KEYS,auth:'!'.repeat(22)}}})],
  ['unknown kind',base({times:[{at:SEC+100,kind:'balance'}]})],
  ['time as string',base({times:[{at:'2026-12-01',kind:'fee'}]})],
  ['fractional time',base({times:[{at:SEC+100.5,kind:'fee'}]})],
  ['time with a label',base({times:[{at:SEC+100,kind:'fee',label:'Card ending 1234'}]})],
  ['time too far ahead',base({times:[{at:SEC+401*86400,kind:'fee'}]})],
  ['time long past',base({times:[{at:SEC-2*86400,kind:'fee'}]})],
  ['201 entries',base({times:Array.from({length:MAX_TIMES+1},(_,i)=>({at:SEC+i+1,kind:'fee'}))})],
 ];
 for(const [why,body] of bad){const r=await put(g,body);assert.equal(r.status,400,why);assert.equal(await errorOf(r),'bad_request',why);}
 assert.equal((await put(g,undefined,{raw:'{not json'})).status,400);
 assert.equal((await g.handle(new Request('https://gateway.test'+ROUTES.push,{method:'PUT',headers:{Origin:ORIGIN,Authorization:'Bearer '+CODE,'Content-Type':'text/plain'},body:'{}'}))).status,415);
 assert.equal(stored(g).length,0,'a refused body leaves nothing behind');
 // The limits themselves pass: 200 entries, 400 days, a time a day ago.
 const edge=base({times:[...Array.from({length:MAX_TIMES-2},(_,i)=>({at:SEC+i+1,kind:'fee'})),{at:SEC+400*86400,kind:'credit'},{at:SEC-86400,kind:'payment'}]});
 assert.equal((await put(g,edge)).status,200);
 assert.equal(JSON.parse(stored(g)[0][1]).times.length,MAX_TIMES);
 for(const host of ['updates.push.services.mozilla.com','web.push.apple.com','wns2-par02p.notify.windows.com'])assert.equal(validEndpoint('https://'+host+'/x'),true,host);
});

test('DELETE forgets the device, and is quiet about one that is not there',async()=>{
 const g=await setup();
 await put(g,base());await put(g,base({device:OTHER_DEVICE}));
 const r=await g.handle(req('DELETE',ROUTES.push,{device:DEVICE}));assert.equal(r.status,200);
 assert.deepEqual(stored(g).map(([k])=>k),[PUSH_PREFIX+OTHER_DEVICE]);
 assert.equal((await g.handle(req('DELETE',ROUTES.push,{device:DEVICE}))).status,200);
 assert.equal((await g.handle(req('DELETE',ROUTES.push,{device:'x'}))).status,400);
 assert.equal((await g.handle(req('DELETE',ROUTES.push,{device:DEVICE,extra:1}))).status,400);
 // Other methods on the path are refused, and the preflight lists both.
 const wrong=await g.handle(req('POST',ROUTES.push,base()));assert.equal(wrong.status,405);assert.equal(wrong.headers.get('Allow'),'PUT, DELETE');
 const pre=await g.handle(new Request('https://gateway.test'+ROUTES.push,{method:'OPTIONS',headers:{Origin:ORIGIN}}));
 assert.equal(pre.status,204);assert.equal(pre.headers.get('Access-Control-Allow-Methods'),'PUT, DELETE');
});

test('push is unavailable until the VAPID pair is set',async()=>{
 const g=await setup({vars:{VAPID_PRIVATE_KEY:undefined,VAPID_PUBLIC_KEY:undefined}});
 for(const r of [await put(g,base()),await g.handle(req('GET',ROUTES.pushKey,undefined,{code:null}))]){assert.equal(r.status,503);assert.equal(await errorOf(r),'push_unavailable');}
});

test('the log line has the route, status and number of fire times, never the endpoint or device',async()=>{
 const g=await setup();
 await put(g,base());
 const line=g.logs.at(-1),o=JSON.parse(line);
 assert.equal(o.route,'push');assert.equal(o.status,200);assert.equal(o.times,2);
 for(const secret of [ENDPOINT,'synthetic-endpoint',DEVICE,KEYS.p256dh,KEYS.auth,CODE])assert.ok(!line.includes(secret),secret);
 await put(g,{...base(),times:'x'});assert.equal(JSON.parse(g.logs.at(-1)).status,400);
});

test('a device not updated for 60 days is deleted; an update starts the 60 days again',async()=>{
 let t=T0;const g=await setup({now:()=>t});
 await put(g,base());
 t=T0+(EXPIRY_SECONDS-60)*1000;assert.equal(stored(g).length,1,'still there just before');
 assert.equal((await put(g,base({times:[{at:SEC+EXPIRY_SECONDS,kind:'fee'}]}))).status,200);// the wallet updated it
 t=T0+(EXPIRY_SECONDS+3600)*1000;assert.ok(await g.env.INVITES.get(PUSH_PREFIX+DEVICE),'the update moved the expiry');
 t=T0+(2*EXPIRY_SECONDS)*1000;assert.equal(await g.env.INVITES.get(PUSH_PREFIX+DEVICE),null);
 assert.deepEqual((await g.env.INVITES.list({prefix:PUSH_PREFIX})).keys,[]);
});

// --- The cron
function pushWorld(statusOf=()=>201){
 const w={calls:[],fetch:async(url,init)=>{w.calls.push({url,init});return new Response(null,{status:statusOf(url,w.calls.length)});}};
 return w;
}
async function jwtOf(header){
 const [,t]=header.match(/^vapid t=([^,]+), k=(.+)$/);const [h,c,s]=t.split('.');
 const key=await webcrypto.subtle.importKey('raw',Buffer.from(vapid.public,'base64url'),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const ok=await webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,Buffer.from(s,'base64url'),Buffer.from(h+'.'+c));
 return {ok,header:JSON.parse(Buffer.from(h,'base64url')),claims:JSON.parse(Buffer.from(c,'base64url')),k:header.split('k=')[1]};
}
const run=(g,w,now=T0)=>{const logs=[];return sendDuePushes(g.env,{fetch:w.fetch,now:()=>now,log:l=>logs.push(l)}).then(r=>({...r,logs}));};
const timesOf=async(g,device=DEVICE)=>(await g.env.INVITES.get(PUSH_PREFIX+device,{type:'json'}))?.times;

test('the cron sends one payload-free push per device with due times, signed with VAPID, and drops only those times',async()=>{
 const g=await setup();
 await put(g,base({times:[{at:SEC-100,kind:'payment'},{at:SEC-50,kind:'fee'},{at:SEC+3600,kind:'credit'}]}));
 await put(g,base({device:OTHER_DEVICE,subscription:{endpoint:'https://updates.push.services.mozilla.com/wpush/v2/synthetic',keys:KEYS},times:[{at:SEC+600,kind:'fee'}]}));
 const w=pushWorld(),r=await run(g,w);
 assert.equal(w.calls.length,1,'the second device is not due and the first gets one push for two times');
 assert.equal(w.calls[0].url,ENDPOINT);
 const init=w.calls[0].init;assert.equal(init.method,'POST');assert.equal(init.body,undefined,'no payload');assert.equal(init.redirect,'manual');
 assert.ok(init.headers.TTL);
 const jwt=await jwtOf(init.headers.Authorization);
 assert.equal(jwt.ok,true,'the signature verifies with the public key');assert.equal(jwt.k,vapid.public);
 assert.equal(jwt.header.alg,'ES256');assert.equal(jwt.claims.aud,'https://fcm.googleapis.com');assert.match(jwt.claims.sub,/^(mailto:|https:\/\/)/);
 assert.ok(jwt.claims.exp>SEC&&jwt.claims.exp<=SEC+86400);
 assert.deepEqual(await timesOf(g),[{at:SEC+3600,kind:'credit'}]);
 assert.deepEqual(await timesOf(g,OTHER_DEVICE),[{at:SEC+600,kind:'fee'}]);
 assert.equal(r.sent,1);
 // Later, the second device is due; the first is not, so it is not sent again.
 const w2=pushWorld();await run(g,w2,T0+700*1000);
 assert.deepEqual(w2.calls.map(c=>c.url),['https://updates.push.services.mozilla.com/wpush/v2/synthetic']);
 assert.deepEqual(await timesOf(g,OTHER_DEVICE),[]);
 // Nothing due: no request at all.
 const w3=pushWorld();await run(g,w3,T0+700*1000);assert.equal(w3.calls.length,0);
});

test('a 400, 403, 404 or 410 from the push service deletes the device at once and frees its place',async()=>{
 for(const status of [400,403,404,410]){
  const g=await setup();
  await put(g,base({times:[{at:SEC-10,kind:'payment'}]}));await put(g,base({device:OTHER_DEVICE,subscription:{endpoint:ENDPOINT+'-2',keys:KEYS},times:[{at:SEC-10,kind:'fee'}]}));
  const w=pushWorld(url=>url===ENDPOINT?status:201),r=await run(g,w);
  assert.equal(await timesOf(g),undefined,String(status));assert.equal(stored(g).length,1);assert.deepEqual(await timesOf(g,OTHER_DEVICE),[]);
  assert.equal(r.gone,1);assert.equal(r.sent,1);
  const ledger=g.env.USAGE.instances.get('global').storage.data;
  assert.equal(ledger.has('v:'+DEVICE),false,'its place under the device cap is free');assert.equal(ledger.get('devices'),1);
 }
});

const ipReq=(ip,body,method='PUT')=>new Request('https://gateway.test'+ROUTES.push,{method,headers:{Origin:ORIGIN,'Content-Type':'application/json','CF-Connecting-IP':ip},body:JSON.stringify(body)});
const deviceId=i=>('dev'+String(i).padStart(4,'0')).padEnd(22,'x');
test('push writes are capped per client per day (PUT and DELETE alike), with their own code',async()=>{
 const g=await setup({vars:{PUSH_WRITES_PER_CLIENT:'3'}});
 for(let i=0;i<3;i++)assert.equal((await g.handle(ipReq('203.0.113.7',base({device:deviceId(i)})))).status,200);
 const over=await g.handle(ipReq('203.0.113.7',base({device:deviceId(9)})));assert.equal(over.status,429);assert.equal(await errorOf(over),'push_daily_limit');
 const del=await g.handle(ipReq('203.0.113.7',{device:deviceId(0)},'DELETE'));assert.equal(await errorOf(del),'push_daily_limit');
 assert.equal(stored(g).length,3,'nothing written once over');
 // Another address has its own allowance; the next day starts again.
 assert.equal((await g.handle(ipReq('198.51.100.7',base({device:deviceId(9)})))).status,200);
 assert.equal(g.logs.some(l=>l.includes('203.0.113.7')),false,'no address in the log');
});
test('a global device cap refuses new devices with push_capacity; known devices and deletes still work',async()=>{
 const g=await setup({vars:{MAX_PUSH_DEVICES:'2'}});
 assert.equal((await g.handle(ipReq('203.0.113.1',base({device:deviceId(1)})))).status,200);
 assert.equal((await g.handle(ipReq('203.0.113.2',base({device:deviceId(2)})))).status,200);
 const full=await g.handle(ipReq('203.0.113.3',base({device:deviceId(3)})));assert.equal(full.status,503);assert.equal(await errorOf(full),'push_capacity');
 assert.equal(stored(g).length,2);
 assert.equal((await g.handle(ipReq('203.0.113.1',base({device:deviceId(1),times:[]})))).status,200,'an update to a stored device is not a new one');
 assert.equal((await g.handle(ipReq('203.0.113.1',{device:deviceId(1)},'DELETE'))).status,200);
 assert.equal((await g.handle(ipReq('203.0.113.3',base({device:deviceId(3)})))).status,200,'a delete frees a place');
});
test('the cron goes round robin: devices claiming the oldest fire time cannot starve the others',async()=>{
 const g=await setup({vars:{PUSH_WRITES_PER_CLIENT:'100'}});
 // Six flooding devices with a fire time a day old (their pushes keep failing, so they stay due), then two real
 // devices due now; three are handled per run. Oldest-first would never reach the real ones.
 const ep=name=>ENDPOINT+'-'+name;
 const floods=Array.from({length:6},(_,i)=>'a'+deviceId(i).slice(1)),real=['z'+'real1'.padEnd(21,'x'),'z'+'real2'.padEnd(21,'x')];
 for(const d of floods)await put(g,base({device:d,subscription:{endpoint:ep(d),keys:KEYS},times:[{at:SEC-86399,kind:'payment'}]}));
 for(const d of real)await put(g,base({device:d,subscription:{endpoint:ep(d),keys:KEYS},times:[{at:SEC,kind:'fee'}]}));
 const reached=new Set();
 for(let n=0;n<3;n++){
  const seen=[];await sendDuePushes(g.env,{fetch:async url=>{seen.push(url);return new Response(null,{status:url.includes('-z')?201:500});},now:()=>T0,log:()=>{},perRun:3});
  assert.ok(seen.length<=3,'at most three per run');seen.forEach(u=>reached.add(u));
 }
 for(const d of real){assert.ok(reached.has(ep(d)),'a real device was reached');assert.deepEqual(await timesOf(g,d),[]);}
 // With a cursor: the run after a full batch starts after it.
 const g2=await setup({vars:{PUSH_WRITES_PER_CLIENT:'100'}});
 for(let i=0;i<5;i++)await put(g2,base({device:deviceId(i),times:[{at:SEC-10,kind:'fee'}]}));
 const batches=[];
 for(let n=0;n<2;n++){await sendDuePushes(g2.env,{fetch:async()=>{return new Response(null,{status:500});},now:()=>T0,log:()=>{},perRun:3});batches.push(await g2.env.INVITES.get('pushcursor'));}
 assert.deepEqual(batches,[PUSH_PREFIX+deviceId(2),PUSH_PREFIX+deviceId(0)],'the second run starts after the first and wraps around');
});

test('a push that fails stays due for the next run, until it has waited two days',async()=>{
 const g=await setup();
 await put(g,base({times:[{at:SEC-10,kind:'payment'}]}));
 for(const status of [500,429,0]){
  const w=status?pushWorld(()=>status):{calls:[],fetch:async()=>{throw Error('network');}};
  const r=await run(g,w);assert.equal(r.failed,1,String(status));assert.deepEqual(await timesOf(g),[{at:SEC-10,kind:'payment'}],String(status));
 }
 const r=await run(g,pushWorld(()=>500),T0+(2*86400+60)*1000);
 assert.equal(r.expired,1);assert.deepEqual(await timesOf(g),[]);
 // A retry that finally works clears the time.
 await put(g,base({times:[{at:SEC+5,kind:'fee'}]}));
 const ok=await run(g,pushWorld(),T0+10*1000);assert.equal(ok.sent,1);assert.deepEqual(await timesOf(g),[]);
});

test('a run does not extend the 60 days, and its log line names no endpoint',async()=>{
 let t=T0;const g=await setup({now:()=>t});
 await put(g,base({times:[{at:SEC+10,kind:'fee'},{at:SEC+(EXPIRY_SECONDS-5),kind:'fee'}]}));
 const logs=[];await sendDuePushes(g.env,{fetch:pushWorld().fetch,now:()=>T0+20*1000,log:l=>logs.push(l)});
 const meta=g.env.INVITES.meta.get(PUSH_PREFIX+DEVICE);assert.equal(meta.exp,SEC+EXPIRY_SECONDS);
 t=T0+(EXPIRY_SECONDS+1)*1000;assert.equal(await g.env.INVITES.get(PUSH_PREFIX+DEVICE),null);
 assert.ok(logs.length);
 for(const line of logs)for(const secret of [ENDPOINT,DEVICE,KEYS.auth])assert.ok(!line.includes(secret));
});

test('without the VAPID secrets the cron sends nothing',async()=>{
 const g=await setup({vars:{VAPID_PRIVATE_KEY:undefined}});
 await put(g,base({times:[{at:SEC-10,kind:'fee'}]}));
 const w=pushWorld();assert.deepEqual(await run(g,w),{skipped:true,logs:[]});assert.equal(w.calls.length,0);
});

test('the Worker runs the push sender on its 15-minute Cron Trigger and the alert check on the hourly one',async()=>{
 const g=await setup();
 await put(g,base({times:[{at:SEC-5,kind:'fee'}]}));
 const calls=[],original=globalThis.fetch,realNow=Date.now;
 globalThis.fetch=async url=>{calls.push(String(url));return new Response(null,{status:201});};Date.now=()=>T0;
 try{
  const waits=[];await worker.scheduled({cron:'7 * * * *'},g.env,{waitUntil:p=>waits.push(p)});await Promise.all(waits);
  assert.ok(!calls.includes(ENDPOINT),'the hourly trigger does not send pushes');
  const waits2=[];await worker.scheduled({cron:'*/15 * * * *'},g.env,{waitUntil:p=>waits2.push(p)});await Promise.all(waits2);
  assert.ok(calls.includes(ENDPOINT));
 }finally{globalThis.fetch=original;Date.now=realNow;}
 const wrangler=readFileSync(new URL('../gateway/wrangler.jsonc',import.meta.url),'utf8');
 assert.match(wrangler,/"crons": \["7 \* \* \* \*", "\*\/15 \* \* \* \*"\]/);
});

test('parsePut is pure and exported for the wallet code to share',()=>{
 assert.deepEqual(parsePut(base(),T0).times.length,2);
 assert.throws(()=>parsePut({},T0),/bad_request/);
});

// --- The VAPID secret script
test('gateway-vapid makes a usable pair, and gateway-set-vapid.sh never prints the private key',()=>{
 const dir=mkdtempSync(join(tmpdir(),'vapid-'));
 // A stand-in `npx` that records what `wrangler secret put` would get on stdin, and reports no existing secret.
 const log=join(dir,'puts.log');
 writeFileSync(join(dir,'npx'),`#!/usr/bin/env bash\nargs="$*"\nif [[ "$args" == *"secret list"* ]]; then echo '[]'; exit 0; fi\nname=$(echo "$args" | sed -E 's/.*secret put ([A-Z_]+).*/\\1/')\nprintf '%s=%s\\n' "$name" "$(cat)" >> "${log}"\n`);
 chmodSync(join(dir,'npx'),0o755);
 const root=new URL('..',import.meta.url).pathname;
 const r=spawnSync('bash',[root+'scripts/gateway-set-vapid.sh'],{encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH}});
 assert.equal(r.status,0,r.stderr);
 const puts=Object.fromEntries(readFileSync(log,'utf8').trim().split('\n').map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
 assert.deepEqual(Object.keys(puts).sort(),['VAPID_PRIVATE_KEY','VAPID_PUBLIC_KEY']);
 assert.ok(!(r.stdout+r.stderr).includes(puts.VAPID_PRIVATE_KEY),'the private key is not printed');
 assert.ok(r.stdout.includes(puts.VAPID_PUBLIC_KEY));
 assert.equal(Buffer.from(puts.VAPID_PUBLIC_KEY,'base64url').length,65);
 // The pair signs a header the gateway builds.
 return import('../gateway/src/push.js').then(async({vapidHeader})=>{
  const header=await vapidHeader({VAPID_PRIVATE_KEY:puts.VAPID_PRIVATE_KEY,VAPID_PUBLIC_KEY:puts.VAPID_PUBLIC_KEY},'https://fcm.googleapis.com',T0);
  assert.match(header,/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
 });
});
test('gateway-set-vapid.sh refuses to replace an existing pair unless ROTATE=1',()=>{
 const dir=mkdtempSync(join(tmpdir(),'vapid-'));
 writeFileSync(join(dir,'npx'),`#!/usr/bin/env bash\nif [[ "$*" == *"secret list"* ]]; then echo '[{"name":"VAPID_PRIVATE_KEY"}]'; fi\nexit 0\n`);
 chmodSync(join(dir,'npx'),0o755);
 const root=new URL('..',import.meta.url).pathname;
 const r=spawnSync('bash',[root+'scripts/gateway-set-vapid.sh'],{encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH}});
 assert.equal(r.status,4);assert.match(r.stderr,/ROTATE=1/);
});

test('each non-skipped run writes one push data point: route only, counts and an age in a fixed order',async()=>{
 const points=[];
 // The PUTs below write their own request points (blob1 'webpush', #625); only the sender's are collected here.
 const g=await setup({vars:{AGENT_METRICS:{writeDataPoint:p=>{if(p.blobs[0]!=='webpush')points.push(structuredClone(p));}}}});
 const dev=i=>deviceId(i);
 const ep=i=>'https://fcm.googleapis.com/fcm/send/m-'+i;
 await put(g,base({device:dev(1),subscription:{endpoint:ep(1),keys:KEYS},times:[{at:SEC-600,kind:'payment'}]}));// sent
 await put(g,base({device:dev(2),subscription:{endpoint:ep(2),keys:KEYS},times:[{at:SEC-10,kind:'fee'}]}));// gone
 await put(g,base({device:dev(3),subscription:{endpoint:ep(3),keys:KEYS},times:[{at:SEC-10,kind:'fee'}]}));// failed
 await put(g,base({device:dev(4),subscription:{endpoint:ep(4),keys:KEYS},times:[{at:SEC-5,kind:'fee'},{at:SEC-6,kind:'credit'}]}));// failed, expired later
 await put(g,base({device:dev(5),subscription:{endpoint:ep(5),keys:KEYS},times:[{at:SEC+9999,kind:'fee'}]}));// not due
 const status=url=>url===ep(2)?410:url===ep(3)||url===ep(4)?500:201;
 const r=await run(g,pushWorld(status));
 assert.equal(points.length,1);
 const p=points[0];
 assert.deepEqual(p.indexes,['push']);assert.deepEqual(p.blobs,['push']);
 assert.deepEqual(PUSH_DOUBLES,['due','sent','gone','failed','expired','devices','oldest_due_age_s']);
 assert.deepEqual(p.doubles,[4,1,1,2,0,4,600]);
 assert.equal(r.sent,1);
 // Only the route is a string, and no id, endpoint or key appears anywhere in the point.
 assert.ok(p.doubles.every(Number.isFinite));
 const text=JSON.stringify(p);
 for(const secret of [DEVICE,dev(1),'fcm.googleapis.com',KEYS.auth,KEYS.p256dh])assert.ok(!text.includes(secret));
 // A later run, after the wait limit: the failed device's times expire.
 await run(g,pushWorld(()=>500),T0+(2*86400+60)*1000);
 assert.equal(points.length,2);
 assert.ok(points[1].doubles[4]>=1);assert.equal(points[1].doubles[6],2*86400+60+10,'the oldest still-due time at the start of the run');
 assert.deepEqual(points[1].blobs,['push']);
});

test('a push point is written for an empty run with age 0, and not for a skipped run',async()=>{
 const points=[];
 const g=await setup({vars:{AGENT_METRICS:{writeDataPoint:p=>points.push(p)}}});
 await run(g,pushWorld());
 assert.deepEqual(points.map(p=>p.doubles),[[0,0,0,0,0,0,0]]);
 const off=await setup({vars:{VAPID_PRIVATE_KEY:undefined,AGENT_METRICS:{writeDataPoint:p=>points.push(p)}}});
 await run(off,pushWorld());
 assert.equal(points.length,1);
});

test('a throwing or missing metrics binding does not change the run result',async()=>{
 const results=[];
 for(const binding of [undefined,{writeDataPoint(){throw Error('boom');}},{}]){
  const g=await setup({vars:{AGENT_METRICS:binding}});
  await put(g,base({times:[{at:SEC-10,kind:'payment'}]}));
  const {logs,...r}=await run(g,pushWorld());results.push(r);
  assert.equal(r.sent,1);assert.deepEqual(await timesOf(g),[]);
 }
 assert.deepEqual(results[1],results[0]);assert.deepEqual(results[2],results[0]);
});

test('push points do not change the agent turn queries: all of them filter on blob1 = agent',()=>{
 for(const q of [HOUR_SQL,WEEK_SQL,SILENCE_SQL])assert.match(q,/blob1 = 'agent'/);
 assert.ok(!/blob1 = 'push'|push/.test(HOUR_SQL+WEEK_SQL+SILENCE_SQL));
});

test('a push point never carries a string field other than the route',async()=>{
 const {pushPoint}=await import('../gateway/src/metrics.js');
 const p=pushPoint({due:'dev-secret',sent:'x',gone:NaN,failed:-1,expired:2.4,extra:'https://fcm.googleapis.com/x'},'id',Infinity);
 assert.deepEqual(p.blobs,['push']);assert.deepEqual(p.indexes,['push']);
 assert.ok(p.doubles.every(n=>typeof n==='number'&&Number.isFinite(n)));
 assert.equal(p.doubles.length,PUSH_DOUBLES.length);
});

// Subscription route metrics (stl00/Cardybara#625): one request point per route and method, no subscription data.
test('metrics: each push route and method writes one point with its fixed name and nothing of the subscription',async()=>{
 const points=[];
 const g=await setup({vars:{AGENT_METRICS:{writeDataPoint:p=>points.push(structuredClone(p))}}});
 assert.equal((await put(g,base())).status,200);
 assert.equal((await g.handle(req('GET',ROUTES.pushKey,undefined))).status,200);
 assert.equal((await g.handle(req('DELETE',ROUTES.push,{device:DEVICE}))).status,200);
 assert.deepEqual(points.map(p=>p.blobs),[['webpush','subscribe',''],['webpush','key',''],['webpush','unsubscribe','']]);
 for(const p of points){assert.deepEqual(p.indexes,['webpush']);assert.equal(p.doubles.length,2);assert.equal(p.doubles[0],200);assert.ok(Number.isFinite(p.doubles[1]));}
 // Negative control: the synthetic subscription that was sent shows up nowhere in what was written.
 const text=JSON.stringify(points),sent=base();
 for(const secret of [DEVICE,ENDPOINT,'fcm.googleapis.com','synthetic-endpoint',KEYS.p256dh,KEYS.auth,...sent.times.map(t=>String(t.at)),...sent.times.map(t=>t.kind),ORIGIN])assert.ok(!text.includes(secret),secret);
});

test('metrics: an unknown path, a wrong method or a preflight on the push routes writes nothing',async()=>{
 const points=[];
 const g=await setup({vars:{AGENT_METRICS:{writeDataPoint:p=>points.push(p)}}});
 for(const [method,path] of [['POST',ROUTES.push],['GET',ROUTES.push],['PUT',ROUTES.pushKey],['DELETE',ROUTES.pushKey],['GET','/v1/push/other'],['OPTIONS',ROUTES.push],['OPTIONS',ROUTES.pushKey]])
  await g.handle(req(method,path,undefined));
 assert.deepEqual(points,[]);
});

test('metrics: push refusals keep their own code; a code outside the list is written as other',async()=>{
 const points=[],binding={writeDataPoint:p=>points.push(p)};
 const off=await setup({vars:{VAPID_PRIVATE_KEY:undefined,AGENT_METRICS:binding}});
 await put(off,base());await off.handle(req('GET',ROUTES.pushKey,undefined));
 const full=await setup({vars:{MAX_PUSH_DEVICES:'0',AGENT_METRICS:binding}});
 await put(full,base());
 const capped=await setup({vars:{PUSH_WRITES_PER_CLIENT:'0',AGENT_METRICS:binding}});
 await capped.handle(req('DELETE',ROUTES.push,{device:DEVICE}));
 await put(capped,base({times:'synthetic'}));
 assert.deepEqual(points.map(p=>[p.blobs[1],p.blobs[2],p.doubles[0]]),
  [['subscribe','push_unavailable',503],['key','push_unavailable',503],['subscribe','push_capacity',503],['unsubscribe','push_daily_limit',429],['subscribe','bad_request',400]]);
 const {metricsPoint}=await import('../gateway/src/metrics.js');
 assert.deepEqual(metricsPoint({record:{route:'push',status:500,error:ENDPOINT},request:{method:'PUT'}},3).blobs,['webpush','subscribe','other']);
});

test('metrics: a missing or throwing binding changes nothing for the subscribing caller',async()=>{
 for(const binding of [undefined,{},{writeDataPoint(){throw Error('boom');}}]){
  const g=await setup({vars:{AGENT_METRICS:binding}});
  const r=await put(g,base());assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'stored',times:2});
 }
});

