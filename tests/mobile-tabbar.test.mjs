// #498: the phone tab bar is the config's primary group with the assistant in the centre, then "More".
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
  const {outputFiles: [bundle]} = await build({stdin: {contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {MobileTabBar} from './src/MobileNav.jsx';import {activateLanguage} from './src/i18n-core.js';
export const render=(props,lang='zh-CN')=>{activateLanguage(lang);return renderToStaticMarkup(React.createElement(MobileTabBar,props));};`, resolveDir: root, loader: 'jsx'}, bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', loader: {'.css': 'empty', '.png': 'empty', '.svg': 'empty'}, logLevel: 'silent'});
  const module = {exports: {}};
  new Function('module', 'exports', 'require', bundle.text)(module, module.exports, createRequire(new URL('../package.json', import.meta.url)));
  return mod = module.exports;
}
const keys = html => [...html.matchAll(/data-nav-key="([^"]+)"/g)].map(m => m[1]);
const groups = navGroups({collects: false});

test('five tabs: overview, wallet, the assistant in the centre, credits, more', async () => {
  const {render} = await load();
  const html = render({groups, page: 'overview', onGo() {}, onMore() {}});
  assert.match(html, /<nav class="mobile-tabbar" aria-label="主导航">/);
  assert.deepEqual(keys(html), ['overview', 'wallet', 'advisor', 'credits', 'more']);
  assert.match(html, /data-nav-key="advisor" class="mobile-tab mobile-tab-centre"/);
  assert.match(html, /\/brand\/zen\.svg/);
});

test('the current page is marked; a page from the more group marks More', async () => {
  const {render} = await load();
  assert.match(render({groups, page: 'wallet', onGo() {}, onMore() {}}), /data-nav-key="wallet" class="mobile-tab is-active" aria-current="page"/);
  const more = render({groups, page: 'settings', onGo() {}, onMore() {}});
  assert.match(more, /data-nav-key="more" class="mobile-tab is-active"/);
  assert.doesNotMatch(more, /aria-current/);
});

test('short labels in three languages', async () => {
  const {render} = await load();
  const label = (lang) => [...render({groups, page: 'overview', onGo() {}, onMore() {}}, lang).matchAll(/mobile-tab-label">([^<]+)</g)].map(m => m[1]);
  assert.deepEqual(label('zh-CN'), ['总览', '钱包', '问问', '福利', '更多']);
  assert.deepEqual(label('zh-TW'), ['總覽', '錢包', '問問', '福利', '更多']);
  assert.deepEqual(label('en-US'), ['Overview', 'Wallet', 'Ask', 'Benefits', 'More']);
});

test('below md the wallet renders the tab bar instead of the sider, and lays out for it', () => {
  const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(main, /\{!phone&&<Sider /);
  assert.match(main, /\{phone&&<MobileTabBar /);
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.main-layout\.is-phone\{margin-left:0;padding-bottom:calc\(72px \+ env\(safe-area-inset-bottom\)\)\}/);
  assert.match(css, /\.mobile-tab\{[^}]*min-height:44px/);
});
