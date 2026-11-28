// #684: the quiet wallet list on a 375x812 phone, in real headless Chrome (dist/web, loopback only, synthetic cards).
// Every item that left the tile or the page heading is clicked to where it went.
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {PHONE, withPhone} from './helpers/mobile-chrome.mjs';
import {prepareWebTestBuild} from './helpers/web-test-build.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';
import {GUIDE_KEY} from '../src/webFirstLaunch.js';
import {tileDue} from '../src/paymentStates.js';

test('a tile tags an overdue bill before its due date, and nothing for a handled or unread one', () => {
  const card = extra => ({id: 'synthetic', bank: 'Chase', currency: 'USD', updated: '2026-11-09', ...extra});
  assert.deepEqual(tileDue(card({due: '2026-11-05', statement: 10}), [], '2026-11-10'), {kind: 'overdue'});
  assert.deepEqual(tileDue(card({due: '2026-11-20', statement: 10}), [], '2026-11-10'), {kind: 'date', date: '2026-11-20'});
  const handled = [{key: JSON.stringify(['synthetic', 'date', '2026-11-05']), at: '2026-11-09T00:00:00Z'}];
  assert.equal(tileDue(card({due: '2026-11-05', statement: 10}), handled, '2026-11-10'), null);
  assert.equal(tileDue(card({}), [], '2026-11-10'), null);
});

let buildDir;
const chrome = await findChrome().then(() => { buildDir = prepareWebTestBuild(); return withPhone(async () => true, {dir: buildDir}); }, () => false).then(ok => ok || false, err => {
  if (process.env.GITHUB_ACTIONS) throw err;
  console.warn('Chrome found but cannot start here, phone tests skipped: ' + err.message);
  return false;
});
const skip = !chrome && 'no working Chrome on this machine';

const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const card = (id, bank, name, tail) => ({id, bank, name, tail, currency: 'USD', identitySource: 'manual'});
const CARDS = [card('synthetic-a', 'Amex US', 'The Platinum Card', '1111'), card('synthetic-b', 'Chase', 'Sapphire Reserve', '2222')];
const bill = due => ({statement: 20, minimum: 10, due, at: new Date().toISOString()});
const EDITS = [{cardId: 'synthetic-a', bill: bill(day(-3))}, {cardId: 'synthetic-b', bill: bill(day(12))}];
const set = (key, value) => `localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(value)});`;
const INIT = `if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');` + set('cardybara-language', 'en-US') + set(GUIDE_KEY, '1')
  + set('cardybara-wallet-cards-v1', JSON.stringify(CARDS)) + set('cardybara-card-edits-v1', JSON.stringify(EDITS)) + '}';
const run = fn => withPhone(async c => {
  await c.goto('/#wallet');
  await c.until(`document.querySelectorAll('.wallet-card').length===2`, 'two tiles');
  await fn(c);
  assert.deepEqual(c.errors, []);
}, {dir: buildDir, init: INIT});

