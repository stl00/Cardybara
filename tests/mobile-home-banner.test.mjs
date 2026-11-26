// #578: the Home Screen app's sign-in banner, in real headless Chrome (dist/web, loopback only). Standalone is emulated with
// `display-mode: standalone`. Signed out: the banner shows on Overview and its button opens the account sheet. Signed in, or in a
// normal tab: no banner. No network: the gateway is an in-page stub. Synthetic data only.
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
const SESSION = `localStorage.setItem('cardybara-account-session-v1',JSON.stringify({token:'cbs_'+'A'.repeat(43),expiresAt:Math.floor(Date.now()/1000)+86400,email:'synthetic.user@example.test'}));`;
const init = (lang, signedIn, installed = true) => `${installed ? STANDALONE : ''}${NO_NETWORK}localStorage.setItem('cardybara-language',${JSON.stringify(lang)});localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');${signedIn ? SESSION : ''}`;
// Chrome's media emulation has no display-mode feature, so the query is answered in the page: `(display-mode: standalone)` matches.
const STANDALONE = `(()=>{const real=window.matchMedia.bind(window);window.matchMedia=q=>/display-mode:\\s*standalone/.test(q)?{...real('all'),matches:true,media:q}:real(q);})();`;
const banner = c => c.evaluate(`!!document.querySelector('.home-screen-banner')`);
const BANNER_TEXT = {'zh-CN': '这个主屏幕 App 和 Safari 是分开的', 'en-US': 'This Home Screen app is separate from Safari'};

for (const lang of ['zh-CN', 'en-US']) {
  test(`${lang} standalone, signed out: the sign-in banner shows on Overview and opens the account sheet`, {timeout: 90000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
    await withPhone(async c => {
      await c.goto('/#overview');
      await c.until(`document.querySelector('.home-screen-banner')`, 'the Home Screen banner');
      assert.ok((await c.text()).includes(BANNER_TEXT[lang]), `${lang}: banner text`);
      const a = await c.audit();
      assert.ok(a.scrollWidth <= PHONE.width, `${lang}: no horizontal scroll`);
      assert.deepEqual(a.overflow, [], `${lang}: nothing outside the viewport`);
      await c.tap('.home-screen-banner .ant-btn');
      await c.until(`document.querySelector('.account-drawer.ant-drawer-open .account-sheet')`, 'the account sheet');
      assert.equal(await banner(c), false, `${lang}: the banner is gone once used (one-time)`);
    }, {dir: buildDir, init: init(lang, false)});
  });
  test(`${lang} standalone, signed in: no banner`, {timeout: 90000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
    await withPhone(async c => {
      await c.goto('/#overview');
      await c.until(`document.querySelector('.app-header .account-avatar')`, 'the signed-in avatar');
      await c.pause(800);
      assert.equal(await banner(c), false, `${lang}: signed in shows no banner`);
    }, {dir: buildDir, init: init(lang, true)});
  });
}
test('a normal browser tab, signed out: no banner', {timeout: 90000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
  await withPhone(async c => {
    await c.goto('/#overview');
    await c.until(`document.querySelector('.app-header .account-entry')`, 'the header');
    await c.pause(800);
    assert.equal(await banner(c), false);
  }, {dir: buildDir, init: init('en-US', false, false)});
});
