// #499: the phone More sheet holds the more pages (not Settings, which has its own row), backup, language and settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {navGroups} from '../src/navigation.js';

const root = new URL('..', import.meta.url).pathname;
let mod;
async function load() {
  if (mod) return mod;
  const {outputFiles: [bundle]} = await build({stdin: {contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {MoreSheet} from './src/MobileNav.jsx';import {activateLanguage} from './src/i18n-core.js';
export const render=(props,lang='zh-CN')=>{activateLanguage(lang);return renderToStaticMarkup(React.createElement(MoreSheet,props));};`, resolveDir: root, loader: 'jsx'}, bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', loader: {'.css': 'empty', '.png': 'empty', '.svg': 'empty'}, logLevel: 'silent'});
  const module = {exports: {}};
  new Function('module', 'exports', 'require', bundle.text)(module, module.exports, createRequire(new URL('../package.json', import.meta.url)));
  return mod = module.exports;
}
const noop = () => {};
const props = (collects, extra = {}) => ({groups: navGroups({collects}), page: 'overview', onGo: noop, onExport: noop, onImport: noop, language: 'zh-CN', setLanguage: noop, onAbout: noop, onRelease: noop, ...extra});
const entries = html => [...html.matchAll(/data-(nav-key|action)="([^"]+)"/g)].map(m => (m[1] === 'nav-key' ? 'nav:' : 'action:') + m[2]);

test('web: the more pages without connections, then export, import, language and settings', async () => {
  const {render} = await load();
  assert.deepEqual(entries(render(props(false))), ['nav:rewards', 'nav:catalog', 'nav:guide', 'action:export', 'action:import', 'action:language', 'action:settings']);
});

test('where the runtime collects, the bank connections tile is there too', async () => {
  const {render} = await load();
  assert.deepEqual(entries(render(props(true))).filter(e => e.startsWith('nav:')), ['nav:rewards', 'nav:connections', 'nav:catalog', 'nav:guide']);
});

test('the current more page is marked, and the footer links are in the sheet', async () => {
  const {render} = await load();
  const html = render(props(false, {page: 'catalog'}), 'en-US');
  assert.match(html, /class="more-tile is-active" data-nav-key="catalog" aria-current="page"/);
  for (const text of ['Export backup', 'Import backup', 'Settings', 'About Cardybara', 'About this version', 'EN']) assert.ok(html.includes(text), text);
});

test('phones lose the page-heading data menu and the footer; settings keeps card-type import and the guide', () => {
  const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(main, /\{!phone&&<Dropdown menu=\{\{items:\[\{key:'export'/);
  assert.match(main, /page!=='advisor'&&!phone&&<Footer/);
  assert.match(main, /className="backup-guide-settings"[^;]*从旧备份导入卡种[^;]*首次使用指南/);
  assert.match(main, /\{phone&&<MoreDrawer /);
});
