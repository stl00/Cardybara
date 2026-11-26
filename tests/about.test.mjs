// #662: the About view shows the name, version, author, links and the data-source text in every language.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import release from '../release.json' with {type: 'json'};

const root = new URL('..', import.meta.url).pathname;
let mod;
async function load() {
  if (mod) return mod;
  const {outputFiles: [bundle]} = await build({stdin: {contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import About from './src/About.jsx';import {activateLanguage} from './src/i18n-core.js';
export const render=(props,lang)=>{activateLanguage(lang);return renderToStaticMarkup(React.createElement(About,props));};`, resolveDir: root, loader: 'jsx'}, bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', loader: {'.css': 'empty', '.png': 'empty', '.svg': 'empty'}, logLevel: 'silent'});
  const module = {exports: {}};
  new Function('module', 'exports', 'require', bundle.text)(module, module.exports, createRequire(new URL('../package.json', import.meta.url)));
  return mod = module.exports;
}
const expected = {
  'zh-CN': [`版本 ${release.label}`, '作者：Ollie Sun', '隐私说明', '安全问题反馈', '版本说明', '数据来源与说明', '当前 2 条卡片记录。'],
  'zh-TW': [`版本 ${release.label}`, '作者：Ollie Sun', '私隱說明', '安全問題回報', '版本說明', '資料來源與說明'],
  'en-US': [`Version ${release.label}`, 'Author: Ollie Sun', 'One wallet for your credit card', 'Privacy notice', 'Security reporting', 'Release notes', 'Sources and notes'],
};
const text = html => html.replace(/<[^>]+>/g, '');

for (const [language, strings] of Object.entries(expected)) test(`About renders name, version, author, links and sources in ${language}`, async () => {
  const {render} = await load();
  const html = render({collects: false, cardCount: 2, onRelease() {}}, language);
  for (const s of strings) assert.ok(text(html).includes(s), s);
  assert.ok(text(html).includes('Cardybara'));
  assert.deepEqual([...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]), ['PRIVACY.md', 'SECURITY.md'].map(f => 'https://github.com/stl00/Cardybara/blob/main/' + f));
  assert.doesNotMatch(html, /mailto:|@/);
});

test('the data-source explanation follows whether this runtime reads bank pages', async () => {
  const {render} = await load();
  assert.match(render({collects: true, cardCount: 0}, 'en-US'), /Refreshing visits the bank website/);
  assert.doesNotMatch(render({collects: false, cardCount: 0}, 'en-US'), /Refreshing visits the bank website/);
});

test('the footer, data menu and More sheet open the About view', () => {
  const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(main, /<Footer className="app-footer">[^]*?setAbout\(true\)\}>\{t\('关于 Cardybara'\)\}/);
  assert.match(main, /\{key:'about',label:t\('关于 Cardybara'\)\}/);
  assert.match(main, /onAbout=\{\(\)=>\{setMoreOpen\(false\);setAbout\(true\)\}\}/);
  assert.match(main, /<Modal title=\{t\('关于 Cardybara'\)\} open=\{about\}[^]*?<About collects=\{collects\}/);
});
