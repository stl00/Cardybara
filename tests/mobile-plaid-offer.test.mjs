// #581: the Overview Plaid offer on a 375x812 phone, in real headless Chrome (dist/web, loopback only, synthetic wallet).
// The gateway is an in-page stub, so no request leaves the machine. Signed-in wallet with no Plaid link: the card shows and
// its button asks the gateway for a Link session and navigates to the page it returns. With a link, dismissed, or when the
// gateway says plaid_unavailable: no card. Signed out: the button opens the sign-in sheet; a sign-in (simulated by storing
// the session the gateway would hand out) then continues into Link. The extension build never shows it (the pure condition is
// covered in tests/plaid-offer.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {PHONE, withPhone} from './helpers/mobile-chrome.mjs';
import {prepareWebTestBuild} from './helpers/web-test-build.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';
import {GUIDE_KEY} from '../src/webFirstLaunch.js';

const GATEWAY = 'https://cardybara-gateway.cardybara.workers.dev';
let buildDir;
const chrome = await findChrome().then(() => { buildDir = prepareWebTestBuild(); return withPhone(async () => true, {dir: buildDir}); }, () => false).then(ok => ok || false, err => {
  if (process.env.GITHUB_ACTIONS) throw err;
  console.warn('Chrome found but cannot start here, phone tests skipped: ' + err.message);
  return false;
});
const skip = !chrome && 'no working Chrome on this machine';

const SESSION = `window.__session=JSON.stringify({token:'cbs_'+'A'.repeat(43),expiresAt:Math.floor(Date.now()/1000)+86400,email:'synthetic.user@example.test'});`;
const WALLET = `localStorage.setItem('cardybara-wallet-cards-v1',JSON.stringify([{id:'synthetic-1',bank:'Bilt',name:'Synthetic Card',tail:'1234',currency:'USD',identitySource:'manual'}]));`;
// `cards`: what GET /v2/plaid/cards answers (an object, or a status number for an error).
const stub = (cards, link = {url: GATEWAY + '/v2/plaid/link#s=synthetic'}) => `(()=>{const real=window.fetch.bind(window);
  const json=(b,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json'}});
  window.fetch=async(url,init)=>{url=String(url);if(url.startsWith(location.origin)||url.startsWith('/'))return real(url,init);
   if(url.startsWith(${JSON.stringify(GATEWAY)})){const path=url.slice(${JSON.stringify(GATEWAY)}.length),m=(init&&init.method)||'GET';
    if(m==='GET'&&path==='/v2/plaid/cards')return ${typeof cards === 'number' ? `json({error:{code:'plaid_unavailable'}},${cards})` : `json(${JSON.stringify(cards)})`};
    if(m==='POST'&&path==='/v2/plaid/link')return json(${JSON.stringify(link)});}
   return json({},400);};})();`;
const EMPTY = {items: [], cards: []};
const LINKED = {items: [{itemId: 'item-1', institution: 'Synthetic Bank', status: 'ok', historicalComplete: true}], cards: []};
const init = (lang, {signedIn = true, cards = EMPTY, extra = ''} = {}) => `${SESSION}${signedIn ? `localStorage.setItem('cardybara-account-session-v1',window.__session);` : ''}localStorage.setItem('cardybara-language',${JSON.stringify(lang)});localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');${WALLET}${extra}${stub(cards)}`;
const offer = c => c.evaluate(`!!document.querySelector('.plaid-offer')`);
const TEXT = {'zh-CN': '连接美国信用卡（Plaid）', 'zh-TW': '連接美國信用卡（Plaid）', 'en-US': 'Connect your US credit cards (Plaid)'};
const run = (fn, opts) => withPhone(fn, {...opts, dir: buildDir, onEvent: msg => { if (msg.method === 'Page.frameRequestedNavigation') (opts.nav ??= []).push(msg.params.url); }});
const linkNav = nav => nav.filter(u => u.startsWith(GATEWAY + '/v2/plaid/link'));

for (const lang of ['zh-CN', 'zh-TW', 'en-US']) {
  test(`${lang} signed in, no Plaid link: the Overview card shows, fits the phone and its button opens Plaid Link`, {timeout: 90000, skip}, async () => {
    const opts = {init: init(lang), nav: []};
    await run(async c => {
      await c.goto('/#overview');
      await c.until(`document.querySelector('.plaid-offer')`, 'the Plaid offer');
      assert.ok((await c.text()).includes(TEXT[lang]), `${lang}: card text`);
      const a = await c.audit();
      assert.ok(a.scrollWidth <= PHONE.width, `${lang}: no horizontal scroll`);
      assert.deepEqual(a.overflow, [], `${lang}: nothing outside the viewport`);
      assert.deepEqual(a.small, [], `${lang}: controls under 44 px`);
      await c.tap('.plaid-offer .ant-btn');
      for (let i = 0; i < 100 && !linkNav(opts.nav).length; i++) await c.pause(50);
    }, opts);
    assert.equal(linkNav(opts.nav).length, 1, `${lang}: signed-in click went to the gateway's Link page`);
  });
}

