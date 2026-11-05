import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {context,referenceContext,retrievalCases,liveCases,publicRuleCases,planCases,planGroundingCases,decisionCases} from '../evals/fixtures.mjs';
import {resolveTripDates} from '../src/tripDates.js';
import {searchBenefitKnowledge} from '../src/benefitSearch.js';
import {queryKnowledge} from '../src/knowledge.js';
import {matchCardProduct} from '../src/productCatalog.js';
import {chooseCard} from '../src/cardDecision.js';
import {prepareAgentContext} from '../src/agentContext.js';
import {answerGrounding} from '../src/answerGrounding.js';
import {runAgentTurn} from '../src/agentSession.js';
import {runWalletTool} from '../src/walletAgent.js';
import {chatAgent} from './chat-agent.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),live=process.argv.includes('--live');
const outputArg=process.argv.find(a=>a.startsWith('--out=')),output=resolve(outputArg?.slice(6)||resolve(root,'evals/latest-'+(live?'live':'offline')+'.json'));
const report={schema:1,dataset:'wallet-agent-development-v1',asOf:context.day,mode:live?'live-deepseek-sdk':'offline',syntheticWallet:true,createdAt:new Date().toISOString(),cases:[],limitations:['Development set, not a held-out benchmark.','Automated checks do not prove all statements true.','Live model runs are stochastic and use only synthetic products.']};
const check=(id,checks,detail={})=>report.cases.push({id,passed:Object.values(checks).every(Boolean),checks,...detail});
function legacySearch(text){const products=new Set(context.cards.map(c=>matchCardProduct(c).product?.id).filter(Boolean)),scenario=/酒店|hotel|希尔顿|hilton/i.test(text)?'hotel-stay':/餐饮|dining|吃饭/i.test(text)?'dining':/机场|休息室|lounge/i.test(text)?'airport':null,keyword=/hilton|希尔顿/i.test(text)?'Hilton':/marriott|万豪/i.test(text)?'Marriott':/hyatt|凯悦/i.test(text)?'Hyatt':/ihg|洲际/i.test(text)?'IHG':null;return queryKnowledge({kind:'benefit',...(scenario?{scenarioId:scenario}:{}),...(keyword?{text:keyword}:{}),asOf:context.day}).rules.filter(r=>r.productIds.some(id=>products.has(id))).slice(0,12);}
if(!live){
 let hits=0,rr=0,baseline=0,n=0,shared=0,sharedHits=0;
 for(const c of retrievalCases){
  const start=performance.now(),r=searchBenefitKnowledge(c.query,context.cards,context.day,c.filters),ids=r.rules.map(x=>x.id),rank=ids.findIndex(id=>c.expected.includes(id));
  if(c.expected.length){n++;hits+=rank>=0;rr+=rank>=0?1/(rank+1):0;if(!c.filters){shared++;sharedHits+=rank>=0;if(legacySearch(c.query).some(x=>c.expected.includes(x.id)))baseline++;}}
  const checks={expectedHit:c.empty?ids.length===0:rank>=0,...(c.expectedAll?{allExpected:c.expected.every(id=>ids.includes(id))}:{}),active:r.rules.every(x=>!['expired','not-started'].includes(x.assessment.temporal)),heldOnly:r.rules.every(x=>x.productIds.some(id=>context.cards.some(p=>p.productId===id)))};
  if(c.partner)checks.partnerOnly=r.rules.every(x=>JSON.stringify(x).toLowerCase().includes(c.partner));
  check(c.id,checks,{rank:rank>=0?rank+1:null,matches:r.total,ms:Math.round(performance.now()-start)});
 }
 report.retrieval={cases:n,hitAt12:hits/n,meanReciprocalRank:rr/n,sharedQueries:{count:shared,beforeHitAt12:baseline/shared,afterHitAt12:sharedHits/shared},note:'Development-set expected-record hit@12, not exhaustive recall or held-out generalization.'};
 for(const c of decisionCases){
  const r=chooseCard(c.args,{...referenceContext,events:c.events||[]});
  check(c.id,{expected:c.check(r)},{choice:r.choice?.kind,certainty:r.choice?.certainty||null});
 }
 for(const c of publicRuleCases){
  const result=runWalletTool({id:c.id,function:{name:'get_card_rules',arguments:JSON.stringify(c.args)}},context);
  const rule=result.rules.find(r=>!c.role||r.terms.cardholderRole===c.role);
  check(c.id,{found:!!rule,terms:!!rule&&Object.entries(c.terms).every(([key,value])=>rule.terms[key]===value),sourced:!!rule?.sources.some(s=>s.url),regional:result.rules.every(r=>r.cards.every(card=>card.region===c.args.region))});
 }
 for(const c of planCases){
  const result=runWalletTool({id:c.id,function:{name:'query_credits',arguments:JSON.stringify({use:c.use||'hotel',...(c.when?{when:c.when}:{})})}},{...referenceContext,events:c.events||[]});
  check(c.id,{expected:c.check(result)});
 }
 const planEvidence=[runWalletTool({id:'grounding',function:{name:'query_credits',arguments:JSON.stringify({use:'hotel',when:'12月'})}},referenceContext)];
 for(const [id,answer,code] of planGroundingCases)check(id,{caught:answerGrounding(answer,planEvidence).issues.some(i=>i.code===code)});
 const old=Array.from({length:30},(_,i)=>[{role:'user',content:'question '+i},{role:'assistant',content:'reply '.repeat(1000)}]).flat();const prep=prepareAgentContext(old,{lastPurchase:{category:'dining',country:'US',currency:'USD',amount:100}});check('bounded-context',{bounded:prep.chars<=22000,keepsLatest:prep.messages.some(x=>x.content==='question 29'),memory:prep.memory.lastPurchase.amount===100});
 for(const [id,answer,evidence,code] of [
  ['unknown-transfer-ratio','Transfer at 1:1',[{rules:[{kind:'transfer-relationship',revision:1,terms:{ratio:null}}]}],'unsupported_transfer_ratio'],
  ['no-tool-invented-number','Your card returns 99 USD',[],'unsupported_number'],
  ['invented-citation','[terms](https://invented.example)',[],'unsupported_citation'],
  ['invented-number','Cashback is 99 USD',[{reward:3}],'unsupported_number'],
  ['fake-payment','我已付款',[],'unauthorized_action_claim'],
  ['fake-enrollment','你已登记成功',[],'unverified_enrollment'],
 ])check(id,{caught:answerGrounding(answer,evidence).issues.some(i=>i.code===code)});
}else{
 const envFile=process.env.CARDYBARA_MODEL_CONFIG;
 const env={};for(const line of (await readFile(envFile?resolve(envFile):resolve(root,'.env.local'),'utf8')).split('\n')){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m)env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
 report.model=env.DEEPSEEK_MODEL||'deepseek-flash';
 const only=process.argv.find(a=>a.startsWith('--case='))?.slice(7);
 const selected=only?liveCases.filter(c=>c.id===only):liveCases;if(!selected.length)throw Error('unknown_eval_case');
 for(const c of selected){
  const start=performance.now(),calls=[];
  try{
   const request=async p=>{const m=await chatAgent(env,p);for(const call of m.tool_calls||[])calls.push({name:call.function.name,args:JSON.parse(call.function.arguments)});return {message:m}};
   let history=[],memory=c.memory||{};
   const caseContext={...(['query_credits','choose_card'].includes(c.expectTool)?referenceContext:context),events:c.events||context.events};
   for(const question of c.setupQuestions||[]){const setup=await runAgentTurn({history,memory,question,context:caseContext,request});history=setup.messages;memory=setup.memory;}
   calls.length=0;
   const r=await runAgentTurn({history,memory,question:c.question,context:caseContext,request});
   const checks={completed:!!r.answer.trim(),modelAnswered:!r.trace.some(t=>t.type==='fallback'),readOnly:calls.every(x=>['list_cards','choose_card','find_benefits','get_card_rules','query_credits'].includes(x.name)),bounded:r.tools.length<=16};
   if(c.expectTool)checks.expectedTool=calls.some(x=>x.name===c.expectTool);
   // Either tool carries these terms, so either is a correct choice.
   if(c.expectTools)checks.expectedTool=calls.some(x=>c.expectTools.includes(x.name));
      if(c.expectedArgs)checks.expectedArguments=calls.some(x=>x.name===c.expectTool&&Object.entries(c.expectedArgs).every(([k,v])=>x.args[k]===v));
   if(c.expectedWindow)checks.expectedWindow=calls.some(x=>{const w=x.name==='query_credits'&&resolveTripDates(x.args.when,context.day);return w?.ok&&w.start===c.expectedWindow.start&&w.end===c.expectedWindow.end;});
   if(c.expectedTrip)checks.expectedTrip=r.memory.trip?.start===c.expectedTrip.start;
   if(c.answerPatterns)checks.coversNamedProgrammes=c.answerPatterns.every(pattern=>new RegExp(pattern,'i').test(r.answer));
   if(c.answersFirst)checks.answersBeforeAsking=calls.some(x=>x.name==='choose_card');
   check(c.id,checks,{ms:Math.round(performance.now()-start),toolNames:calls.map(x=>x.name),answerChars:r.answer.length,trace:r.trace,context:r.context});
  }catch(error){check(c.id,{completed:false},{ms:Math.round(performance.now()-start),error:error.message==='answer_not_grounded'?'answer_not_grounded':'model_or_execution_failed',...(error.codes?{codes:error.codes}:{}),toolNames:calls.map(x=>x.name)});}
  console.log(c.id+': '+(report.cases.at(-1).passed?'PASS':'FAIL'));
 }
}
report.summary={passed:report.cases.filter(c=>c.passed).length,total:report.cases.length};report.summary.passRate=report.summary.passed/report.summary.total;
await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({mode:report.mode,...report.summary,report:output,retrieval:report.retrieval}));if(report.summary.passed!==report.summary.total)process.exitCode=1;
