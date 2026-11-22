// Wallet sync between devices (stl00/Cardybara#414, epic #410): one server copy of the wallet document (#411) per
// account, read and written through the gateway's `/v2/account/wallet` with a revision check (#412, #413).
// Offline-first: the wallet always works from this device's stores; sync pulls on start, on focus and when the browser
// comes back online, and pushes after local changes (debounced). A push that finds a newer server revision (409) pulls,
// merges and pushes again.
//
// Merging is three-way against the document this device last synced (`base`), so an edit on either side is kept and
// a deletion on one side is honoured when the other side did not touch the same thing. Where both sides changed the
// same thing, the module's own rule decides:
//  - registry cards: by id, field by field; a manual row wins over a bank-read copy of the same bank and tail, and two
//    rows for one bank and tail become one (no duplicate card); a card removed on either side stays removed;
//  - card edits (the overlay on bank cards) and card types: by card id, field by field, the newer side on a tie;
//  - payment marks and point values: by key, the later `at` (their backup rule);
//  - benefit and cost events: a union by id;
//  - reminder settings: field by field, the newer side on a tie;
//  - bank readings (#416): per card and field, the later reading wins (src/bankReadings.js);
//  - favourites: a set; bank snapshot rows: as one unit, the newer side on a tie.
// "Newer side" is this device's last local change time against the server copy's `updatedAt`.
//
// The default timers are wrapped: a browser's setTimeout throws "Illegal invocation" when called as a method of another object.
// Sync is off unless the user turned it on and is signed in. Off, nothing here touches the network or adds a listener.
import {WALLET_FORMAT_VERSION,migrateWalletDocument} from './walletDocument.js';
import {mergeBankReadings} from './bankReadings.js';

export const SYNC_STATE_KEY='cardybara-sync-v1';
export const ACCOUNT_SESSION_KEY='cardybara-account-session-v1';
export const PUSH_DEBOUNCE_MS=5000,CHECK_INTERVAL_MS=30000,MAX_ROUNDS=4;
// Events the wallet's modules dispatch after writing their store.
export const CHANGE_EVENTS=['cardybara-card-edits-change','cardybara-card-products-change','cardybara-payment-marks-change','cardybara-point-values-change','cardybara-reminder-settings-change','cardybara-personal-change','cardybara-cost-change','cardybara-bank-live-change'];

const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** JSON with object keys sorted, so two equal documents compare equal whatever order their keys were written in. */
export const stableJson=v=>JSON.stringify(v,(k,x)=>plain(x)?Object.fromEntries(Object.keys(x).sort().map(key=>[key,x[key]])):x);
const same=(a,b)=>stableJson(a)===stableJson(b);

// ---- state -------------------------------------------------------------------------------------------------------
/** `{on, revision, base, changedAt}`: whether sync is on, the server revision and document last synced, the last local change. */
export function readSyncState(storage){
 try{const v=JSON.parse(storage.getItem(SYNC_STATE_KEY));if(plain(v))return {on:v.on===true,revision:Number.isInteger(v.revision)&&v.revision>0?v.revision:0,base:plain(v.base)?v.base:null,changedAt:Number.isFinite(v.changedAt)?v.changedAt:null};}catch{}
 return {on:false,revision:0,base:null,changedAt:null};
}
const writeSyncState=(storage,s)=>storage.setItem(SYNC_STATE_KEY,JSON.stringify(s));
/** Turns sync on or off for this device. Turning it off forgets the revision and the last synced copy. */
export function setSyncOn(storage,on){writeSyncState(storage,on?{...readSyncState(storage),on:true}:{on:false,revision:0,base:null,changedAt:null});}
export function readSessionToken(storage){try{const v=JSON.parse(storage.getItem(ACCOUNT_SESSION_KEY));return typeof v?.token==='string'&&v.token?v.token:null;}catch{return null}}

