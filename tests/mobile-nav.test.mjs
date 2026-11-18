// #502 (epic #496): acceptance E2E for phone navigation, in real headless Chrome on dist/web with a synthetic wallet:
// 375x812 bottom tab bar + More drawer + slim header, 1280x800 sider. zh-CN, zh-TW and en-US.
// Screenshots: CARDYBARA_SHOTS=<dir> node --test tests/mobile-nav.test.mjs
//
// The checks that need an unmerged issue turn on by themselves: each one probes the build for its issue's marker (below) and
// is skipped with the issue number until it finds it. CARDYBARA_PHONE_NAV=all forces every check on (what the issue owner
// runs before closing #502); to remove a gate once its issue has landed, delete its entry from NEEDS.
//   #497 src/navigation.js exists                  (one nav config; desktop menu order)
//   #498 `.mobile-tabbar` renders below 768 px     (no sider, tab bar, one-tap tabs, composer above the bar)
//   #499 the More tab opens `.more-drawer`          (drawer targets, two-tap pages and actions)
//   #500 the header has no breadcrumb               (single-row header)
//   #501 src/CapybaraPet.jsx knows the tab bar      (pet clear of tab bar, composer and drawer)
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WEB_DIR, PHONE, withPhone} from './helpers/mobile-chrome.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';
import {GUIDE_KEY} from '../src/webFirstLaunch.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DESKTOP = {width: 1280, height: 800};
const LANGS = ['zh-CN', 'zh-TW', 'en-US'];
const newest = dir => readdirSync(dir, {withFileTypes: true}).reduce((m, e) => Math.max(m, e.isDirectory() ? newest(join(dir, e.name)) : statSync(join(dir, e.name)).mtimeMs), 0);
function ensureBuild() {
  const index = join(WEB_DIR, 'index.html');
  if (existsSync(index) && statSync(index).mtimeMs >= Math.max(newest(join(root, 'src')), statSync(join(root, 'index.html')).mtimeMs)) return;
  const built = spawnSync('npm', ['run', 'build:web'], {cwd: root, encoding: 'utf8'});
  assert.equal(built.status, 0, 'npm run build:web failed:\n' + built.stdout.slice(-2000) + built.stderr.slice(-2000));
}
const initFor = lang => `localStorage.setItem('cardybara-language',${JSON.stringify(lang)});localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');`;
const shots = process.env.CARDYBARA_SHOTS ? resolve(process.env.CARDYBARA_SHOTS) : null;
const PAGES = ['overview', 'wallet', 'advisor', 'credits', 'rewards', 'settings', 'release'];

// Same Chrome rule as the first-run test: skip with the reason when Chrome cannot start, never on GitHub Actions.
const drawerOpen = `(()=>{const d=document.querySelector('.more-drawer');if(!d)return false;const sec=d.querySelector('.ant-drawer-section')||d,r=sec.getBoundingClientRect(),root=d.closest('.ant-drawer')||d;return (root.classList.contains('ant-drawer-open')||!root.classList.contains('ant-drawer'))&&r.width>0&&r.top<innerHeight&&getComputedStyle(sec).visibility!=='hidden'&&!!d.querySelector('[data-nav-key],[data-action]')})()`;
const chrome = await findChrome().then(() => { ensureBuild(); return withPhone(async c => {
  await c.goto('/');
  await c.pause(500);
  const tabbar = await c.evaluate(`!!document.querySelector('.mobile-tabbar')`);
  let drawer = false;
  if (tabbar) { await c.tap('.mobile-tabbar [data-nav-key="more"]').catch(() => {}); await c.pause(500); drawer = await c.evaluate(drawerOpen); }
  return {tabbar, drawer, header: await c.evaluate(`!!document.querySelector('.app-header') && !document.querySelector('.app-header .ant-breadcrumb')`)};
}, {init: initFor('en-US')}); }, () => false).then(ok => ok, err => {
  if (process.env.GITHUB_ACTIONS) throw err;
  console.warn('Chrome found but cannot start here, phone navigation tests skipped: ' + err.message);
  return false;
});
const all = process.env.CARDYBARA_PHONE_NAV === 'all';
const ready = {
  497: all || existsSync(join(root, 'src/navigation.js')),
  498: all || !!chrome?.tabbar,
  499: all || !!chrome?.drawer,
  500: all || !!chrome?.header,
  501: all || /mobile-tabbar/.test(readFileSync(join(root, 'src/CapybaraPet.jsx'), 'utf8')),
};
// Skip reason for a check that needs these issues; false (run it) when all have landed.
const needs = (...issues) => {
  if (!chrome) return 'no working Chrome on this machine';
  const open = issues.filter(n => !ready[n]);
  return open.length ? `waiting for ${open.map(n => '#' + n).join(', ')} (epic #496)` : false;
};
const opts = (...issues) => ({timeout: 180000, skip: needs(...issues)});