test('with a Plaid link the card does not show', {timeout: 90000, skip}, async () => {
  await run(async c => {
    await c.goto('/#overview');
    await c.until(`document.querySelector('.app-header .account-avatar')`, 'the signed-in header');
    await c.pause(800);
    assert.equal(await offer(c), false);
  }, {init: init('en-US', {cards: LINKED, extra: `localStorage.setItem('cardybara-plaid-cards-v1',${JSON.stringify(JSON.stringify(LINKED))});`}), nav: []});
});

test('when the gateway reports plaid_unavailable the card goes away', {timeout: 90000, skip}, async () => {
  await run(async c => {
    await c.goto('/#overview');
    await c.until(`document.querySelector('.app-header .account-avatar')`, 'the signed-in header');
    await c.until(`!document.querySelector('.plaid-offer')`, 'the card to be withdrawn');
  }, {init: init('en-US', {cards: 503}), nav: []});
});

test('dismissing the card is remembered on this device', {timeout: 90000, skip}, async () => {
  await run(async c => {
    await c.goto('/#overview');
    await c.until(`document.querySelector('.plaid-offer .ant-alert-close-icon')`, 'the close control');
    await c.tap('.plaid-offer .ant-alert-close-icon');
    await c.until(`!document.querySelector('.plaid-offer')`, 'the card to close');
    await c.goto('/#overview');
    await c.until(`document.querySelector('.ask-card')`, 'the Overview');
    await c.pause(800);
    assert.equal(await offer(c), false, 'still dismissed after a reload');
  }, {init: init('en-US'), nav: []});
});

test('signed out: the button opens sign-in first, then continues into Plaid Link', {timeout: 90000, skip}, async () => {
  const opts = {init: init('en-US', {signedIn: false}), nav: []};
  await run(async c => {
    await c.goto('/#overview');
    await c.until(`document.querySelector('.plaid-offer')`, 'the Plaid offer');
    await c.tap('.plaid-offer .ant-btn');
    await c.until(`document.querySelector('.account-drawer.ant-drawer-open .account-sheet')`, 'the account sheet');
    assert.equal(linkNav(opts.nav).length, 0, 'nothing opens before sign-in');
    // The sign-in itself is the account flow's own test; here the session it would store arrives.
    await c.evaluate(`localStorage.setItem('cardybara-account-session-v1',window.__session);window.dispatchEvent(new Event('cardybara-account-change'))`);
    for (let i = 0; i < 100 && !linkNav(opts.nav).length; i++) await c.pause(50);
  }, opts);
  assert.equal(linkNav(opts.nav).length, 1, 'after sign-in the Link page opened');
});

// Owner 2026-11-25: the wallet's "Add card" button is the Plaid entry itself, not only the panel in Settings.
test('the wallet "Add card" button keeps typing a card in as the menu beside it', {timeout: 90000, skip}, async () => {
  const opts = {init: init('en-US'), nav: []};
  await run(async c => {
    await c.goto('/#wallet');
    await c.until(`document.querySelector('.page-heading .add-card-plaid')`, 'the Plaid add-card button');
    assert.deepEqual((await c.audit()).small, [], 'controls under 44 px');
    await c.tap('.page-heading .add-card-more');
    await c.until(`document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item')`, 'the add-card menu');
    await c.tap('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item', {text: 'Add manually'});
    await c.until(`document.querySelector('.product-tile')`, 'the card catalogue');
  }, opts);
  assert.equal(linkNav(opts.nav).length, 0, 'the manual choice does not open Plaid');
});

test('the wallet "Add card" button itself opens Plaid Link', {timeout: 90000, skip}, async () => {
  const opts = {init: init('zh-CN'), nav: []};
  await run(async c => {
    await c.goto('/#wallet');
    await c.until(`document.querySelector('.page-heading .add-card-plaid')`, 'the Plaid add-card button');
    await c.tap('.page-heading .add-card-plaid .ant-btn', {text: '添加卡片'});
    for (let i = 0; i < 100 && !linkNav(opts.nav).length; i++) await c.pause(50);
  }, opts);
  assert.equal(linkNav(opts.nav).length, 1, 'the button went to the gateway\'s Link page');
});

test('when the gateway reports plaid_unavailable, "Add card" is the manual button again', {timeout: 90000, skip}, async () => {
  await run(async c => {
    await c.goto('/#wallet');
    await c.until(`document.querySelector('.app-header .account-avatar')`, 'the signed-in header');
    await c.until(`!document.querySelector('.add-card-plaid')`, 'the Plaid button to be withdrawn');
    await c.tap('.page-heading .ant-btn', {text: 'Add card'});
    await c.until(`document.querySelector('.product-tile')`, 'the card catalogue');
  }, {init: init('en-US', {cards: 503}), nav: []});
});
