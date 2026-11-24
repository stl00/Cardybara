// #600: the sync switch's copy is one state-dependent sentence. With sync off, nothing may still say the wallet syncs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
let mod;
async function load() {
  if (mod) return mod;
  const {outputFiles: [bundle]} = await build({stdin: {contents: `import {syncCopy} from './src/AccountSettings.jsx';import {activateLanguage} from './src/i18n-core.js';
export const copy=(on,lang)=>{activateLanguage(lang);return syncCopy(on);};`, resolveDir: root, loader: 'jsx'}, bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', loader: {'.js': 'jsx', '.json': 'json'}, logLevel: 'silent'});
  const module = {exports: {}};
  new Function('module', 'exports', 'require', bundle.text)(module, module.exports, createRequire(new URL('../package.json', import.meta.url)));
  return mod = module.exports;
}

const SYNCS = {'zh-CN': /会在你登录的设备间同步/, 'zh-TW': /同步/, 'en-US': /syncs across devices/};
const OFF = {'zh-CN': /同步已关闭/, 'zh-TW': /已關閉|已关闭/, 'en-US': /Sync is off/};

for (const lang of ['zh-CN', 'zh-TW', 'en-US']) {
  test(`${lang}: sync on says it syncs; sync off says it is off and that signing in again turns it on`, async () => {
    const {copy} = await load();
    const on = copy(true, lang), off = copy(false, lang);
    assert.notEqual(on, off);
    assert.match(on, SYNCS[lang]);
    assert.match(off, OFF[lang]);
    assert.doesNotMatch(off, lang === 'zh-TW' ? /會在你登入的裝置間同步/ : SYNCS[lang], 'the off sentence does not claim syncing');
    assert.match(off, lang === 'en-US' ? /Signing in again turns it back on/ : /再次登[录入]/);
  });
}

test('the card and the sheet both use the one sentence; no fixed sync claim is left in the component', () => {
  const src = readFileSync(new URL('../src/AccountSettings.jsx', import.meta.url), 'utf8');
  assert.equal((src.match(/\{syncCopy\(on\)\}/g) || []).length, 2);
  assert.equal((src.match(/t\('你的钱包会在你登录的设备间同步。银行密码永远不会上传。'\)/g) || []).length, 1, 'only inside syncCopy');
});
