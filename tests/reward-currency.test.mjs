// #245: a percent paid in a restricted reward currency is named and never ranked or added as cash back.
import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseCard} from '../src/cardDecision.js';
import {quickChoice} from '../src/purchaseChoice.js';
import {renderChoiceAnswer} from '../src/decisionAnswer.js';
import {queryKnowledge,knowledgeSources,validateKnowledge} from '../src/knowledge.js';
import {cardProducts} from '../src/productCatalog.js';
const DAY='2026-11-12',NAME='Disney Rewards Dollars';
const DISNEY=['chase-us-disney-visa-card','chase-us-disney-premier-visa-card','chase-us-disney-inspire-visa-card'];
const held=(id,extra={})=>{const p=cardProducts.find(x=>x.id===id);assert.ok(p,id);return {id:'c-'+id,bank:p.bank,region:p.region,name:p.name,currency:'USD',tail:'0000',...extra};};
const premier=held('chase-us-disney-premier-visa-card'),flat=held('chase-us-freedom-unlimited');
const context=cards=>({cards,events:[],day:DAY,marketDefaults:false});
const dining={category:'supermarket',amount:100,currency:'USD',country:'US'};

test('every Disney earning rule names Disney Rewards Dollars as a non-cash currency, with its source and check date',()=>{
 assert.deepEqual(validateKnowledge().errors,[]);
 for(const id of DISNEY){
  const rules=queryKnowledge({productId:id,kind:'earning-rate',asOf:DAY}).rules;assert.ok(rules.length,id);
  for(const rule of rules){
   const c=rule.terms.rewardCurrency;
   assert.deepEqual({name:c?.name,cash:c?.cash},{name:NAME,cash:false},rule.id);
   assert.match(c.sourceText,/Disney Rewards Dollars/);assert.ok(c.redemptionText);
   assert.equal(rule.evidence.checkedAt,'2026-11-12');
   assert.ok(knowledgeSources(rule.evidence.sourceIds).every(s=>s.url.startsWith('https://creditcards.chase.com/')&&s.checkedAt==='2026-11-12'));
  }
 }
});

test('a Disney card earns Disney Rewards Dollars, not cash, and a lower cash rate still leads',()=>{
 const r=chooseCard(dining,context([premier,flat]));
 const disney=r.rows.find(x=>x.card===premier.name),cash=r.rows.find(x=>x.card===flat.name);
 assert.equal(disney.earn.rate,2);assert.equal(disney.earn.isCash,false);assert.equal(disney.earn.nonCash,true);
 assert.equal(disney.earn.rewardCurrency,NAME);assert.equal(disney.earn.programme,NAME);assert.equal(disney.earn.reward,2);
 // 2% in Disney Rewards Dollars does not outrank 1.5% cash, and is not counted as money.
 assert.equal(cash.earn.isCash,true);assert.equal(cash.earn.rewardCurrency,undefined);
 assert.equal(r.choice.card,flat.name);assert.equal(r.choice.value,cash.earn.reward);
 assert.equal(disney.valueAtPointValue,undefined);
 const other=r.pointsAlternatives.find(p=>p.card===premier.name);
 assert.equal(other.nonCash,true);assert.equal(other.rewardCurrency,NAME);assert.equal(other.breakEvenCentsPerPoint,undefined);
 assert.match(r.nonCashNote,/never call it cash back/);
 // With no amount, rates are compared: the non-cash percent is still not a cash rate.
 const bare=chooseCard({category:'supermarket',country:'US'},context([premier,flat]));
 assert.equal(bare.choice.card,flat.name);assert.equal(bare.choice.basis,'cash-rate');
});

test('a wallet with only a Disney card gets no cash answer',()=>{
 const r=chooseCard(dining,context([premier]));
 assert.notEqual(r.choice.kind,'use-card');assert.equal(r.rows[0].earn.nonCash,true);
 for(const q of ['餐厅用哪张卡','Which card for dinner?']){
  const text=renderChoiceAnswer(chooseCard(dining,context([premier,flat])),q);
  assert.ok(text.includes(NAME),text);assert.ok(/不是现金返现|not cash back/.test(text),text);
 }
});

test('a value the user states for the currency is the only way it counts as money',()=>{
 const r=chooseCard({...dining,pointValues:{'disney rewards dollars':100}},context([premier,flat]));
 const disney=r.rows.find(x=>x.card===premier.name);
 assert.equal(disney.pointValue?.basis,'stated');assert.equal(disney.valueAtPointValue,2);assert.equal(r.choice.card,premier.name);assert.equal(r.choice.valuedPoints,true);
});

test('cash-back cards are unchanged, and the wallet entry carries the currency through',()=>{
 const cash=chooseCard(dining,context([flat]));
 assert.equal(cash.choice.card,flat.name);assert.equal(cash.rows[0].earn.isCash,true);assert.equal(cash.rows[0].earn.nonCash,undefined);assert.equal(cash.nonCashNote,undefined);
 const quick=quickChoice({category:'supermarket',amount:100,currency:'USD'},context([premier,flat]));
 const other=quick.others.find(o=>o.card===premier.name);
 assert.equal(quick.card,flat.name);assert.equal(other.nonCash,true);assert.equal(other.rewardCurrency,NAME);assert.equal(other.percent,null);assert.equal(other.value,null);
});
