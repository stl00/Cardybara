// #568: the wallet-wide credit summary on the Credits page at 375x812, in real headless Chrome (dist/web, loopback only,
// synthetic wallet: a made-up Platinum and Reserve with fee dates, one HKD-booked card and one card without a fee date).
// Nothing sticks out of the viewport. The totals are covered in tests/wallet-ledger.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PHONE, withPhone} from './helpers/mobile-chrome.mjs';
import {prepareWebTestBuild} from './helpers/web-test-build.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';
import {GUIDE_KEY} from '../src/webFirstLaunch.js';

let buildDir;
const chrome = await findChrome().then(() => { buildDir = prepareWebTestBuild(); return withPhone(async () => true, {dir: buildDir}); }, () => false).then(ok => ok || false, err => {
  if (process.env.GITHUB_ACTIONS) throw err;
  console.warn('Chrome found but cannot start here, phone tests skipped: ' + err.message);
  return false;
});
const skip = !chrome && 'no working Chrome on this machine';

const card = (id, bank, name, tail) => ({id, bank, name, tail, identitySource: 'manual'});
const CARDS = [
  card('synthetic-plat', 'Amex US', 'The Platinum Card', '1111'),
  card('synthetic-csr', 'Chase', 'Sapphire Reserve', '2222'),
  card('synthetic-hkd', 'Amex HK', 'The Platinum Card', '3333'),
  card('synthetic-bare', 'Amex US', 'The Platinum Card', '4444')
];
// Fee dates are a card edit, applied on top of the card; the last card gets none.
const EDITS = [['synthetic-plat', {month: 3, day: 15}], ['synthetic-csr', {month: 8, day: 1}], ['synthetic-hkd', {month: 6, day: 1}]].map(([cardId, feeDate]) => ({cardId, feeDate}));
const WALLET = `localStorage.setItem('cardybara-wallet-cards-v1',${JSON.stringify(JSON.stringify(CARDS))});localStorage.setItem('cardybara-card-edits-v1',${JSON.stringify(JSON.stringify(EDITS))});`;
const init = lang => `localStorage.setItem('cardybara-language',${JSON.stringify(lang)});localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');${WALLET}`;
const HINT = {'zh-CN': '填年费日', 'zh-TW': '填年費日', 'en-US': 'fee date'};
const summary = c => c.evaluate(`document.querySelector('.wallet-ledger')?.innerText||''`);

for (const lang of ['zh-CN', 'zh-TW', 'en-US']) {
  test(`${lang} 375 px: the wallet credit summary lists each card, totals per currency and does not overflow`, {timeout: 90000, skip}, async () => {
    await withPhone(async c => {
      await c.goto('/#credits');
      await c.until(`document.querySelector('.wallet-ledger')`, 'the wallet credit summary');
      const text = await summary(c);
      assert.equal((await c.evaluate(`document.querySelectorAll('.wallet-ledger-row').length`)), 4, `${lang}: one row per card`);
      assert.ok(text.includes('US$') && text.includes('HK$'), `${lang}: both currencies appear`);
      assert.equal((await c.evaluate(`document.querySelectorAll('.wallet-ledger-totals > div').length`)), 2, `${lang}: one total per currency`);
      assert.ok(text.toLowerCase().includes(HINT[lang].toLowerCase()), `${lang}: the undated card shows the fee-date hint`);
      const a = await c.audit();
      assert.ok(a.scrollWidth <= PHONE.width, `${lang}: no horizontal scroll`);
      assert.deepEqual(a.overflow, [], `${lang}: nothing outside the viewport`);
    }, {dir: buildDir, init: init(lang)});
  });
}
