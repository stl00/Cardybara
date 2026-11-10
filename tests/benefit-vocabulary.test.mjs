import test from 'node:test';
import assert from 'node:assert/strict';
import {toSimplified,expandQuery} from '../src/benefitVocabulary.js';
import {searchBenefitKnowledge} from '../src/benefitSearch.js';
import {cardProducts} from '../src/productCatalog.js';

const card=id=>{const p=cardProducts.find(x=>x.id===id);return {id:'t-'+id,productId:id,name:p.name,bank:p.bank,region:p.region};};
const ids=(q,cards)=>searchBenefitKnowledge(q,cards,'2026-11-09').rules.map(r=>r.id);

test('Traditional characters become Simplified, other text is kept', () => {
 assert.equal(toSimplified('機場貴賓室 Lounge'),'机场贵宾室 Lounge');
});

test('expansion adds words, never replaces the question', () => {
 const q=expandQuery('rental car insurance');
 assert.ok(q.startsWith('rental car insurance'));
 assert.match(q,/租车/);assert.match(q,/保障/);
});

test('a programme alias adds the programme name', () => {
 assert.match(expandQuery('万豪会籍'),/Marriott Bonvoy/);
 assert.match(expandQuery('達美'),/Delta SkyMiles/);
 assert.doesNotMatch(expandQuery('unitedly'),/MileagePlus/);
});

test('a matched alias is not matched again by a shorter alias inside it', () => {
 assert.match(expandQuery('阿拉斯加航空休息室'),/Atmos Rewards/);
 assert.doesNotMatch(expandQuery('阿拉斯加航空休息室'),/Air Canada/);
 assert.match(expandQuery('达美航空'),/Delta SkyMiles/);
 assert.doesNotMatch(expandQuery('达美航空'),/AAdvantage/);
 assert.doesNotMatch(expandQuery('trip to the United States'),/MileagePlus/);
 assert.match(expandQuery('United perks'),/MileagePlus/);
});

test('glossary words match whole words only', () => {
 for(const q of ['frontier','mainstream','seat selection','how does it work out'])assert.doesNotMatch(expandQuery(q),/会籍|流媒体|餐饮|健身/,q);
});

test('an alias widens scoring but does not turn on the strict partner filter', () => {
 const biz=[card('amex-us-us-business-platinum-card'),card('chase-us-ihg-one-rewards-business-credit-card')];
 const found=ids('InterContinental hotel credit',biz);
 assert.ok(found.includes('rule.amex-us-us-business-platinum-card.hotel-credit'));
 assert.ok(found.includes('rule.chase-us-ihg-one-rewards-business-credit-card.food-beverage'));
});

test('a question with the bare word 卡 counts as generic', () => {
 assert.ok(searchBenefitKnowledge('我的卡有什么福利',[card('chase-us-sapphire-reserve')],'2026-11-09').total>20);
});

test('English questions reach Chinese rule text', () => {
 const csr=[card('chase-us-sapphire-reserve')];
 assert.ok(ids('Do I get rental car insurance?',csr).includes('rule.chase-us-sapphire-reserve.rental'));
 assert.ok(ids('travel insurance for trip delays',csr).includes('rule.chase-us-sapphire-reserve.trip-delay'));
});

test('Hong Kong wording reaches Simplified rule text', () => {
 const exp=[card('amex-hk-hk-american-express-explorer-credit-card')];
 assert.ok(ids('睇戲有冇折？',exp).includes('rule.amex-hk-hk-american-express-explorer-credit-card.movies'));
});

test('a generic benefits question still lists everything', () => {
 const csr=[card('chase-us-sapphire-reserve')];
 assert.ok(searchBenefitKnowledge('benefits',csr,'2026-11-09').total>20);
});
