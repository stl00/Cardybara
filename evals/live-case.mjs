// One live development case: run the question through the agent loop and score it with hard assertions on tool
// choice, arguments, dates and required wording. Shared by `eval:agent:live` and the scheduled run
// (scripts/live-eval.mjs). No LLM judge: every check is code.
import {performance} from 'node:perf_hooks';
import {context,referenceContext} from './fixtures.mjs';
import {resolveTripDates} from '../src/tripDates.js';
import {runAgentTurn} from '../tests/helpers/agent-target.mjs';

export const READ_ONLY_TOOLS=['list_cards','choose_card','find_benefits','get_card_rules','convert_points','query_credits','find_protections','plan_flight','points_accounts'];

/** The wallet a case sends: the shared synthetic one, plus the case's scripted marks (`events`) and card fee dates
 * (`feeDates`, product id to {month,day}), `day` moves the wallet's date (rules checked after the shared day are not in force before it), and `heldProductIds` narrows the wallet to those products, the same way the offline ledger and cycle cases set them up. */
export function caseWallet(c){
 const base=['query_credits','choose_card'].includes(c.expectTool)?referenceContext:context;
 const held=c.heldProductIds?base.cards.filter(card=>c.heldProductIds.includes(card.productId)):base.cards;
 const cards=c.feeDates?held.map(card=>c.feeDates[card.productId]?{...card,feeDate:c.feeDates[card.productId]}:card):held;
 return {...base,cards,events:c.events||context.events,...(c.day?{day:c.day}:{})};
}

/** What a failing try needs for diagnosis (#260): the answer checker's codes per stage, and every model reply of the turn,
 * because a fallback replaces the model's own text with code-written text and the shown answer alone hides why. */
function diagnosis(trace,texts){
 const graded=(trace||[]).filter(t=>['grounding','repair','fallback'].includes(t.type)).map(t=>({type:t.type,...(t.passed!==undefined?{passed:t.passed}:{}),codes:t.codes||[]}));
 return {...(graded.length?{graded}:{}),...(texts.length?{modelTexts:texts.slice(-4)}:{})};
}

/** `detail.transcript` (answer text and tool calls) is for the separate transcripts artifact only; the report never copies it.
 * `chat(payload)` returns the model's message. Returns {checks, detail}; a thrown turn is a failed case, not an exception. */
export async function runLiveCase(c,{chat,turn=runAgentTurn}){
 const start=performance.now(),calls=[],texts=[];let lastText='';
 try{
  const request=async p=>{const m=await chat(p);if(typeof m?.content==='string'&&m.content){lastText=m.content;texts.push(m.content);}for(const call of m.tool_calls||[])calls.push({name:call.function.name,args:JSON.parse(call.function.arguments)});return {message:m}};
  let history=[],memory=c.memory||{};
  const caseContext=caseWallet(c);
  for(const question of c.setupQuestions||[]){const setup=await turn({history,memory,question,context:caseContext,request});history=setup.messages;memory=setup.memory;}
  calls.length=0;
  const r=await turn({history,memory,question:c.question,context:caseContext,request});
  // A hosted turn runs the agent in the Worker, so it hands back the calls it could see instead of model payloads.
  if(Array.isArray(r.calls))calls.push(...r.calls);
  const checks={completed:!!r.answer.trim(),modelAnswered:!r.trace.some(t=>t.type==='fallback'),readOnly:calls.every(x=>READ_ONLY_TOOLS.includes(x.name)),bounded:r.tools.length<=16};
  if(c.expectTool)checks.expectedTool=calls.some(x=>x.name===c.expectTool);
  // Either tool carries these terms, so either is a correct choice.
  if(c.expectTools)checks.expectedTool=calls.some(x=>c.expectTools.includes(x.name));
  if(c.expectedArgs)checks.expectedArguments=calls.some(x=>x.name===c.expectTool&&Object.entries(c.expectedArgs).every(([k,v])=>x.args[k]===v));
  if(c.expectedWindow)checks.expectedWindow=calls.some(x=>{const w=x.name==='query_credits'&&resolveTripDates(x.args.when,context.day);return w?.ok&&w.start===c.expectedWindow.start&&w.end===c.expectedWindow.end;});
  if(c.expectAllTools)checks.expectedAllTools=c.expectAllTools.every(name=>calls.some(x=>x.name===name));
  if(c.sameDateWords){const words=calls.filter(x=>['plan_flight','query_credits'].includes(x.name)).map(x=>x.args.when);checks.sameDateWords=words.length>=2&&words.every(w=>w===words[0]);}
  if(c.expectedTrip)checks.expectedTrip=r.memory.trip?.start===c.expectedTrip.start;
  if(c.answerPatterns)checks.coversNamedProgrammes=c.answerPatterns.every(pattern=>new RegExp(pattern,'i').test(r.answer));
  // Wording that would misstate the tool's totals, such as adding the not-captured amount to the used one.
  // A case can set stripDenials when the forbidden wording is a claim: a clause that denies it ("不代表它一定没有保障", "does not mean it is not covered") is the answer we want, so it is removed before matching. An outright claim still fails.
  const claimed=c.stripDenials?r.answer.replace(/(?:并?不(?:代表|意味着|等于|能说)|不是说|not necessarily|does not mean|doesn't mean|doesn’t mean)[^。\n.；;，,]*/gi,''):r.answer;
  if(c.forbidAnswerPatterns)checks.avoidsWrongTotals=!c.forbidAnswerPatterns.some(pattern=>new RegExp(pattern,'i').test(claimed));
  if(c.answersFirst)checks.answersBeforeAsking=calls.some(x=>x.name==='choose_card');
  return {checks,detail:{ms:Math.round(performance.now()-start),toolNames:calls.map(x=>x.name),answerChars:r.answer.length,trace:r.trace,context:r.context,transcript:{answer:r.answer,toolCalls:calls.map(x=>({name:x.name,args:x.args})),...diagnosis(r.trace,texts)}}};
 }catch(error){return {checks:{completed:false},detail:{ms:Math.round(performance.now()-start),error:error.message==='answer_not_grounded'?'answer_not_grounded':'model_or_execution_failed',...(error.codes?{codes:error.codes}:{}),toolNames:calls.map(x=>x.name),transcript:{answer:lastText,toolCalls:calls.map(x=>({name:x.name,args:x.args})),...diagnosis([],texts)}}};}
}