const TILE = tail => `[...document.querySelectorAll('.wallet-card')].find(e=>e.innerText.includes('${tail}'))`;
const ITEM = key => `.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item[data-menu-id$="-${key}"]`;
const stored = (c, key) => c.evaluate(`localStorage.getItem(${JSON.stringify(key)})||''`);
const rect = (c, expr) => c.evaluate(`(()=>{const r=(${expr}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
async function longPress(c, tail) {
  await c.evaluate(`(${TILE(tail)}).scrollIntoView({block:'center',behavior:'instant'})`);
  await c.pause(200);
  const at = await rect(c, `(${TILE(tail)}).querySelector('.card-bottom')`);
  await c.page('Emulation.setTouchEmulationEnabled', {enabled: true});
  await c.page('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [at]});
  await c.pause(800);
  await c.page('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await c.pause(300);
}

test('the tile: one tag, two lines, no visible button, no data-status line; the whole tile opens the card', {timeout: 90000, skip}, async () => {
  await run(async c => {
    const tiles = await c.evaluate(`[...document.querySelectorAll('.wallet-card')].map(e=>({
      tags:[...e.querySelectorAll('.ant-tag')].map(x=>x.innerText),
      buttons:[...e.querySelectorAll('.ant-btn')].filter(b=>+getComputedStyle(b.closest('.card-more')||b).opacity>0).length,
      text:e.querySelector('.ant-card-body').innerText}))`);
    assert.deepEqual(tiles[0].tags, ['Due date passed']);
    assert.deepEqual(tiles[1].tags, [day(12).slice(5).replace('-', '/') + ' payment']);
    for (const tile of tiles) {
      assert.equal(tile.buttons, 0);
      assert.doesNotMatch(tile.text, /Balance updated|From your bank|United States|Credit/);
    }
    assert.equal(await c.evaluate(`!!document.querySelector('.wallet-data-status,.wallet-filters .ant-select,.wallet-filters .ant-switch')`), false);
    assert.ok((await c.audit()).scrollWidth <= PHONE.width, 'no horizontal scroll');

    // A tap away from the name opens the card too.
    await c.evaluate(`(${TILE('2222')}).scrollIntoView({block:'center',behavior:'instant'})`);
    await c.pause(300);
    const at = await rect(c, `(${TILE('2222')}).querySelector('.card-cover')`);
    for (const type of ['mousePressed', 'mouseReleased']) await c.page('Input.dispatchMouseEvent', {type, ...at, button: 'left', clickCount: 1});
    await c.until(`document.querySelector('.ant-drawer-open')?.innerText.includes('2222')`, 'the card detail');
    // Region, and where the figures came from, are in the detail.
    assert.ok((await c.text()).includes('United States'));
    await c.tap('.ant-drawer-open .card-data-source .ant-collapse-header');
    await c.until(`document.querySelector('.card-data-source .source-note')`, 'the data source');
    const source = await c.evaluate(`document.querySelector('.card-data-source').innerText`);
    assert.doesNotMatch(source, /Balance updated/, 'no read date for a balance that was never read');
    assert.match(source, /artwork/i);

    // Favorite and hide are in the detail's menu as well.
    await c.tap('.ant-drawer-footer .more-menu-trigger');
    await c.until(`document.querySelector('${ITEM('favorite')}')`, 'the detail menu');
    await c.tap(ITEM('favorite'));
    await c.until(`localStorage.getItem('cardybara-favorites')?.includes('synthetic-b')`, 'the favorite stored');
  });
});

test('long press and the keyboard reach favorite and hide without opening the card', {timeout: 90000, skip}, async () => {
  await run(async c => {
    await longPress(c, '1111');
    await c.until(`document.querySelector('${ITEM('favorite')}')`, 'the menu after a long press');
    assert.equal(await c.evaluate(`!!document.querySelector('.ant-drawer-open')`), false, 'the card did not open');
    await c.tap(ITEM('favorite'));
    await c.until(`localStorage.getItem('cardybara-favorites')?.includes('synthetic-a')`, 'the favorite stored');
    assert.equal(await c.evaluate(`!!document.querySelector('.ant-drawer-open')`), false);

    // The ⋯ is focusable and shows when focused.
    await c.evaluate(`(${TILE('2222')}).querySelector('.more-menu-trigger').focus()`);
    assert.equal(await c.evaluate(`getComputedStyle((${TILE('2222')}).querySelector('.card-more')).opacity`), '1');
    assert.match(await c.evaluate(`(${TILE('2222')}).querySelector('.more-menu-trigger').getAttribute('aria-label')`), /More actions for Sapphire Reserve/);
    await c.evaluate(`document.activeElement.click()`);
    await c.until(`document.querySelector('${ITEM('hide')}')`, 'the menu');
    await c.tap(ITEM('hide'));
    await c.until(`document.querySelector('.hidden-cards')`, 'the hidden group');
    assert.match(await stored(c, 'cardybara-card-edits-v1'), /"hidden":true/);
  });
});

test('filters, the page explanations and the wallet record line are each one tap away', {timeout: 90000, skip}, async () => {
  await run(async c => {
    await c.tap('.page-heading .info-tip');
    await c.until(`document.body.innerText.includes('Find cards by country')`, 'the subtitle');
    await c.tap('.page-heading .info-tip');
    await c.tap('.section-heading .info-tip');
    await c.until(`document.body.innerText.includes('A positive balance is debt')`, 'the source note');

    await c.tap('.wallet-filter-toggle');
    await c.until(`document.querySelectorAll('.wallet-filter-panel .ant-select').length===2`, 'region and bank');
    assert.equal(await c.evaluate(`!!document.querySelector('.wallet-filters .ant-badge-count')`), false, 'nothing active, no badge');
    await c.tap('.wallet-filter-panel .favorite-filter .ant-switch');
    await c.until(`document.querySelector('.wallet-filters .ant-badge-count')?.innerText.trim()==='1'`, 'the count badge');
    await c.until(`!document.querySelector('.wallet-card')`, 'no favorite yet');
    await c.tap('.wallet-filter-panel > .ant-btn');
    await c.until(`document.querySelectorAll('.wallet-card').length===2`, 'filters reset');
    // The badge stays while the panel is closed.
    await c.tap('.wallet-filter-panel .favorite-filter .ant-switch');
    await c.tap('.wallet-filter-toggle');
    await c.until(`!document.querySelector('.wallet-filter-panel')&&document.querySelector('.wallet-filters .ant-badge-count')`, 'closed with its badge');

    await c.evaluate(`location.hash='settings'`);
    await c.until(`document.querySelector('.settings-advanced .ant-collapse-header')`, 'Settings');
    await c.tap('.settings-advanced .ant-collapse-header');
    await c.until(`document.querySelector('.settings-advanced .wallet-data-status')`, 'the wallet record line');
    assert.match(await c.evaluate(`document.querySelector('.wallet-data-status').innerText`), /Wallet records · \d+ banks/);
  });
});
