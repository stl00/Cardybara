import test from 'node:test';
import assert from 'node:assert/strict';
import {context} from '../evals/fixtures.mjs';
import {prepareAgentContext,validateMemory} from '../src/agentContext.js';
import {answerGrounding} from '../src/answerGrounding.js';
import {runAgentTurn} from '../src/agentSession.js';
import {validateChat} from '../scripts/chat-agent.mjs';
const comparison={category:'dining',country:'US',currency:'USD',amount:100};
const call={id:'c1',type:'function',function:{name:'choose_card',arguments:JSON.stringify(comparison)}};
test('context keeps recent complete messages and typed scenario, discards stale tool evidence',()=>{
 const history=[{role:'user',content:'old question'},{role:'assistant',content:'',tool_calls:[call]},{role:'tool',tool_call_id:'c1',content:'{"secret_old_balance":123}'},{role:'assistant',content:'old reply'}];
 for(let i=0;i<15;i++)history.push({role:'user',content:'q'+i},{role:'assistant',content:'a'.repeat(4000)});
 const p=prepareAgentContext(history);assert.ok(p.chars<=22000);assert.ok(p.droppedTurns>0);assert.deepEqual(p.memory.lastPurchase,comparison);assert.ok(!JSON.stringify(p.messages).includes('secret_old_balance'));assert.ok(p.messages.every(m=>m.role!=='tool'&&!m.tool_calls));
 assert.equal(p.messages.at(-2).content,'q14');assert.throws(()=>validateMemory({password:'bad'}));assert.throws(()=>validateMemory({lastPurchase:{...comparison,cookie:'bad'}}));
 assert.doesNotThrow(()=>validateChat({messages:[{role:'user',content:'next'}],memory:p.memory}));
});
test('grounding checks source URLs, numbers, action and enrollment claims',()=>{
 assert.equal(answerGrounding('公开权益不代表你已登记。',[]).passed,true);
 assert.equal(answerGrounding('你提到花100，请补充币种。',[[{name:'Gold'}]],{contextText:'餐厅花100'}).passed,true);
 const evidence=[{reward:3,rate:3,amount:100,sources:[{url:'https://bank.example/terms'}]}];
 assert.equal(answerGrounding('100美元约返3美元。[条款](https://bank.example/terms)',evidence).passed,true);
 assert.equal(answerGrounding('返99美元',evidence).issues[0].code,'unsupported_number');
 assert.equal(answerGrounding('[来源](https://invented.example)',evidence).issues[0].code,'unsupported_citation');
 assert.ok(answerGrounding('我已为你付款',evidence).issues.some(i=>i.code==='unauthorized_action_claim'));
 assert.ok(answerGrounding('你已登记成功',evidence).issues.some(i=>i.code==='unverified_enrollment'));
});
test('bad answer is repaired once; failed repair is never presented as success',async()=>{
 let count=0;const request=async()=>({message:++count===1?{role:'assistant',content:'',tool_calls:[call]}:{role:'assistant',content:count===2?'You get 99999 dollars.':'Use Freedom Unlimited. Rates depend on conditions; please verify the official terms.'}});
 const r=await runAgentTurn({history:[],question:'US dining USD100',context,request});assert.equal(count,3);assert.equal(r.trace.at(-1).type,'repair');assert.ok(!JSON.stringify(r.messages).includes('99999'));assert.deepEqual(r.memory.lastPurchase,comparison);
 await assert.rejects(()=>runAgentTurn({history:[],question:'test',context,request:async()=>({message:{role:'assistant',content:'[source](https://invented.example)'}})}),/answer_not_grounded/);
});
test('new frontend remains usable with the previous local proxy during rollout',async()=>{
 const {requestAdvisor}=await import('../src/advisorTransport.js');const bodies=[];
 const reply=await requestAdvisor('',{messages:[{role:'user',content:'hi'}],memory:{}},undefined,async(url,opts)=>{bodies.push(JSON.parse(opts.body));return bodies.length===1?{ok:false,status:400}:{ok:true,status:200,json:async()=>({message:{content:'hello'}})}});
 assert.equal(reply.message.content,'hello');assert.ok(bodies[0].memory);assert.ok(!('memory' in bodies[1]));
});

test('a skipped tool cannot invent a reward, while a numeric clarification stays conversational',async()=>{
 assert.ok(answerGrounding('Your card earns 99 USD.',[]).issues.some(i=>i.code==='unsupported_number'));
 assert.equal(answerGrounding('You mentioned 100; which currency?',[],{contextText:'dining 100'}).passed,true);
 assert.equal(answerGrounding('1. Which country?\n2. Which currency?',[]).passed,true);
 let requests=0;
 const result=await runAgentTurn({history:[],question:'Which card should I use?',context,request:async()=>({message:{role:'assistant',content:++requests===1?'You will earn 99 USD.':'Which country, currency, amount and spending category?'}})});
 assert.equal(requests,2);assert.equal(result.trace.at(-1).type,'repair');
 assert.ok(!result.messages.some(m=>m.content?.includes('99 USD')));
});

test('a regional fee follow-up keeps the dialogue but requires fresh tool evidence',async()=>{
 const toolCall=(region,id)=>({id,type:'function',function:{name:'get_card_rules',arguments:JSON.stringify({kind:'fee',region,cardName:'Platinum Card'})}});
 let first=0;
 const original=await runAgentTurn({history:[],question:'What is the Canadian Platinum annual fee?',context,request:async()=>({message:++first===1?{role:'assistant',content:'',tool_calls:[toolCall('CA','ca')]}:{role:'assistant',content:'The published primary fee is CAD 799; actual charges are unconfirmed.'}})});
 let second=0;
 const follow=await runAgentTurn({history:original.messages,question:'What about Hong Kong?',context,request:async payload=>{
  if(++second===1){assert.ok(!payload.messages.some(m=>m.role==='tool'));assert.ok(payload.messages.some(m=>m.content.includes('Canadian Platinum')));return {message:{role:'assistant',content:'',tool_calls:[toolCall('HK','hk')]}};}
  const result=JSON.parse(payload.messages.at(-1).content);assert.equal(result.scope.region,'HK');assert.ok(result.rules.every(r=>r.terms.currency==='HKD'));
  return {message:{role:'assistant',content:'These are the Hong Kong published fees, not a confirmed personal charge.'}};
 }});
 assert.deepEqual(follow.tools,['get_card_rules']);assert.equal(follow.trace.at(-1).passed,true);
});


test('incidental evidence numbers cannot justify a ratio when all transfer ratios are unknown',()=>{
 const evidence=[{rules:[{kind:'transfer-relationship',revision:'example@2026-10-27.1',terms:{ratio:null,grantsEliteStatus:false}}]}];
 assert.ok(answerGrounding('Transfer ratio is 1:1.',evidence).issues.some(i=>i.code==='unsupported_transfer_ratio'));
 assert.equal(answerGrounding('The transfer ratio is not recorded; check official terms.',evidence).passed,true);
 const known=[{rules:[{kind:'transfer-relationship',terms:{ratio:{from:1,to:1}}}]}];
 assert.equal(answerGrounding('Transfer ratio is 1:1.',known).passed,true);
});
