// #497: one navigation config for the desktop sider and the phone tab bar / drawer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NAV, navGroups, navOrder, siderItems} from '../src/navigation.js';
import {translations} from '../src/i18n/index.js';
import {tx, t, activateLanguage} from '../src/i18n-core.js';

const all = [...NAV.primary, ...NAV.more];

test('no two menu entries share a key or an icon', () => {
  assert.equal(new Set(all.map(i => i.key)).size, all.length);
  assert.equal(new Set(all.map(i => i.icon)).size, all.length, all.map(i => i.icon).join());
  assert.equal(NAV.primary.find(i => i.key === 'advisor').icon, 'capybara');
});

test('the primary group is overview, wallet, the assistant and credits; more holds the rest', () => {
  assert.deepEqual(NAV.primary.map(i => i.key), ['overview', 'wallet', 'advisor', 'credits']);
  assert.deepEqual(NAV.more.map(i => i.key), ['rewards', 'connections', 'catalog', 'guide', 'settings']);
});

test('connections is shown only where the runtime can collect bank pages', () => {
  assert.ok(!navOrder({collects: false}).includes('connections'));
  assert.ok(navOrder({collects: true}).includes('connections'));
  assert.ok(!navGroups().more.some(i => i.key === 'connections'));
});

test('the desktop menu order equals primary then more', () => {
  for (const collects of [false, true]) {
    const items = siderItems({collects});
    const keys = items.flatMap(i => i.type === 'group' ? i.children.map(c => c.key) : [i.key]);
    assert.deepEqual(keys, navOrder({collects}));
    const groups = items.filter(i => i.type === 'group');
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].children.map(c => c.key), navGroups({collects}).more.map(i => i.key));
  }
});

test('every label and short label is translated, and the assistant has its own name', () => {
  for (const language of ['en-US', 'zh-TW']) for (const item of all) {
    assert.ok(translations[language][item.label], `${language} ${item.label}`);
    assert.ok(translations[language][`nav|${item.short}`] || translations[language][item.short], `${language} short ${item.short}`);
  }
  activateLanguage('en-US');
  assert.equal(t('问问卡疲扒拉'), 'Ask Cardybara');
  assert.equal(tx('nav', '问问'), 'Ask');
  assert.equal(tx('nav', '福利'), 'Benefits');
  assert.equal(t('福利'), 'Benefit', 'the context key leaves the plain word alone');
  assert.equal(tx('nav', '设置'), 'Settings', 'falls back to the plain key');
  activateLanguage('zh-TW');
  assert.equal(t('问问卡疲扒拉'), '問問卡疲扒拉');
  assert.equal(tx('nav', '问问'), '問問');
  activateLanguage('zh-CN');
  assert.equal(tx('nav', '问问'), '问问');
  assert.equal(t('问问卡疲扒拉'), '问问卡疲扒拉');
});

test('the wallet builds its sider from the config, not an inline list', () => {
  const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(main, /items=\{siderItems\(\{collects\}/);
  assert.doesNotMatch(main, /sider-bottom/);
});
