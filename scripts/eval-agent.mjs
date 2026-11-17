import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {context,referenceContext,retrievalCases,liveCases,publicRuleCases,planCases,cycleCases,ledgerCases,planGroundingCases,decisionCases,actionClaimCases,actionClaimControls,tripCases} from '../evals/fixtures.mjs';
import {searchBenefitKnowledge} from '../src/benefitSearch.js';
import {queryKnowledge} from '../src/knowledge.js';
import {matchCardProduct} from '../src/productCatalog.js';
import {chooseCard} from '../src/cardDecision.js';
import {prepareAgentContext} from '../src/agentContext.js';
import {renderCreditAnswer,renderCreditAnswers} from '../src/creditAnswer.js';
import {answerGrounding} from '../src/answerGrounding.js';
// CARDYBARA_AGENT=cloud runs every case through the hosted agent (tests/helpers/agent-target.mjs).
import {AGENT_TARGET} from '../tests/helpers/agent-target.mjs';
import {runWalletTool} from '../src/walletAgent.js';
import {chatAgent} from './chat-agent.mjs';
import {runLiveCase} from '../evals/live-case.mjs';
import {coverageCases,runCoverageCase,FAULTS} from '../evals/coverage-case.mjs';
import {redemptionCases,runRedemptionCase,ungatedTurn,REDEMPTION_FAULTS} from '../evals/redemption-case.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),live=process.argv.includes('--live');
const outputArg=process.argv.find(a=>a.startsWith('--out=')),output=resolve(outputArg?.slice(6)||resolve(root,'evals/latest-'+(live?'live':'offline')+(AGENT_TARGET==='cloud'?'-cloud':'')+'.json'));
const report={schema:1,dataset:'wallet-agent-development-v1',asOf:context.day,mode:(live?'live-deepseek-sdk':'offline')+(AGENT_TARGET==='cloud'?'-cloud-agent':''),syntheticWallet:true,createdAt:new Date().toISOString(),cases:[],limitations:['Development set, not a held-out benchmark.','Automated checks do not prove all statements true.','Live model runs are stochastic and use only synthetic products.']};
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
  // A case about the comparison mechanics pins marketDefaults:false, so it does not depend on the default valuation table.
  const r=chooseCard(c.args,{...referenceContext,events:c.events||[],...(c.marketDefaults===false?{marketDefaults:false}:{})});
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
 for(const c of cycleCases){
  const cards=referenceContext.cards.map(card=>c.feeDates?.[card.productId]?{...card,feeDate:c.feeDates[card.productId]}:card);
  const result=runWalletTool({id:c.id,function:{name:'query_credits',arguments:JSON.stringify(c.args)}},{...referenceContext,cards,events:c.events||[]});
  check(c.id,{expected:c.check(result),answerInLanguage:c.answer.test(renderCreditAnswer(result,c.question))});
 }
 for(const c of ledgerCases){
  const cards=referenceContext.cards.map(card=>c.feeDates?.[card.productId]?{...card,feeDate:c.feeDates[card.productId]}:card);
  const result=runWalletTool({id:c.id,function:{name:'query_credits',arguments:JSON.stringify(c.args)}},{...referenceContext,cards,events:c.events||[]});
  check(c.id,{expected:c.check(result),answerInLanguage:c.answer.test(renderCreditAnswers([result],c.question)),totalsAddUp:result.cards.every(x=>!x.returned||Math.round((x.returned.used+x.returned.unused+x.returned.skipped+x.returned.notCaptured+x.returned.open)*100)===Math.round(x.returned.available*100))});
 }
 for(const c of tripCases){
  const run=(name,args)=>runWalletTool({id:c.id,function:{name,arguments:JSON.stringify(args)}},referenceContext);
  const flight=run('plan_flight',{airline:c.airline,when:c.when}),hotel=run('query_credits',{use:'hotel',when:c.when}),cover=run('find_protections',{});
  const same=flight.dates.start===hotel.window.start&&flight.dates.end===hotel.window.end;
  check(c.id,{sameWindow:same,expectedWindow:hotel.window.start===c.expectedWindow.start&&hotel.window.end===c.expectedWindow.end,awardNotChecked:flight.award.status==='not-checked',hotelCredits:hotel.totalItems>0,coverFound:cover.cards.some(x=>x.status==='found'),noRecordIsNotFound:cover.cards.every(x=>['found','not_found'].includes(x.status))});
 }
 // #345: coverage questions end to end through the real agent loop with a scripted model. `--fault=<name>` breaks one rule on
 // purpose (not-covered, invented-limit, valuation, no-tool) to show the matching case fail; without it the controls below must all be caught.
 const fault=process.argv.find(a=>a.startsWith('--fault='))?.slice(8)||null;
 if(fault&&!FAULTS.includes(fault)&&!REDEMPTION_FAULTS.includes(fault))throw Error('unknown_fault');
 const coverageFault=FAULTS.includes(fault)?fault:null,redemptionFault=REDEMPTION_FAULTS.includes(fault)?fault:null;
 for(const c of coverageCases){const r=await runCoverageCase(c,{fault:coverageFault});check(c.id,r.checks,r.detail);}
 if(!fault)for(const f of FAULTS){const results=[];for(const c of coverageCases)results.push(await runCoverageCase(c,{fault:f}));
  // A fault only applies where it has something to break: "not-covered" needs a card with no record.
  const applicable=f==='not-covered'?results.filter((r,i)=>coverageCases[i].noRecord):results;
  check('coverage-control-'+f,{caught:applicable.length>0&&applicable.every(r=>Object.values(r.checks).some(v=>!v))});}
 // #464: issuer-redemption answers (points_accounts). `--fault=<name>` (wrong-dollars, invented-cpp, varies-number, needs-card-value, no-tool)
 // breaks one rule so the matching case fails. The controls take the shipped answer checker out of the way, so they test the eval's own checks.
 for(const c of redemptionCases){const r=await runRedemptionCase(c,{fault:redemptionFault});check(c.id,r.checks,r.detail);}
 if(!fault)for(const f of REDEMPTION_FAULTS){const results=[];for(const c of redemptionCases)results.push(await runRedemptionCase(c,{fault:f,turn:ungatedTurn}));
  const applicable=f==='no-tool'?results:results.filter((r,i)=>redemptionCases[i].fault===f);
  check('redemption-control-'+f,{caught:applicable.length>0&&applicable.every(r=>Object.values(r.checks).some(v=>!v))});}
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
 for(const [id,answer,code] of actionClaimCases)check(id,{caught:answerGrounding(answer,[]).issues.some(i=>i.code===code)});
 // A false positive here would block a correct how-to answer, so the controls must stay clean.
 for(const [id,answer] of actionClaimControls)check(id,{notFlagged:!answerGrounding(answer,[]).issues.some(i=>['unauthorized_action_claim','unverified_enrollment'].includes(i.code))});
}else{
 const envFile=process.env.CARDYBARA_MODEL_CONFIG;
 const env={};for(const line of (await readFile(envFile?resolve(envFile):resolve(root,'.env.local'),'utf8')).split('\n')){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m)env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
 report.model=env.DEEPSEEK_MODEL||'deepseek-flash';
 const only=process.argv.find(a=>a.startsWith('--case='))?.slice(7);
 const selected=only?liveCases.filter(c=>c.id===only):liveCases;if(!selected.length)throw Error('unknown_eval_case');
 for(const c of selected){
  const r=await runLiveCase(c,{chat:p=>chatAgent(env,p)});check(c.id,r.checks,r.detail);
  console.log(c.id+': '+(report.cases.at(-1).passed?'PASS':'FAIL'));
 }
}
report.summary={passed:report.cases.filter(c=>c.passed).length,total:report.cases.length};report.summary.passRate=report.summary.passed/report.summary.total;
await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({mode:report.mode,...report.summary,report:output,retrieval:report.retrieval}));if(report.summary.passed!==report.summary.total)process.exitCode=1;
