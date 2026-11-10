// Shared by the offline and live benefit recall evals: loads and checks a golden file, runs find_benefits-shaped
// calls against synthetic portfolios, and scores what came back.
import {readFile} from 'node:fs/promises';
import {searchBenefitKnowledge} from '../../src/benefitSearch.js';
import {queryKnowledge} from '../../src/knowledge.js';
import {cardProducts} from '../../src/productCatalog.js';
import {validateToolCall} from '../../src/walletAgent.js';
export const K=12;

export async function loadGolden(goldenPath){
 const golden=JSON.parse(await readFile(goldenPath,'utf8'));
 const active=new Set(queryKnowledge({kind:'benefit',asOf:golden.asOf}).rules.map(r=>r.id));
 const problems=[];
 const portfolios=Object.fromEntries(Object.entries(golden.portfolios).map(([name,aliases])=>[name,{aliases,cards:Object.entries(aliases).map(([alias,productId])=>{
  const p=cardProducts.find(x=>x.id===productId);if(!p){problems.push(`${name}: unknown product ${productId}`);return null;}
  // Synthetic card: public product fields only, no account data.
  return {id:`golden-${alias}`,productId:p.id,name:p.name,bank:p.bank,region:p.region,currency:{US:'USD',CA:'CAD',HK:'HKD'}[p.region]};
 }).filter(Boolean)}]));
 const expand=(q,ref)=>{
  const [alias,suffix]=ref.split(':'),productId=portfolios[q.portfolio]?.aliases[alias],id=productId&&`rule.${productId}.${suffix}`;
  if(!productId)problems.push(`${q.id}: ${ref} is not a card in ${q.portfolio}`);else if(!active.has(id))problems.push(`${q.id}: ${ref} is not an active benefit rule on ${golden.asOf}`);
  return id;
 };
 const questions=golden.questions.map(q=>{
  if(!portfolios[q.portfolio])problems.push(`${q.id}: unknown portfolio ${q.portfolio}`);
  const expected=(q.expected||[]).map(r=>expand(q,r)),acceptable=(q.acceptable||[]).map(r=>expand(q,r)),forbidden=(q.forbidden||[]).map(r=>expand(q,r));
  const overlap=expected.filter(id=>acceptable.includes(id)||forbidden.includes(id)).concat(acceptable.filter(id=>forbidden.includes(id)));
  if(overlap.length)problems.push(`${q.id}: ${overlap.join(', ')} labelled twice`);
  if(q.type==='absent'?expected.length:!q.ambiguous&&!expected.length)problems.push(`${q.id}: absent questions need no expected rules; other scored questions need some`);
  if(!q.rationale)problems.push(`${q.id}: no rationale`);
  if(!['zh-Hans','zh-Hant','en'].includes(q.lang))problems.push(`${q.id}: unknown language ${q.lang}`);
  if(!q.rewrite?.length)problems.push(`${q.id}: no rewrite`);
  // The rewrite must be a call the model could actually make: same schema and enums as find_benefits.
  for(const call of q.rewrite||[])try{validateToolCall({id:q.id,function:{name:'find_benefits',arguments:JSON.stringify(call)}});}catch(e){problems.push(`${q.id}: rewrite ${JSON.stringify(call)} fails find_benefits validation (${e.message})`);}
  return {...q,expected,acceptable,forbidden};
 });
 const ids=new Set();for(const q of questions){if(ids.has(q.id))problems.push(`duplicate id ${q.id}`);ids.add(q.id);}
 if(problems.length)throw Object.assign(Error('invalid_golden'),{problems});

 // Each call returns its own top 12, as find_benefits would; several calls are merged by best rank.
 // cardName and region narrow the cards first, as find_benefits does in src/walletAgent.js.
 const normalized=s=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 // search defaults to production; the ranking lab passes its own rankers.
 function run(calls,cards,search=searchBenefitKnowledge){
  const rank=new Map();let total=0;
  for(const {query,cardName,region,...filters} of calls){
   const held=cards.filter(c=>(!cardName||normalized(c.name).includes(normalized(cardName)))&&(!region||c.region===region));
   const r=search(query,held,golden.asOf,filters);total+=r.total;
   r.rules.slice(0,K).forEach((rule,i)=>{if(!rank.has(rule.id)||rank.get(rule.id)>i+1)rank.set(rule.id,i+1);});
  }
  return {ranked:[...rank].sort((a,b)=>a[1]-b[1]||a[0].localeCompare(b[0])),total};
 }
 function score(q,{ranked,total}){
  const got=new Map(ranked),hits=q.expected.filter(id=>got.has(id)),first=Math.min(...hits.map(id=>got.get(id)));
  return {
   returned:ranked.length,total,zero:ranked.length===0,
   recall:q.expected.length?hits.length/Math.min(q.expected.length,K):null,
   rr:q.expected.length?(hits.length?1/first:0):null,
   missed:q.expected.filter(id=>!got.has(id)),
   forbiddenHits:q.forbidden.filter(id=>got.has(id)),
   // Share of returned rules that are expected; acceptable rules are left out of both sides.
   precision:(()=>{const judged=ranked.filter(([id])=>!q.acceptable.includes(id));return judged.length?judged.filter(([id])=>q.expected.includes(id)).length/judged.length:null;})(),
   // For absent questions: anything returned that is not labelled acceptable.
   spurious:ranked.map(([id])=>id).filter(id=>!q.expected.includes(id)&&!q.acceptable.includes(id)).length,
   top:ranked.slice(0,5).map(([id])=>id),
  };
 }
 return {golden,portfolios,questions,run,score};
}
