// The shipped find_benefits path (#575): the model writes the find_benefits call, runWalletToolAsync runs it with the
// gated answer judge, and what comes back after the judge is what a user would be shown. Both model calls are injected
// (chat for the assistant turn, judgeComplete for the judge), so tests run it with stubs and no network or key.
import {runWalletToolAsync} from '../../src/walletAgent.js';
import {queryKnowledge} from '../../src/knowledge.js';
import {K} from './lib.mjs';

export const ROUNDS=3,JUDGE_MAX_CALLS=2;
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;

// One question. chat(messages) resolves to an assistant message {content,tool_calls}. Other read-only tools run locally;
// the first round with find_benefits ends the question. Returns the rule ids a user would see after the judge.
export async function askShipped(q,{cards,day,chat,judgeComplete,idOf}){
 const messages=[{role:'user',content:q.question}],toolCalls=[],judge={question:q.question,maxCalls:JUDGE_MAX_CALLS,used:0,asked:0,complete:async m=>{judge.asked++;return judgeComplete(m);}};
 const rank=new Map();let total=0,searched=false,emptiedByJudge=false,modelError=null;
 for(let round=0;round<ROUNDS;round++){
  let message;
  try{message=await chat(messages);}catch(e){return {error:e.message||'error',toolCalls,searched,rank,total,judgeAsked:judge.asked,emptiedByJudge};}
  if(!message?.tool_calls?.length)break;
  messages.push(message);
  for(const call of message.tool_calls){
   let args={};try{args=JSON.parse(call.function.arguments||'{}');}catch{}
   toolCalls.push({name:call.function.name,args});
   let content;
   try{
    const result=await runWalletToolAsync(call,{cards,events:[],day,judge});
    content=JSON.stringify(result);
    if(call.function.name==='find_benefits'){
     searched=true;total+=result.totalMatches??result.rules?.length??0;
     if(result.unknownSubject&&!result.rules?.length&&judge.asked>0)emptiedByJudge=true;
     (result.rules||[]).slice(0,K).forEach((r,i)=>{const id=idOf.get(r.revision);if(id&&(!rank.has(id)||rank.get(id)>i+1))rank.set(id,i+1);});
    }
   }catch(e){modelError=e.message||'tool_error';content=JSON.stringify({error:'invalid_tool_call'});}
   messages.push({role:'tool',tool_call_id:call.id,content});
  }
  if(toolCalls.some(t=>t.name==='find_benefits'))break;
 }
 return {toolCalls,searched,rank,total,judgeAsked:judge.asked,emptiedByJudge,modelError};
}

export const revisionIds=day=>new Map(queryKnowledge({kind:'benefit',asOf:day}).rules.map(r=>[r.revisionId,r.id]));

// A whole set. A question the model never searched for returns nothing: noise-free if absent, a recall miss if scored.
export async function runShippedSet(set,{chat,judgeComplete,limit=Infinity,shouldStop=()=>false}){
 const {golden,portfolios,questions,score}=set,idOf=revisionIds(golden.asOf),rows=[];
 let stopped=false;
 for(const q of questions.slice(0,limit)){
  if(shouldStop()){stopped=true;break;}
  const cards=portfolios[q.portfolio].cards;
  const r=await askShipped(q,{cards,day:golden.asOf,chat:m=>chat(m,q),judgeComplete:m=>judgeComplete(m,q),idOf});
  if(r.error){rows.push({id:q.id,lang:q.lang,absent:q.type==='absent',scored:false,error:r.error});continue;}
  const ranked=[...r.rank].sort((a,b)=>a[1]-b[1]||a[0].localeCompare(b[0])),s=score(q,{ranked,total:r.total});
  rows.push({id:q.id,lang:q.lang,absent:q.type==='absent',scored:q.type!=='absent'&&!q.ambiguous,searched:r.searched,judgeAsked:r.judgeAsked>0,judgeCalls:r.judgeAsked,emptiedByJudge:r.emptiedByJudge,
   noisy:q.type==='absent'?s.spurious>0:null,recall:s.recall,returned:s.returned,tools:r.toolCalls.map(t=>t.name),calls:r.toolCalls.filter(t=>t.name==='find_benefits').map(t=>t.args),...(r.modelError?{modelError:r.modelError}:{})});
 }
 const done=rows.filter(x=>!x.error),scored=done.filter(x=>x.scored),absent=done.filter(x=>x.absent),searched=done.filter(x=>x.searched);
 return {dataset:golden.dataset,asOf:golden.asOf,questions:rows.length,answered:done.length,failedRequests:rows.length-done.length,stopped,
  scored:scored.length,absent:absent.length,
  recallAt12:mean(scored.map(x=>x.recall)),noise:mean(absent.map(x=>x.noisy?1:0)),
  noiseByLang:Object.fromEntries([...new Set(absent.map(x=>x.lang))].sort().map(l=>[l,mean(absent.filter(x=>x.lang===l).map(x=>x.noisy?1:0))])),
  // Share of questions with at least one judge call, and of find_benefits-searching questions; calls per question.
  judgeShare:mean(done.map(x=>x.judgeAsked?1:0)),judgeShareOfSearched:mean(searched.map(x=>x.judgeAsked?1:0)),judgeCalls:done.reduce((a,x)=>a+(x.judgeCalls||0),0),
  searchedShare:mean(done.map(x=>x.searched?1:0)),
  stillNoisy:absent.filter(x=>x.noisy).map(x=>x.id),lostRecall:scored.filter(x=>x.recall<1).map(x=>x.id),rows};
}

// #575 pass conditions, fixed before any live run: frozen no-answer noise at most 20%, held-out recall@12 at least
// 91.9 minus 1. A set that was not run, stopped early or lost questions to failed requests is `incomplete`, never a pass.
// `failing` names the questions a follow-up issue should list.
export const TARGETS={frozenNoiseMax:0.2,holdoutRecallMin:0.909};
export function checkTargets(sets){
 const complete=s=>!!s&&!s.stopped&&s.failedRequests===0&&s.answered>0;
 const frozen=sets?.noanswer,holdout=sets?.holdout;
 const noise=complete(frozen)?(frozen.noise<=TARGETS.frozenNoiseMax?'pass':'fail'):'incomplete';
 const recall=complete(holdout)?(holdout.recallAt12>=TARGETS.holdoutRecallMin?'pass':'fail'):'incomplete';
 const verdict=noise==='fail'||recall==='fail'?'fail':noise==='pass'&&recall==='pass'?'pass':'incomplete';
 return {verdict,frozenNoise:{status:noise,value:frozen?.noise??null,max:TARGETS.frozenNoiseMax},holdoutRecallAt12:{status:recall,value:holdout?.recallAt12??null,min:TARGETS.holdoutRecallMin},
  failing:{frozenStillNoisy:noise==='fail'?frozen.stillNoisy:[],holdoutLostRecall:recall==='fail'?holdout.lostRecall:[]}};
}
