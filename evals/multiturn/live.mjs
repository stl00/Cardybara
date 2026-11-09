// Scoring and spend control for the live multi-turn eval. No network and no configuration here.
import {knowledgeEntities} from '../../src/knowledge.js';
import {selectCards} from './harness.mjs';

/** Round-robin by kind, so the first n dialogues cover every kind. */
export const interleaved=list=>{const byKind=[...new Set(list.map(d=>d.kind))].map(k=>list.filter(d=>d.kind===k)),out=[];for(let i=0;out.length<list.length;i++)for(const group of byKind)if(group[i])out.push(group[i]);return out;};

const programmeNames=knowledgeEntities.programmes.map(p=>p.name);
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** What a programme argument reaches: get_card_rules keeps a programme whose name contains it. */
export const programmesReached=text=>programmeNames.filter(n=>n.toLowerCase().includes(String(text).toLowerCase().trim()));
/** The one programme an expected value names, as a whole word ("ANA" is ANA Mileage Club, not Air Canada). */
export function targetProgramme(value){
 const found=programmeNames.filter(n=>new RegExp(`(?<![\\p{L}\\p{N}])${escape(value.trim())}(?![\\p{L}\\p{N}])`,'iu').test(n));
 if(found.length!==1)throw Error('ambiguous_expected_programme: '+value);
 return found[0];
}

/** An argument matches if it is the expected value; a card name if it selects the same held cards; a programme if it reaches the expected one. */
export function argumentsMatch(expect,call){
 if(call.name!==expect.tool)return false;
 return Object.entries(expect.args).every(([k,v])=>{
  if(k==='query')return typeof call.args.query==='string'&&call.args.query.trim().length>0;
  if(k==='cardName'||k==='region'){const want=selectCards(expect.args).map(c=>c.id).sort().join(),got=selectCards(call.args).map(c=>c.id).sort().join();return want===got;}
  if(k==='programme')return typeof call.args.programme==='string'&&call.args.programme.trim().length>0&&programmesReached(call.args.programme).includes(targetProgramme(v));
  return call.args[k]===v;
 });
}
/** The reference itself: some call names the referred card and nothing else. null when the referent is not a card. */
export const resolvesCard=(d,calls)=>d.target.card?calls.some(c=>{if(!c.args?.cardName)return false;const got=selectCards(c.args);return got.length===1&&got[0].productId===d.target.card;}):null;
export const scoreLive=(d,calls,completed)=>({completed,expectedTool:calls.some(c=>c.name===d.expect.tool),expectedArguments:calls.some(c=>argumentsMatch(d.expect,c)),referentResolved:resolvesCard(d,calls)});
export const passedLive=checks=>checks.completed&&checks.expectedTool&&checks.expectedArguments;

// List prices per million tokens at the higher (peak) rate. https://api-docs.deepseek.com/quick_start/pricing, read 2026-11-09.
export const PRICES={'deepseek-flash':{hit:0.006,miss:0.3,output:1.2},'deepseek-v4-pro':{hit:0.044,miss:1.32,output:3.96}};
const ALIASES={'deepseek-v4-flash':'deepseek-flash','deepseek-v4-flash-vision-exp':'deepseek-flash'};
export function priceFor(model){const p=PRICES[ALIASES[model]||model];if(!p)throw Error('no price for model '+model);return p;}

/**
 * Spend for one run. Each call is charged its metered cost; a call that returns no usage (or fails after it may have
 * been billed) is charged a worst case. A dialogue may start only if a worst-case dialogue still fits the budget:
 * every call of the agent loop (5 rounds and 1 repair), all prompt tokens uncached, the full output allowance.
 */
export function meter({price,budget,callsPerDialogue=6,maxOutputTokens=1800,initialPromptTokens=30000}){
 const u={calls:0,unmetered:0,promptTokens:0,cacheHitTokens:0,cacheMissTokens:0,completionTokens:0,worstCaseUsd:0},m={usage:u};
 let biggestPrompt=initialPromptTokens,seen=false;
 const callWorstCase=()=>(biggestPrompt*1.5*price.miss+maxOutputTokens*price.output)/1e6;
 m.spent=()=>(u.cacheHitTokens*price.hit+u.cacheMissTokens*price.miss+u.completionTokens*price.output)/1e6+u.worstCaseUsd;
 m.dialogueWorstCase=()=>callsPerDialogue*callWorstCase();
 m.canStartDialogue=()=>m.spent()+m.dialogueWorstCase()<=budget;
 m.record=x=>{u.calls++;const prompt=x.prompt_tokens||0,hit=x.prompt_cache_hit_tokens??0;u.promptTokens+=prompt;u.completionTokens+=x.completion_tokens||0;u.cacheHitTokens+=hit;u.cacheMissTokens+=x.prompt_cache_miss_tokens??Math.max(0,prompt-hit);biggestPrompt=seen?Math.max(biggestPrompt,prompt):prompt;seen=true;};
 m.unmetered=()=>{u.calls++;u.unmetered++;u.worstCaseUsd+=callWorstCase();};
 return m;
}
