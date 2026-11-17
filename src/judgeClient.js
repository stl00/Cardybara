// The answer judge's model call for the extension (#295). The credential is read by extension-next/model-client.js from
// the extension's local storage and goes only to its own host; nothing here sees, stores or sends it anywhere else.
import {completeBody} from '../extension-next/model-client.js';
export const JUDGE_MAX_CALLS=2,JUDGE_TIMEOUT_MS=8000,JUDGE_MAX_TOKENS=40;
// One judge for one assistant turn: at most JUDGE_MAX_CALLS model calls, each short and time-limited. Failures reject, and the caller keeps the rules.
export function turnJudge(question,{complete=completeBody}={}){
 return {question,maxCalls:JUDGE_MAX_CALLS,used:0,complete:async(messages)=>{
  const body=await complete({messages,max_tokens:JUDGE_MAX_TOKENS,temperature:0,thinking:{type:'disabled'}},{signal:AbortSignal.timeout(JUDGE_TIMEOUT_MS),timeout:JUDGE_TIMEOUT_MS});
  return body?.choices?.[0]?.message?.content||'';
 }};
}
