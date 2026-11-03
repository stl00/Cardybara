import {ORIGIN,PROVIDERS,FIELDS,VERSION} from './providers.js';
const token=v=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(v);
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,allowed)=>object(v)&&Object.keys(v).every(k=>allowed.includes(k));
export function trusted(sender){try{return Number.isInteger(sender?.tab?.id)&&sender.frameId===0&&new URL(sender.url).origin===ORIGIN;}catch{return false;}}
export function request(m){
 if(!object(m)||JSON.stringify(m).length>16000||!token(m.requestId))throw Error('invalid_request');
 if(['hello','cancel','export'].includes(m.type)){if(!keys(m,['type','requestId','channel']))throw Error('invalid_request');return m;}
 if(['disconnect','connect','clear','focus-bank'].includes(m.type)){
  if(!keys(m,['type','requestId','bank','channel'])||!Object.hasOwn(PROVIDERS,m.bank))throw Error('invalid_bank');return m;
 }
 if(m.type!=='refresh'||!keys(m,['type','requestId','banks','cards','cardId','channel'])||!Array.isArray(m.banks)||!m.banks.length||m.banks.length>7||new Set(m.banks).size!==m.banks.length||m.banks.some(b=>!Object.hasOwn(PROVIDERS,b))||!Array.isArray(m.cards)||m.cards.length>40)throw Error('invalid_scope');
 const ids=new Set();
 for(const c of m.cards){
  if(!keys(c,['id','bank','tail','currency'])||!token(c.id)||ids.has(c.id)||!Object.hasOwn(PROVIDERS,c.bank)||!/^\d{4,5}$/.test(c.tail)||c.currency!==PROVIDERS[c.bank].currency)throw Error('invalid_card');ids.add(c.id);
 }
 if(m.cardId!==undefined&&(!token(m.cardId)||m.banks.length!==1||!m.cards.some(c=>c.id===m.cardId&&c.bank===m.banks[0])))throw Error('invalid_card_scope');
 return m;
}
export function validateRead(raw,job,now=Date.now()){
 if(!keys(raw,['status','patches'])||!['updated','partial','no_data','needs_login','needs_confirmation','load_error','ambiguous'].includes(raw.status)||!Array.isArray(raw.patches)||raw.patches.length>40||JSON.stringify(raw).length>64000)throw Error('invalid_result');
 if(raw.patches.length&&!['updated','partial'].includes(raw.status))throw Error('contradictory_result');
 const seen=new Set(),patches=[];
 for(const p of raw.patches){
  const card=job.cards.find(c=>c.id===p.id);
  if(!keys(p,['id','fields','capturedAt','locale'])||!card||seen.has(p.id)||!object(p.fields)||!Object.keys(p.fields).length||!Object.keys(p.fields).every(k=>FIELDS.includes(k))||!PROVIDERS[job.bank].locales.includes(p.locale)||!Number.isFinite(Date.parse(p.capturedAt))||Date.parse(p.capturedAt)<job.startedAt-5000||Date.parse(p.capturedAt)>now+60000)throw Error('invalid_fields');
  seen.add(p.id);const fields={};
  for(const [key,value] of Object.entries(p.fields)){
   if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e9||(!['balance','statementClosing'].includes(key)&&value<0))throw Error('invalid_amount');
   fields[key]={value,currency:card.currency,capturedAt:p.capturedAt,source:{issuer:PROVIDERS[job.bank].issuer,region:PROVIDERS[job.bank].region,page:'account-overview'},locale:p.locale,adapterVersion:VERSION,status:'observed'};
  }
  if(!job.cardId||job.cardId===p.id)patches.push({id:p.id,fields});
 }
 return {status:patches.length?(patches.length===(job.cardId?1:job.cards.length)?'updated':'partial'):raw.status==='updated'||raw.status==='partial'?'no_data':raw.status,patches};
}
