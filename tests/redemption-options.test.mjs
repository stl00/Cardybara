// The assistant compares issuer redemptions with transfers using only numbers a tool returned (#309).
// Synthetic wallets and a scripted model; no network and no live model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentTurn} from '../src/agentSession.js';
import {runWalletTool,validateToolCall} from '../src/walletAgent.js';
import {answerGrounding} from '../src/answerGrounding.js';
import {SYSTEM} from '../src/chatProtocol.js';
import {redemptionOptions} from '../src/redemptionOptions.js';

const DAY='2026-11-16';
const card=(id,bank,region,name)=>({id,bank,region,name,currency:'USD'});
const gold=card('g','Amex US','US','American Express Gold Card'),bizPlat=card('b','Amex US','US','Business Platinum Card'),csr=card('c','Chase','US','Sapphire Reserve');
const call=(name,args,id='c1')=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const tools=(...calls)=>({role:'assistant',content:'',tool_calls:calls});
const say=content=>({role:'assistant',content});
const pa=(cards,args)=>runWalletTool(call('points_accounts',args),{cards,events:[],day:DAY});
const options=r=>Object.fromEntries(r.programmes[0].redemptions.options.map(o=>[o.id,o]));
async function turn(cards,question,...steps){
 let i=0;
 const request=async body=>{const s=steps[i++];assert.ok(s,'the loop asked the model more often than scripted');return {message:typeof s==='function'?s(body):s};};
 const result=await runAgentTurn({history:[],question,context:{cards,events:[],day:DAY},request});
 return {result,requests:i};
}
const toolMessages=body=>body.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
const redemptionResult=body=>toolMessages(body).find(r=>r?.kind==='points-accounts');

test('schema: points is optional, a positive number, and unknown arguments still fail',()=>{
 assert.deepEqual(validateToolCall(call('points_accounts',{programme:'Ultimate Rewards',points:5000})).args,{programme:'Ultimate Rewards',points:5000});
 for(const bad of [{points:0},{points:'many'},{points:-5},{cash:1}])assert.throws(()=>validateToolCall(call('points_accounts',bad)),/invalid_arguments/);
});

test('UR cash back and gift cards are computed in code from the stated points; travel varies, the rest are unknown',()=>{
 const o=options(pa([csr],{programme:'Ultimate Rewards',points:12345}));
 assert.deepEqual(o['ur-cash-back'].value,{status:'computed',points:12345,leftoverPoints:0,cents:12345,dollars:123.45});
 assert.equal(o['ur-gift-cards'].value.dollars,123.45);
 assert.equal(o['ur-travel-chase-travel'].value.status,'varies');assert.equal(o['ur-travel-chase-travel'].value.cents,undefined);
 for(const id of ['ur-pay-yourself-back','ur-shop-apple','ur-chase-dining'])assert.equal(o[id].value.status,'unknown');
 assert.ok(o['ur-cash-back'].sources[0].url.startsWith('https://'));
 // No stated number: rates only, never an assumed balance.
 assert.equal(options(pa([csr],{programme:'Ultimate Rewards'}))['ur-cash-back'].value.status,'rate-only');
});

test('MR: statement credit has no published rate; deposits move in 1,000-point blocks; the Business Platinum option needs that card',()=>{
 const none=options(pa([gold],{programme:'Membership Rewards',points:25500}));
 assert.equal(none['mr-statement-credit'].value.status,'unknown');
 assert.equal(none['mr-business-checking-deposit-business-platinum'].value.status,'needs-card');
 assert.equal(none['mr-business-checking-deposit-business-platinum'].eligibility,'needs-card-not-held');
 assert.deepEqual(none['mr-checking-deposit-standard'].value,{status:'computed',points:25000,leftoverPoints:500,cents:20000,dollars:200});
 const held=options(pa([gold,bizPlat],{programme:'Membership Rewards',points:20000}));
 assert.deepEqual(held['mr-business-checking-deposit-business-platinum'].value,{status:'computed',points:20000,leftoverPoints:0,cents:20000,dollars:200});
 const big=options(pa([bizPlat],{programme:'Membership Rewards',points:1500000}));
 assert.equal(big['mr-business-checking-deposit-business-platinum'].value.status,'above-annual-cap');assert.equal(big['mr-business-checking-deposit-business-platinum'].value.cents,undefined);
});

