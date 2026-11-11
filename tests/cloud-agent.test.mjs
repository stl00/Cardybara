// The hosted agent route `/v1/chat` (stl00/Cardybara#210) on in-memory bindings with a scripted streaming provider,
// driven by the extension's own client (src/cloudChat.js). Synthetic wallet and synthetic keys only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cloudGateway,ORIGIN,INVITE} from './helpers/agent-target.mjs';
import {runCloudTurn} from '../src/cloudChat.js';
import {buildWalletSummary} from '../src/walletSummary.js';
import {sseEvents} from '../src/cloudProtocol.js';

const DAY='2026-10-28',NOW=()=>Date.parse(DAY+'T12:00:00Z');
const products=JSON.parse(readFileSync(new URL('./fixtures/wallet-products.json',import.meta.url))).cards;
const PRIVATE={balance:4321.98,available:8765.43,statement:2468.13,minimum:87.65,creditLimit:13579.11,due:'2026-11-23',paymentStatus:'No payment due sentinel',tail:'7319',fieldSources:{balance:{page:'/sentinel/overview-page'}}};
const SENTINELS=['4321.98','8765.43','2468.13','87.65','13579.11','2026-11-23','No payment due sentinel','7319','/sentinel/overview-page','acct-sentinel'];
const cards=products.map((c,i)=>({...c,...PRIVATE,id:'acct-sentinel-'+i}));
const context={cards,events:[],day:DAY,language:'zh-CN'};
const call=(name,args={},id='c1')=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const tools=(...calls)=>({message:{role:'assistant',content:'',tool_calls:calls}});
const say=content=>({message:{role:'assistant',content}});
const toolResults=payload=>payload.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
async function gateway(steps,{vars,logs=[]}={}){
 let n=0;const payloads=[];
 const g=await cloudGateway({vars,now:NOW,log:l=>logs.push(l),request:async(payload,signal,opts)=>{payloads.push({payload,opts});const step=steps[n++];assert.ok(step,'the agent asked the model more often than scripted');return typeof step==='function'?step(payload,signal,opts):step;}});
 // A failed assertion inside the scripted model surfaces as itself, not as the Worker's provider error.
 return {...g,payloads,logs,calls:()=>n,turn:args=>runCloudTurn({...args,post:args.post||g.post}).catch(e=>{throw g.thrown()||e;})};
}
const post=(g,body,{code=INVITE}={})=>g.handle(new Request('https://gateway.test/v1/chat',{method:'POST',headers:{Origin:ORIGIN,Authorization:'Bearer '+code,'Content-Type':'application/json'},body:JSON.stringify(body)}));
async function events(response){const out=[];for await(const e of sseEvents(response.body))out.push(e);return out;}
const summary=()=>buildWalletSummary({cards,day:DAY,language:'zh-CN'});
const settle=()=>new Promise(r=>setTimeout(r,20));

