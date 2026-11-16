// Offline end-to-end coverage-question cases (#345): a scripted model drives the real agent loop (the same
// runAgentTurn as the live run, so the answer checker and tool execution are the shipped code) and every check is code.
// The scripted model is a reference responder that writes its answer only from the find_protections result; a `fault`
// makes it break one rule on purpose, so each check can be shown to fail. Synthetic public products only, no network.
import {cards} from './fixtures.mjs';
import {runAgentTurn} from '../tests/helpers/agent-target.mjs';

export const COVERAGE_DAY='2026-11-16';
const GOLD='amex-us-us-american-express-gold-card',BLUE='amex-us-us-blue-cash-everyday',STRATA='citi-us-citi-strata-premier-card';
export const FAULTS=['not-covered','invented-limit','valuation','no-tool'];

// Wording the answer may and may not use about a card with no record (en, zh).
const NO_RECORD=/no\b[^.\n]{0,40}\brecord|not found in (?:our|the) records|没有[^。\n]{0,12}记录|未找到|没有找到/i;
const GUIDE=/guide to benefits|issuer|保障指南|发卡行|發卡行/i;
const NOT_COVERED=/\bnot covered\b|\bisn'?t covered\b|\bno coverage\b|\buncovered\b|没有[^。\n]{0,6}保障|不[^。\n]{0,2}保障|不在[^。\n]{0,4}保障|未[^。\n]{0,2}覆盖|不承保|无保障/i;
const VALUATION=/\b(?:worth|valued?\s+at|value\s+of)\b[^.\n]{0,20}\d|\b(?:score|scored|ranked)\b|评分|打分|估值|价值[^。\n]{0,6}\d|值\s*\$?\d/i;
const BASIS={primary:/primary|主要/i,secondary:/secondary|次要/i};

export const coverageCases=[
 {id:'coverage-rental-recorded',products:[GOLD],question:'Does my Amex Gold cover a rental car? Is that primary or secondary?',args:{type:'rental-car'},expectNames:['American Express Gold Card'],basis:{'American Express Gold Card':'secondary'}},
 {id:'coverage-trip-delay-no-record',products:[BLUE],question:'If my flight is delayed, does my Blue Cash Everyday pay for the hotel?',args:{type:'trip-delay'},expectNames:['Blue Cash Everyday'],noRecord:['Blue Cash Everyday']},
 {id:'coverage-flight-two-cards',products:[GOLD,STRATA],question:'Which of my two cards should I book the flight with for trip protection?',args:{},expectNames:['American Express Gold Card','Citi Strata Premier Card'],listAll:true},
 {id:'coverage-rental-recorded-zh',products:[GOLD],language:'zh-CN',question:'我的 Amex Gold 租车有保障吗？是主要还是次要保障？',args:{type:'rental-car'},expectNames:['American Express Gold Card'],basis:{'American Express Gold Card':'secondary'}},
];

const heldCards=c=>c.products.map(id=>cards.find(x=>x.productId===id));
const basisWord=(basis,zh)=>zh?{primary:'主要保障（按记录）',secondary:'次要保障（按记录）'}[basis]||'记录中没有写明主要或次要':{primary:'primary coverage as recorded',secondary:'secondary coverage as recorded'}[basis]||'primary or secondary is not stated in our records';

/** The reference answer, written only from the tool result; `fault` breaks one rule. */
function answerFrom(c,result,fault){
 const zh=/^zh/.test(c.language||''),lines=[];
 for(const card of result.cards){
  const own=result.rules.filter(r=>r.cards.some(x=>x.name===card.name));
  if(card.status==='found')for(const r of own){
   const source=r.sources?.[0]?.url?(zh?' 来源：':' Source: ')+r.sources[0].url:'';
   lines.push(zh?`${card.name}：${r.coverageType}，${basisWord(r.basis,true)}。${source}`:`${card.name}: ${r.title} (${basisWord(r.basis)}). ${r.summary}${source}`);
  }else lines.push(fault==='not-covered'?(zh?`${card.name}：没有保障。`:`${card.name} is not covered for this.`):(zh?`${card.name}：我们的记录里没有找到这项保障记录，卡片的保障指南可能仍有列出，请以发卡行的保障指南为准。`:`${card.name}: no protection record is found in our records for this. The card may still list it, so check the issuer's guide to benefits.`));
 }
 if(fault==='invented-limit')lines.push(zh?'上限为 5000000 美元。':'The limit is $5,000,000.');
 if(fault==='valuation')lines.push(zh?'这项保险价值 200 美元。':'This insurance is worth about $200.');
 return lines.join('\n');
}

