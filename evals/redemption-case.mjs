// Offline end-to-end issuer-redemption cases (#464): a scripted model drives the real agent loop (runAgentTurn, so the
// shipped answer checker and tool execution run) and every check is code. The reference model writes its answer only from
// the points_accounts result (#309); a `fault` makes it break one rule on purpose so each check can be shown to fail.
// Synthetic wallet (one Membership Rewards US card, one Ultimate Rewards card) and a stated synthetic balance; no network.
import {cards} from './fixtures.mjs';
import {runAgentTurn} from '../tests/helpers/agent-target.mjs';
import {runWalletTool} from '../src/walletAgent.js';

export const REDEMPTION_DAY='2026-11-16';
export const REDEMPTION_POINTS=50000;
const GOLD='amex-us-us-american-express-gold-card',SAPPHIRE='chase-us-sapphire-reserve';
export const REDEMPTION_FAULTS=['wrong-dollars','invented-cpp','varies-number','needs-card-value','boost-dollars','no-tool'];

// What each case is about. `status` is the value.status the tool gives the option; `fault` is the one fault that has
// something to break there (no-tool applies to every case).
export const redemptionCases=[
 {id:'redemption-ur-cash-back-en',language:'en',programme:'Ultimate Rewards',optionId:'ur-cash-back',status:'computed',fault:'wrong-dollars',question:'I have 50,000 Ultimate Rewards points. Should I take cash back or transfer them?',focus:/cash back/i},
 {id:'redemption-ur-cash-back-zh',language:'zh-CN',programme:'Ultimate Rewards',optionId:'ur-cash-back',status:'computed',fault:'wrong-dollars',question:'我有 50000 Ultimate Rewards 点，换现金返还还是转点划算？',focus:/现金返还/},
 {id:'redemption-mr-unknown-zh',language:'zh-CN',programme:'Membership Rewards',optionId:'mr-statement-credit',status:'unknown',fault:'invented-cpp',question:'我有 50000 MR 点，抵扣账单一点值多少钱？',focus:/抵扣账单/},
 {id:'redemption-ur-varies-en',language:'en',programme:'Ultimate Rewards',optionId:'ur-travel-chase-travel',status:'varies',fault:'varies-number',question:'I have 50,000 Ultimate Rewards points. What are they worth through Chase Travel?',focus:/chase travel/i},
 {id:'redemption-ur-boost-en',language:'en',programme:'Ultimate Rewards',optionId:'ur-travel-chase-travel',status:'varies',boost:true,fault:'boost-dollars',question:'I have 50,000 Ultimate Rewards points. Does my card give a better rate through Chase Travel?',focus:/chase travel/i},
 {id:'redemption-mr-needs-card-zh',language:'zh-TW',programme:'Membership Rewards',optionId:'mr-business-checking-deposit-business-platinum',status:'needs-card',fault:'needs-card-value',question:'我有 50000 MR 點，存入 Business Checking 可以換多少錢？',focus:/Business Checking/},
];

const wallet=()=>[GOLD,SAPPHIRE].map(id=>cards.find(x=>x.productId===id));
const dollars=n=>Number.isInteger(n)?String(n):n.toFixed(2);

/** The reference answer, written only from the tool result; `fault` breaks one rule. */
function answerFrom(c,result,fault){
 const o=result.programmes[0].redemptions.options.find(x=>x.id===c.optionId),zh=/^zh/.test(c.language),hant=c.language==='zh-TW',cpp=o.centsPerPoint,pts=REDEMPTION_POINTS;
 const f=fault===c.fault?fault:null;
 let text;
 if(c.status==='computed'){
  const total=f==='wrong-dollars'?Math.round(o.value.dollars*1.5):o.value.dollars;
  text=zh?`现金返还：每点 ${cpp} 美分，${pts} 点是 $${dollars(total)}。转点的价值这里没有公布，转点比例请以 convert_points 返回的为准，我不会把它换算成美元来比较。`:`Cash back: each point is worth ${cpp} cent, so ${pts} points is $${dollars(total)}. The value of a transferred point is not published here, so I do not convert transfers into dollars; check the rates convert_points returns.`;
 }else if(c.status==='unknown')text=(zh?'抵扣账单：官方条款没有公布每点价值，所以我不能给出具体金额。':'')+(f==='invented-cpp'?'抵扣账单每点约 0.6 美分，50000 点约 $300。':'');
 else if(c.boost)text=f==='boost-dollars'?'Chase Travel: your Sapphire Reserve page says up to $2.00, so your 50,000 points are worth $1,000.':'Chase Travel: the value varies. Your Sapphire Reserve page says 100 points could be worth up to $2.00 through Chase Travel with Points Boost. That is a ceiling, not what a booking will give, so I give no dollar amount for your points.';
 else if(c.status==='varies')text=f==='varies-number'?'Chase Travel is worth about 1.5 cents per point, so 50,000 points is $750.':'Chase Travel: the issuer says the value varies by card, so I give no value per point and no dollar amount.';
 else text=f==='needs-card-value'?'存入 Business Checking 約值 $500。':(hant?'存入 Business Checking 需要綁定 Business Platinum Card，你的錢包裡沒有這張卡，所以不能給你這個方案的金額。':'');
 return text;
}

