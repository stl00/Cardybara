// Public, deterministic knowledge API. No model, network, credentials or account storage.
import manifest from './data/knowledge/manifest.json' with {type:'json'};
import taxonomy from './data/knowledge/taxonomy.json' with {type:'json'};
import entities from './data/knowledge/entities.json' with {type:'json'};
import sources from './data/knowledge/sources.json' with {type:'json'};
import storedRules from './data/knowledge/rules.json' with {type:'json'};
import {cardProducts} from './productCatalog.js';
import {validateCoupon} from './couponKnowledge.js';
const copy=value=>structuredClone(value);
// A programme's transfer rule reaches every card the catalogue links to that programme.
const rules=storedRules.map(r=>r.terms?.appliesTo==='linked-products'?{...r,productIds:[...new Set([...r.productIds,...cardProducts.filter(p=>p.transferProgrammeId===r.terms.fromProgrammeId).map(p=>p.id)])]}:r);
export const knowledgeManifest=copy(manifest);
export const knowledgeTaxonomy=copy(taxonomy);
export const knowledgeEntities=copy(entities);
const isDate=value=>typeof value==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
function assertDate(value){if(!isDate(value))throw new TypeError('Expected a real YYYY-MM-DD date');}
export function assessKnowledgeRule(rule,{asOf=manifest.asOf}={}){
 assertDate(asOf);const v=rule.validity;
 const temporal=v.effectiveFrom&&asOf<v.effectiveFrom?'not-started':v.effectiveThrough&&asOf>v.effectiveThrough?'expired':v.effectiveFrom?'within-dated-validity':'start-unknown';
 return {asOf,temporal,enrollmentWindow:v.enrollBy?(asOf>v.enrollBy?'closed':'open'):'not-specified',reviewDue:asOf>rule.review.reviewAfter,checkedAt:rule.evidence.checkedAt,eligibility:'not-assessed',conditionsCoverage:rule.conditions.coverage};
}
// Bitemporal selection: what was known then, and what applied on the requested day.
export function resolveRuleRevisions(records,{asOf=manifest.asOf,knownAt=asOf,includeInactive=false}={}){
 assertDate(asOf);assertDate(knownAt);if(knownAt>asOf)throw new TypeError('knownAt cannot be later than asOf');
 const groups=new Map();
 for(const rule of records){if(!['published','withdrawn'].includes(rule.status)||rule.evidence.checkedAt>knownAt)continue;(groups.get(rule.id)||groups.set(rule.id,[]).get(rule.id)).push(rule);}
 const selected=[];
 for(const rows of groups.values()){
  const started=rows.filter(r=>!r.validity.effectiveFrom||r.validity.effectiveFrom<=asOf);
  const pool=started.length?started:rows;
  const chosen=pool.toSorted((a,b)=>b.revision-a.revision)[0];
  // A withdrawn revision ends the rule from the day it was recorded; earlier knowledge still sees it.
  if(chosen.status==='withdrawn')continue;
  // Never resurrect an older, apparently perpetual rule after its replacement expired.
  if(includeInactive||!['not-started','expired'].includes(assessKnowledgeRule(chosen,{asOf}).temporal))selected.push(copy(chosen));
 }
 return selected;
}
// Rule text has a language. `original` is written in the official source's language, with short verbatim quotes
// from the cited pages; `content` is the zh-CN text, a translation once `content.translatedFrom` is set.
export const ORIGINAL_LANGUAGES=['en-US','en-HK','en-CA','zh-HK','zh-TW','zh-CN'];
const QUOTE_MAX=320;
const script=lang=>/^en/.test(lang)?'en':/^zh-(?:HK|TW|Hant)/.test(lang)?'zh-Hant':/^zh/.test(lang)?'zh-Hans':lang;
// Hong Kong and Taiwan text share a script, so a zh-HK original serves a zh-TW reader as the same language.
export const sameLanguage=(a,b)=>!!a&&!!b&&script(a)===script(b);
/** The text to show a reader of `language`: the same language first, then zh-CN for any Chinese reader (another
 * script of the same language), then the original, then zh-CN. */