// ---- merge -------------------------------------------------------------------------------------------------------
const CONFLICT=Symbol('conflict');
/** Three-way pick for one value; `undefined` is "absent". CONFLICT when both sides changed it differently. */
function pick3(base,local,remote){
 if(same(local,remote))return local;
 if(same(local,base))return remote;
 if(same(remote,base))return local;
 return CONFLICT;
}
/** Field-by-field three-way merge of two objects; a field both sides changed goes to the newer side. */
function mergeFields(base,local,remote,localNewer){
 const b=plain(base)?base:{},out={};
 for(const k of new Set([...Object.keys(local),...Object.keys(remote)])){
  let v=pick3(b[k],local[k],remote[k]);
  if(v===CONFLICT)v=localNewer?local[k]:remote[k];
  if(v!==undefined)out[k]=v;
 }
 return out;
}
/**
 * Three-way merge of two lists keyed by `keyOf`. `resolve(local, remote, base)` decides a key both sides changed;
 * a key one side deleted and the other changed is kept (an edit is never lost to a deletion).
 */
function mergeKeyed(base,local,remote,keyOf,resolve){
 const index=list=>new Map((Array.isArray(list)?list:[]).map(x=>[keyOf(x),x]));
 const b=index(base),l=index(local),r=index(remote),out=[];
 for(const k of new Set([...l.keys(),...r.keys()])){
  let v=pick3(b.get(k),l.get(k),r.get(k));
  if(v===CONFLICT)v=l.get(k)===undefined?r.get(k):r.get(k)===undefined?l.get(k):resolve(l.get(k),r.get(k),b.get(k));
  if(v!==undefined)out.push(v);
 }
 return out;
}
const later=(a,b)=>Date.parse(b.at)>Date.parse(a.at)?b:a;
const unionPairs=(local,remote)=>{const m=new Map();for(const p of [...(remote||[]),...(local||[])])m.set(p.manualId+'\n'+p.bankId,p);return [...m.values()];};
const union=(local,remote)=>{const m=new Map();for(const e of [...(remote||[]),...(local||[])])m.set(e.id,e);return [...m.values()];};
const SECTIONS=new Set(['formatVersion','walletCards','cardEdits','cardProducts','paymentMarks','pointValues','reminderSettings','favorites','personalBenefits','costLedger','bankReadings','cardMerges']);
const snapshotOf=doc=>Object.fromEntries(Object.entries(doc).filter(([k])=>!SECTIONS.has(k)));

/**
 * One registry card per bank and tail: a manual row wins over a bank-read copy, otherwise the first (this device's)
 * row stays. Returns the kept cards and a map from each dropped id to the id that replaced it.
 */
export function dedupeRegistry(cards){
 const kept=[],moved=new Map();
 for(const c of cards){
  const i=kept.findIndex(o=>o.id===c.id||(c.tail&&o.bank===c.bank&&o.tail===c.tail));
  if(i<0){kept.push(c);continue;}
  const o=kept[i];
  if(o.id===c.id)continue;
  if(o.identitySource==='bank-page'&&c.identitySource!=='bank-page'){kept[i]=c;moved.set(o.id,c.id);}
  else moved.set(c.id,o.id);
 }
 return {cards:kept,moved};
}

/**
 * Merges this device's document with the server's. `base` is the document both last agreed on (null on the first
 * sync of this device, which then unions both sides). `localNewer` breaks ties where both changed the same field.
 * All three must already be migrated to the current format.
 */