test('a public-knowledge question runs in the Worker and streams its answer; the extension sends no wallet data',async()=>{
 const g=await gateway([tools(call('list_cards')),payload=>say('你持有 '+toolResults(payload)[0].map(c=>c.name).join('、')+'。')]);
 const deltas=[];const r=await runCloudTurn({question:'我有哪些卡？',context,onDelta:t=>deltas.push(t),post:g.post});
 assert.match(r.answer,/^你持有 American Express Gold Card/);
 assert.equal(deltas.filter(t=>t!==null).join(''),r.answer,'the answer streamed before it was final');
 assert.ok(deltas.includes(null),'each model call starts a fresh draft');
 assert.deepEqual(r.tools,['list_cards']);
 assert.equal(g.agentRequests.length,1,'no tool round-trip for a public tool');
 const sent=JSON.stringify(g.agentRequests)+JSON.stringify(g.providerRequests);
 for(const v of SENTINELS)assert.ok(!sent.includes(v),'reached the gateway or the model: '+v);
 // The summary sits in the system message, so "my Platinum" needs no tool call.
 assert.match(g.providerRequests[0].messages[0].content,/Held cards, from the user's wallet.*Sapphire Reserve/);
 assert.ok(r.messages.every(m=>m.role!=='tool'),'no tool result comes back into the history');
 // Two model calls, each reserved and counted.
 const day=[...g.env.USAGE.instances.get('global').storage.data.entries()].find(([k])=>k.startsWith('d:'))[1];
 assert.equal(day.requests,2);
});

test('a wallet tool runs in the extension: only its result is posted back, then the turn continues',async()=>{
 const g=await gateway([
  tools(call('find_benefits',{query:'hotel 酒店',category:'credit'},'pub'),call('query_credits',{use:'hotel'},'wal')),
  payload=>{const [found,credits]=toolResults(payload);assert.equal(found.coverage.slice(0,6),'Public');assert.equal(credits.tool,'query_credits');return say('本期酒店 credit 都没有手动标记，不确定是否用过。');},
  // The checker may ask for one repair; the answer is the same.
  say('本期酒店 credit 都没有手动标记，不确定是否用过。'),
 ]);
 const progress=[];const r=await g.turn({question:'本期酒店 credit 用了吗？',context,onProgress:p=>progress.push(p.name||p.phase)});
 assert.ok(r.answer);
 assert.deepEqual(r.tools,['find_benefits','query_credits']);
 assert.equal(g.agentRequests.length,2);
 // The replayed round is not sent to the model again: the continuation's first model call already holds both results.
 assert.equal(g.providerRequests[0].messages.filter(m=>m.role==='tool').length,0);
 assert.equal(g.providerRequests[1].messages.filter(m=>m.role==='tool').length,2);
 const [first,second]=g.agentRequests;
 assert.ok(!('rounds' in first));
 assert.deepEqual(Object.keys(second.rounds[0].results),['wal'],'only the requested wallet tool\'s result');
 assert.ok(progress.includes('query_credits'));
 for(const v of SENTINELS)assert.ok(!JSON.stringify(g.agentRequests).includes(v),v);
});

test('the Worker refuses a continuation that adds wallet data or answers calls it never made',async()=>{
 const g=await gateway([tools(call('query_credits',{use:'hotel'},'wal'))]);
 const base={question:'本期酒店 credit 用了吗？',history:[],memory:{},summary:summary()};
 const ask=await events(await post(g,base));
 const req=ask.find(e=>e.type==='tool_request');
 assert.ok(req);assert.deepEqual(req.calls.map(c=>c.id),['wal']);
 const round=(results,message=req.rounds[0])=>({...base,rounds:[{message,results}],turn:req.turn});
 const refuse=async(body,code)=>{const r=await post(g,body);assert.equal(r.status,code==='turn_expired'?409:400,code);assert.equal((await r.json()).error.code,code);};
 await refuse(round({wal:{ok:1},extra:{balance:4321.98}}),'bad_request');
 await refuse(round({}),'bad_request');
 await refuse({...round({wal:{ok:1}}),balance:4321.98},'bad_request');
 await refuse({...round({wal:{ok:1}}),summary:{...summary(),cards:[{...summary().cards[0],name:'Gold 4321.98'}]}},'bad_request');
 await refuse({...round({wal:{ok:1}}),history:[{role:'user',content:'hi'},{role:'tool',tool_call_id:'x',content:'{"balance":4321.98}'}]},'bad_request');
 // A forged round (a wallet call the agent did not make) fails the signature.
 await refuse(round({forged:{ok:1}},{...req.rounds[0],tool_calls:[call('query_credits',{use:'dining'},'forged')]}),'turn_invalid');
 await refuse({...round({wal:{ok:1}}),turn:{...req.turn,sig:'0'.repeat(64)}},'turn_invalid');
 // The signature binds the question too.
 await refuse({...round({wal:{ok:1}}),question:'另一个问题'},'turn_invalid');
 const late=await cloudGateway({now:()=>NOW()+11*60000,request:async()=>assert.fail()});
 const r=await post(late,round({wal:{ok:1}}));assert.equal(r.status,409);assert.equal((await r.json()).error.code,'turn_expired');
});

test('the extension refuses a tool request for anything but a wallet tool of the newest round',async()=>{
 const g=await gateway([tools(call('query_credits',{use:'hotel'},'wal'))]);
 const forged=async(body,opts)=>{
  const stream=await g.post(body,opts);const all=await events({body:stream});
  const req=all.find(e=>e.type==='tool_request');req.calls=[call('list_cards',{},'x')];
  return new Response('data: '+JSON.stringify(req)+'\n\n').body;
 };
 await assert.rejects(()=>runCloudTurn({question:'本期酒店 credit 用了吗？',context,post:forged}),/model_failed/);
});

test('invite, caps and errors: a revoked code, a code over its cap mid-turn, and a cut stream',async()=>{
 const g=await gateway([tools(call('list_cards')),say('ok')],{vars:{DAILY_REQUESTS_PER_CODE:'1'}});
 await g.addInvite('cdy_'+'revoked-test-only-'.padEnd(43,'r'),{id:'revoked',status:'revoked'});
 const revoked=await post(g,{question:'hi',history:[],memory:{},summary:summary()},{code:'cdy_'+'revoked-test-only-'.padEnd(43,'r')});
 assert.equal(revoked.status,403);assert.equal((await revoked.json()).error.code,'invite_revoked');
 // The second model call of the turn is over the daily cap: the stream ends with that error.
 await assert.rejects(()=>runCloudTurn({question:'我有哪些卡？',context,post:g.post}),/hosted_over_cap/);
 assert.equal(g.calls(),1);
 const cut=async()=>new Response('data: {"type":"model"}\n\ndata: {"type":"delta","text":"部分"}\n\n').body;
 await assert.rejects(()=>runCloudTurn({question:'hi',context,post:cut}),/model_failed/);
 await assert.rejects(()=>runCloudTurn({question:'hi',context,post:async()=>{throw Error('model_failed');}}),/model_failed/);
});

test('stop cancels the turn in the Worker: the provider call is aborted and its worst case stays charged',async()=>{
 const logs=[];let aborted=false,asked;const waiting=new Promise(r=>{asked=r;});
 const g=await gateway([(payload,signal)=>{signal.addEventListener('abort',()=>{aborted=true;});asked();return 'hang';}],{logs});
 const ctrl=new AbortController();
 const turn=runCloudTurn({question:'hi',context,signal:ctrl.signal,post:g.post});
 await waiting;ctrl.abort();
 await assert.rejects(turn,{name:'AbortError'});
 await settle();
 assert.ok(aborted,'the provider request was aborted');
 const line=JSON.parse(logs.at(-1));assert.equal(line.route,'agent');assert.equal(line.error,'cancelled');
 const ledger=g.env.USAGE.instances.get('global').storage.data;
 assert.ok(![...ledger.keys()].some(k=>k.startsWith('r:')),'no reservation left open');
 assert.ok([...ledger.entries()].find(([k])=>k.startsWith('d:'))[1].tokens>0,'the worst case stays charged');
});

test('a failed grounding check is repaired without streaming, and the log line carries no content',async()=>{
 const logs=[];
 const g=await gateway([tools(call('get_card_rules',{kind:'fee',cardName:'Sapphire Reserve'})),say('年费是 999 美元。'),say('Sapphire Reserve 的公开年费见上面的规则。')],{logs});
 const r=await runCloudTurn({question:'CSR 年费多少？',context,post:g.post});
 assert.equal(r.answer,'Sapphire Reserve 的公开年费见上面的规则。');
 assert.deepEqual(g.payloads.map(p=>p.opts.repair),[false,false,true]);
 assert.equal(g.providerRequests.at(-1).stream,false,'a repair is checked before anyone sees it');
 assert.deepEqual(r.trace.filter(t=>['grounding','repair'].includes(t.type)).map(t=>[t.type,t.passed]),[['grounding',false],['repair',true]]);
 await settle();
 const line=JSON.parse(logs.at(-1));
 assert.deepEqual(Object.keys(line).sort(),['answered','at','code','completion_tokens','model_calls','prompt_tokens','rounds_replayed','route','status','wallet_results']);
 for(const text of ['CSR','年费','Sapphire',INVITE])assert.ok(!logs.join('\n').includes(text),'the log carries '+text);
});

test('the agent route takes the same origin and size limits as the model proxy',async()=>{
 const g=await gateway([]);
 const evil=await g.handle(new Request('https://gateway.test/v1/chat',{method:'POST',headers:{Origin:'https://evil.example',Authorization:'Bearer '+INVITE,'Content-Type':'application/json'},body:'{}'}));
 assert.equal(evil.status,403);
 const big=await post(g,{question:'x'.repeat(300000),history:[],memory:{},summary:summary()});
 assert.equal(big.status,413);
 const old=await post(g,{question:'hi',history:[],memory:{},summary:{...summary(),day:'2026-01-01'}});
 assert.equal(old.status,400,'a wallet day far from the Worker\'s clock');
 assert.equal(g.calls(),0);
});
