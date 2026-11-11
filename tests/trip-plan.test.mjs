// #183: a whole-trip question (flight + hotel stay + what covers me) uses plan_flight, query_credits and
// find_protections in one round, with the same date words, and the answer is checked against all three results.
// A scripted model drives the real agent loop; no network and no live model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runAgentTurn} from './helpers/agent-target.mjs';
import {SYSTEM} from '../src/chatProtocol.js';
import {planResults} from '../src/creditClaims.js';
import {renderCreditAnswers} from '../src/creditAnswer.js';

const cards=JSON.parse(readFileSync(new URL('./fixtures/wallet-products.json',import.meta.url))).cards;
const context={cards,events:[],day:'2026-11-10'};
const call=(name,args,id)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const toolResults=messages=>messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));

// Synthetic whole-trip questions. Award price and points are the user's own stated numbers.
const TRIPS=[
 {lang:'zh-Hans',question:'12月20日到27日坐达美飞东京，机票要80000里程，我有60000点，住凯悦，怎么付最好？有什么保障？',when:'12月20日到27日',route:'飞东京',
  flight:(row,dates)=>`${dates.start} 至 ${dates.end}（日期是推定的）。航班：奖励座位和里程价格无法查询。${row.programme} 转 ${row.partner}，需要 ${n(row.toReachMiles.spend)} 点，还差 ${n(row.shortfall.pointsShort)} 点。`,
  cover:found=>'保障：'+found.map(c=>c.name+'（'+c.coverageTypes.join('、')+'）').join('；')+'。以各卡的保障指南为准，这不是保险建议；没有记录的卡是未找到记录，不是没有保障。'},
 {lang:'zh-Hant',question:'12月20日到27日搭達美飛東京，機票要80000哩，我有60000點，住凱悅，怎麼付比較好？有什麼保障？',when:'12月20日到27日',route:'飛東京',
  flight:(row,dates)=>`${dates.start} 至 ${dates.end}（日期是推定的）。航班：獎勵座位和哩程價格無法查詢。${row.programme} 轉 ${row.partner}，需要 ${n(row.toReachMiles.spend)} 點，還差 ${n(row.shortfall.pointsShort)} 點。`,
  cover:found=>'保障：'+found.map(c=>c.name+'（'+c.coverageTypes.join('、')+'）').join('；')+'。以各卡的保障指南為準，這不是保險建議；沒有記錄的卡是未找到記錄，不是沒有保障。'},
 {lang:'en',question:'Flying Delta to Tokyo Dec 20-27 (the award is 80,000 miles and I have 60,000 points) and staying at a Hyatt — how should I pay and what covers me?',when:'Dec 20-27',route:'to Tokyo',
  flight:(row,dates)=>`Dates ${dates.start} to ${dates.end} (assumed year). Award seats and award prices could not be checked. ${row.programme} to ${row.partner}: you need ${n(row.toReachMiles.spend)} points and are ${n(row.shortfall.pointsShort)} short.`,
  cover:found=>'Cover: '+found.map(c=>c.name+' ('+c.coverageTypes.join(', ')+')').join('; ')+'. Each card\'s guide to benefits controls; this is not insurance advice. A card with no record is not found, not uncovered.'},
];
const n=x=>x.toLocaleString('en-US');
const tripCalls=t=>[
 call('plan_flight',{airline:t.lang==='en'?'Delta':t.lang==='zh-Hans'?'达美':'達美',route:t.route,when:t.when,destination:'JP',milesNeeded:80000,points:60000},'flight'),
 call('query_credits',{use:'hotel',when:t.when,destination:'JP'},'hotel'),
 call('find_protections',{},'cover'),
];
// The answer a well-behaved model writes: every number is copied from a tool result, in the fixed order.
function composeAnswer(t,results){
 const [flight,hotel,cover]=results;
 const row=flight.transfers.programmes.flatMap(g=>g.partners.map(p=>({...p,programme:g.programme}))).find(r=>r.toReachMiles&&r.shortfall);
 assert.ok(row,'the synthetic wallet has a published route to the airline');
 const credits=renderCreditAnswers(planResults([flight.credits,hotel]),t.question,{});
 return [t.flight(row,flight.dates),credits,t.cover(cover.cards.filter(c=>c.status==='found'))].join('\n\n');
}
function scripted(t,answers){
 const requests=[];let step=0;
 const request=async payload=>{
  requests.push(payload);step++;
  if(step===1)return {message:{role:'assistant',content:'',tool_calls:tripCalls(t)}};
  const content=answers[step-2](toolResults(payload.messages));
  return {message:{role:'assistant',content}};
 };
 return {request,requests};
}

