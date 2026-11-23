// A card type the user chose names a card that has no name of its own (Plaid calls many cards just "CREDIT CARD").
// A name with product words, or one the user typed, is kept. Synthetic cards only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {presentCard,genericCardName,productDisplayName} from '../src/cardName.js';
import {applyCardProductChoices} from '../src/cardProductChoice.js';

const ID = 'chase-us-sapphire-reserve';
const card = (name, extra = {}) => ({id: 'c1', bank: 'Chase', region: 'US', tail: '1234', identitySource: 'manual', name, ...extra});
const chosen = c => applyCardProductChoices([c], [{cardId: c.id, productId: ID}])[0];

test('a generic Plaid name becomes the chosen card type, in the wallet language', () => {
  for (const name of ['CREDIT CARD', 'Credit Card', 'Visa Signature', 'Chase 1234', 'Chase Credit Card']) {
    const shown = presentCard(chosen(card(name)), 'en-US');
    assert.equal(shown.name, productDisplayName(ID, 'en-US'), name);
    assert.equal(shown.pageName, name, 'the original name is kept as pageName');
  }
  assert.equal(presentCard(chosen(card('CREDIT CARD')), 'zh-CN').name, productDisplayName(ID, 'zh-CN'));
});

test('negative controls: no choice, a real name, or a name the user set stays as it is', () => {
  assert.equal(presentCard(card('CREDIT CARD'), 'en-US').name, 'CREDIT CARD', 'no card type chosen');
  for (const name of ['我的蓝宝石', 'Sapphire', 'Chase Freedom'])
    assert.equal(presentCard(chosen(card(name)), 'en-US').name, name);
  assert.equal(presentCard(chosen(card('CREDIT CARD', {userSet: ['name']})), 'en-US').name, 'CREDIT CARD');
});

test('genericCardName', () => {
  assert.ok(genericCardName(card('CREDIT CARD')));
  assert.ok(genericCardName(card('')));
  assert.ok(!genericCardName(card('Sapphire Preferred')));
  assert.ok(!genericCardName(card('United Explorer')));
});

test('names with the card\'s own tail or only 信用卡 are generic too', () => {
  for (const name of ['CREDIT CARD 1234', 'Credit Card (1234)', '信用卡'])
    assert.equal(presentCard(chosen(card(name)), 'en-US').name, productDisplayName(ID, 'en-US'), name);
  assert.ok(!genericCardName(card('Credit Card 9999')), 'other digits are not this card\'s tail');
});

test('bank-page cards keep their existing path', () => {
  const page = {id: 'b1', bank: 'Chase', region: 'US', tail: '1234', identitySource: 'bank-page', name: 'Sapphire Reserve'};
  assert.equal(presentCard(page, 'en-US').name, productDisplayName(ID, 'en-US'), 'recognised by its page name as before');
  assert.equal(presentCard({...page, name: 'Visa Signature'}, 'en-US').name, 'Visa Signature', 'no choice: the cleaned page name, as before');
});
