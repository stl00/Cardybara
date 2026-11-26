// #662: the About view shows the name, version, author, links and the data-source text in every language.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {commitSha, webAppPlugin} from '../scripts/web-build.mjs';
import {build} from 'esbuild';
import release from '../release.json' with {type: 'json'};

const root = new URL('..', import.meta.url).pathname;
let mod;
// `define` stands in for what a build injects; `globals` for the runtime the platform is chosen in at startup.
async function bundleAbout({define, globals = {}} = {}) {
  const {outputFiles: [bundle]} = await build({define, stdin: {contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import About from './src/About.jsx';import {activateLanguage} from './src/i18n-core.js';
export const render=(props,lang)=>{activateLanguage(lang);return renderToStaticMarkup(React.createElement(About,props));};`, resolveDir: root, loader: 'jsx'}, bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', loader: {'.css': 'empty', '.png': 'empty', '.svg': 'empty'}, logLevel: 'silent'});
  const module = {exports: {}};
  const before = Object.keys(globals).map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  for (const [k, value] of Object.entries(globals)) Object.defineProperty(globalThis, k, {value, configurable: true, writable: true});
  try {
    new Function('module', 'exports', 'require', bundle.text)(module, module.exports, createRequire(new URL('../package.json', import.meta.url)));
  } finally {
    for (const [k, d] of before) d ? Object.defineProperty(globalThis, k, d) : delete globalThis[k];
  }
  return module.exports;
}
const load = async () => mod ??= await bundleAbout();
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

// #666: the web build is identified by its commit, the extension by its release.json label.
const version = async options => text((await bundleAbout(options)).render({collects: false, cardCount: 0, onRelease() {}}, 'en-US'));
const define = {__WEB_COMMIT__: '"abc1234"'};

test('the web About view shows the commit SHA instead of the release label', async () => {
  const shown = await version({define});
  assert.ok(shown.includes('Version abc1234'), shown);
  assert.ok(!shown.includes(release.label));
});

test('the extension About view keeps the release.json label', async () => {
  const globals = {location: {protocol: 'chrome-extension:'}, chrome: {runtime: {id: 'synthetic'}}};
  const shown = await version({define, globals});
  assert.ok(shown.includes(`Version ${release.label}`), shown);
  assert.ok(!shown.includes('abc1234'));
});

test('a web build without a commit falls back to the release label', async () => {
  assert.ok((await version({define: {__WEB_COMMIT__: '""'}})).includes(`Version ${release.label}`));
});

test('the web build takes its SHA from the workflow, CI or git, and never fails without one', () => {
  const outside = mkdtempSync(join(tmpdir(), 'cardybara-no-git-'));
  const a = 'A'.repeat(40), b = 'b'.repeat(40);
  try {
    assert.equal(commitSha({CARDYBARA_COMMIT_SHA: a, GITHUB_SHA: b}, outside), 'aaaaaaa');
    assert.equal(commitSha({GITHUB_SHA: b}, outside), 'bbbbbbb');
    assert.equal(commitSha({CARDYBARA_COMMIT_SHA: 'not a sha'}, outside), '');
    assert.equal(commitSha({}, outside), '');
    assert.match(commitSha({}, root), /^([0-9a-f]{7})?$/);
  } finally { rmSync(outside, {recursive: true, force: true}); }
  assert.deepEqual(webAppPlugin({root, env: {GITHUB_SHA: b}}).config(), {define: {__WEB_COMMIT__: '"bbbbbbb"'}});
  const workflow = readFileSync(new URL('../.github/workflows/web-deploy.yml', import.meta.url), 'utf8');
  assert.match(workflow, /- run: npm run build:web\n {8}env:\n(?: {10}#.*\n)* {10}CARDYBARA_COMMIT_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
});

test('the footer, data menu and More sheet open the About view', () => {
  const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(main, /<Footer className="app-footer">[^]*?setAbout\(true\)\}>\{t\('关于 Cardybara'\)\}/);
  assert.match(main, /\{key:'about',label:t\('关于 Cardybara'\)\}/);
  assert.match(main, /onAbout=\{\(\)=>\{setMoreOpen\(false\);setAbout\(true\)\}\}/);
  assert.match(main, /<Modal title=\{t\('关于 Cardybara'\)\} open=\{about\}[^]*?<About collects=\{collects\}/);
});