test('the system prompt routes a whole-trip question to all three tools with the same date words',()=>{
 assert.match(SYSTEM,/whole-trip question/);
 assert.match(SYSTEM,/plan_flight for the flight, query_credits with use hotel for the stay, and find_protections/);
 assert.match(SYSTEM,/same date words verbatim/);
 // The flight-only rule no longer forbids a hotel query_credits call in the same turn.
 assert.doesNotMatch(SYSTEM,/do not call convert_points or query_credits for the same question/);
 assert.match(SYSTEM,/Award seats were not checked|award seats were not checked/);
});

for(const t of TRIPS){
 test(`${t.lang}: a whole-trip question runs flight, hotel credits and protections once each, on one set of dates`,async()=>{
  const s=scripted(t,[results=>composeAnswer(t,results)]);
  const r=await runAgentTurn({history:[],question:t.question,context,request:s.request});
  assert.deepEqual(r.tools,['plan_flight','query_credits','find_protections'],'each tool once, in one round');
  assert.equal(s.requests.length,2,'one tool round and one answer');
  const calls=r.messages.find(m=>m.tool_calls)?.tool_calls.map(c=>({name:c.function.name,args:JSON.parse(c.function.arguments)}));
  assert.equal(calls[0].args.when,t.when);assert.equal(calls[1].args.when,t.when,'the same date words reach both date tools');
  assert.equal(calls[1].args.use,'hotel');
  const [flight,hotel,cover]=toolResults(r.messages);
  assert.equal(flight.dates.start,'2026-12-20');assert.equal(flight.dates.end,'2026-12-27');
  assert.deepEqual([hotel.window.start,hotel.window.end],[flight.dates.start,flight.dates.end],'flight and hotel resolve to the same window');
  assert.equal(flight.award.status,'not-checked');
  assert.ok(cover.cards.some(c=>c.status==='found'),'the synthetic wallet holds at least one protection record');
  assert.ok(cover.cards.some(c=>c.status==='not_found'));
  // The composed answer passes the checks without a repair: its numbers all come from tool results.
  assert.deepEqual(r.trace.filter(x=>['grounding','repair','fallback'].includes(x.type)).map(x=>[x.type,x.passed]),[['grounding',true]]);
  assert.ok(r.answer.includes('2026-12-20'));
  assert.equal(r.memory.trip?.start,'2026-12-20','the trip dates are remembered for a follow-up');
 });
}

test('a whole-trip answer with a number no tool returned is sent back for repair',async()=>{
 const t=TRIPS[2];
 const s=scripted(t,[results=>composeAnswer(t,results).replace(/are [\d,]+ short/,'are 7,777 short'),results=>composeAnswer(t,results)]);
 const r=await runAgentTurn({history:[],question:t.question,context,request:s.request});
 const checks=r.trace.filter(x=>['grounding','repair'].includes(x.type));
 assert.equal(checks[0].passed,false);assert.ok(checks[0].codes.includes('unsupported_number'));
 assert.equal(checks[1].passed,true);assert.ok(!r.answer.includes('7,777'));
});

test('a whole-trip answer that drops the hotel credits fails the credit coverage check',async()=>{
 const t=TRIPS[0];
 const flightOnly=results=>{const [flight]=results;const full=composeAnswer(t,results);return full.split('\n\n')[0]+'\n\n'+renderCreditAnswers(planResults([flight.credits]),t.question,{});};
 const s=scripted(t,[flightOnly,results=>composeAnswer(t,results)]);
 const r=await runAgentTurn({history:[],question:t.question,context,request:s.request});
 const first=r.trace.find(x=>x.type==='grounding');
 assert.equal(first.passed,false);assert.ok(first.codes.includes('plan_item_omitted'),'hotel credits returned by query_credits must be covered');
 assert.equal(r.trace.find(x=>x.type==='repair').passed,true);
});
