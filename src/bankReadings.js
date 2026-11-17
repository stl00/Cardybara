// Bank readings in the synced wallet (stl00/Cardybara#416, epic #410). Bank pages are read only in the user's own
// browser (the extension); what travels with the wallet document is the amounts that came out of a read, so another
// device can show them: per bank, per card, the numeric fields with when each was read. Nothing else leaves the live
// store: no tab ids, no page text, no evidence, no cookies, no bank credentials. Anything not on the allow-list below is
// dropped on the way out and again on the way in.
import {LIVE_KEY} from './live.js';

export const READINGS_SCHEMA=1;
// The numeric card fields a read can fill (the same list live.js applies to a card).
export const READING_FIELDS=['balance','available','statement','statementClosing','minimum','creditLimit','bankRawBalance','offers'];
const STATUSES=['updated','partial'];
const BANK=/^[A-Za-z][A-Za-z0-9 ]{0,29}$/,CARD_ID=/^[a-zA-Z0-9-]{1,64}$/,SOURCE=/^[A-Za-z0-9_.:-]{1,60}$/;
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const iso=v=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v))?v:null;
const ms=v=>Date.parse(v);

export const emptyReadings=()=>({schema:READINGS_SCHEMA,banks:{}});

function cleanPatch(p){
 if(!plain(p)||typeof p.id!=='string'||!CARD_ID.test(p.id))return null;
 const capturedAt=iso(p.capturedAt);
 if(!capturedAt)return null;
 const fields={},fieldCapturedAt={},fieldSources={};
 for(const k of READING_FIELDS){
  const v=p.fields?.[k];
  if(typeof v!=='number'||!Number.isFinite(v))continue;
  fields[k]=v;fieldCapturedAt[k]=iso(p.fieldCapturedAt?.[k])||capturedAt;
  if(typeof p.fieldSources?.[k]==='string'&&SOURCE.test(p.fieldSources[k]))fieldSources[k]=p.fieldSources[k];
 }
 if(!Object.keys(fields).length)return null;
 return {id:p.id,capturedAt,fields,fieldCapturedAt,...(Object.keys(fieldSources).length?{fieldSources}:{})};
}
/**
 * The allow-listed readings out of the live store (or out of a document's `banks`): a fresh object, sorted so two equal
 * sets of readings compare equal. A bank with nothing readable is left out.
 */
export function readingsFromLive(live){
 const banks={};
 for(const bank of Object.keys(plain(live)?live:{}).sort()){
  const e=live[bank];
  if(!BANK.test(bank)||!plain(e))continue;
  const byId=new Map();
  for(const p of Array.isArray(e.patches)?e.patches:[]){const c=cleanPatch(p);if(c)byId.set(c.id,c);}
  if(!byId.size)continue;
  banks[bank]={attemptedAt:iso(e.attemptedAt)||[...byId.values()].map(p=>p.capturedAt).sort().at(-1),status:STATUSES.includes(e.status)?e.status:'updated',patches:[...byId.values()].sort((a,b)=>a.id<b.id?-1:1)};
 }
 return {schema:READINGS_SCHEMA,banks};
}
/** A document's section, cleaned; anything that is not a readings section reads as none. */
export const cleanReadings=section=>plain(section)&&section.schema===READINGS_SCHEMA?readingsFromLive(section.banks):emptyReadings();

function mergePatch(a,b){
 const out={id:a.id,capturedAt:ms(b.capturedAt)>ms(a.capturedAt)?b.capturedAt:a.capturedAt,fields:{},fieldCapturedAt:{},fieldSources:{}};
 for(const k of new Set([...Object.keys(a.fields),...Object.keys(b.fields)])){
  const pickB=!(k in a.fields)||(k in b.fields&&ms(b.fieldCapturedAt[k])>ms(a.fieldCapturedAt[k]));
  const src=pickB?b:a;
  out.fields[k]=src.fields[k];out.fieldCapturedAt[k]=src.fieldCapturedAt[k];
  if(src.fieldSources?.[k])out.fieldSources[k]=src.fieldSources[k];
 }
 if(!Object.keys(out.fieldSources).length)delete out.fieldSources;
 return out;
}
/**
 * Two sets of readings become one: for every field the reading taken later wins, whichever device took it, so a
 * fresh read on the extension is never replaced by an older copy and the other way round. `mapId` renames a card
 * (a card folded into another follows it); returning null drops the card's readings (a removed card).
 */
export function mergeBankReadings(a,b,mapId=id=>id){
 const A=cleanReadings(a),B=cleanReadings(b),banks={};
 for(const bank of new Set([...Object.keys(A.banks),...Object.keys(B.banks)])){
  const ea=A.banks[bank],eb=B.banks[bank],byId=new Map();
  for(const e of [ea,eb])for(const p of e?.patches||[]){
   const id=mapId(p.id);if(id==null)continue;
   const q={...p,id};
   byId.set(id,byId.has(id)?mergePatch(byId.get(id),q):q);
  }
  if(!byId.size)continue;
  const later=!ea?eb:!eb?ea:ms(eb.attemptedAt)>ms(ea.attemptedAt)?eb:ea;
  banks[bank]={attemptedAt:later.attemptedAt,status:later.status,patches:[...byId.values()].sort((x,y)=>x.id<y.id?-1:1)};
 }
 return {schema:READINGS_SCHEMA,banks};
}

const parse=(storage,key)=>{try{return JSON.parse(storage.getItem(key))}catch{return null}};
/** This device's readings, from its live store. */
export const readBankReadings=storage=>readingsFromLive(parse(storage,LIVE_KEY)||{});
/**
 * Writes readings into this device's live store, where the wallet applies them to its cards (applyLive). With
 * `replace`, a card the readings no longer mention (it was removed) loses its stored reading; otherwise readings
 * only add or update. Fields this device holds that are not on the allow-list are kept for the cards that stay.
 */
export function storeBankReadings(storage,readings,{replace=false}={}){
 const live=plain(parse(storage,LIVE_KEY))?parse(storage,LIVE_KEY):{};
 const R=cleanReadings(readings);
 for(const [bank,e] of Object.entries(R.banks)){
  const old=plain(live[bank])?live[bank]:{},oldById=new Map((old.patches||[]).map(p=>[p.id,p]));
  const patches=e.patches.map(p=>{const o=oldById.get(p.id);return o?{...o,...p,fields:{...o.fields,...p.fields},fieldCapturedAt:{...o.fieldCapturedAt,...p.fieldCapturedAt},fieldSources:{...o.fieldSources,...p.fieldSources}}:p;});
  const kept=replace?[]:(old.patches||[]).filter(p=>!e.patches.some(x=>x.id===p.id));
  live[bank]={...old,status:e.status,attemptedAt:e.attemptedAt,receivedCount:patches.length,patches:[...kept,...patches]};
 }
 if(replace)for(const bank of Object.keys(live))if(!R.banks[bank])delete live[bank];
 storage.setItem(LIVE_KEY,JSON.stringify(live));
}

/** When a card's bank amounts were last read: the latest field date, or null for a card that was never read. */
export function lastBankRead(card){
 const times=Object.values(card?.fieldDates||{}).filter(v=>typeof v==='string'&&Number.isFinite(Date.parse(v)));
 return times.length?times.sort().at(-1):null;
}
