import {PROVIDERS,FIELDS} from '../extension-next/providers.js';
const statuses=['queued','opening','navigating','capturing','updated','partial','no_data','needs_login','needs_confirmation','load_error','ambiguous','interrupted','cancelled','timeout','navigation_changed','tab_closed','cleared','disconnected'];
export function collectorSnapshot(s,cards){
 if(!s||s.schema!==2||!Number.isSafeInteger(s.revision)||s.revision<0||!s.records||Array.isArray(s.records)||JSON.stringify(s).length>3000000||!Array.isArray(s.disabled)||s.disabled.some(b=>!Object.hasOwn(PROVIDERS,b)))throw Error('invalid_snapshot');
 if(s.run&&(!/^[a-zA-Z0-9-]{1,64}$/.test(s.run.id)||!['running','complete','interrupted','cancelled'].includes(s.run.status)||!Array.isArray(s.run.jobs)||s.run.jobs.length>7||s.run.jobs.some(j=>!Object.hasOwn(PROVIDERS,j.bank)||!statuses.includes(j.status))))throw Error('invalid_run');
 const live={};
 for(const [bank,records]of Object.entries(s.records)){
  if(!Object.hasOwn(PROVIDERS,bank)||!records||typeof records!=='object'||Array.isArray(records)||Object.keys(records).length>40)throw Error('invalid_bank');
  const patches=[];
  for(const [id,fields]of Object.entries(records)){
   const c=cards.find(c=>c.id===id&&c.bank===bank);if(!c)continue;
   if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).some(k=>!FIELDS.includes(k)))throw Error('invalid_field');
   const values={},dates={},sources={};
   for(const [k,f]of Object.entries(fields)){
    if(!f||!Number.isFinite(f.value)||Math.abs(f.value)>1e9||(!['balance','statementClosing'].includes(k)&&f.value<0)||f.currency!==c.currency||f.status!=='observed'||!Number.isFinite(Date.parse(f.capturedAt))||Date.parse(f.capturedAt)>Date.now()+60000||f.source?.region!==PROVIDERS[bank].region||f.source?.issuer!==PROVIDERS[bank].issuer||!PROVIDERS[bank].locales.includes(f.locale)||f.adapterVersion!=='1.1.0')throw Error('invalid_observation');
    values[k]=f.value;dates[k]=f.capturedAt;sources[k]={...f.source,locale:f.locale,adapterVersion:f.adapterVersion,currency:f.currency};
   }
   if(Object.keys(values).length)patches.push({id,fields:values,fieldCapturedAt:dates,fieldSources:sources,capturedAt:Object.values(dates).sort().at(-1)});
  }
  const job=s.run?.jobs.find(j=>j.bank===bank);live[bank]={patches,tabId:Number.isInteger(job?.tabId)?job.tabId:undefined,status:job?.status||'partial',receivedCount:job?.received??patches.length,attemptedAt:job?.finishedAt?new Date(job.finishedAt).toISOString():patches.map(p=>p.capturedAt).sort().at(-1)};
 }
 for(const job of s.run?.jobs||[])if(!live[job.bank])live[job.bank]={patches:[],tabId:Number.isInteger(job.tabId)?job.tabId:undefined,receivedCount:0,status:job.status,attemptedAt:job.finishedAt?new Date(job.finishedAt).toISOString():undefined};
 return live;
}