async function shot(c, name) {
  if (!shots) return;
  mkdirSync(shots, {recursive: true});
  await c.shot(join(shots, name + '.png'));
}
const visible = `const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&+s.opacity!==0};
const box=e=>{const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height}};`;
const rects = (c, sel) => c.evaluate(`(()=>{${visible}return [...document.querySelectorAll(${JSON.stringify(sel)})].filter(vis).map(box)})()`);
const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const goPage = async (c, key) => { await c.evaluate(`location.hash=${JSON.stringify(key)}`); await c.pause(350); };
const phone = (lang, fn) => withPhone(fn, {init: initFor(lang)});
async function desktop(lang, fn) {
  return withPhone(async c => {
    await c.page('Emulation.setDeviceMetricsOverride', {...DESKTOP, deviceScaleFactor: 1, mobile: false});
    await c.goto('/');
    await c.pause(500);
    return fn(c);
  }, {init: initFor(lang)});
}
const openMore = async c => { await c.tap('.mobile-tabbar [data-nav-key="more"]'); await c.until(drawerOpen, 'the More drawer'); await c.pause(400); };

for (const lang of LANGS) {
  test(`${lang} 375 px: no sider, content as wide as the screen, no horizontal scroll, tab bar on every page`, opts(498), async () => {
    await phone(lang, async c => {
      await c.goto('/');
      for (const key of PAGES) {
        await goPage(c, key);
        const a = await c.evaluate(`(()=>{${visible}const c=document.querySelector('.app-content');return {sider:!!document.querySelector('.app-sider')&&vis(document.querySelector('.app-sider')),content:c?c.getBoundingClientRect().width:0,sw:document.documentElement.scrollWidth,bw:document.body.scrollWidth,vw:document.documentElement.clientWidth,tab:vis(document.querySelector('.mobile-tabbar'))}})()`);
        assert.equal(a.vw, PHONE.width, `${lang} ${key}: phone width`);
        assert.equal(a.sider, false, `${lang} ${key}: the sider is gone below 768 px`);
        assert.equal(await c.evaluate(`!document.querySelector('.app-sider')`), true, `${lang} ${key}: no .app-sider element`);
        assert.equal(Math.round(a.content), PHONE.width, `${lang} ${key}: .app-content is ${a.content}px wide`);
        assert.ok(a.sw <= PHONE.width && a.bw <= PHONE.width, `${lang} ${key}: horizontal scroll (${a.sw}px)`);
        assert.ok(a.tab, `${lang} ${key}: the tab bar is visible`);
        await shot(c, `${lang}-375-${key}`);
      }
    });
  });

  test(`${lang} 375 px: the four primary pages are one tap away`, opts(498), async () => {
    await phone(lang, async c => {
      await c.goto('/');
      for (const from of ['release', 'advisor']) for (const key of ['overview', 'wallet', 'advisor', 'credits']) {
        if (from === key) continue;
        await goPage(c, from);
        await c.tap(`.mobile-tabbar [data-nav-key="${key}"]`);
        await c.until(`location.hash==='#${key}'`, `${key} after one tap from ${from}`);
      }
      assert.deepEqual(await c.evaluate(`[...document.querySelectorAll('.mobile-tabbar [data-nav-key]')].map(e=>e.dataset.navKey)`), ['overview', 'wallet', 'advisor', 'credits', 'more'], `${lang}: tab order`);
    });
  });

  test(`${lang} 375 px: More pages, export, import, language and settings are two taps away`, opts(499), async () => {
    await phone(lang, async c => {
      await c.goto('/');
      for (const from of ['overview', 'advisor']) {
        await goPage(c, from);
        await openMore(c);
        await shot(c, `${lang}-375-more-from-${from}`);
        const entries = await c.evaluate(`[...document.querySelectorAll('.more-drawer [data-nav-key],.more-drawer [data-action]')].map(e=>e.dataset.navKey?'nav:'+e.dataset.navKey:'action:'+e.dataset.action)`);
        for (const need of ['nav:rewards', 'nav:catalog', 'action:export', 'action:import', 'action:language']) assert.ok(entries.includes(need), `${lang}: the drawer offers ${need} (has ${entries})`);
        // Pages and Settings are tapped; export and import would open a download or a file chooser, so for those the second tap is shown to be possible.
        for (const sel of ['.more-drawer [data-nav-key="rewards"]', '.more-drawer [data-action="settings"],.more-drawer [data-nav-key="settings"]']) {
          if (!(await c.evaluate(drawerOpen))) await openMore(c);
          const key = /rewards/.test(sel) ? 'rewards' : 'settings';
          await c.tap(sel);
          await c.until(`location.hash==='#${key}'`, `${key} after two taps from ${from}`);
          await c.pause(400);
          await goPage(c, from);
          if (await c.evaluate(drawerOpen)) await c.pause(300);
        }
        if (!(await c.evaluate(drawerOpen))) await openMore(c);
        assert.ok(entries.includes('action:settings') || entries.includes('nav:settings'), `${lang}: the drawer offers Settings (has ${entries})`);
        const others = await rects(c, '.more-drawer [data-action="export"],.more-drawer [data-action="import"],.more-drawer [data-action="language"]');
        assert.equal(others.length, 3, `${lang}: export, import and language are visible in the open drawer`);
      }
    });
  });

  test(`${lang} 375 px: every tab-bar and drawer target is at least 44x44`, opts(498), async () => {
    await phone(lang, async c => {
      await c.goto('/');
      const small = a => a.filter(r => r.w < 43.5 || r.h < 43.5).map(r => `${Math.round(r.w)}x${Math.round(r.h)}`);
      const tabs = await rects(c, '.mobile-tabbar [data-nav-key]');
      assert.equal(tabs.length, 5, `${lang}: five tab targets`);
      assert.deepEqual(small(tabs), [], `${lang}: tab bar targets under 44 px`);
      if (!ready[499]) return;
      await openMore(c);
      const targets = await rects(c, '.more-drawer [data-nav-key],.more-drawer [data-action]');
      assert.ok(targets.length >= 5, `${lang}: drawer targets found (${targets.length})`);
      assert.deepEqual(small(targets), [], `${lang}: drawer targets under 44 px`);
    });
  });

  test(`${lang} 375 px: tab bar, pet, chat composer and drawer do not overlap`, opts(498), async () => {
    await phone(lang, async c => {
      await c.goto('/');
      for (const key of PAGES) {
        await goPage(c, key);
        await c.pause(300);
        const [bar] = await rects(c, '.mobile-tabbar');
        assert.ok(bar, `${lang} ${key}: tab bar`);
        const others = {pet: await rects(c, '.capy-companion,.capy-restore'), composer: await rects(c, '.chat-composer-area')};
        for (const [name, list] of Object.entries(others)) for (const r of list) assert.ok(!hit(bar, r), `${lang} ${key}: ${name} overlaps the tab bar`);
        // The pet is checked from #501 on: it must exist on overview, and the assistant page hides it.
        if (ready[501]) assert.equal(others.pet.length, key === 'advisor' ? 0 : 1, `${lang} ${key}: pet count`);
        if (!ready[501]) others.pet.length = 0;
        for (const p of others.pet) for (const m of others.composer) assert.ok(!hit(p, m), `${lang} ${key}: pet overlaps the chat composer`);
        if (key === 'advisor') assert.equal(others.composer.length, 1, `${lang}: the advisor shows its composer`);
        if (key === 'advisor') await shot(c, `${lang}-375-advisor-overlap`);
      }
      if (!ready[499]) return;
      for (const from of ['overview', 'advisor']) {
        await goPage(c, from);
        await openMore(c);
        const drawer = (await rects(c, '.more-drawer .ant-drawer-section')).concat(await rects(c, '.more-drawer.ant-drawer-section'))[0];
        assert.ok(drawer, `${lang}: the drawer panel is measurable`);
        if (ready[501]) for (const p of await rects(c, '.capy-companion,.capy-restore')) assert.ok(!hit(drawer, p), `${lang} ${from}: pet overlaps the open drawer`);
        for (const m of await rects(c, '.chat-composer-area')) assert.ok(!hit(drawer, m), `${lang} ${from}: composer overlaps the open drawer`);
        await c.tap('.more-drawer .ant-drawer-mask, .ant-drawer-mask').catch(() => {});
        await c.pause(400);
      }
    });
  });

  test(`${lang} 375 px: the header is a single row`, opts(500), async () => {
    await phone(lang, async c => {
      await c.goto('/');
      for (const key of ['overview', 'wallet', 'advisor', 'settings']) {
        await goPage(c, key);
        const h = await c.evaluate(`(()=>{${visible}const hd=document.querySelector('.app-header');const items=[...hd.querySelectorAll('button,.ant-select,.account-entry,h1,h2,.page-title,.ant-breadcrumb')].filter(vis);const ys=items.map(e=>{const r=e.getBoundingClientRect();return (r.top+r.bottom)/2});return {height:hd.getBoundingClientRect().height,spread:ys.length?Math.max(...ys)-Math.min(...ys):0,n:items.length,right:Math.max(0,...items.map(e=>e.getBoundingClientRect().right))}})()`);
        assert.ok(h.n > 0, `${lang} ${key}: the header has content`);
        assert.ok(h.spread <= 8, `${lang} ${key}: header items sit on ${Math.round(h.spread)} px of different heights (wrapped)`);
        assert.ok(h.height <= 72, `${lang} ${key}: header is ${h.height}px tall`);
        assert.ok(h.right <= PHONE.width + 1, `${lang} ${key}: header sticks out of the screen`);
        if (key === 'overview') await shot(c, `${lang}-375-header`);
      }
    });
  });

  test(`${lang} 1280 px: sider, no tab bar, menu order follows the nav config`, opts(), async () => {
    await desktop(lang, async c => {
      const a = await c.evaluate(`(()=>{${visible}return {sider:vis(document.querySelector('.app-sider')),bar:vis(document.querySelector('.mobile-tabbar')),vw:document.documentElement.clientWidth,sw:document.documentElement.scrollWidth,
        keys:[...document.querySelectorAll('.app-sider .ant-menu-item')].map(e=>(e.getAttribute('data-menu-id')||'').replace(/^.*?-(?=[a-z]+$)/,''))}})()`);
      assert.equal(a.vw, DESKTOP.width, `${lang}: desktop width`);
      assert.ok(a.sider, `${lang}: the sider is shown at 1280 px`);
      assert.equal(a.bar, false, `${lang}: no tab bar at 1280 px`);
      assert.ok(a.sw <= DESKTOP.width, `${lang}: horizontal scroll at 1280 px`);
      await shot(c, `${lang}-1280-overview`);
      if (!ready[497]) return;
      // #497's own unit test pins the config; here only what the user sees: the four primary pages lead the sider.
      assert.deepEqual(a.keys.slice(0, 4), ['overview', 'wallet', 'advisor', 'credits'], `${lang}: sider starts with the primary pages (has ${a.keys})`);
    });
  });
}
