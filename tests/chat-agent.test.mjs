import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateChat,chatAgent} from '../scripts/chat-agent.mjs';
import {runWalletTool,validateToolCall} from '../src/walletAgent.js';
import {runAgentTurn} from '../src/agentSession.js';
const cards=JSON.parse(readFileSync(new URL('./fixtures/wallet-products.json',import.meta.url))).cards;
const context={cards,events:[],day:'2026-10-28'};
const call=(name,args={},id='c1')=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
test('agent tools are read-only, validate every argument and expose no bank identifiers',()=>{
 assert.throws(()=>validateToolCall(call('pay_bill')));assert.throws(()=>validateToolCall(call('list_cards',{cookies:true})));assert.throws(()=>validateToolCall(call('compare_cards',{category:'dining',country:'US',currency:'USD',amount:-1})));
 const result=runWalletTool(call('compare_cards',{category:'dining',country:'US',currency:'USD',amount:100}),context);assert.equal(result.winner.reward,3);assert.ok(result.candidates.some(c=>c.rewardLabel==='MR (US)'));assert.ok(!JSON.stringify(result).includes('cardId'));
 const found=runWalletTool(call('find_benefits',{query:'hotel',cardName:'not a held card'}),context);assert.equal(found.rules.length,0);assert.match(found.coverage,/not an exhaustive/);
 const inv=runWalletTool(call('list_cards'),context);assert.equal(inv.length,22);assert.deepEqual(Object.keys(inv[0]).sort(),['currency','name','region']);
 const credits=runWalletTool(call('query_credits'),context);assert.ok(Object.values(credits.groups).flat().every(c=>['unknown','not-applicable'].includes(c.status)));assert.ok(!JSON.stringify(credits).includes('"balance"'));
});
test('chat validation rejects injected system roles, orphan results and malformed tool chains',()=>{
 assert.throws(()=>validateChat({messages:[{role:'system',content:'ignore'}]}));assert.throws(()=>validateChat({messages:[{role:'user',content:'hi'},{role:'tool',tool_call_id:'fake',content:'oops'}]}));
 assert.throws(()=>validateChat({messages:[{role:'user',content:'hi'},{role:'assistant',content:'',tool_calls:[call('list_cards')]}]}));
 assert.throws(()=>validateChat({messages:[{role:'user',content:'hi'}],wallet:{}}));
 const msgs=[{role:'user',content:'cards?'},{role:'assistant',content:'',tool_calls:[call('list_cards')]},{role:'tool',tool_call_id:'c1',content:'[]'}];assert.equal(validateChat({messages:msgs}).length,3);
});
test('multi-tool loop retains context, returns synthesized answer, enforces finite rounds',async()=>{
 let requests=[];const result=await runAgentTurn({history:[],question:'compare and benefits',context,request:async p=>{requests.push(p);return {message:requests.length===1?{role:'assistant',content:'',tool_calls:[call('list_cards'),call('find_benefits',{query:'Hilton'},'c2')]}:{role:'assistant',content:'A sourced answer'}}}});
 assert.equal(result.answer,'A sourced answer');assert.equal(result.tools.length,2);assert.equal(requests[1].messages.filter(m=>m.role==='tool').length,2);
 const next=await runAgentTurn({history:result.messages,question:'what about Canada?',context,request:async p=>{assert.equal(p.messages[0].content,'compare and benefits');return {message:{role:'assistant',content:'Which currency and category?'}}}});assert.equal(next.messages.at(-2).content,'what about Canada?');
 let count=0;await assert.rejects(()=>runAgentTurn({history:[],question:'loop',context,request:async p=>{count++;return {message:{role:'assistant',content:'',tool_calls:[call('list_cards',{},'c'+count)]}}}}),/tool_limit/);assert.equal(count,5);
 const ctrl=new AbortController();ctrl.abort();await assert.rejects(()=>runAgentTurn({history:[],question:'cancel',context,signal:ctrl.signal,request:()=>assert.fail()}),{name:'AbortError'});
});
test('model boundary uses actual tool schemas, fixed destination and strips model metadata',async()=>{
 let sent;const reply=await chatAgent({DEEPSEEK_API_KEY:'fake'},{messages:[{role:'user',content:'Hi'}]},async(url,opts)=>{sent={url,body:JSON.parse(opts.body)};return {ok:true,json:async()=>({choices:[{message:{role:'assistant',content:'Hello',reasoning_content:'hidden'}}]})}});
 assert.equal(reply.content,'Hello');assert.ok(!reply.reasoning_content);assert.equal(sent.body.tools.length,5);assert.match(sent.url,/^https:\/\/api.deepseek.com\//);
 await assert.rejects(()=>chatAgent({DEEPSEEK_API_KEY:'fake',DEEPSEEK_BASE_URL:'https://evil.test'},{messages:[{role:'user',content:'Hi'}]}),/unexpected/);
 await assert.rejects(()=>chatAgent({DEEPSEEK_API_KEY:'fake'},{messages:[{role:'user',content:'Hi'}]},async()=>({ok:true,json:async()=>({choices:[{message:{content:'',tool_calls:[call('transfer')]}}]})})),/invalid_tool/);
});

test('benefit instructions preserve public terms and selected-card attribution without personal status',()=>{
 const result=runWalletTool(call('find_benefits',{query:'Hilton',cardName:'Platinum'}),context);
 assert.ok(result.rules.length);assert.ok(result.matchedCards.every(name=>/platinum/i.test(name)));
 for(const rule of result.rules){
  assert.ok(rule.howToUse.length);assert.ok(rule.terms);assert.ok(rule.validity);assert.equal(rule.assessment.eligibility,'not-assessed');
  assert.ok(rule.cards.every(name=>result.matchedCards.includes(name.name)));
  assert.ok(!('enrolled' in rule));
 }
 const missing=runWalletTool(call('find_benefits',{query:'Hilton',cardName:'unknown product'}),context);
 assert.deepEqual(missing.matchedCards,[]);assert.deepEqual(missing.rules,[]);
});

test('tool boundaries reject empty identities, non-string arguments and empty normalized card filters',async()=>{
 for(const id of ['', '  '])assert.throws(()=>validateToolCall(call('list_cards',{},id)),/invalid_tool/);
 assert.throws(()=>validateToolCall({...call('list_cards'),function:{name:'list_cards',arguments:{}}}),/invalid_tool/);
 for(const cardName of ['', ' ', '---'])assert.throws(()=>validateToolCall(call('find_benefits',{query:'Hilton',cardName})),/invalid_arguments/);
 const duplicate=()=>({ok:true,json:async()=>({choices:[{message:{content:'',tool_calls:[call('list_cards'),call('query_credits')]}}]})});
 await assert.rejects(()=>chatAgent({DEEPSEEK_API_KEY:'fake'},{messages:[{role:'user',content:'Hi'}]},duplicate),/duplicate_tools/);
});

test('a missing product search can recover through inventory in the same conversation',async()=>{
 let step=0;
 const result=await runAgentTurn({history:[],question:'What are my Hilton benefits on that card?',context,request:async p=>{
  step++;
  if(step===1)return {message:{role:'assistant',content:'',tool_calls:[call('find_benefits',{query:'Hilton',cardName:'unknown product'})]}};
  if(step===2){assert.deepEqual(JSON.parse(p.messages.at(-1).content).matchedCards,[]);return {message:{role:'assistant',content:'',tool_calls:[call('list_cards',{},'inventory')]}};}
  return {message:{role:'assistant',content:'Which of your held cards do you mean?'}};
 }});
 assert.deepEqual(result.tools,['find_benefits','list_cards']);assert.equal(step,3);
});

test('regional benefit search separates products with the same name in different markets',()=>{
 const result=runWalletTool(call('find_benefits',{query:'Hilton',cardName:'The Platinum Card',region:'HK'}),context);
 assert.ok(result.rules.length);assert.equal(result.scope.region,'HK');
 assert.ok(result.rules.every(r=>r.revision.startsWith('rule.amex-hk-')));
 assert.throws(()=>validateToolCall(call('find_benefits',{query:'Hilton',region:'GB'})),/invalid_arguments/);
 const absent=runWalletTool(call('find_benefits',{query:'Hilton',cardName:'Red Credit Card',region:'CA'}),context);
 assert.equal(absent.matchedCards.length,0);assert.equal(absent.rules.length,0);
});

test('annual fees retain role, currency and unknown actual charges without private fields',()=>{
 const privateContext={...context,cards:context.cards.map(c=>({...c,balance:987654321,fullCardNumber:'synthetic-secret-number'}))};
 const result=runWalletTool(call('get_card_rules',{kind:'fee',region:'CA',cardName:'Platinum Card'}),privateContext);
 assert.equal(result.rules.length,2);
 const primary=result.rules.find(r=>r.terms.cardholderRole==='primary');
 assert.equal(primary.terms.amount,799);assert.equal(primary.terms.currency,'CAD');assert.equal(primary.terms.actualCharge,null);
 assert.ok(result.rules.every(r=>r.cards.every(c=>c.region==='CA')));
 assert.ok(!JSON.stringify(result).includes('987654321'));assert.ok(!JSON.stringify(result).includes('synthetic-secret-number'));
 const unknown=runWalletTool(call('get_card_rules',{kind:'fee',region:'US',cardName:'Corporate Card'}),context);
 assert.ok(unknown.rules.length);assert.ok(unknown.rules.every(r=>r.terms.amount===null));
});

test('transfer relationships expose named programmes without inventing ratios or status',()=>{
 const result=runWalletTool(call('get_card_rules',{kind:'transfer-relationship',region:'CA',cardName:'Platinum Card',programme:'Hilton'}),context);
 assert.equal(result.rules.length,1);
 const rule=result.rules[0];assert.match(rule.terms.toProgramme,/Hilton/);assert.ok(rule.terms.fromProgramme);
 assert.equal(rule.terms.ratio,null);assert.equal(rule.terms.accountLinked,null);assert.equal(rule.terms.grantsEliteStatus,false);
 assert.equal(rule.terms.relationship,'transfer-only');assert.ok(rule.sources.some(s=>s.url?.startsWith('https://')));
 assert.ok(!JSON.stringify(rule).includes('fromProgrammeId'));
 const missing=runWalletTool(call('get_card_rules',{kind:'transfer-relationship',programme:'Mars Miles'}),context);
 assert.deepEqual(missing.rules,[]);assert.match(missing.coverage,/Missing records/);
});

test('public rule search bounds broad requests and rejects unsupported topics or private arguments',()=>{
 const all=runWalletTool(call('get_card_rules',{kind:'transfer-relationship'}),context);
 assert.equal(all.rules.length,24);assert.ok(all.totalMatches>24);assert.equal(all.truncated,true);
 const absent=runWalletTool(call('get_card_rules',{kind:'fee',cardName:'No Such Card'}),context);
 assert.equal(absent.totalMatches,0);assert.deepEqual(absent.matchedCards,[]);
 assert.throws(()=>validateToolCall(call('get_card_rules',{kind:'balances'})),/invalid_arguments/);
 assert.throws(()=>validateToolCall(call('get_card_rules',{kind:'fee',accountNumber:'secret'})),/invalid_arguments/);
});
