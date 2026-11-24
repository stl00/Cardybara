// #567: the credit ledger's previous-period view on a 375x812 phone, in real headless Chrome (dist/web, loopback only,
// synthetic wallet: one made-up Platinum with a made-up fee date). The step switches the window to the card year / calendar
// year before the current one and nothing sticks out of the viewport. The totals are covered in tests/credit-ledger.test.mjs.
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

const WALLET = `localStorage.setItem('cardybara-wallet-cards-v1',JSON.stringify([{id:'synthetic-plat',bank:'Amex US',name:'The Platinum Card',tail:'1234',currency:'USD',region:'US',feeDate:{month:3,day:15},identitySource:'manual'}]));`;
const init = lang => `localStorage.setItem('cardybara-language',${JSON.stringify(lang)});localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');${WALLET}`;
const TEXT = {'zh-CN': '上一期', 'zh-TW': '上一期', 'en-US': 'Previous period'};
const ledgerText = c => c.evaluate(`document.querySelector('.credit-ledger')?.innerText||''`);
const year = () => new Date().getFullYear();

for (const lang of ['zh-CN', 'zh-TW', 'en-US']) {
  test(`${lang} 375 px: the previous-period step moves the ledger window back and does not overflow`, {timeout: 90000, skip}, async () => {
    ensureBuild();
    await withPhone(async c => {
      await c.goto('/#card/synthetic-plat');
      await c.until(`document.querySelector('.credit-ledger')`, 'the credit ledger');
      const before = await ledgerText(c);
      await c.tap('.credit-ledger .ant-segmented-item', {text: TEXT[lang]});
      await c.until(`document.querySelector('.credit-ledger')?.innerText!==${JSON.stringify(before)}`, 'the window to change');
      const after = await ledgerText(c);
      const dates = s => [...s.matchAll(/\d{4}-\d{2}-\d{2}/g)].map(m => m[0]);
      assert.equal(dates(after).length >= 2, true, `${lang}: window dates shown`);
      assert.ok(dates(after)[0] < dates(before)[0], `${lang}: the window starts earlier than the current one`);
      assert.ok(Number(dates(after)[1].slice(0, 4)) <= year(), `${lang}: the window is already over`);
      // The calendar-year basis steps back to last year too.
      await c.tap('.credit-ledger .ant-segmented-item', {text: lang === 'en-US' ? 'Calendar year' : lang === 'zh-TW' ? '曆年' : '日历年'});
      await c.until(`/${year() - 1}-01-01/.test(document.querySelector('.credit-ledger')?.innerText||'')`, 'last calendar year');
      const a = await c.audit();
      assert.ok(a.scrollWidth <= PHONE.width, `${lang}: no horizontal scroll`);
      assert.deepEqual(a.overflow, [], `${lang}: nothing outside the viewport`);
    }, {init: init(lang)});
  });
}
