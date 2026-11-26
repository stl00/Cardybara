// #572: the backup reminder at 375 px in real headless Chrome (dist/web, loopback only), synthetic wallet. It shows without
// overflow and "Export now" runs the existing export, which records the export day and hides the notice.
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
const NO_NETWORK = `(()=>{const real=window.fetch.bind(window);window.fetch=async(url,init)=>{url=String(url);if(url.startsWith(location.origin)||url.startsWith('/'))return real(url,init);return new Response('{}',{status:400,headers:{'Content-Type':'application/json'}});};})();`;
const WALLET = `localStorage.setItem('cardybara-wallet-cards-v1',JSON.stringify([{id:'synthetic-1',bank:'Bilt',name:'Synthetic Card',tail:'1234',currency:'USD',identitySource:'manual'}]));localStorage.setItem('cardybara-backup-nudge-v1',JSON.stringify({firstCardAt:Date.now()-10*86400000}));`;
const init = lang => `${NO_NETWORK}localStorage.setItem('cardybara-language',${JSON.stringify(lang)});localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');${WALLET}`;
const TEXT = {'zh-CN': '现在导出', 'zh-TW': '現在匯出', 'en-US': 'Export now'};

for (const lang of ['zh-CN', 'zh-TW', 'en-US']) {
  test(`${lang} 375 px: the backup notice shows without overflow and Export now exports`, {timeout: 90000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
    await withPhone(async c => {
      await c.goto('/#wallet');
      await c.until(`document.querySelector('.backup-nudge')`, 'the backup notice');
      assert.ok((await c.text()).includes(TEXT[lang]));
      const a = await c.audit();
      assert.ok(a.scrollWidth <= PHONE.width, `${lang}: no horizontal scroll`);
      assert.deepEqual(a.overflow, [], `${lang}: nothing outside the viewport`);
      await c.tap('.backup-nudge .ant-btn-primary');
      await c.until(`localStorage.getItem('cardybara-last-export-v1')`, 'the export day recorded');
      await c.until(`!document.querySelector('.backup-nudge')`, 'the notice gone after export');
    }, {dir: buildDir, init: init(lang)});
  });
}
test('Later hides the notice', {timeout: 90000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
  await withPhone(async c => {
    await c.goto('/#wallet');
    await c.until(`document.querySelector('.backup-nudge')`, 'the backup notice');
    await c.tap('.backup-nudge .ant-btn:not(.ant-btn-primary)');
    await c.until(`!document.querySelector('.backup-nudge')`, 'the notice gone after Later');
    assert.equal(await c.evaluate(`localStorage.getItem('cardybara-last-export-v1')`), null);
  }, {dir: buildDir, init: init('en-US')});
});
