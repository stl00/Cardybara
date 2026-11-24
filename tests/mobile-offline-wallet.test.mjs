// #611: a wallet with cards survives an offline reload on a 375x812 phone, in real headless Chrome (dist/web, synthetic wallet,
// loopback only). Empty wallet -> add two catalogue cards with fee dates -> enter a due date on one -> card detail shows its
// benefits -> Overview shows the next payment. Then the static server is stopped and the page reloaded: the service worker
// answers, and both cards, their fee dates and the due date are still shown. Every step runs the same layout audit as
// tests/mobile-first-run.test.mjs. Screenshots: CARDYBARA_SHOTS=<dir> node --test tests/mobile-offline-wallet.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, statSync} from 'node:fs';
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
// Same rule as the first-run test: skip when Chrome cannot start here, never on GitHub Actions.
const chrome = await findChrome().then(() => { ensureBuild(); return withPhone(async () => true); }, () => false).then(ok => ok || false, err => {
  if (process.env.GITHUB_ACTIONS) throw err;
  console.warn('Chrome found but cannot start here, phone tests skipped: ' + err.message);
  return false;
});
const shots = process.env.CARDYBARA_SHOTS ? resolve(process.env.CARDYBARA_SHOTS) : null;

// Synthetic catalogue cards (tile 1 and 2), fake last digits, fee dates (month-day) and one due date.
const CARDS = [{tile: 1, tail: '1234', month: '12', day: '15', fee: '12-15'}, {tile: 2, tail: '5678', month: '11', day: '20', fee: '11-20'}];
const DUE = '2030-01-15';
const BENEFITS = {'zh-CN': '这张卡能用什么', 'en-US': 'What this card offers'};
const DUE_LABEL = {'zh-CN': '还款日 ' + DUE, 'en-US': 'Due ' + DUE};

async function walk(c, lang) {
  const log = [];
  const check = async step => {
    await c.pause(450);
    const a = await c.audit();
    if (shots) { mkdirSync(shots, {recursive: true}); await c.shot(join(shots, `${lang}-${String(log.length + 1).padStart(2, '0')}-${step}.png`)); }
    log.push(step);
    assert.equal(a.vw, PHONE.width, `${lang} ${step}: phone width`);
    assert.ok(a.scrollWidth <= PHONE.width && a.bodyScrollWidth <= PHONE.width, `${lang} ${step}: horizontal scroll (${a.scrollWidth}px)`);
    assert.deepEqual(a.overflow, [], `${lang} ${step}: elements outside the viewport`);
    assert.deepEqual(a.small, [], `${lang} ${step}: controls under 44 px`);
    for (const m of a.modals) assert.ok(m.l >= 0 && m.r <= PHONE.width && m.t >= 0 && m.b <= PHONE.height + 1, `${lang} ${step}: ${m.cls} is outside the screen (${m.l},${m.t} to ${m.r},${m.b})`);
    return a;
  };
  const addCard = async (card, first) => {
    // The empty wallet leads with its own button; once a card exists the page header carries the same "add card" button.
    if (first) await c.tap('.empty-wallet-manual button');
    else await c.tap('.app-layout .ant-btn:not(.ant-btn-primary)', {text: lang === 'en-US' ? 'Add card' : '添加卡片'});
    await c.until(`document.querySelector('.product-tile')`, 'the card catalogue');
    const id = await c.evaluate(`document.querySelectorAll('.product-tile')[${card.tile - 1}].dataset.productId`);
    await c.tap(`.product-tile[data-product-id="${id}"]`);
    await c.until(`document.querySelector('.add-card-tail')`, 'the add-card form');
    await c.type('.add-card-tail', card.tail);
    await c.evaluate(`document.querySelectorAll('.add-card-form .ant-input-number-input')[0].focus()`);
    await c.page('Input.insertText', {text: card.month});
    await c.evaluate(`document.querySelectorAll('.add-card-form .ant-input-number-input')[1].focus()`);
    await c.page('Input.insertText', {text: card.day});
    await check(`add-card-form-${card.tail}`);
    await c.tap('.add-card-modal .ant-btn-primary');
    await c.until(`!document.querySelector('.add-card-modal')`, 'the add-card form to close');
    await c.pause(600);
    return id;
  };
  await c.goto('/');
  await c.until(`document.querySelector('.empty-wallet-manual')`, 'the empty wallet');
  await check('empty-wallet');
  await addCard(CARDS[0], true);
  await check('first-card-saved');
  await addCard(CARDS[1], false);
  await check('second-card-saved');

  await c.tap('.mobile-tabbar [data-nav-key="wallet"]');
  await c.until(`document.querySelectorAll('.card-title').length === 2`, 'two cards in the list');
  await check('card-list');
  await c.tap('.card-title');
  await c.until(`document.querySelector('.ant-drawer .manual-bill-edit')`, 'the card detail');
  assert.ok((await c.text()).includes(BENEFITS[lang]), `${lang}: the card detail lists what the card offers`);
  assert.ok((await c.text()).includes(CARDS[0].fee), `${lang}: the card detail shows its fee date`);
  await c.evaluate(`(()=>{const e=[...document.querySelectorAll('.ant-drawer *')].find(x=>x.children.length===0&&x.textContent.trim()===${JSON.stringify(BENEFITS[lang])});if(e)e.scrollIntoView({block:'center',behavior:'instant'})})()`);
  await check('card-benefits');
  await c.tap('.ant-drawer .manual-bill-edit');
  await c.until(`document.querySelector('.manual-bill-modal input#due')`, 'the statement form');
  await c.setValue('.manual-bill-modal input#due', DUE);
  await check('due-date');
  await c.tap('.manual-bill-modal .ant-btn-primary');
  await c.until(`!document.querySelector('.manual-bill-modal .ant-modal-container')`, 'the statement form to close');
  await c.pause(400);
  assert.ok((await c.text()).includes(DUE), `${lang}: the due date shows on the card`);
  await check('due-date-saved');
  await c.tap('.ant-drawer .ant-drawer-close');
  await c.until(`!document.querySelector('.ant-drawer-open')`, 'the card detail to close');
  await c.tap('.mobile-tabbar [data-nav-key="overview"]');
  await c.until(`document.querySelector('.payment-assistant')`, 'the next payment on Overview');
  assert.ok((await c.evaluate(`document.querySelector('.payment-assistant').innerText`)).includes(DUE_LABEL[lang]), `${lang}: Overview shows the next payment (${DUE_LABEL[lang]})`);
  await check('overview-next-payment');
  return log;
}

