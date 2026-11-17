// Web Push reminders (stl00/Cardybara#380): body validation, invite required, replacement, expiry, 410 cleanup,
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
import worker from '../gateway/src/worker.js';

const ORIGIN='chrome-extension://'+'a'.repeat(32);
const CODE='cdy_'+'test-only-'.padEnd(43,'a');
const DEVICE='D'.repeat(22),OTHER_DEVICE='E'.repeat(22);
const ENDPOINT='https://fcm.googleapis.com/fcm/send/synthetic-endpoint-0001';
const KEYS={p256dh:'B'.repeat(87),auth:'C'.repeat(22)};
const T0=Date.parse('2026-11-16T12:00:00Z'),SEC=Math.floor(T0/1000);
const vapid=await generateVapid();
const base=(over={})=>({device:DEVICE,subscription:{endpoint:ENDPOINT,keys:{...KEYS}},times:[{at:SEC+3600,kind:'payment'},{at:SEC+86400,kind:'fee'}],...over});
function setup({now=()=>T0,vars={}}={}){
 const logs=[],g=localGateway({vars:{ALLOWED_ORIGINS:ORIGIN,VAPID_PRIVATE_KEY:vapid.private,VAPID_PUBLIC_KEY:vapid.public,...vars},log:l=>logs.push(l),now:()=>now()});
 g.addInvite(CODE,{id:'t01'});
 return {...g,logs};
}
const req=(method,path,body,{code=CODE,origin=ORIGIN,raw}={})=>new Request('https://gateway.test'+path,{method,headers:{...(origin?{Origin:origin}:{}),...(code?{Authorization:'Bearer '+code}:{}),'Content-Type':'application/json'},...(body!==undefined||raw!==undefined?{body:raw??JSON.stringify(body)}:{})});
const put=(g,body,opts)=>g.handle(req('PUT',ROUTES.push,body,opts));
const errorOf=async r=>(await r.json()).error.code;
const stored=g=>[...g.env.INVITES.data.entries()].filter(([k])=>k.startsWith(PUSH_PREFIX));

test('PUT stores a device and replaces its whole list of fire times',async()=>{
 const g=await setup();await g.addInvite(CODE,{id:'t01'});
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
 const g=await setup();await g.addInvite(CODE,{id:'t01'});
 await put(g,base());
 const [key,value]=stored(g)[0];
 assert.equal(key,PUSH_PREFIX+DEVICE);
 const record=JSON.parse(value);
 assert.deepEqual(Object.keys(record).sort(),['subscription','times']);
 assert.deepEqual(Object.keys(record.subscription).sort(),['endpoint','keys']);
 assert.deepEqual(Object.keys(record.subscription.keys).sort(),['auth','p256dh']);
 for(const t of record.times)assert.deepEqual(Object.keys(t).sort(),['at','kind']);
 assert.deepEqual(Object.keys(g.env.INVITES.meta.get(key)).sort(),['exp','next']);
 // The invite code and its id are not part of the record.
 assert.ok(!value.includes(CODE)&&!value.includes('t01'));
});

test('an invite code is required, and a revoked one is refused',async()=>{
 const g=await setup();await g.addInvite(CODE,{id:'t01'});
 for(const code of [null,'cdy_short','cdy_'+'z'.repeat(43)]){
  const r=await put(g,base(),{code});assert.equal(r.status,401,String(code));assert.equal(await errorOf(r),'invite_invalid');
 }
 assert.equal((await g.handle(req('DELETE',ROUTES.push,{device:DEVICE},{code:null}))).status,401);
 assert.equal(stored(g).length,0);
 // The public key is public (the wallet asks for it before it has registered), but an unlisted origin still gets nothing.
 const open=await g.handle(req('GET',ROUTES.pushKey,undefined,{code:null}));assert.equal(open.status,200);assert.deepEqual(await open.json(),{publicKey:vapid.public});
 assert.equal((await g.handle(req('GET',ROUTES.pushKey,undefined,{code:null,origin:'https://evil.example'}))).status,403);
});

