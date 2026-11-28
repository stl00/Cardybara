// #686: the quiet Overview at 375 px in real headless Chrome (dist/web, loopback only), synthetic wallet. Three blocks,
// one banner, and every moved item still reachable: ⋯ on a bill, "more" chips and the amount and merchant fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import {withPhone} from './helpers/mobile-chrome.mjs';
import {prepareWebTestBuild} from './helpers/web-test-build.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';
import {INIT} from '../scripts/density-check.mjs';

let buildDir;
const chrome = await findChrome().then(() => { buildDir = prepareWebTestBuild(); return withPhone(async () => true, {dir: buildDir}); }, () => false).then(ok => ok || false, err => {
  if (process.env.GITHUB_ACTIONS) throw err;
  console.warn('Chrome found but cannot start here, phone tests skipped: ' + err.message);
  return false;
});
const skip = !chrome && 'no working Chrome on this machine';
const count = (c, selector) => c.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);

test('a bill row shows the amount and one tag; the bank link and details sit in its menu', {timeout: 90000, skip}, async () => {
  await withPhone(async c => {
    await c.goto('/#overview');
    await c.until(`document.querySelector('.payment-row')`, 'a bill row');
    assert.ok(await c.evaluate(`[...document.querySelectorAll('.payment-row')].every(r=>r.querySelectorAll('.ant-tag').length<=1)`), 'one tag per row');
    const row = await c.evaluate(`document.querySelector('.payment-row').innerText`);
    assert.match(row, /Statement \$/);
    assert.doesNotMatch(row, /Autopay|Read /, 'the other facts are behind the info tip');
    assert.equal(await c.evaluate(`!!document.querySelector('.ask-card')`), false);
    await c.tap('.payment-row .info-tip');
    await c.until(`document.querySelector('.info-tip-content')?.innerText.includes('Autopay')`, 'the facts in the info tip');
    await c.tap('.payment-row .more-menu-trigger');
    await c.until(`[...document.querySelectorAll('.ant-dropdown-menu-item')].some(i=>i.innerText.includes('Details'))`, 'the row menu');
    await c.tap('.ant-dropdown-menu-item', 'Details');
    await c.until(`document.querySelector('.ant-drawer-open')`, 'the card detail');
    assert.deepEqual(c.errors, []);
  }, {dir: buildDir, init: INIT});
});

test('the chooser shows four chips and keeps amount and merchant behind "Add details"', {timeout: 90000, skip}, async () => {
  await withPhone(async c => {
    await c.goto('/#overview');
    await c.until(`document.querySelector('.purchase-chooser .pc-result')`, 'the chooser');
    assert.equal(await count(c, '.pc-chips .pc-chip'), 4);
    assert.equal(await count(c, '.pc-merchant'), 0);
    assert.ok(await count(c, '.pc-tags .ant-tag') <= 1, 'the result has one tag');
    await c.tap('.pc-chip-more');
    await c.until(`document.querySelector('[data-category="flight"]')&&document.querySelector('[data-category="hotel"]')&&document.querySelector('[data-category="travel"]')`, 'the other chips');
    await c.tap('.pc-details-toggle');
    await c.until(`document.querySelector('.pc-merchant')&&document.querySelector('.pc-amount')`, 'the amount and merchant fields');
    assert.ok((await c.evaluate(`document.querySelector('.pc-fields').innerText+document.querySelector('.pc-fields').innerHTML`)).includes('US$')||await count(c, '.pc-currency-select')===1, 'the currency is on the amount or chosen beside it');
    assert.deepEqual(c.errors, []);
  }, {dir: buildDir, init: INIT});
});

test('Overview keeps one add button; the wallet page keeps typing a card in', {timeout: 90000, skip}, async () => {
  await withPhone(async c => {
    await c.goto('/#overview');
    await c.until(`document.querySelector('.page-heading')&&document.querySelector('.payment-row')`, 'Overview');
    assert.equal(await count(c, '.page-heading .add-card-more'), 0);
    await c.goto('/#wallet');
    await c.until(`document.querySelector('.page-heading button')`, 'the wallet heading');
    assert.deepEqual(c.errors, []);
  }, {dir: buildDir, init: INIT});
});
