// One live development case: run the question through the agent loop and score it with hard assertions on tool
// choice, arguments, dates and required wording. Shared by `eval:agent:live` and the scheduled run
// (scripts/live-eval.mjs). No LLM judge: every check is code.
import {performance} from 'node:perf_hooks';
import {context,referenceContext} from './fixtures.mjs';
import {resolveTripDates} from '../src/tripDates.js';
import {runAgentTurn} from '../tests/helpers/agent-target.mjs';

export const READ_ONLY_TOOLS=['list_cards','choose_card','find_benefits','get_card_rules','convert_points','query_credits','find_protections','plan_flight','points_accounts'];

/** `chat(payload)` returns the model's message. Returns {checks, detail}; a thrown turn is a failed case, not an exception. */
export async function runLiveCase(c,{chat,turn=runAgentTurn}){
 const start=performance.now(),calls=[];
 try{
  const request=async p=>{const m=await chat(p);for(const call of m.tool_calls||[])calls.push({name:call.function.name,args:JSON.parse(call.function.arguments)});return {message:m}};
  let history=[],memory=c.memory||{};
  const caseContext={...(['query_credits','choose_card'].includes(c.expectTool)?referenceContext:context),events:c.events||context.events};
  for(const question of c.setupQuestions||[]){const setup=await turn({history,memory,question,context:caseContext,request});history=setup.messages;memory=setup.memory;}
  calls.length=0;
  const r=await turn({history,memory,question:c.question,context:caseContext,request});
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
  if(c.answersFirst)checks.answersBeforeAsking=calls.some(x=>x.name==='choose_card');
  return {checks,detail:{ms:Math.round(performance.now()-start),toolNames:calls.map(x=>x.name),answerChars:r.answer.length,trace:r.trace,context:r.context}};
 }catch(error){return {checks:{completed:false},detail:{ms:Math.round(performance.now()-start),error:error.message==='answer_not_grounded'?'answer_not_grounded':'model_or_execution_failed',...(error.codes?{codes:error.codes}:{}),toolNames:calls.map(x=>x.name)}};}
}
