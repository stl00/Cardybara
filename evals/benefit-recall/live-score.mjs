// Scoring for the live benefit recall eval (scripts/eval-benefit-recall-live.mjs), kept apart so tests can run it
// without a model. Each tool's output is mapped back to rule ids and joins after the find_benefits results, capped at
// the same 12 a reader sees from each tool.
import {runWalletTool} from '../../src/walletAgent.js';
import {queryKnowledge} from '../../src/knowledge.js';
import {K} from './lib.mjs';

const call=(name,args,cards,day)=>{try{return runWalletTool({id:name,function:{name,arguments:JSON.stringify(args)}},{cards,events:[],day});}catch{return null;}};

// Credit items name a card and a title; together they identify the rule.
export function creditRuleIds(args,cards,day){
 const r=call('query_credits',args,cards,day);if(!r)return [];
 const items=Object.entries(r.groups||{}).filter(([g])=>g!=='dismissedByUser').flatMap(([,list])=>list);
 const rules=queryKnowledge({kind:'benefit',asOf:day}).rules;
 return [...new Set(items.flatMap(i=>{const card=cards.find(c=>c.name===i.card);return rules.filter(x=>card&&x.productIds.includes(card.productId)&&x.content.title===i.title).map(x=>x.id);}))];
}
// Protection rules carry their revision, which names exactly one rule; only the first 12 count, in the tool's order.
export function protectionRuleIds(args,cards,day){
 const r=call('find_protections',args,cards,day);if(!r?.rules)return [];
 const byRevision=new Map(queryKnowledge({kind:'benefit',category:'protection',asOf:day}).rules.map(x=>[x.revisionId,x.id]));
 return [...new Set(r.rules.slice(0,K).map(x=>byRevision.get(x.revision)).filter(Boolean))];
}
// Another tool counts only when its output has something to answer with: transfer relationships, or a card choice.
export function altRouteAnswered(q,toolCalls,cards,day){
 return (q.alsoAnsweredBy||[]).some(a=>toolCalls.some(t=>{
  if(t.name!==a.tool||!t.args||(a.kind&&t.args.kind!==a.kind))return false;
  const r=call(t.name,t.args,cards,day);if(!r)return false;
  return t.name==='get_card_rules'?r.rules?.length>0:t.name==='choose_card'?!!r.choice&&r.choice.kind!=='points-depends':false;
 }));
}
const append=(found,ids)=>{const seen=new Set(found.ranked.map(([id])=>id)),extra=ids.filter(id=>!seen.has(id)).slice(0,K);return {ranked:[...found.ranked,...extra.map((id,i)=>[id,found.ranked.length+1+i])],total:found.total+ids.length};};
// find: find_benefits alone. both: plus query_credits items (the step 4 score, kept for comparison with older runs).
// tools: plus find_protections rules, since a protection question answered from find_protections is right for the user.
export function scoreCase(q,toolCalls,{cards,run,score,day}){
 const args=name=>toolCalls.filter(t=>t.name===name&&t.args).map(t=>t.args);
 const calls=args('find_benefits'),found=calls.length?run(calls,cards):{ranked:[],total:0};
 const withCredits=append(found,args('query_credits').flatMap(a=>creditRuleIds(a,cards,day)));
 const withTools=append(withCredits,args('find_protections').flatMap(a=>protectionRuleIds(a,cards,day)));
 return {find:score(q,found),both:score(q,withCredits),tools:score(q,withTools),calls};
}