test('strict body checks',async()=>{
 const g=await setup();await g.addInvite(CODE,{id:'t01'});
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
 const g=await setup();await g.addInvite(CODE,{id:'t01'});
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
 const g=await setup({vars:{VAPID_PRIVATE_KEY:undefined,VAPID_PUBLIC_KEY:undefined}});await g.addInvite(CODE,{id:'t01'});
 for(const r of [await put(g,base()),await g.handle(req('GET',ROUTES.pushKey,undefined,{code:null}))]){assert.equal(r.status,503);assert.equal(await errorOf(r),'push_unavailable');}
});

test('the log line has the route, status and number of fire times, never the endpoint or device',async()=>{
 const g=await setup();await g.addInvite(CODE,{id:'t01'});
 await put(g,base());
 const line=g.logs.at(-1),o=JSON.parse(line);
 assert.equal(o.route,'push');assert.equal(o.status,200);assert.equal(o.times,2);
 for(const secret of [ENDPOINT,'synthetic-endpoint',DEVICE,KEYS.p256dh,KEYS.auth,CODE])assert.ok(!line.includes(secret),secret);
 await put(g,{...base(),times:'x'});assert.equal(JSON.parse(g.logs.at(-1)).status,400);
});

test('a device not updated for 60 days is deleted; an update starts the 60 days again',async()=>{
 let t=T0;const g=await setup({now:()=>t});await g.addInvite(CODE,{id:'t01'});
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
 const g=await setup();await g.addInvite(CODE,{id:'t01'});
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

test('a 404 or 410 from the push service deletes the device',async()=>{
 for(const status of [404,410]){
  const g=await setup();await g.addInvite(CODE,{id:'t01'});
  await put(g,base({times:[{at:SEC-10,kind:'payment'}]}));await put(g,base({device:OTHER_DEVICE,subscription:{endpoint:ENDPOINT+'-2',keys:KEYS},times:[{at:SEC-10,kind:'fee'}]}));
  const w=pushWorld(url=>url===ENDPOINT?status:201),r=await run(g,w);
  assert.equal(await timesOf(g),undefined,String(status));assert.equal(stored(g).length,1);assert.deepEqual(await timesOf(g,OTHER_DEVICE),[]);
  assert.equal(r.gone,1);assert.equal(r.sent,1);
 }
});

test('a push that fails stays due for the next run, until it has waited two days',async()=>{
 const g=await setup();await g.addInvite(CODE,{id:'t01'});
 await put(g,base({times:[{at:SEC-10,kind:'payment'}]}));
 for(const status of [500,429,403,0]){
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
 let t=T0;const g=await setup({now:()=>t});await g.addInvite(CODE,{id:'t01'});
 await put(g,base({times:[{at:SEC+10,kind:'fee'},{at:SEC+(EXPIRY_SECONDS-5),kind:'fee'}]}));
 const logs=[];await sendDuePushes(g.env,{fetch:pushWorld().fetch,now:()=>T0+20*1000,log:l=>logs.push(l)});
 const meta=g.env.INVITES.meta.get(PUSH_PREFIX+DEVICE);assert.equal(meta.exp,SEC+EXPIRY_SECONDS);
 t=T0+(EXPIRY_SECONDS+1)*1000;assert.equal(await g.env.INVITES.get(PUSH_PREFIX+DEVICE),null);
 assert.ok(logs.length);
 for(const line of logs)for(const secret of [ENDPOINT,DEVICE,KEYS.auth])assert.ok(!line.includes(secret));
});

test('without the VAPID secrets the cron sends nothing',async()=>{
 const g=await setup({vars:{VAPID_PRIVATE_KEY:undefined}});await g.addInvite(CODE,{id:'t01'});
 await put(g,base({times:[{at:SEC-10,kind:'fee'}]}));
 const w=pushWorld();assert.deepEqual(await run(g,w),{skipped:true,logs:[]});assert.equal(w.calls.length,0);
});

test('the Worker runs the push sender on its 15-minute Cron Trigger and the alert check on the hourly one',async()=>{
 const g=await setup();await g.addInvite(CODE,{id:'t01'});
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
