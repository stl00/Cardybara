// #501: on a 375x812 phone the capybara pet stays clear of the bottom tab bar, in real headless Chrome (dist/web, synthetic
// wallet, loopback only): its default spot, a saved spot from an older layout (clamped on load), and keyboard moves can never
// put it on the bar; it hides on the assistant page and comes back elsewhere; it steps aside while the More sheet is open.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WEB_DIR, withPhone} from './helpers/mobile-chrome.mjs';
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
const base = `localStorage.setItem('cardybara-language','en-US');localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');`;
// The gap between the pet's bottom edge and the tab bar's top edge (negative: they overlap); null when one is missing.
const gap = c => c.evaluate(`(()=>{const p=document.querySelector('.capy-companion,.capy-restore'),b=document.querySelector('.mobile-tabbar');if(!p||!b)return null;return Math.round(b.getBoundingClientRect().top-p.getBoundingClientRect().bottom)})()`);

test('default spot, saved spot and keyboard moves all keep the pet at least 8 px above the tab bar', {timeout: 60000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
  ensureBuild();
  await withPhone(async c => {
    await c.goto('/#overview');
    await c.pause(800);
    assert.ok((await gap(c)) >= 8, `default spot: ${await gap(c)} px above the bar`);
    for (let i = 0; i < 40; i++) await c.evaluate(`document.querySelector('.capy-pet-button').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);
    await c.pause(200);
    assert.ok((await gap(c)) >= 8, `after moving down with the keyboard: ${await gap(c)} px`);
  }, {init: base});
  // A spot saved by the old layout, right where the tab bar now is.
  await withPhone(async c => {
    await c.goto('/#overview');
    await c.pause(900);
    assert.ok((await gap(c)) >= 8, `a saved spot on the bar is clamped on load: ${await gap(c)} px`);
  }, {init: base + `localStorage.setItem('cardybara-pet-v1',JSON.stringify({hidden:false,feeds:0,pos:{x:200,y:760}}));`});
  // The rested pet's restore button too.
  await withPhone(async c => {
    await c.goto('/#overview');
    await c.pause(800);
    assert.equal(await c.evaluate(`!!document.querySelector('.capy-restore')`), true);
    assert.ok((await gap(c)) >= 8, `restore button: ${await gap(c)} px above the bar`);
  }, {init: base + `localStorage.setItem('cardybara-pet-v1',JSON.stringify({hidden:true,feeds:0,pos:null}));`});
});

test('the pet hides on the assistant page and while the More sheet is open, and comes back', {timeout: 60000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
  ensureBuild();
  await withPhone(async c => {
    const shown = () => c.evaluate(`(()=>{const p=document.querySelector('.capy-companion,.capy-restore');return !!p&&getComputedStyle(p).visibility!=='hidden'})()`);
    await c.goto('/#overview');
    await c.pause(800);
    assert.equal(await shown(), true, 'on overview');
    await c.tap('.mobile-tabbar [data-nav-key="advisor"]');
    await c.pause(500);
    assert.equal(await shown(), false, 'hidden on the assistant page');
    await c.tap('.mobile-tabbar [data-nav-key="credits"]');
    await c.pause(500);
    assert.equal(await shown(), true, 'back on credits');
    assert.ok((await gap(c)) >= 8);
    await c.tap('.mobile-tabbar [data-nav-key="more"]');
    await c.pause(700);
    assert.equal(await shown(), false, 'steps aside while the More sheet is open');
  }, {init: base});
});
