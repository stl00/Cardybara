// #677: back from Plaid Link on a 375x812 phone, in real headless Chrome (dist/web, loopback only). The gateway is an
// in-page stub with synthetic cards; no Plaid, account service or network is used. `window.__cards` is what the stub
// answers, so the first read after "coming back" already holds the new cards, as the real gateway's does.
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {PHONE, withPhone} from './helpers/mobile-chrome.mjs';
import {prepareWebTestBuild} from './helpers/web-test-build.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';
import {GUIDE_KEY} from '../src/webFirstLaunch.js';
import {cardProducts, matchCardProduct} from '../src/productCatalog.js';

let buildDir;
const chrome = await findChrome().then(() => { buildDir = prepareWebTestBuild(); return withPhone(async () => true, {dir: buildDir}); }, () => false).then(ok => ok || false, err => {
  if (process.env.GITHUB_ACTIONS) throw err;
  console.warn('Chrome found but cannot start here, phone tests skipped: ' + err.message);
  return false;
});
const skip = !chrome && 'no working Chrome on this machine';

// A Chase product whose own catalogue name matches it and nothing else.
const KNOWN = cardProducts.find(p => p.bank === 'Chase' && p.region === 'US' && matchCardProduct({bank: 'Chase', region: 'US', name: p.name}).status === 'matched');
const READ = Math.floor(Date.parse('2026-11-18T12:00:00Z') / 1000);
const card = (n, name, extra) => ({itemId: 'item_1', accountId: 'acc_' + n, institution: 'Chase', name, mask: String(n).repeat(4), subtype: 'credit card', currency: 'USD',
  balance: 10 * n, statementBalance: 5 * n, minimumPayment: 1, dueDate: '2026-12-26', aprs: [], readAt: READ, ...extra});
const answer = cards => ({items: [{itemId: 'item_1', institution: cards[0]?.institution || 'Chase', status: 'ok', historicalComplete: true}], cards});
const MATCHED = answer([card(1, KNOWN.name)]);
const UNKNOWN = answer([card(2, 'Synthetic Mystery Card')]);
const NO_CATALOG = answer([card(3, 'Synthetic Platypus Card', {institution: 'Synthetic Platypus Bank'})]);
const THREE = answer([card(4, 'Synthetic Alpha'), card(5, 'Synthetic Beta'), card(6, KNOWN.name)]);
const NOTHING = {items: [], cards: []};

const init = (plaid, lang = 'en-US') => `(()=>{const real=window.fetch.bind(window);const J=(s,b)=>new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json'}});
window.__cards=${JSON.stringify(plaid)};
window.fetch=async(url,init={})=>{url=String(url);const i=url.indexOf('/v2/');if(i<0)return real(url,init);
 if(url.slice(i).split('?')[0]==='/v2/plaid/cards')return J(200,window.__cards);
 return J(404,{error:{code:'not_found'}});};
if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');
 localStorage.setItem('cardybara-language',${JSON.stringify(lang)});localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');
 localStorage.setItem('cardybara-account-session-v1',JSON.stringify({token:'cbs_'+'A'.repeat(43),expiresAt:Math.floor(Date.now()/1000)+86400,email:'synthetic.user@example.test'}));}})();`;

const run = (plaid, fn, lang) => withPhone(fn, {dir: buildDir, init: init(plaid, lang)});
const DRAWER = '.ant-drawer-open .ant-drawer-section';
const PICKER = '.product-picker-modal';
const shown = selector => `[...document.querySelectorAll(${JSON.stringify(selector)})].some(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden')`;
const choices = c => c.evaluate(`JSON.parse(localStorage.getItem('cardybara-card-products-v1')||'[]')`);
const shot = (c, name) => process.env.CARDYBARA_SHOTS && c.pause(600).then(() => c.shot(join(process.env.CARDYBARA_SHOTS, name + '.png')));

test('one matched card: its drawer opens with "Added" and no question, zero taps', {timeout: 90000, skip}, async () => {
  await run(MATCHED, async c => {
    await c.goto('/#plaid-added');
    await c.until(`document.querySelector('${DRAWER} .plaid-added-banner')`, 'the new card drawer', 15000);
    await c.pause(600);
    assert.equal(await c.evaluate(shown(PICKER)), false, 'no picker');
    assert.equal(await c.evaluate(`!!document.querySelector('.plaid-keep')`), false, 'no question');
    assert.ok(await c.evaluate(`document.querySelector('${DRAWER} .card-product-picker').innerText.includes('Recognised automatically')||!!document.querySelector('${DRAWER} .card-product-picker .ant-tag-success')`), 'confirmed type');
    assert.equal(await c.evaluate(`location.hash`), '#wallet');
    await shot(c, 'matched');
    assert.deepEqual(c.errors, []);
  });
});

test('one unknown card: the picker is already open and one tap chooses a type', {timeout: 90000, skip}, async () => {
  await run(UNKNOWN, async c => {
    await c.goto('/#plaid-added');
    await c.until(`document.querySelector('${PICKER} .product-tile')`, 'the picker over the drawer', 15000);
    await shot(c, 'unknown');
    const audit = await c.audit();
    assert.ok(audit.scrollWidth <= PHONE.width, 'no horizontal scroll');
    assert.notEqual(await c.evaluate(`document.activeElement?.tagName`), 'INPUT', 'no keyboard');
    await c.tap(`${PICKER} .product-tile`);
    await c.until(`!(${shown(PICKER)})&&!document.querySelector('.plaid-keep')`, 'the question answered');
    assert.equal((await choices(c)).length, 1);
  });
});

