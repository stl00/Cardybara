// Problem reports a beta tester saves and sends by hand after a failed or partial read (#196).
// Page structure comes from problem-structure.js (the shared redaction in structure-report.js): ids, roles,
// vocabulary words and value shapes only. Card values are reported as read or missing, never as values.
// Nothing here sends anything anywhere.
import {redactStructureText} from './structure-report.js';

export const BILLING=['balance','statement','minimum','due'];
export const STRUCTURE_KEY='cardybara:problem-structure';
const BAD=['partial','failed','no_data','load_error','timeout','interrupted','ambiguous','navigation_changed','tab_closed'];
const REGION={'Amex US':'US','Amex HK':'HK','Amex CA':'CA','Chase':'US','BOA':'US','Citi US':'US','HSBC HK':'HK','SC HK':'HK'};

// Which billing fields each card has, in record order. Card ids hold tails, so they become card-1, card-2.
// A card whose page says no payment is due has no minimum or due date to read.
export function cardFields(records){
 return Object.values(records||{}).map((fields,i)=>{
  const has=k=>Object.hasOwn(fields||{},k),settled=has('paymentStatus');
  return {card:'card-'+(i+1),fields:Object.fromEntries(BILLING.map(k=>[k,has(k)?'read':settled&&k!=='balance'&&k!=='statement'?'not_due':'missing'])),
   other:Object.keys(fields||{}).filter(k=>!BILLING.includes(k)&&/^[A-Za-z]{1,40}$/.test(k)).sort()};
 });
}

// Offer a report when the bank's job did not read everything, or a card misses a billing field.
export function needsReport(job,records){
 if(!job||['queued','opening','navigating','capturing','cancelled'].includes(job.status))return false;
 if(BAD.includes(job.status)||job.readError)return true;
 return cardFields(records).some(c=>Object.values(c.fields).includes('missing'));
}

// Fail closed: page text goes through the redaction again, and every other string has its digits masked, so a
// digit from the page can't survive even if a stored structure came from an older build. Run codes are ours.
const clean=v=>typeof v==='string'?redactStructureText(v).replace(/\p{N}/gu,'#'):Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[clean(k),clean(x)])):v;
// Ids, paths and hashes keep only vocabulary and generic page words; tags, roles, input types and language codes
// keep only a short code. Both again, so a structure stored by an older build cannot carry a name through.
const ident=v=>redactStructureText(String(v||''),true).replace(/\p{N}/gu,'#');
const code=v=>String(v??'').replace(/[^A-Za-z0-9-]/g,'').slice(0,20);
const tagLike=v=>String(v??'').replace(/[^A-Za-z-]/g,'').slice(0,20);
const shapeOnly=v=>typeof v==='string'?v.replace(/\p{N}/gu,'#'):Array.isArray(v)?v.map(shapeOnly):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[shapeOnly(k),shapeOnly(x)])):v;

export function buildReport({build,version,bank,job,records,structure,diagnostic,createdAt=new Date().toISOString()}){
 const sections=Object.fromEntries(Object.entries(job?.sections||{}).map(([k,v])=>[k,{status:v?.status||null,...(v?.reason?{reason:v.reason}:{}),...(Array.isArray(v?.missing)?{missing:v.missing}:{})}]));
 const run={status:job?.status||null,phase:job?.phase||null,readError:job?.readError?clean(job.readError):null,received:job?.received??null,pages:job?.pages??null,rejected:job?.rejected??null,
  rejectReasons:Object.fromEntries(Object.entries(job?.rejectReasons||{}).map(([k,v])=>[k,typeof v==='number'?v:null])),sections,
  diagnostic:diagnostic?{adapterBuild:diagnostic.adapterBuild||null,language:diagnostic.language||null,locale:diagnostic.locale||null,cards:diagnostic.cards??null,fieldCount:diagnostic.fieldCount??null}:null};
 const page=structure?.report?{lang:tagLike(structure.report.lang),path:ident(structure.report.path),hashShape:ident(structure.report.hashShape),title:clean(structure.report.title||''),
  rows:(structure.report.rows||[]).slice(0,1500).map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,['text','aria'].includes(k)?clean(v):k==='id'?ident(v):k==='tag'||k==='role'?code(v):typeof v==='string'?tagLike(v):typeof v==='boolean'?v:null])))}:null;
 return {schema:1,kind:'cardybara-problem-report',createdAt,extension:{version:version||null,build:build||null},bank,region:REGION[bank]||null,
  run:shapeOnly(run),cards:cardFields(records),structure:page?{capturedAt:structure.capturedAt||null,...page}:null,
  privacy:'Amounts, card numbers, names, dates and free text are replaced by placeholders: # for each digit, [word] or [字] for other words. Only generic label words remain.'};
}

// One way to gather a report, for the popup and the wallet page. Outside the extension (no chrome.storage) the
// report still holds the run and field states, with no page structure.
export const reportFileName=bank=>'cardybara-problem-report-'+String(bank).replace(/\W+/g,'-').toLowerCase()+'.json';
export async function collectReport(job,state,api=globalThis.chrome){
 const DIAG='cardybara:last-read-diagnostic';let got={},version=null;
 try{if(api?.storage?.local)got=await api.storage.local.get([STRUCTURE_KEY,DIAG])||{};}catch{}
 try{version=api?.runtime?.getManifest?.().version||null;}catch{}
 const diag=got[DIAG];
 return buildReport({build:state?.runtimeBuild,version,bank:job.bank,job,records:state?.records?.[job.bank],structure:got[STRUCTURE_KEY]?.[job.bank]||null,diagnostic:diag?.bank===job.bank?diag:null});
}

// Replay a report's page structure as synthetic text a reader can parse, for a failing fixture.
// Each # becomes a digit from a counter so amounts differ; date shapes become 12 Dec 2030, which reads the same day-first or month-first.
export function replayText(report){
 let n=0;const digit=()=>String((n++%9)+1);
 const value=s=>s.replace(/(?<![#\d])#{1,2}\/#{1,2}\/#{4}(?![#\d])/g,'12/12/2030').replace(/(?<![#\d])#{4}-#{2}-#{2}(?![#\d])/g,'2030-12-12')
  .replace(/(?<![#\d,.])####(?![#\d,.])/g,'0000').replace(/#/g,digit).replace(/\[word\]/g,'Word').replace(/\[字\]/g,'字').replace(/\[x\]/g,'x');
 return (report?.structure?.rows||[]).flatMap(r=>[r.aria,r.text].filter(Boolean)).map(value).join('\n');
}
