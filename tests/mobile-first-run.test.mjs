// #377: the first-run path on a 375x812 phone, in real headless Chrome (dist/web, synthetic wallet, loopback only):
// empty wallet -> add a card from the catalogue -> set its fee date -> card detail -> credits -> enter a due date.
// At every step: no horizontal scroll, nothing sticking out of the viewport, every control at least 44 px, and any
// modal or drawer inside the screen. Screenshots: CARDYBARA_SHOTS=<dir> node --test tests/mobile-first-run.test.mjs
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
// The test reads the real web build; build it when it is missing or older than the source.
function ensureBuild() {
  const index = join(WEB_DIR, 'index.html');
  if (existsSync(index) && statSync(index).mtimeMs >= Math.max(newest(join(root, 'src')), statSync(join(root, 'index.html')).mtimeMs)) return;
  const built = spawnSync('npm', ['run', 'build:web'], {cwd: root, encoding: 'utf8'});
  assert.equal(built.status, 0, 'npm run build:web failed:\n' + built.stdout.slice(-2000) + built.stderr.slice(-2000));
}
// Chrome must be found AND able to start. Some sandboxes ship a Chrome that aborts (SIGABRT) at launch: skip there with the
// reason, but never skip on GitHub Actions, where a broken Chrome has to fail the build (the local verifier sandbox also sets CI, so CI alone is not the signal).
const chrome = await findChrome().then(() => { ensureBuild(); return withPhone(async () => true); }, () => false).then(ok => ok || false, err => {
  if (process.env.GITHUB_ACTIONS) throw err;
  console.warn('Chrome found but cannot start here, phone tests skipped: ' + err.message);
  return false;
});
const shots = process.env.CARDYBARA_SHOTS ? resolve(process.env.CARDYBARA_SHOTS) : null;

// Every step of the path, with what must be on screen; run once per language because the long strings are what overflow.
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
  await c.goto('/');
  await c.until(`document.querySelector('.empty-wallet-manual')`, 'the empty wallet');
  await check('empty-wallet');
  await c.tap('.empty-wallet-manual button');
  await c.until(`document.querySelector('.product-tile')`, 'the card catalogue');
  assert.equal((await check('catalogue')).modals.length, 1);
  await c.tap('.product-tile');
  await c.until(`document.querySelector('.add-card-tail')`, 'the add-card form');
  await c.type('.add-card-tail', '1234');
  const month = await c.evaluate(`[...document.querySelectorAll('.add-card-form .ant-input-number-input')].length`);
  assert.equal(month, 3, 'the fee date has month, day and year inputs');
  await c.evaluate(`document.querySelectorAll('.add-card-form .ant-input-number-input')[0].focus()`);
  await c.page('Input.insertText', {text: '12'});
  await c.evaluate(`document.querySelectorAll('.add-card-form .ant-input-number-input')[1].focus()`);
  await c.page('Input.insertText', {text: '15'});
  await check('add-card-form');
  await c.tap('.add-card-modal .ant-btn-primary');
  await c.until(`!document.querySelector('.add-card-modal') && document.querySelector('.payment-assistant')`, 'the saved card');
  await c.pause(600);
    await check('card-saved');
  await c.tap('.mobile-tabbar [data-nav-key="wallet"]');
  await c.until(`document.querySelector('.card-title')`, 'the card list');
  await check('card-list');
  await c.tap('.card-title');
  await c.until(`document.querySelector('.ant-drawer .manual-bill-edit')`, 'the card detail');
  await check('card-detail');
  const credits = await c.evaluate(`(()=>{const e=document.querySelector('.ant-drawer .ant-drawer-body');const h=[...e.querySelectorAll('*')].find(x=>x.children.length===0&&/Credit/.test(x.textContent));if(h)h.scrollIntoView({block:'center',behavior:'instant'});return !!h})()`);
  assert.ok(credits, 'the card detail shows the Credit section');
  await check('card-credits');
  await c.tap('.ant-drawer .manual-bill-edit');
  await c.until(`document.querySelector('.manual-bill-modal input#due')`, 'the statement form');
  await c.setValue('.manual-bill-modal input#due', '2030-01-15');
  await check('due-date');
  await c.tap('.manual-bill-modal .ant-btn-primary');
  await c.until(`!document.querySelector('.manual-bill-modal .ant-modal-container')`, 'the statement form to close');
  await c.pause(400);
  const text = await c.text();
  assert.ok(text.includes('2030-01-15'), `${lang}: the due date shows on the card`);
  await check('due-date-saved');
  return log;
}

for (const lang of ['zh-CN', 'en-US']) {
  test(`first run at 375 px (${lang}): add a card, fee date, detail, credits, due date`, {timeout: 120000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
    ensureBuild();
    const steps = await withPhone(c => walk(c, lang), {init: `localStorage.setItem('cardybara-language',${JSON.stringify(lang)});localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');`});
    assert.equal(steps.length, 9);
  });
}

test('the first-launch guide fits a 375 px phone', {timeout: 60000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
  ensureBuild();
  await withPhone(async c => {
    await c.goto('/');
    await c.until(`document.querySelector('.web-guide .ant-modal-container')`, 'the guide');
    await c.pause(500);
    for (let step = 0; step < 4; step++) {
      const a = await c.audit();
      assert.ok(a.scrollWidth <= PHONE.width, `guide step ${step + 1}: horizontal scroll`);
      assert.deepEqual(a.overflow, [], `guide step ${step + 1}: elements outside the viewport`);
      assert.deepEqual(a.small, [], `guide step ${step + 1}: controls under 44 px`);
      for (const m of a.modals) assert.ok(m.l >= 0 && m.r <= PHONE.width && m.t >= 0 && m.b <= PHONE.height + 1, `guide step ${step + 1}: outside the screen`);
      await c.tap('.web-guide .guide-next');
      await c.pause(350);
    }
  }, {init: `localStorage.setItem('cardybara-language','zh-CN');`});
});