export function ruleText(rule,language='zh-CN'){
 const o=rule.original,zh={lang:'zh-CN',title:rule.content.title,summary:rule.content.summary,howToUse:rule.content.howToUse,translated:!!rule.content.translatedFrom};
 const pick=t=>({lang:t.lang,title:t.title,summary:t.summary,howToUse:t.howToUse,translated:!!t.translated});
 if(o&&sameLanguage(o.lang,language))return pick(o);
 const shown=Object.entries(rule.translations||{}).find(([lang])=>sameLanguage(lang,language));if(shown)return pick({...shown[1],lang:shown[0],translated:true});
 if(/^zh/.test(language)||!o)return pick(zh);
 return pick(o);
}
/** Category/scenario/programme are controlled IDs, not guesses extracted from prose. */
export function queryKnowledge({productId,kind,category,scenarioId,programmeId,issuer,country,requiresEnrollment,text='',asOf=manifest.asOf,knownAt=asOf,includeInactive=false}={}){
 assertDate(asOf);assertDate(knownAt);
 if(knownAt>asOf)throw new TypeError('knownAt cannot be later than asOf');
 for(const [value,list] of [[kind,taxonomy.ruleKinds],[category,taxonomy.categories.map(x=>x.id)],[scenarioId,taxonomy.scenarios.map(x=>x.id)],[programmeId,entities.programmes.map(x=>x.id)]])if(value&&!list.includes(value))throw new TypeError(`Unknown taxonomy/entity ID: ${value}`);
 if(productId&&!cardProducts.some(p=>p.id===productId))throw new TypeError(`Unknown product ID: ${productId}`);
 if(requiresEnrollment!==undefined&&typeof requiresEnrollment!=='boolean')throw new TypeError('requiresEnrollment must be boolean');
 const needle=String(text).normalize('NFKC').toLowerCase();
 const result=resolveRuleRevisions(rules,{asOf,knownAt,includeInactive}).filter(r=>(!productId||r.productIds.includes(productId))&&(!kind||r.kind===kind)&&(!category||r.category===category)&&(!scenarioId||r.scenarioIds.includes(scenarioId))&&(!programmeId||r.programmeIds.includes(programmeId))&&(!issuer||r.market.issuer===issuer)&&(!country||r.market.country===country)&&(requiresEnrollment===undefined||r.terms.requiresEnrollment===requiresEnrollment)&&(!needle||[r.id,r.content.title,r.content.summary,...r.content.howToUse,...r.programmeIds.map(id=>entities.programmes.find(p=>p.id===id)?.name||'')].some(v=>v.toLowerCase().includes(needle)))).sort((a,b)=>a.id.localeCompare(b.id));
 return {snapshotId:manifest.snapshotId,asOf,knownAt,count:result.length,rules:result.map(r=>({...copy(r),assessment:assessKnowledgeRule(r,{asOf})}))};
}
export function getKnowledgeRule(id,options={}){return queryKnowledge({...options,includeInactive:true}).rules.find(r=>r.id===id)||null;}
export function ruleRevisions(id){return copy(rules.filter(r=>r.id===id).sort((a,b)=>a.revision-b.revision));}
export function knowledgeSources(ids){return copy(sources.filter(s=>ids.includes(s.id)));}
export function groupKnowledge(result,by='category'){
 if(!['category','scenario','programme','kind'].includes(by))throw new TypeError('Unsupported grouping');
 const groups={};for(const r of result.rules){const keys=by==='scenario'?r.scenarioIds:by==='programme'?r.programmeIds:[r[by]];for(const key of keys){(groups[key]??=[]).push(copy(r));}}
 return groups;
}
/** Missing context and unparsed conditions are explicit; this never authorizes an action. */
export function inspectRuleRequirements(id,context={},options={}){
 const rule=getKnowledgeRule(id,options);if(!rule)return null;
 const get=path=>path.split('.').reduce((o,k)=>o&&Object.hasOwn(o,k)?o[k]:undefined,context);
 const checks=rule.conditions.all.map(c=>{const value=get(c.field);return {...c,result:value===undefined||value===null?'unknown':c.op==='eq'?(value===c.value?'satisfied':'not-satisfied'):typeof value!=='number'||!Number.isFinite(value)?'unknown':value>=c.value?'satisfied':'not-satisfied'};});
 // Partial conditions, unknown personal state and historical spend timing forbid a positive eligibility claim.
 return {ruleId:rule.id,revisionId:rule.revisionId,checks,unparsedText:rule.conditions.unparsedText,result:checks.some(c=>c.result==='not-satisfied')?'requirements-not-met':'needs-verification',remainingQuestions:['是否满足原文中的全部适用条件？','个人登记、有效期及使用进度是否有银行证据？'],actionsAuthorized:false};
}
// Compatibility view for the existing wallet. Canonical facts live only in knowledge/*.json.
export function benefitProfileView({asOf=manifest.asOf}={}){
 return (manifest.profileProductIds||manifest.pilotProductIds).map(productId=>{
  const rows=queryKnowledge({productId,includeInactive:true,asOf}).rules,meta=manifest.profileMetadata[productId],fee=role=>rows.find(r=>r.kind==='fee'&&r.terms.cardholderRole===role);
  return {productId,...copy(meta),fees:{currency:fee('primary')?.terms.currency||null,primaryAnnual:fee('primary')?.terms.amount??null,additionalAnnual:fee('additional')?.terms.amount??null,scope:'published-standard-fees-not-actual-account-charge',sourceIds:fee('primary')?.evidence.sourceIds||[]},
   earningRates:rows.filter(r=>r.kind==='earning-rate').map(r=>({label:r.terms.spendCategory,multiplier:r.terms.multiplier,...(r.terms.unit!=='points-per-USD'?{unit:r.terms.unit}:{}),...(productId!=='chase-us-sapphire-reserve'?{condition:r.content.summary}:{}),sourceIds:r.evidence.sourceIds})),
   benefits:rows.filter(r=>r.kind==='benefit').sort((a,b)=>rules.findIndex(r=>r.revisionId===a.revisionId)-rules.findIndex(r=>r.revisionId===b.revisionId)).map(r=>({id:r.id.split('.').at(-1),...copy(r.terms),title:r.content.title,condition:r.content.summary,sourceIds:r.evidence.sourceIds,checkedAt:r.evidence.checkedAt,accountState:'unverified',...(r.validity.effectiveFrom?{validFrom:r.validity.effectiveFrom}:{}),...(r.validity.effectiveThrough?{validThrough:r.validity.effectiveThrough}:{}),...(r.validity.enrollBy?{enrollBy:r.validity.enrollBy}:{}),...(r.evidence.verification==='summary-only'?{verification:'summary-only'}:{}),knowledgeRuleId:r.id,revisionId:r.revisionId,howToUse:copy(r.content.howToUse),...(r.original?{original:{lang:r.original.lang,title:r.original.title,summary:r.original.summary,howToUse:copy(r.original.howToUse)}}:{}),...(r.translations?{translations:copy(r.translations)}:{})})),
   transferPartners:rows.filter(r=>r.kind==='transfer-relationship').map(r=>{const p=entities.programmes.find(p=>p.id===r.terms.toProgrammeId);return {category:p.kind,programme:p.name,relationship:r.terms.relationship,ratio:r.transferRate?.rate??null,ratioCondition:r.transferRate?.condition??null,ratesReviewed:!!r.transferRate,accountLinked:'unverified',sourceIds:r.evidence.sourceIds};})};
 });
}
export const benefitSourceView=Object.fromEntries(sources.map(s=>[s.id,copy(s)]));
export const hsbcRewardCashView={...copy(manifest.hsbcRewardCash),capabilities:queryKnowledge({kind:'channel-capability',includeInactive:true}).rules.map(r=>({feature:r.content.title,channel:r.terms.channel,finding:r.content.summary,sourceIds:r.evidence.sourceIds}))};
export function validateKnowledge(records=rules){
 const errors=[],ids=new Map(),revIds=new Set(),sourceIds=new Set(sources.map(s=>s.id)),productIds=new Set(cardProducts.map(p=>p.id)),programmeIds=new Set(entities.programmes.map(p=>p.id));
 for(const r of records){
  const fail=m=>errors.push(`${r.revisionId}: ${m}`);
  if(revIds.has(r.revisionId))fail('duplicate revision ID');revIds.add(r.revisionId);
  if(!Number.isInteger(r.revision)||r.revision<1)fail('invalid revision');
  if(!r.id.startsWith('rule.')||!r.revisionId.startsWith(r.id+'@'))fail('unstable ID');
  (ids.get(r.id)||ids.set(r.id,[]).get(r.id)).push(r);
  if(!taxonomy.ruleKinds.includes(r.kind)||!taxonomy.categories.some(c=>c.id===r.category))fail('invalid kind/category');
  if(r.productIds.some(id=>!productIds.has(id))||r.programmeIds.some(id=>!programmeIds.has(id)))fail('dangling product/programme');
  if(r.scenarioIds.some(id=>!taxonomy.scenarios.some(s=>s.id===id)))fail('unknown scenario');
  if(!r.evidence.sourceIds.length||r.evidence.sourceIds.some(id=>!sourceIds.has(id)))fail('missing source');
  if(r.status==='published'&&!r.evidence.sourceIds.some(id=>sources.find(s=>s.id===id)?.authority==='official'))fail('published fact requires official source');
  if(!isDate(r.evidence.checkedAt)||!isDate(r.review.reviewAfter)||r.review.reviewAfter<r.evidence.checkedAt)fail('invalid review dates');
  for(const key of ['effectiveFrom','effectiveThrough','enrollBy'])if(r.validity[key]!==null&&!isDate(r.validity[key]))fail('invalid validity date');
  if(r.validity.effectiveFrom&&r.validity.effectiveThrough&&r.validity.effectiveFrom>r.validity.effectiveThrough)fail('reversed validity');
  if(r.terms.period&&!taxonomy.periods.includes(r.terms.period))fail('unknown period');
  if(r.kind==='earning-rate'&&!taxonomy.rateUnits.includes(r.terms.unit))fail('unknown earning unit');
  if(!r.content.title||!r.content.summary||!r.content.howToUse.length)fail('missing explanation');
  if(r.original){
   const o=r.original,text=v=>typeof v==='string'&&v.trim().length>0;
   if(!ORIGINAL_LANGUAGES.includes(o.lang))fail('original: unknown language');
   if(!text(o.title)||!text(o.summary)||!Array.isArray(o.howToUse)||!o.howToUse.length||!o.howToUse.every(text))fail('original: missing text');
   if(!Array.isArray(o.quotes)||!o.quotes.length)fail('original: needs a quote from the source');
   for(const q of o.quotes||[]){if(!r.evidence.sourceIds.includes(q.sourceId))fail('original: quote from a source the rule does not cite');if(!text(q.text)||q.text.length>QUOTE_MAX)fail('original: quotes are short key sentences');}
   if(r.content.translatedFrom!==o.lang)fail('original: zh-CN content must be marked as translated from the original');
  }else if(r.content.translatedFrom)fail('translated content without an original');
  for(const [lang,t] of Object.entries(r.translations||{}))if(!ORIGINAL_LANGUAGES.includes(lang)||sameLanguage(lang,r.original?.lang)||sameLanguage(lang,'zh-CN')||!t.title||!t.summary||!t.howToUse?.length)fail('invalid display translation');
  if(r.conditions.coverage!=='partial'||!r.conditions.unparsedText)fail('conditions must preserve unresolved text');
  for(const c of r.conditions.all)if(!taxonomy.conditionOps.includes(c.op)||!taxonomy.conditionFields.includes(c.field))fail('unsupported condition');
  if(r.personalState!=='not-in-public-knowledge')fail('personal state in public knowledge');
  if(r.kind==='transfer-relationship'&&r.status==='published'){
   const ratio=r.transferRate?.rate??null;
   if(r.terms.ratio!==null)fail('rates belong in transferRate until the assistant can tell cards apart');
   if(ratio!==null&&!(Number.isInteger(ratio?.from)&&Number.isInteger(ratio?.to)&&ratio.from>0&&ratio.to>0))fail('transfer rate must be null or positive whole numbers');
   if(r.terms.fromProgrammeId&&!r.programmeIds.includes(r.terms.fromProgrammeId))fail('transfer source programme not linked');
   if(!r.productIds.length)fail('transfer rule without products');
   for(const key of ['minimumPoints','incrementPoints','maximumPoints'])if(r.terms[key]!==undefined&&r.terms[key]!==null&&!(Number.isInteger(r.terms[key])&&r.terms[key]>0))fail(`invalid ${key}`);
  }
  if(r.status==='withdrawn'){const next=records.find(x=>x.id===r.terms.replacedByRuleId);if(!next||r.productIds.some(id=>!next.productIds.includes(id)))fail('withdrawn rule must name a replacement covering its cards');}
  if(r.terms.coupon){
   for(const error of validateCoupon(r.terms.coupon,r.terms,[...sourceIds]))fail('coupon: '+error);
   if(r.kind!=='benefit'||!['credit','promo'].includes(r.category))fail('coupon outside benefit credit/promo');
   if(r.terms.coupon.review?.checkedAt!==r.evidence.checkedAt||(!Array.isArray(r.terms.coupon.review?.sourceIds)||r.terms.coupon.review.sourceIds.some(id=>!r.evidence.sourceIds.includes(id))))fail('coupon evidence mismatch');
  }
 }
 for(const p of cardProducts)if(p.transferProgrammeId){const market=records.find(r=>r.kind==='transfer-relationship'&&r.status==='published'&&r.terms.fromProgrammeId===p.transferProgrammeId)?.market;if(!programmeIds.has(p.transferProgrammeId))errors.push(`${p.id}: unknown transfer programme`);else if(market&&(market.issuer!==p.bank||market.country!==p.region))errors.push(`${p.id}: transfer programme from another issuer or market`);}
 for(const [id,rows] of ids){rows.sort((a,b)=>a.revision-b.revision);for(let i=0;i<rows.length;i++){if(i===0&&rows[i].supersedes!==null)errors.push(`${id}: missing root revision`);if(i>0&&(rows[i].revision<=rows[i-1].revision||rows[i].supersedes!==rows[i-1].revisionId||rows[i].evidence.checkedAt<rows[i-1].evidence.checkedAt))errors.push(`${id}: broken revision chain`);}}
 return {valid:errors.length===0,errors,rules:records.length,uniqueRules:ids.size,programmes:entities.programmes.length,sources:sources.length};
}