export function mergeWalletDocuments({base,local,remote,localNewer}){
 const B=base||{};
 const sec=(name,field)=>[B[name]?.[field],local[name]?.[field]??[],remote[name]?.[field]??[]];
 const tie=(l,r,b)=>mergeFields(b,l,r,localNewer);
 const newer=(l,r)=>localNewer?l:r;

 const removed=mergeKeyed(...sec('walletCards','removed'),r=>r.id,newer);
 const gone=new Set(removed.map(r=>r.id));
 const registry=dedupeRegistry(mergeKeyed(...sec('walletCards','cards'),c=>c.id,tie).filter(c=>!gone.has(c.id)));
 const moveId=id=>registry.moved.get(id)??id;
 // A row for a card that was folded into another follows it, unless the kept card has its own.
 const follow=(rows,key='cardId')=>{const out=new Map();for(const x of rows){const id=moveId(x[key]);if(!out.has(id)||x[key]===id)out.set(id,{...x,[key]:id});}return [...out.values()];};

 const edits=follow(mergeKeyed(...sec('cardEdits','edits'),e=>e.cardId,tie));
 const choices=follow(mergeKeyed(...sec('cardProducts','choices'),c=>c.cardId,newer));
 const marks=mergeKeyed(...sec('paymentMarks','marks'),m=>m.key,later);
 const values=mergeKeyed(...sec('pointValues','values'),v=>v.id,later);
 const favorites=[...new Set(mergeKeyed(B.favorites,local.favorites||[],remote.favorites||[],x=>x,newer).map(moveId))];
 const settings=mergeFields(B.reminderSettings,local.reminderSettings||{},remote.reminderSettings||{},localNewer);

 let snapshot=pick3(base?snapshotOf(base):undefined,snapshotOf(local),snapshotOf(remote));
 if(snapshot===CONFLICT)snapshot=newer(snapshotOf(local),snapshotOf(remote));

 return {
  ...snapshot,
  formatVersion:WALLET_FORMAT_VERSION,
  walletCards:{cards:registry.cards,removed},
  cardEdits:{...local.cardEdits,schema:1,edits},
  cardProducts:{...local.cardProducts,schema:1,choices},
  paymentMarks:{...local.paymentMarks,schema:1,marks},
  pointValues:{...remote.pointValues,...local.pointValues,values},
  reminderSettings:settings,
  favorites,
  cardMerges:{schema:1,declined:unionPairs(local.cardMerges?.declined,remote.cardMerges?.declined)},
  personalBenefits:{schema:1,events:union(local.personalBenefits?.events,remote.personalBenefits?.events)},
  costLedger:{schema:1,events:union(local.costLedger?.events,remote.costLedger?.events)},
  // Bank amounts: the later reading of each field wins; a removed card's readings go with it and a folded card's follow it.
  bankReadings:mergeBankReadings(local.bankReadings,remote.bankReadings,id=>gone.has(id)?null:moveId(id)),
 };
}

