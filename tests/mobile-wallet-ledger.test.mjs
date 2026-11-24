// #568: the wallet-wide credit summary on the Credits page at 375x812, in real headless Chrome (dist/web, loopback only,
// synthetic wallet: a made-up Platinum and Reserve with fee dates, one HKD-booked card and one card without a fee date).
// Nothing sticks out of the viewport. The totals are covered in tests/wallet-ledger.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WEB_DIR, PHONE, withPhone} from './helpers/mobile-chrome.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';
import {GUIDE_KEY} from '../src/webFirstLaunch.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const newest = dir => readdirSync(dir, {withFileTypes: true}).reduce((m, e) => Math.max(m, e.isDirectory() ? newest(join(dir, e.name)) : statSync(join(dir, e.name)).mtimeMs), 0);
function ensureBuild() {
  const index = join(WEB_DIR, 'index.html');
  if (existsSync(index) && statSync(index).mtimeMs >= Math.max(newest(join(root, 'src')), statSync(join(root, 'index.html')).mtimeMs)) return;
  const built = spawnSync('npm', ['run', 'build:web'], {cwd: root, encoding: 'utf8'});
  assert.equal(built.status, 0, 'npm run build:web failed:\n' + built.stdout.slice(-2000) + built.stderr.slice(-2000));
}
const chrome = await findChrome().then(() => { ensureBuild(); return withPhone(async () => true); }, () => false).then(ok => ok || false, err => {
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
    ensureBuild();
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
    }, {init: init(lang)});
  });
}
