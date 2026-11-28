// #677: coming back from Plaid Link. The pure rules behind src/plaidLanding.js, with synthetic cards only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cardsToType,isPlaidAddedHash,landingResult,needsCardType,startLanding,PLAID_ADDED_HASH} from '../src/plaidLanding.js';
import {NAV} from '../src/navigation.js';
import {cardProducts} from '../src/productCatalog.js';
import {groupEntries,pickerEntries} from '../src/productPicker.js';

const plaid = id => ({accountId: id});

test('only the new hash starts a landing; the old #settings stays an ordinary page', () => {
  assert.equal(isPlaidAddedHash(PLAID_ADDED_HASH), true);
  for (const hash of ['#settings', '', '#overview', '#card/synthetic', '#plaid-added-x']) assert.equal(isPlaidAddedHash(hash), false, hash);
  const pages = [...NAV.primary, ...NAV.more].map(item => item.key);
  assert.ok(pages.includes('settings'), 'older gateways still send #settings, which is still a page');
  // A wallet built before the hash falls back to the Overview for any key that is not a page, so the new one must not be.
  assert.ok(!pages.includes(PLAID_ADDED_HASH.slice(1)));
});

test('a landing waits until the new Plaid cards are read and in the wallet', () => {
  const {baseline} = startLanding([plaid('old')]);
  const old = ['w-old', plaid('old')];
  assert.equal(landingResult({baseline, plaidCards: [plaid('old')], pairs: [old]}).status, 'waiting', 'nothing new read yet');
  assert.equal(landingResult({baseline, plaidCards: [plaid('old'), plaid('new')], pairs: [old], pending: [{plaid: plaid('new')}]}).status, 'waiting', 'not added yet');
  assert.deepEqual(landingResult({baseline, plaidCards: [plaid('old'), plaid('new')], pairs: [old, ['w-new', plaid('new')]], pending: [{plaid: plaid('old')}]}), {status: 'ready', cardIds: ['w-new']});
  assert.equal(landingResult({baseline, plaidCards: [plaid('new')], pairs: []}).status, 'unplaced', 'read, but no wallet card can take it');
});

test('a card type is asked only while it is unrecognised, unchosen and unanswered', () => {
  const product = cardProducts.find(p => p.bank === 'Chase' && p.region === 'US');
  const unknown = {id: 'a', bank: 'Chase', region: 'US', name: 'Synthetic Card'};
  const matched = {id: 'b', bank: 'Chase', region: 'US', name: product.name};
  const chosen = {...unknown, id: 'c', productId: product.id, productChosen: true};
  assert.deepEqual([unknown, matched, chosen].map(needsCardType), [true, false, false]);
  const landing = {phase: 'done', cardIds: ['a', 'b', 'c', 'gone'], answered: []};
  assert.deepEqual(cardsToType(landing, [unknown, matched, chosen]), ['a']);
  assert.deepEqual(cardsToType({...landing, answered: ['a']}, [unknown]), []);
  assert.deepEqual(cardsToType({...landing, phase: 'waiting'}, [unknown]), []);
});

test('the picker can keep suggestions in the order given: catalogue candidates, then the AI one', () => {
  const entries = pickerEntries(cardProducts.filter(p => p.bank === 'Chase' && p.region === 'US'), p => p.name);
  const byName = [...entries].sort((a, b) => a.label.localeCompare(b.label));
  const pinned = [byName.at(-1).id, byName[0].id];
  const first = options => groupEntries(entries, {pinned, ...options})[0].items.slice(0, 2).map(e => e.id);
  assert.deepEqual(first({keepPinnedOrder: true}), pinned);
  assert.deepEqual(first({}).sort(), [...pinned].sort());
});