// ---- transport ---------------------------------------------------------------------------------------------------
/** The gateway's wallet route. `token()` returns the session token, or null when signed out. */
export function createAccountTransport({gateway,token,fetchFn=(...a)=>globalThis.fetch(...a)}){
 const call=async(method,body)=>{
  const t=token();
  if(!t)throw Error('signed_out');
  const r=await fetchFn(gateway+'/v2/account/wallet',{method,headers:{Authorization:'Bearer '+t,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
  if(r.status===401)throw Error('signed_out');
  return r;
 };
 return {
  async get(){const r=await call('GET');if(!r.ok)throw Error('sync_'+r.status);return r.json();},
  async put(body){
   const r=await call('PUT',body);
   if(r.ok)return {ok:true,...await r.json()};
   if(r.status===409)return {ok:false,status:409};
   throw Error('sync_'+r.status);
  },
 };
}

// ---- engine ------------------------------------------------------------------------------------------------------
/**
 * The sync engine. `readLocal()` returns this device's document; `applyLocal(doc)` replaces this device's stores with
 * it. `isOn()` is checked before every request. Status codes for `onStatus`: syncing, synced, offline, signed_out,
 * newer (the server copy comes from a newer build: nothing is written here until a reload), error.
 */
export function createWalletSync({transport,readLocal,applyLocal,storage,isOn,now=()=>Date.now(),onStatus=()=>{},timers={set:(f,ms)=>setTimeout(f,ms),clear:id=>clearTimeout(id)}}){
 let running=null,again=false,timer=null,blocked=false;
 const save=patch=>writeSyncState(storage,{...readSyncState(storage),...patch});

 async function round(pushFirst){
  const st=readSyncState(storage);
  const local=migrateWalletDocument(await readLocal());
  if(pushFirst&&st.base&&st.revision>0&&!same(local,st.base)){
   const r=await transport.put({baseRevision:st.revision,formatVersion:WALLET_FORMAT_VERSION,document:local});
   if(r.ok){save({revision:r.revision,base:local,changedAt:null});return true;}
  }
  const remote=await transport.get();
  if(Number.isInteger(remote.formatVersion)&&remote.formatVersion>WALLET_FORMAT_VERSION){const e=Error('wallet_format_newer');throw e;}
  const remoteDoc=remote.document?migrateWalletDocument(remote.document):null;
  const localNewer=st.changedAt!=null&&(remote.updatedAt==null||st.changedAt>=remote.updatedAt*1000);
  const merged=remoteDoc?mergeWalletDocuments({base:st.base,local,remote:remoteDoc,localNewer}):local;
  if(!same(merged,local))await applyLocal(merged);
  if(remoteDoc&&same(merged,remoteDoc)){save({revision:remote.revision,base:merged,changedAt:null});return true;}
  const r=await transport.put({baseRevision:remote.revision||0,formatVersion:WALLET_FORMAT_VERSION,document:merged});
  if(r.ok){save({revision:r.revision,base:merged,changedAt:null});return true;}
  // 409: someone wrote in between. The merged copy is already this device's, so the next round starts from it.
  return false;
 }

 async function run(pushFirst){
  if(blocked||!isOn())return 'off';
  onStatus('syncing');
  try{
   for(let i=0;i<MAX_ROUNDS;i++)if(await round(pushFirst&&i===0)){onStatus('synced');return 'synced';}
   onStatus('error');return 'error';
  }catch(e){
   const code=e?.message==='signed_out'||e?.message==='wallet_format_newer'?e.message:e instanceof TypeError?'offline':'error';
   if(code==='wallet_format_newer'){blocked=true;onStatus('newer');return 'newer';}
   onStatus(code);return code;
  }
 }
 /** Runs one sync now; calls made while one runs are folded into one more run after it. */
 function sync(pushFirst=false){
  if(running){again=true;return running;}
  running=run(pushFirst).finally(()=>{running=null;if(again){again=false;sync(true);}});
  return running;
 }
 return {
  sync,
  /** A local change: remember when, and push after a quiet moment. */
  changed(){
   if(blocked||!isOn())return;
   save({changedAt:now()});
   if(timer!=null)timers.clear(timer);
   timer=timers.set(()=>{timer=null;sync(true);},PUSH_DEBOUNCE_MS);
  },
  /** Compares this device's document with the last synced copy and counts a difference as a change. Local only. */
  async check(){
   if(blocked||!isOn())return false;
   const st=readSyncState(storage);
   if(!st.base)return false;
   const local=migrateWalletDocument(await readLocal());
   if(same(local,st.base))return false;
   this.changed();return true;
  },
  stop(){if(timer!=null)timers.clear(timer);timer=null;},
 };
}

/**
 * Starts sync for the page when it is on and the user is signed in; otherwise does nothing at all (no request, no
 * listener) and returns a no-op. Returns `stop`.
 */
export function startWalletSync({gateway,storage=globalThis.localStorage,win=globalThis.window,doc=globalThis.document,fetchFn,readLocal,applyLocal,onStatus,interval={set:(f,ms)=>setInterval(f,ms),clear:id=>clearInterval(id)}}){
 const isOn=()=>!!gateway&&readSyncState(storage).on&&!!readSessionToken(storage);
 if(!isOn())return ()=>{};
 // The stores' own change events fire while a pulled copy is applied; those are not local edits.
 let applying=false;
 const apply=async merged=>{applying=true;try{await applyLocal(merged);}finally{applying=false;}};
 const engine=createWalletSync({transport:createAccountTransport({gateway,token:()=>readSessionToken(storage),fetchFn}),readLocal,applyLocal:apply,storage,isOn,onStatus});
 const pull=()=>{if(!doc||doc.visibilityState!=='hidden')engine.sync(true);};
 const changed=()=>{if(!applying)engine.changed();};
 const check=()=>{if(!doc||doc.visibilityState!=='hidden')engine.check().catch(()=>{});};
 win.addEventListener('focus',pull);win.addEventListener('online',pull);doc?.addEventListener('visibilitychange',pull);
 for(const ev of CHANGE_EVENTS)win.addEventListener(ev,changed);
 const id=interval.set(check,CHECK_INTERVAL_MS);
 engine.sync(true);
 return ()=>{
  engine.stop();interval.clear(id);
  win.removeEventListener('focus',pull);win.removeEventListener('online',pull);doc?.removeEventListener('visibilitychange',pull);
  for(const ev of CHANGE_EVENTS)win.removeEventListener(ev,changed);
 };
}
