// Runs the frozen held-out cases offline, with the same checks as the development set in scripts/eval-agent.mjs.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {context,referenceContext} from './context.mjs';
import {retrievalCases,decisionCases,planCases,publicRuleCases,groundingCases} from './cases.mjs';
import {searchBenefitKnowledge} from '../../src/benefitSearch.js';
import {chooseCard} from '../../src/cardDecision.js';
import {answerGrounding} from '../../src/answerGrounding.js';
import {runWalletTool} from '../../src/walletAgent.js';
// Everything that decides a held-out result is frozen together: the cases, their wallet and these checks.
export const HOLDOUT_FILES=['cases.mjs','context.mjs','run.mjs'];
export const holdoutManifest=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url),'utf8'));
export const holdoutSha256=(dir=new URL('./',import.meta.url))=>{const h=createHash('sha256');for(const f of HOLDOUT_FILES)h.update(f+'\0').update(readFileSync(new URL(f,dir))).update('\0');return h.digest('hex');};
export const holdoutCaseIds=()=>[...retrievalCases,...decisionCases,...planCases,...publicRuleCases].map(c=>c.id).concat(groundingCases.map(c=>c[0]));
export function runHoldout(){
 const cases=[],check=(id,checks)=>cases.push({id,passed:Object.values(checks).every(Boolean),checks});
 // A case that throws is a failed case, never a skipped one.
 const safe=(id,fn)=>{try{check(id,fn());}catch{check(id,{completed:false});}};
 for(const c of retrievalCases)safe(c.id,()=>{
  const r=searchBenefitKnowledge(c.query,context.cards,context.day,c.filters),ids=r.rules.map(x=>x.id);
  return {expectedHit:c.empty?ids.length===0:ids.some(id=>c.expected.includes(id)),active:r.rules.every(x=>!['expired','not-started'].includes(x.assessment.temporal)),heldOnly:r.rules.every(x=>x.productIds.some(id=>context.cards.some(p=>p.productId===id)))};
 });
 for(const c of decisionCases)safe(c.id,()=>({expected:!!c.check(chooseCard(c.args,{...referenceContext,events:c.events||[]}))}));
 // Unlike the development set, a case without a use passes none, so the tool's own default is what is tested.
 for(const c of planCases)safe(c.id,()=>({expected:!!c.check(runWalletTool({id:c.id,function:{name:'query_credits',arguments:JSON.stringify({...(c.use?{use:c.use}:{}),...(c.when?{when:c.when}:{})})}},{...referenceContext,events:c.events||[]}))}));
 for(const c of publicRuleCases)safe(c.id,()=>{
  const result=runWalletTool({id:c.id,function:{name:'get_card_rules',arguments:JSON.stringify(c.args)}},context),rule=result.rules.find(r=>!c.role||r.terms.cardholderRole===c.role);
  return {found:!!rule,terms:!!rule&&Object.entries(c.terms).every(([k,v])=>rule.terms[k]===v),sourced:!!rule?.sources.some(s=>s.url),regional:result.rules.every(r=>r.cards.every(card=>card.region===c.args.region))};
 });
 for(const [id,answer,evidence,code] of groundingCases)safe(id,()=>({caught:answerGrounding(answer,evidence).issues.some(i=>i.code===code)}));
 const passed=cases.filter(c=>c.passed).length;
 return {dataset:holdoutManifest.dataset,datasetSha256:holdoutSha256(),mode:'offline',passed,total:cases.length,passRate:passed/cases.length,cases};
}
