// stl00/Cardybara#680: defaults over questions, no required typing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {manualCardName, preselectedMerges} from '../src/frictionDefaults.js';
import {DEFAULT_SETTINGS, normalizeSettings} from '../src/reminders.js';
import {mergeWalletCards, newWalletCard, removeWalletCard} from '../src/walletRegistry.js';
import {refreshCard, request} from '../extension-next/protocol.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const question = (bank, ...manual) => ({bank: {id: bank}, manual: manual.map(id => ({id}))});

test('a merge question starts with its likely card selected', () => {
  assert.deepEqual(preselectedMerges([question('b1', 'm1', 'm2')]), {b1: 'm1'});
});

test('a manual card that two bank cards claim is never preselected', () => {
  assert.deepEqual(preselectedMerges([question('b1', 'm1'), question('b2', 'm1')]), {});
  assert.deepEqual(preselectedMerges([question('b1', 'm1', 'm2'), question('b2', 'm1')]), {b1: 'm2'});
});

test('a card from outside the list saves without a typed name; a catalogue card keeps its product name', () => {
  const translate = (key, [bank]) => key.replace('{0}', bank);
  const name = manualCardName({name: '  ', productId: null, bankLabel: 'Chase'}, translate);
  assert.equal(name, 'Chase 信用卡');
  assert.equal(newWalletCard({bank: 'Chase', name, tail: '1234'}, 'synthetic').name, name);
  assert.equal(manualCardName({productId: 'any', bankLabel: ''}, translate), '');
  assert.equal(manualCardName({name: ' Mine ', productId: null, bankLabel: 'Chase'}, translate), 'Mine');
});

test('no name field is required in the add-card form', () => {
  assert.match(read('src/WalletOnboarding.jsx'), /name="name"[^\n]*rules=\{\[\{max:100\}\]\}/);
});

test('turning reminders on gives bill reminders three days ahead', () => {
  assert.equal(DEFAULT_SETTINGS.enabled, false, 'still off until the user turns notifications on');
  const on = normalizeSettings({enabled: true});
  assert.equal(on.bills, true);
  assert.equal(on.billDays, 3);
});

test('the Plaid auto-add toast links to what was added, and the web chat turns AI on in place', () => {
  assert.match(read('src/main.jsx'), /plaid-added-link[^\n]*cards\.length===1\?cardHash\(cards\[0\]\.id\):'#wallet'/);
  assert.match(read('src/ChatAdvisor.jsx'), /platform\.kind==='web'\?<Button[^\n]*chat-turn-on/);
});

// #680 lets an item be dropped when tests show it hurts correctness. "Last 4 digits optional" is dropped:
// a card's bank and digits are its identity. These show what a digitless manual card would do today.
const digitless = id => ({id, bank: 'Chase', region: 'US', currency: 'USD', name: 'Chase card', tail: '', identitySource: 'manual'});

test('removing one digitless card would remove every digitless card of that bank', () => {
  const registry = [digitless('first'), digitless('second')];
  assert.deepEqual(removeWalletCard(registry, [], registry[0]).registry, []);
});

test('one digitless card would stop the whole bank refresh, cards with digits included', () => {
  const withDigits = newWalletCard({bank: 'Chase', name: 'Synthetic', tail: '1234'}, 'kept');
  const refresh = cards => ({type: 'refresh', requestId: 'run-1', banks: ['Chase'], cards: cards.map(refreshCard)});
  assert.doesNotThrow(() => request(refresh([withDigits])));
  assert.throws(() => request(refresh([withDigits, digitless('other')])), /invalid_card/);
});

test('a stored digitless card would make a cached build fail to load the whole registry', () => {
  const withDigits = newWalletCard({bank: 'Chase', name: 'Synthetic', tail: '1234'}, 'kept');
  assert.throws(() => mergeWalletCards({cards: [], connections: []}, [withDigits, digitless('other')]), /invalid_card/);
});