for (const lang of ['zh-CN', 'en-US']) {
  test(`two catalogue cards, then an offline reload keeps them at 375 px (${lang})`, {timeout: 180000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
    ensureBuild();
    await withPhone(async c => {
      const steps = await walk(c, lang);
      assert.equal(steps.length, 10);
      // Let the worker finish caching and take control, then take the network away for good.
      const cached = async () => c.evaluate(`navigator.serviceWorker.ready.then(async()=>{const k=await caches.keys();return k.length?(await (await caches.open(k[0])).keys()).length:0})`);
      let entries = 0;
      for (let i = 0; i < 100 && entries < 4; i++) { entries = await cached(); if (entries < 4) await c.pause(100); }
      assert.ok(entries >= 4, `${lang}: the worker cached the app shell`);
      await c.page('Page.reload');
      await c.until(`document.querySelector('#root > *')`, 'the reload with the server up');
      await c.until(`navigator.serviceWorker.controller`, 'the worker to control the page');
      await c.stopServer();
      await c.page('Page.reload');
      await c.until(`document.querySelector('#root > *')`, 'the offline reload', 15000);
      assert.equal(await c.evaluate(`!!navigator.serviceWorker.controller`), true, `${lang}: the offline reload was answered by the worker`);
      await c.until(`document.querySelector('.payment-assistant')`, 'the wallet after the offline reload');
      const home = await c.text();
      assert.ok(!home.includes(lang === 'en-US' ? 'Welcome, this is your new wallet' : '欢迎，这是你的新钱包'), `${lang}: the wallet is not empty after the offline reload`);
      assert.ok(await c.evaluate(`document.querySelector('.payment-assistant').innerText`).then(t => t.includes(DUE_LABEL[lang])), `${lang}: the due date is still shown on Overview offline`);
      await c.tap('.mobile-tabbar [data-nav-key="wallet"]');
      await c.until(`document.querySelectorAll('.card-title').length === 2`, 'both cards offline');
      const list = await c.text();
      for (const card of CARDS) assert.ok(list.includes('•••• ' + card.tail), `${lang}: card ${card.tail} is still in the wallet offline`);
      // Each card's detail still holds its fee date; the first also its due date.
      for (const [i, card] of CARDS.entries()) {
        await c.evaluate(`document.querySelectorAll('.card-title')[${i}].click()`);
        await c.until(`document.querySelector('.ant-drawer .manual-bill-edit')`, `the offline detail of ${card.tail}`);
        await c.pause(700);
        const detail = await c.evaluate(`document.querySelector('.ant-drawer').innerText`);
        assert.ok(detail.includes('•••• ' + card.tail) && detail.includes(card.fee), `${lang}: offline detail of ${card.tail} shows fee date ${card.fee}`);
        if (i === 0) assert.ok(detail.includes(DUE), `${lang}: offline detail shows the due date`);
        const a = await c.audit();
        assert.ok(a.scrollWidth <= PHONE.width, `${lang}: offline detail: no horizontal scroll`);
        assert.deepEqual(a.overflow, [], `${lang}: offline detail: elements outside the viewport`);
        await c.tap('.ant-drawer .ant-drawer-close');
        await c.until(`!document.querySelector('.ant-drawer-open')`, 'the detail to close');
      }
      assert.deepEqual(c.errors.filter(e => !/ERR_(CONNECTION_REFUSED|INTERNET_DISCONNECTED)|Failed to fetch|\/api\/parser\/status/.test(e)), [], `${lang}: no uncaught exceptions or console errors beyond the dead server`);
    }, {init: `localStorage.setItem('cardybara-language',${JSON.stringify(lang)});localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');`});
  });
}