test('other programmes and regions carry no redemption records, and a hidden card is not held',()=>{
 const hk=pa([card('h','Amex HK','HK','The Platinum Card')],{programme:'Membership Rewards',region:'HK',points:1000});
 assert.equal(hk.programmes[0].redemptions,undefined);
 const hidden=options(pa([gold,{...bizPlat,hidden:true}],{programme:'Membership Rewards',points:20000}));
 assert.equal(hidden['mr-business-checking-deposit-business-platinum'].value.status,'needs-card');
 assert.deepEqual(redemptionOptions('programme.nope'),[]);
});

test('the system prompt limits redemption values to what points_accounts returned',()=>{
 assert.match(SYSTEM,/value\.status is rate-only or computed/);assert.match(SYSTEM,/varies, unknown, needs-card or above-annual-cap give no value/);
});

test('en: what are my Ultimate Rewards worth as cash — grounded on the tool value, answered at once',async()=>{
 const {result,requests}=await turn([csr],'I have 12,345 Ultimate Rewards points. What are they worth as cash?',
  tools(call('points_accounts',{programme:'Ultimate Rewards',points:12345})),
  body=>{const cash=redemptionResult(body).programmes[0].redemptions.options.find(o=>o.kind==='cash-back');
   return say(`As cash back each point is worth ${cash.centsPerPoint} cent, so 12,345 points is $${cash.value.dollars}. Source: ${cash.sources[0].url}`);});
 assert.equal(requests,2);assert.match(result.answer,/\$123\.45/);
});

test('zh-Hans: statement credit vs transfer — an invented statement-credit rate is caught and repaired',async()=>{
 const {result,requests}=await turn([gold],'我有 50000 MR 点，抵扣账单还是转点划算？',
  tools(call('points_accounts',{programme:'Membership Rewards',region:'US',points:50000}),call('convert_points',{points:50000},'c2')),
  say('抵扣账单每点约 0.6 美分，50000 点约 300 美元，转点更划算。'),
  say('官方条款没有公布 Membership Rewards 抵扣账单的每点价值，所以我不能给出具体金额；转点的比例以 convert_points 返回的为准，两者我不会换算成同一个价格来比较。'));
 assert.equal(requests,3);assert.doesNotMatch(result.answer,/0\.6|300/);
});

test('zh-Hant: an option that needs a card the user does not hold is named, not priced',async()=>{
 const {result,requests}=await turn([gold],'我有 20000 MR 點，存入 Business Checking 可以換多少錢？',
  tools(call('points_accounts',{programme:'Membership Rewards',region:'US',points:20000})),
  body=>{const biz=redemptionResult(body).programmes[0].redemptions.options.find(o=>o.id==='mr-business-checking-deposit-business-platinum');
   assert.equal(biz.value.status,'needs-card');
   return say('這個存款方案需要綁定 Business Platinum Card，你的錢包裡沒有這張卡，所以不能給你這個方案的金額。');});
 assert.equal(requests,2);assert.match(result.answer,/Business Platinum/);
});

test('en: a "varies" travel redemption priced by the model is rejected',()=>{
 const evidence=[{tool:'points_accounts',...pa([csr],{programme:'Ultimate Rewards',points:20000})}];
 assert.ok(answerGrounding('Chase Travel gives 1.5 cents per point, so 20,000 points is $300.',evidence).issues.some(i=>i.code==='unsupported_number'));
 assert.equal(answerGrounding('Chase Travel value varies by card and is not a fixed number, so I give none.',evidence).passed,true);
});

test('zh-Hant: a rate for an unpublished redemption is rejected, while the stated points may be repeated',()=>{
 const evidence=[{tool:'points_accounts',...pa([csr],{programme:'Ultimate Rewards',points:8000})}];
 assert.ok(answerGrounding('Pay Yourself Back 每點 1.25 美分。',evidence).issues.some(i=>i.code==='unsupported_number'));
 assert.equal(answerGrounding('8000 點換現金返還是 80 美元。',evidence).passed,true);
});
