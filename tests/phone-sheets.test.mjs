// #499: the phone More sheet's state in real headless Chrome (dist/web, synthetic wallet, loopback only): it opens and closes
// from the More tab, closes on any navigation, gives the tab bar back to a dialog that opens over it, and does not
// reopen after the window passes through the desktop layout.
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
const init = `localStorage.setItem('cardybara-language','en-US');localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');`;
const OPEN = `!!document.querySelector('.more-drawer.ant-drawer-open')`;
const state = c => c.evaluate(`({open:${OPEN},over:document.querySelector('.mobile-tabbar')?.classList.contains('is-over'),z:getComputedStyle(document.querySelector('.mobile-tabbar')||document.body).zIndex,hash:location.hash})`);
const settle = async c => { await c.pause(700); return state(c); };

test('the More sheet opens and closes from the tab, closes on navigation, and yields to a dialog', {timeout: 90000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
  ensureBuild();
  await withPhone(async c => {
    await c.goto('/#overview');
    await c.pause(500);
    await c.tap('.mobile-tabbar [data-nav-key="more"]');
    let s = await settle(c);
    assert.equal(s.open, true, 'More opens the sheet');
    assert.equal(s.z, '1001', 'the tab bar sits above the sheet mask');
    await c.tap('.mobile-tabbar [data-nav-key="more"]');
    s = await settle(c);
    assert.equal(s.open, false, 'More again closes it');
    assert.equal(s.over, false, 'the tab bar drops back once the sheet has closed');

    await c.tap('.mobile-tabbar [data-nav-key="more"]');
    await c.until(OPEN, 'the sheet');
    await c.pause(500);
    await c.evaluate(`location.hash='credits'`);
    s = await settle(c);
    assert.equal(s.open, false, 'a hash route closes the sheet');
    assert.equal(s.over, false);

    await c.tap('.mobile-tabbar [data-nav-key="more"]');
    await c.until(OPEN, 'the sheet');
    await c.pause(500);
    await c.tap('.mobile-tabbar [data-nav-key="wallet"]');
    s = await settle(c);
    assert.deepEqual([s.open, s.hash], [false, '#wallet'], 'a tab tap closes the sheet and navigates');

    await c.tap('.mobile-tabbar [data-nav-key="more"]');
    await c.until(OPEN, 'the sheet');
    await c.pause(500);
    await c.tap('.more-drawer [data-action="settings"]');
    s = await settle(c);
    assert.deepEqual([s.open, s.hash], [false, '#settings'], 'Settings in the sheet closes it');

    // A dialog opening while the sheet is up gets the screen back: the bar must not stay above its mask.
    await c.tap('.mobile-tabbar [data-nav-key="more"]');
    await c.until(OPEN, 'the sheet');
    await c.pause(500);
    await c.tap('.more-drawer .more-links .ant-btn');
    await c.until(`document.querySelector('.ant-modal-wrap:not([style*="display: none"]) .ant-modal-container')`, 'the Data sources dialog');
    s = await state(c);
    assert.equal(s.z, '30', 'with a dialog open the tab bar is back under the mask');
  }, {init});
});

test('passing through the desktop layout does not reopen the sheet', {timeout: 60000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
  ensureBuild();
  await withPhone(async c => {
    await c.goto('/#overview');
    await c.pause(500);
    await c.tap('.mobile-tabbar [data-nav-key="more"]');
    await c.until(OPEN, 'the sheet');
    await c.pause(500);
    await c.page('Emulation.setDeviceMetricsOverride', {width: 1280, height: 800, deviceScaleFactor: 1, mobile: false});
    await c.pause(600);
    assert.equal(await c.evaluate(`!!document.querySelector('.mobile-tabbar')`), false, 'no tab bar on desktop');
    await c.page('Emulation.setDeviceMetricsOverride', {...PHONE, deviceScaleFactor: 2, mobile: true});
    const s = await settle(c);
    assert.equal(s.open, false, 'the sheet stays closed back on the phone');
    assert.equal(s.over, false);
  }, {init});
});