test('one unknown card: one tap keeps it as it is', {timeout: 90000, skip}, async () => {
  await run(UNKNOWN, async c => {
    await c.goto('/#plaid-added');
    await c.until(`document.querySelector('${PICKER} .product-picker-keep')`, 'keep as is', 15000);
    await c.tap(`${PICKER} .product-picker-keep`);
    await c.until(`!(${shown(PICKER)})&&!document.querySelector('.plaid-keep')`, 'the question answered');
    assert.deepEqual(await choices(c), []);
    assert.equal(await c.evaluate(`!!document.querySelector('${DRAWER}')`), true, 'the card stays open');
  });
});

test('one card of an issuer with no catalogue products: no empty picker, "Keep as is" on the drawer', {timeout: 90000, skip}, async () => {
  await run(NO_CATALOG, async c => {
    await c.goto('/#plaid-added');
    await c.until(`document.querySelector('${DRAWER} .plaid-keep')`, 'the drawer with keep as is', 15000);
    assert.equal(await c.evaluate(shown(PICKER)), false);
    await c.tap('.plaid-keep');
    await c.until(`!document.querySelector('.plaid-keep')`, 'the question answered');
  });
});

test('three cards: the wallet highlights them and one strip steps through those without a type', {timeout: 120000, skip}, async () => {
  await run(THREE, async c => {
    await c.goto('/#plaid-added');
    await c.until(`document.querySelector('.plaid-landing-types')`, 'the strip', 15000);
    assert.equal(await c.evaluate(`!!document.querySelector('${DRAWER}')`), false, 'no drawer on its own');
    assert.equal(await c.evaluate(`document.querySelectorAll('.wallet-card.is-new').length`), 3);
    assert.ok((await c.text()).includes('2 card(s) need a card type'));
    const audit = await c.audit();
    assert.ok(audit.scrollWidth <= PHONE.width, 'no horizontal scroll');
    await shot(c, 'three');
    await c.tap('.plaid-landing-types .ant-btn');
    await c.until(`document.querySelector('${PICKER} .product-picker-keep')`, 'the first picker');
    await c.tap(`${PICKER} .product-picker-keep`);
    // The next card's drawer and picker take over; choosing there ends the stepping.
    await c.until(`document.querySelector('${DRAWER}')?.innerText.includes('Synthetic Beta')&&(${shown(PICKER + ' .product-tile')})`, 'the second picker');
    await c.pause(600);
    await c.tap(`${PICKER} .product-tile`);
    await c.until(`!document.querySelector('${DRAWER}')&&!document.querySelector('.plaid-landing-types')`, 'back on the wallet, strip gone');
    assert.equal((await choices(c)).length, 1);
    assert.deepEqual(c.errors, []);
  });
});

test('nothing read yet: the wallet shows a "still reading" notice, never the settings page, and lands when cards arrive', {timeout: 120000, skip}, async () => {
  await run(NOTHING, async c => {
    await c.goto('/#plaid-added');
    await c.until(`document.querySelector('.plaid-landing')`, 'the reading notice');
    await c.until(`document.querySelector('.plaid-landing-late')`, 'the still-reading notice', 25000);
    assert.equal(await c.evaluate(`location.hash`), '#wallet');
    assert.ok((await c.text()).includes('Still reading your cards'));
    assert.equal(await c.evaluate(`!!document.querySelector('.plaid-cards')`), false, 'not the settings page');
    await shot(c, 'late');
    await c.evaluate(`window.__cards=${JSON.stringify(MATCHED)}`);
    await c.until(`document.querySelector('${DRAWER} .plaid-added-banner')`, 'the late card opens', 15000);
  });
});

test('old gateway hash #settings still lands on the settings page, adds the card and asks nothing', {timeout: 90000, skip}, async () => {
  await run(UNKNOWN, async c => {
    await c.goto('/#settings');
    await c.until(`JSON.parse(localStorage.getItem('cardybara-wallet-cards-v1')||'[]').length===1`, 'the card added', 15000);
    await c.pause(800);
    assert.equal(await c.evaluate(`location.hash`), '#settings');
    assert.equal(await c.evaluate(`!!document.querySelector('.plaid-cards')`), true);
    assert.equal(await c.evaluate(`!!document.querySelector('${DRAWER}')||!!document.querySelector('.plaid-landing')`), false);
  });
});

for (const lang of ['zh-CN', 'zh-TW']) {
  test(`${lang}: the unknown-card landing is translated`, {timeout: 90000, skip}, async () => {
    await run(UNKNOWN, async c => {
      await c.goto('/#plaid-added');
      await c.until(`document.querySelector('${PICKER} .product-picker-keep')`, 'keep as is', 15000);
      assert.equal(await c.evaluate(`document.querySelector('${PICKER} .product-picker-keep').innerText.replace(/\\s/g,'')`), lang === 'zh-CN' ? '保持现状' : '保持現狀');
    }, lang);
  });
}
