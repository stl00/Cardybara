// #184: choosing a card for a flight or hotel booking also lists each compared card's trip protections, as facts
// beside the choice. They carry no cash value, so the ranking is the same with or without them.
// Synthetic wallet only; a scripted model drives the real agent loop; no network and no live model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runWalletTool,withBookingProtections} from '../src/walletAgent.js';
import {chooseCard} from '../src/cardDecision.js';
import {runAgentTurn} from './helpers/agent-target.mjs';
import {SYSTEM} from '../src/chatProtocol.js';

const cards=JSON.parse(readFileSync(new URL('./fixtures/wallet-products.json',import.meta.url))).cards;
const context={cards,events:[],day:'2026-11-10',language:'en'};
const call=(name,args,id='c1')=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const choose=args=>runWalletTool(call('choose_card',args),context);
const strip=({bookingProtections,...rest})=>rest;

for(const category of ['flight','hotel','travel','vacation-rental','car-rental']){
 test(`${category}: protections ride along without changing the choice or the alternatives`,()=>{
  const args={category,currency:'USD',amount:800};
  const result=choose(args),plain=chooseCard(args,context);
  assert.ok(result.bookingProtections,'a travel booking lists protections');
  assert.equal(result.bookingProtections.scored,false);
  // Same choice, same rows in the same order, same alternatives: protections are added after ranking.
  assert.deepEqual(strip(result),plain);
  const listed=result.bookingProtections.cards.map(c=>c.name);
  for(const row of result.rows)assert.ok(listed.includes(row.card),row.card+' is listed');
  for(const c of result.bookingProtections.cards){
   assert.ok(['found','not_found'].includes(c.status));
   assert.equal(c.status==='found',c.coverage.length>0);
   for(const p of c.coverage){
    assert.ok(result.bookingProtections.coverageTypes.includes(p.type),p.type+' fits a '+category+' booking');
    assert.ok(p.sources.length&&p.sources.every(s=>s.url.startsWith('https://')),'every protection has a source');
    assert.ok(['primary','secondary','not-stated'].includes(p.basis));
    // No cash value is put on insurance.
    assert.equal(p.value,undefined);
   }
  }
 });
}

test('a flight lists trip delay and cancellation where recorded, and a card with no record is not_found',()=>{
 const result=choose({category:'flight',currency:'USD'});
 const csr=result.bookingProtections.cards.find(c=>c.name==='Sapphire Reserve');
 assert.equal(csr.status,'found');
 for(const t of ['trip-delay','trip-cancellation'])assert.ok(csr.coverage.some(p=>p.type===t),t);
 assert.ok(!csr.coverage.some(p=>p.type==='rental-car'||p.type==='purchase-protection'),'only booking-relevant protections');
 const gold=result.bookingProtections.cards.find(c=>c.name==='American Express Gold Card');
 assert.equal(gold.status,'not_found');assert.deepEqual(gold.coverage,[]);
 assert.match(result.bookingProtections.note,/not proof it has no coverage/);
 assert.match(result.bookingProtections.note,/guide to benefits controls/);
 assert.match(result.bookingProtections.note,/not part of the ranking/);
});

test('a car rental lists rental car cover, not trip protections',()=>{
 const result=choose({category:'car-rental',currency:'USD'});
 assert.deepEqual(result.bookingProtections.coverageTypes,['rental-car']);
 const csr=result.bookingProtections.cards.find(c=>c.name==='Sapphire Reserve');
 assert.ok(csr.coverage.length&&csr.coverage.every(p=>p.type==='rental-car'));
});

test('non-travel purchases and unanswered currency choices carry no protections',()=>{
 assert.equal(choose({category:'dining',currency:'USD'}).bookingProtections,undefined);
 assert.equal(choose({category:'online-retail',currency:'USD'}).bookingProtections,undefined);
 const split=choose({category:'flight'});
 if(split.choice.kind==='depends-on-currency')assert.equal(split.bookingProtections,undefined);
 assert.deepEqual(withBookingProtections({tool:'choose_card',needsDates:true},context),{tool:'choose_card',needsDates:true});
});

test('find_protections still returns the same shape after sharing its records with choose_card',()=>{
 const result=runWalletTool(call('find_protections',{type:'trip-delay'}),context);
 assert.equal(result.kind,'protections');
 assert.ok(result.cards.every(c=>!('own' in c)),'internal fields stay out of the tool result');
 assert.ok(result.rules.every(r=>r.coverageType==='trip-delay'));
 assert.ok(result.notFoundNote);
});

test('the system prompt tells the model how to present booking protections',()=>{
 assert.match(SYSTEM,/bookingProtections/);
 assert.match(SYSTEM,/did not change the choice/);
 assert.match(SYSTEM,/not_found not found, never uncovered/);
});

// A scripted model asks choose_card for a flight and writes the answer a well-behaved model would.
const QUESTIONS=[
 {lang:'en',question:'Which card should I use to book a $800 flight to Tokyo?',
  answer:(r,found)=>`Use ${r.choice.card}. Trip protections (separate from the choice): `+found.map(c=>c.name+' ('+c.coverage.map(p=>p.type).join(', ')+')').join('; ')+'. Each card\'s guide to benefits controls; this is not insurance advice. Cards with no record are not found, not uncovered.'},
 {lang:'zh-Hans',question:'订一张800美元去东京的机票用哪张卡？',
  answer:(r,found)=>`用 ${r.choice.card}。行程保障（不影响选卡）：`+found.map(c=>c.name+'（'+c.coverage.map(p=>p.type).join('、')+'）').join('；')+'。以各卡的保障指南为准，这不是保险建议；没有记录的卡是未找到记录，不是没有保障。'},
 {lang:'zh-Hant',question:'訂一張800美元去東京的機票用哪張卡？',
  answer:(r,found)=>`用 ${r.choice.card}。行程保障（不影響選卡）：`+found.map(c=>c.name+'（'+c.coverage.map(p=>p.type).join('、')+'）').join('；')+'。以各卡的保障指南為準，這不是保險建議；沒有記錄的卡是未找到記錄，不是沒有保障。'},
];
for(const q of QUESTIONS){
 test(`${q.lang}: the answer names the protections with the guide-to-benefits caveat and passes the checks`,async()=>{
  let step=0;
  const request=async payload=>{
   step++;
   if(step===1)return {message:{role:'assistant',content:'',tool_calls:[call('choose_card',{category:'flight',categorySource:'stated',amount:800,currency:'USD',merchant:'Tokyo flight'})]}};
   const result=JSON.parse(payload.messages.filter(m=>m.role==='tool').at(-1).content);
   return {message:{role:'assistant',content:q.answer(result,result.bookingProtections.cards.filter(c=>c.status==='found'))}};
  };
  const r=await runAgentTurn({history:[],question:q.question,context,request});
  assert.deepEqual(r.tools,['choose_card']);
  const result=JSON.parse(r.messages.find(m=>m.role==='tool').content);
  assert.ok(result.bookingProtections.cards.some(c=>c.status==='found'));
  assert.deepEqual(r.trace.filter(x=>['grounding','repair','fallback'].includes(x.type)).map(x=>[x.type,x.passed]),[['grounding',true]]);
  assert.ok(r.answer.includes(result.choice.card));
  assert.ok(r.answer.includes('Sapphire Reserve'));
 });
}
