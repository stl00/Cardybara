// The per-turn wallet summary sent to the hosted agent (stl00/Cardybara#210): held products only, never an amount,
// a tail, statement or payment data, a credit mark or a date beyond the wallet day. Synthetic wallet only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildWalletSummary,validateWalletSummary,summaryCards,summaryContext,assistantCardName,WALLET_TOOLS} from '../src/walletSummary.js';
import {runWalletTool,agentTools} from '../src/walletAgent.js';
import {searchBenefitKnowledge} from '../src/benefitSearch.js';
import * as dev from '../evals/fixtures.mjs';
import * as heldOut from '../evals/holdout/cases.mjs';
import {context as heldOutContext} from '../evals/holdout/context.mjs';

const DAY='2026-11-11';
const products=JSON.parse(readFileSync(new URL('./fixtures/wallet-products.json',import.meta.url))).cards;
// Every private field a refreshed or edited card can carry, with sentinel values that must never appear in a summary.
const PRIVATE={balance:4321.98,available:8765.43,statement:2468.13,statementClosing:2469.24,minimum:87.65,creditLimit:13579.11,due:'2026-11-23',duePartial:'Nov 23',autopay:'on',paymentStatus:'No payment due sentinel',tail:'7319',fieldSources:{balance:{page:'/sentinel/overview-page',method:'rules-evidence-validated',evidence:'Balance $4,321.98'}},fieldDates:{balance:'2026-10-27T01:02:03.000Z'},updated:'2026-10-27T01:02:03.000Z',pageName:'Sentinel Page Name ...7319',feeDate:{month:3,day:15}};
const SENTINELS=['4321','8765','2468','2469','87.65','13579','2026-11-23','Nov 23','No payment due sentinel','7319','/sentinel','2026-10-27','Sentinel Page','acct-sentinel','03-15','"month"'];
const wallet=products.map((c,i)=>({...c,...PRIVATE,id:'acct-sentinel-'+i}));
// A user-edited name with a tail in it, a hidden card, and a card with no fee date.
wallet[0]={...wallet[0],name:'Gold ending 7319',productId:'amex-us-us-american-express-gold-card'};
wallet[1]={...wallet[1],hidden:true,name:'Hidden Sentinel Card'};
delete wallet[2].feeDate;
const POINT_VALUES=[{id:'amex-mr-us',cents:1.6,at:'2026-11-01T00:00:00.000Z'}];

test('the summary carries held products and settings only: no amount, tail, statement, payment data or hidden card',()=>{
 const s=buildWalletSummary({cards:wallet,day:DAY,language:'en-US',pointValues:POINT_VALUES});
 const text=JSON.stringify(s)+summaryContext(s);
 for(const v of SENTINELS)assert.ok(!text.includes(v),'the summary carries '+v);
 assert.ok(!text.includes('Hidden Sentinel Card'),'a hidden card is not held');
 assert.equal(s.cards.length,wallet.length-1);
 // No digit at all in any card name: a name with one is replaced by its product's name.
 for(const c of s.cards)assert.doesNotMatch(c.name,/\d/);
 assert.equal(s.cards[0].name,'American Express Gold Card');
 assert.deepEqual(Object.keys(s.cards[0]).sort(),['bank','currency','feeDate','name','productId','region']);
 assert.equal(s.cards[0].feeDate,'set');assert.equal(s.cards[1].feeDate,'unset');
 // The point value the user set, without when they set it.
 assert.deepEqual(s.pointValues,[{id:'amex-mr-us',cents:1.6}]);
 assert.doesNotThrow(()=>validateWalletSummary(s));
 // Programmes and pooling are named in the system context from public rules.
 assert.match(summaryContext(s),/Membership Rewards/);assert.match(summaryContext(s),/"pooling":/);
});

test('the Worker refuses a summary with anything more than the fixed fields',()=>{
 const s=buildWalletSummary({cards:wallet,day:DAY,language:'zh-CN',pointValues:POINT_VALUES});
 const bad=[
  {...s,balance:4321.98},
  {...s,cards:[{...s.cards[0],balance:4321.98},...s.cards.slice(1)]},
  {...s,cards:[{...s.cards[0],name:'Gold 4321.98'}]},
  {...s,cards:[{...s.cards[0],name:'Gold ending 7319'}]},
  {...s,cards:[{...s.cards[0],tail:'7319'}]},
  {...s,cards:[{...s.cards[0],feeDate:'03-15'}]},
  {...s,cards:[{...s.cards[0],productId:'not-a-product'}]},
  {...s,cards:[{...s.cards[0],bank:'Sentinel Bank'}]},
  {...s,pointValues:[{id:'amex-mr-us',cents:1.6,at:'2026-11-01T00:00:00.000Z'}]},
  {...s,pointValues:[{id:'amex-mr-us',cents:500}]},
  {...s,day:'2026-02-30'},
  {...s,language:'fr'},
 ];
 for(const b of bad)assert.throws(()=>validateWalletSummary(b),/invalid_summary/,JSON.stringify(b).slice(0,200));
});

test('a card name with digits becomes its product name, else its bank, never the digits',()=>{
 assert.equal(assistantCardName({name:'Sapphire Reserve ...4821',bank:'Chase',region:'US'}),'Sapphire Reserve');
 assert.equal(assistantCardName({name:'My card 4821',bank:'Chase',region:'US'}),'Chase card');
 assert.equal(assistantCardName({name:'Freedom Unlimited',bank:'Chase',region:'US'}),'Freedom Unlimited');
});

test('wallet tools are exactly the tools that read the user\'s wallet; the rest are public knowledge',()=>{
 assert.deepEqual([...WALLET_TOOLS].sort(),['choose_card','plan_flight','query_credits']);
 for(const name of WALLET_TOOLS)assert.ok(agentTools.some(t=>t.function.name===name));
});

// The hosted agent runs the public-knowledge tools on the summary's cards, not the wallet. Every dev and held-out
// case of those tools must come out the same as on the full wallet.
const call=(name,args,id='p1')=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
for(const [label,context] of [['development',dev.context],['held-out',heldOutContext]]){
 test(`${label} set: public-knowledge tools give the same results on the summary's cards as on the wallet`,()=>{
  const cloud={...context,cards:summaryCards(buildWalletSummary({cards:context.cards,day:context.day,language:'en-US'}))};
  const set=label==='development'?dev:heldOut;
  for(const c of set.retrievalCases){
   const ids=x=>x.rules.map(r=>r.id);
   assert.deepEqual(ids(searchBenefitKnowledge(c.query,cloud.cards,context.day,c.filters)),ids(searchBenefitKnowledge(c.query,context.cards,context.day,c.filters)),c.id);
  }
  for(const c of set.publicRuleCases)assert.deepEqual(runWalletTool(call('get_card_rules',c.args),cloud),runWalletTool(call('get_card_rules',c.args),context),c.id);
  for(const [name,args] of [['list_cards',{}],['points_accounts',{}],['convert_points',{partner:'Hyatt'}],['find_protections',{type:'rental-car'}],['find_benefits',{query:'lounge 贵宾室',category:'lounge'}]])
   assert.deepEqual(runWalletTool(call(name,args),cloud),runWalletTool(call(name,args),context),name);
 });
}
