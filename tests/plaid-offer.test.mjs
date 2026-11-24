// #581: the Overview Plaid offer's decisions and the guide's Plaid step. Pure functions; the real screens are in
// tests/mobile-plaid-offer.test.mjs. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PLAID_OFFER_KEY,dismissOffer,offerDismissed,showPlaidOffer} from '../src/plaidOffer.js';
import {GUIDE_STEPS,guideSteps} from '../src/webFirstLaunch.js';
import {translations} from '../src/i18n/index.js';

const base = {collects: false, hasPlaid: true, gatewayConfigured: true, linked: false, dismissed: false, unavailable: false};
const store = () => {const m = new Map(); return {getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), m};};

test('the offer shows on the web with a gateway and no Plaid link, and nowhere else', () => {
  assert.equal(showPlaidOffer(base), true);
  assert.equal(showPlaidOffer({...base, collects: true}), false, 'the extension collects from bank pages');
  assert.equal(showPlaidOffer({...base, hasPlaid: false}), false);
  assert.equal(showPlaidOffer({...base, gatewayConfigured: false}), false);
  assert.equal(showPlaidOffer({...base, linked: true}), false, 'a Plaid link exists');
  assert.equal(showPlaidOffer({...base, unavailable: true}), false, 'the gateway said plaid_unavailable');
  assert.equal(showPlaidOffer({...base, dismissed: true}), false);
});

test('dismissal is kept in local storage and survives a blocked store', () => {
  const s = store();
  assert.equal(offerDismissed(s), false);
  dismissOffer(s);
  assert.equal(s.m.get(PLAID_OFFER_KEY), '1');
  assert.equal(offerDismissed(s), true);
  const blocked = {getItem() {throw Error('denied');}, setItem() {throw Error('denied');}};
  assert.equal(offerDismissed(blocked), false);
  assert.doesNotThrow(() => dismissOffer(blocked));
});

test('the guide gets a Plaid step before the optional features only when Plaid is offered', () => {
  assert.deepEqual(guideSteps({plaid: false}), GUIDE_STEPS);
  assert.deepEqual(guideSteps(), GUIDE_STEPS);
  assert.deepEqual(guideSteps({plaid: true}), ['what', 'where', 'keep', 'plaid', 'extras']);
});

test('the new strings exist in English and Traditional Chinese and are wired in the app', () => {
  const src = readFileSync(new URL('../src/PlaidOfferCard.jsx', import.meta.url), 'utf8');
  const keys = [...src.matchAll(/t\('([^']+)'\)/g)].map(m => m[1]).concat(['美国信用卡自动导入', '如果你有美国信用卡，可以登录后通过 Plaid 连接，自动读取余额、账单金额、最低还款和还款日。']);
  for (const k of keys) for (const lang of ['en-US', 'zh-TW']) assert.ok(translations[lang][k], `${lang}: ${k}`);
  const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(main, /<PlaidOfferCard gateway=\{GATEWAY_ORIGIN\} collects=\{collects\} gatewayConfigured=\{gatewayConfigured\}\/>/);
});