/** A chat(payload) function: the first request asks for find_protections, the next answers from its result. */
export function scriptedCoverageModel(c,fault=null){
 const seen={results:[]};
 const chat=async payload=>{
  const tools=(payload.messages||[]).filter(m=>m.role==='tool');
  if(!tools.length&&fault!=='no-tool')return {role:'assistant',content:'',tool_calls:[{id:'cov1',type:'function',function:{name:'find_protections',arguments:JSON.stringify(c.args)}}]};
  seen.results=tools.map(m=>JSON.parse(m.content));
  const result=seen.results.find(r=>r.kind==='protections');
  return {role:'assistant',content:result?answerFrom(c,result,fault):(/^zh/.test(c.language||'')?'这项保障有保障。':'Yes, your card covers this.')};
 };
 return {chat,seen};
}

const numbers=text=>(String(text).replace(/https?:\/\/\S+/g,'').match(/\d+(?:,\d{3})*(?:\.\d+)?/g)||[]).map(n=>Number(n.replaceAll(',','')));
const segments=(answer,name)=>answer.split(/\n/).filter(s=>s.includes(name));

/** Runs one case and scores it. Returns {checks, detail}; a thrown turn is a failed case, not an exception. */
export async function runCoverageCase(c,{fault=null,turn=runAgentTurn}={}){
 const model=scriptedCoverageModel(c,fault),calls=[],held=heldCards(c);
 try{
  const request=async p=>{const m=await model.chat(p);for(const call of m.tool_calls||[])calls.push({name:call.function.name,args:JSON.parse(call.function.arguments)});return {message:m}};
  const r=await turn({history:[],memory:{},question:c.question,context:{cards:held,events:[],day:COVERAGE_DAY,language:c.language||'en'},request});
  const answer=r.answer,protections=model.seen.results.filter(x=>x.kind==='protections'),evidence=JSON.stringify(protections);
  const allowed=new Set(numbers(evidence)),own=name=>segments(answer,name).join('\n');
  const checks={
   completed:!!answer.trim(),
   calledFindProtections:calls.some(x=>x.name==='find_protections'),
   // The call covers the held cards (no cardName that narrows it away) and carries the asked type.
   scopedToHeldCards:protections.length>0&&c.expectNames.every(n=>protections.some(p=>p.matchedCards.includes(n)))&&protections.every(p=>p.matchedCards.every(n=>held.some(h=>h.name===n))),
   ...(c.args.type?{typeAsked:calls.some(x=>x.name==='find_protections'&&x.args.type===c.args.type)}:{}),
   // Every number in the answer is in the tool result, so no limit is invented.
   limitsTraceable:numbers(answer).every(n=>allowed.has(n)),
   noValuation:!VALUATION.test(answer),
  };
  if(c.noRecord){
   checks.saysNoRecord=c.noRecord.every(n=>NO_RECORD.test(own(n)));
   checks.pointsToGuide=GUIDE.test(answer);
   // "Not found in our records" is never "not covered": no such wording in any sentence about the card.
   checks.neverNotCovered=!c.noRecord.some(n=>NOT_COVERED.test(own(n)))&&!NOT_COVERED.test(answer);
  }
  for(const [n,b] of Object.entries(c.basis||{})){
   checks['basis:'+b]=BASIS[b].test(own(n))&&!BASIS[b==='primary'?'secondary':'primary'].test(own(n));
  }
  if(c.listAll)checks.listsEachCard=c.expectNames.every(n=>own(n).length>0);
  return {checks,detail:{toolNames:calls.map(x=>x.name),answerChars:answer.length}};
 }catch(error){return {checks:{completed:false},detail:{error:error.message,toolNames:calls.map(x=>x.name)}};}
}
