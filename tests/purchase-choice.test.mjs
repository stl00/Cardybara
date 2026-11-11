import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {referenceCards as cards,creditMark,decisionIds} from '../evals/fixtures.mjs';
import {chooseCard,PURCHASE_CATEGORIES} from '../src/cardDecision.js';
import {QUICK_CATEGORIES,walletCurrencies,purchaseArgs,quickChoice} from '../src/purchaseChoice.js';
const {GOLD,GOLD_DINING}=decisionIds,DAY='2026-11-05';
const wallet={cards,events:[],day:DAY};
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('the wallet entry and the chat use the same engine and give the same choice',()=>{
 for(const category of QUICK_CATEGORIES)for(const amount of [null,100]){
  const input={category,amount,currency:'USD'},mine=quickChoice(input,wallet),chat=chooseCard(purchaseArgs(input),wallet);
  assert.equal(mine.kind,chat.choice.kind,category);
  assert.equal(mine.card,chat.choice.card||null,category);
  assert.equal(mine.value,chat.choice.value??null,category);
  assert.equal(mine.certainty,chat.choice.certainty||null,category);
 }
 // The overview mounts the entry, and the entry reaches the engine only through quickChoice.
 assert.match(source('../src/main.jsx'),/<PurchaseChooser cards=\{held\.cards\}/);
 const ui=source('../src/PurchaseChooser.jsx');
 assert.match(ui,/quickChoice\(/);assert.doesNotMatch(ui,/fetch\(|requestAdvisor|extensionChat|sendCollector/,'no model or network call');
 assert.match(source('../src/purchaseChoice.js'),/from '\.\/cardDecision\.js'/);
});

test('category bonus, a counted credit and what could change are shown as the engine computed them',()=>{
 const dining=quickChoice({category:'dining',amount:100,currency:'USD'},wallet);
 assert.equal(dining.kind,'use-card');assert.equal(dining.card,'Freedom Unlimited');assert.equal(dining.value,3);assert.equal(dining.certainty,'conditional');
 assert.ok(dining.others.length>0&&dining.others.length<=3);assert.ok(!dining.others.some(o=>o.card===dining.card));
 // A credit marked unused for a listed merchant changes the winner here too.
 const marks=[creditMark(GOLD,GOLD_DINING,'2026-11-01','2026-11-30','unused')];
 const grubhub=quickChoice({category:'dining',amount:30,merchant:'Grubhub',currency:'USD'},{...wallet,events:marks});
 assert.equal(grubhub.card,'American Express Gold Card');assert.equal(grubhub.value,10);assert.deepEqual(grubhub.credit,{title:'每月餐饮抵扣',value:10});
 // Unmarked, the credit is not counted but is listed as something that would change the choice.
 const unmarked=quickChoice({category:'dining',amount:30,merchant:'Grubhub',currency:'USD'},wallet);
 assert.equal(unmarked.card,'Freedom Unlimited');
 assert.ok(unmarked.changes.some(c=>c.kind==='credit-if-it-applies'&&c.wouldChangeChoice));
 assert.ok(unmarked.changes.length<=3);
});

test('blank fields stay out, so the engine states its own defaults; nothing to compare says so',()=>{
 assert.deepEqual(purchaseArgs({category:'dining',amount:0,merchant:'  ',currency:undefined}),{category:'dining'});
 assert.deepEqual(purchaseArgs({category:'not-a-category',amount:12.5,merchant:' Shop '}),{category:'other',amount:12.5,merchant:'Shop'});
 assert.equal(purchaseArgs({merchant:'x'.repeat(200)}).merchant.length,80);
 const bare=quickChoice({category:'dining',currency:'USD'},wallet);
 assert.ok(bare.assumptions.includes('channel-assumed-direct'));
 assert.equal(bare.basis,'cash-rate','no amount: rates are compared, not money');
 assert.equal(quickChoice({category:'dining'},{...wallet,cards:[]}).kind,'none');
 const unknown=quickChoice({category:'other'},{...wallet,cards:[{id:'x',name:'Mystery Card',bank:'Nobody',region:'US',currency:'USD'}]});
 assert.equal(unknown.kind,'none');assert.equal(unknown.excluded,1);
});

test('cards in several currencies: the entry asks for the currency, then compares only that currency',()=>{
 const hk=cards.find(c=>c.productId==='hsbc-hk-hk-red-credit-card');assert.ok(hk);
 const mixed={...wallet,cards:[...cards.filter(c=>c.currency==='USD'),hk]};
 assert.deepEqual(walletCurrencies(mixed.cards),['HKD','USD']);
 assert.equal(quickChoice({category:'dining'},mixed).kind,'depends-on-currency');
 const usd=quickChoice({category:'dining',currency:'USD'},mixed);
 assert.equal(usd.kind,'use-card');assert.notEqual(usd.card,hk.name);
 // The HKD card is left out of a USD comparison and counted as such, never silently dropped.
 assert.ok(usd.otherCurrency+usd.excluded>=1);
});

test('every offered category is one the engine knows, and every string is in three languages',()=>{
 assert.ok(QUICK_CATEGORIES.length>=10);for(const c of QUICK_CATEGORIES)assert.ok(PURCHASE_CATEGORIES.includes(c),c);
 const ui=source('../src/PurchaseChooser.jsx'),catalog=JSON.parse(source('../src/translations.json'));
 const keys=[...ui.matchAll(/t\('([^']+)'/g)].map(m=>m[1]);assert.ok(keys.length>30);
 const labels=[...ui.matchAll(/:'([^'\x00-\x7f][^']*)'/g)].map(m=>m[1]);assert.ok(labels.length>=QUICK_CATEGORIES.length);
 for(const key of [...keys,...labels])for(const language of ['en-US','zh-TW'])assert.ok(catalog[language][key],`${language}: ${key}`);
});