/** A chat(payload) function: the first request asks for points_accounts, the next answers from its result. */
export function scriptedRedemptionModel(c,fault=null){
 const seen={results:[]};
 const args={programme:c.programme,region:'US',points:REDEMPTION_POINTS};
 const chat=async payload=>{
  const tools=(payload.messages||[]).filter(m=>m.role==='tool');
  if(!tools.length&&fault!=='no-tool')return {role:'assistant',content:'',tool_calls:[{id:'red1',type:'function',function:{name:'points_accounts',arguments:JSON.stringify(args)}}]};
  seen.results=tools.map(m=>JSON.parse(m.content));
  const result=seen.results.find(r=>r.kind==='points-accounts');
  return {role:'assistant',content:result?answerFrom(c,result,fault):(/^zh/.test(c.language)?'每点约 1 美分，50000 点是 $500。':'Each point is worth 1 cent, so 50,000 points is $500.')};
 };
 return {chat,seen};
}

// Any money wording: a dollar sign, an amount of dollars, or a value per point in cents.
const MONEY=/[$¥]|\d\s*(?:dollars?|usd|美元|美金|美圓)|\d\s*(?:cents?|¢|美分|美仙)|[¢]/i;
const numbers=text=>(String(text).match(/\d+(?:,\d{3})*(?:\.\d+)?/g)||[]).map(n=>Number(n.replaceAll(',','')));
const lines=(answer,focus)=>answer.split(/\n/).filter(s=>focus.test(s));
const dollarAmounts=text=>[...String(text).matchAll(/\$\s?(\d+(?:,\d{3})*(?:\.\d+)?)/g)].map(m=>Number(m[1].replaceAll(',','')));

/** An answer that gives no per-point value and no dollar amount: money wording and numbers other than the stated points. */
const noValue=text=>!MONEY.test(text)&&numbers(text).every(n=>n===REDEMPTION_POINTS);

/** Runs one case and scores it. `turn` is swappable so a test can take the shipped answer checker out of the way. */
export async function runRedemptionCase(c,{fault=null,turn=runAgentTurn}={}){
 const model=scriptedRedemptionModel(c,fault),calls=[],held=wallet();
 try{
  const request=async p=>{const m=await model.chat(p);for(const call of m.tool_calls||[])calls.push({name:call.function.name,args:JSON.parse(call.function.arguments)});return {message:m}};
  const r=await turn({history:[],memory:{},question:c.question,context:{cards:held,events:[],day:REDEMPTION_DAY,language:c.language},request});
  const answer=r.answer,results=model.seen.results.filter(x=>x.kind==='points-accounts'),option=results[0]?.programmes?.[0]?.redemptions?.options?.find(x=>x.id===c.optionId),own=lines(answer,c.focus).join('\n');
  const checks={
   completed:!!answer.trim(),
   // A reply replaced by code-written fallback text is not the model's answer.
   modelAnswered:!(r.trace||[]).some(t=>t.type==='fallback'),
   calledPointsAccounts:calls.some(x=>x.name==='points_accounts'&&x.args.programme===c.programme&&x.args.points===REDEMPTION_POINTS),
   optionStatus:option?.value?.status===c.status,
   namesTheOption:own.length>0,
  };
  if(c.status==='computed'){
   // The dollar value is the one code computed, and it is the only dollar amount in the answer.
   checks.dollarsMatchTool=!!option&&dollarAmounts(answer).length>0&&dollarAmounts(answer).every(n=>n===option.value.dollars);
   checks.centsMatchTool=!!option&&numbers(own).includes(option.centsPerPoint);
  }else if(c.boost){
   // The held card's ceiling is given as "up to", with its source's figure, and no dollar amount is computed from it.
   const h=option?.pointsBoost?.heldCards?.[0];
   checks.toolReturnsHeldLimit=!!h&&h.productId===SAPPHIRE;
   checks.givesLimitAsUpTo=!!h&&/up to/i.test(own)&&dollarAmounts(own).includes(h.upToCentsPerPoint);
   checks.computesNoDollars=dollarAmounts(answer).every(n=>n===h?.upToCentsPerPoint)&&!numbers(answer).some(n=>n>REDEMPTION_POINTS||(n!==REDEMPTION_POINTS&&n>=300&&n!==100));
   checks.saysCeiling=/ceiling|upper limit|not what a booking/i.test(own);
  }else{
   checks.givesNoValue=noValue(answer);
   if(c.status==='needs-card')checks.namesCondition=/Business Platinum/.test(own);
   if(c.status==='unknown')checks.saysNotPublished=/没有公布|沒有公佈|not published|doesn't publish|does not publish/i.test(own);
   if(c.status==='varies')checks.saysVaries=/varies|不固定|因卡而异/i.test(own);
  }
  return {checks,detail:{toolNames:calls.map(x=>x.name),answerChars:answer.length}};
 }catch(error){return {checks:{completed:false},detail:{error:error.message,toolNames:calls.map(x=>x.name)}};}
}

/** The shipped answer checker already blocks most invented numbers; this turn skips it so the eval's own checks can be shown to fail. */
export const ungatedTurn=async({question,context,request})=>{
 const first=(await request({messages:[]})).message;
 const results=(first.tool_calls||[]).map(call=>({role:'tool',content:JSON.stringify(runWalletTool(call,context))}));
 const answer=(await request({messages:results})).message.content;return {answer,trace:[]};
};
