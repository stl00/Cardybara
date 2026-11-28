// #683: the shared quiet-UI components. Static markup first, then their behaviour in real headless Chrome at phone width
// (a fixture bundled with esbuild, on loopback).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {withPhone} from './helpers/mobile-chrome.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = async (contents, options) => (await build({stdin: {contents, resolveDir: root, loader: 'jsx'}, bundle: true, write: false, jsx: 'automatic', logLevel: 'silent', ...options})).outputFiles[0].text;
const IMPORTS = `import React from 'react';import InfoTip from './src/InfoTip.jsx';import MoreMenu from './src/MoreMenu.jsx';import NudgeSlot,{orderNudges,NUDGE_PRIORITY} from './src/NudgeSlot.jsx';import {activateLanguage} from './src/i18n-core.js';`;

const code = await bundle(`${IMPORTS}import {renderToStaticMarkup} from 'react-dom/server';
const parts={InfoTip,MoreMenu,NudgeSlot};
export const html=(name,props,lang='en-US')=>{activateLanguage(lang);return renderToStaticMarkup(React.createElement(parts[name],props));};
export {orderNudges,NUDGE_PRIORITY};`, {format: 'cjs', platform: 'node', external: ['react', 'react-dom', 'react-dom/server']});
const module = {exports: {}};
new Function('module', 'exports', 'require', code)(module, module.exports, createRequire(new URL('../package.json', import.meta.url)));
const {html, orderNudges, NUDGE_PRIORITY} = module.exports;

test('InfoTip is a labelled button, not an antd button, in all three languages', () => {
  for (const [lang, label] of [['zh-CN', '说明'], ['zh-TW', '說明'], ['en-US', 'About this']]) {
    const out = html('InfoTip', {title: 'caveat text'}, lang);
    assert.match(out, new RegExp(`<button type="button" class="info-tip" aria-label="${label}"`), lang);
    assert.doesNotMatch(out, /ant-btn|caveat text/, 'the explanation is not shown by default');
  }
  assert.match(html('InfoTip', {title: 'x', label: 'About fees'}), /aria-label="About fees"/);
  assert.equal(html('InfoTip', {}), '', 'nothing to explain, nothing drawn');
});

test('MoreMenu is a labelled ⋯ button, and nothing without an action', () => {
  const out = html('MoreMenu', {items: [{key: 'a', label: 'A'}]});
  assert.match(out, /more-menu-trigger/);
  assert.match(out, /aria-label="More actions"/);
  assert.equal(html('MoreMenu', {items: [false, {type: 'divider'}]}), '');
});

test('NudgeSlot orders error > overdue > Plaid > home screen > backup > unjudged', () => {
  assert.deepEqual(NUDGE_PRIORITY, ['error', 'overdue', 'plaid', 'home-screen', 'backup', 'unjudged']);
  const given = [...NUDGE_PRIORITY].reverse().map(kind => ({kind, node: kind}));
  assert.deepEqual(orderNudges(given).map(n => n.kind), NUDGE_PRIORITY);
  assert.deepEqual(orderNudges([{kind: 'backup', node: 'b'}, {kind: 'error', node: false}, null]).map(n => n.kind), ['backup']);
  assert.throws(() => orderNudges([{kind: 'ad', node: 'x'}]), /unknown nudge kind/);
  assert.equal(html('NudgeSlot', {nudges: []}), '');
});

const dir = await mkdtemp(join(tmpdir(), 'cardybara-quiet-'));
test.after(() => rm(dir, {recursive: true, force: true}));
const app = await bundle(`${IMPORTS}import {createRoot} from 'react-dom/client';
activateLanguage('en-US');
window.picked=[];window.rowClicks=0;
function Silent(){return null}
function Closable({id}){const [open,setOpen]=React.useState(true);return open?<button id={id} onClick={()=>setOpen(false)}>{id}</button>:null}
createRoot(document.getElementById('root')).render(<div style={{padding:16}}>
 <NudgeSlot nudges={[{kind:'backup',node:<Closable id="backup"/>},{kind:'error',node:<Silent/>},{kind:'plaid',node:<Closable id="plaid"/>}]}/>
 <p>Fees <InfoTip title="Synthetic caveat" hover={false}/></p>
 <div onClick={()=>window.rowClicks++}><MoreMenu items={[{key:'hide',label:'Hide'}]} onClick={key=>window.picked.push(key)}/></div>
</div>);`, {format: 'iife', platform: 'browser', define: {'process.env.NODE_ENV': '"production"'}});
await writeFile(join(dir, 'app.js'), app);
await writeFile(join(dir, 'style.css'), await readFile(join(root, 'src/style.css'), 'utf8'));
await writeFile(join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>');
await writeFile(join(dir, '_headers'), '/*\n');
const chrome = await findChrome().then(() => withPhone(async () => true, {dir})).catch(err => {
  if (process.env.GITHUB_ACTIONS) throw err;
  console.warn('no working Chrome, quiet UI browser test skipped: ' + err.message);
  return false;
});

test('375 px: one nudge at a time, the tip opens on tap, the menu does not click its row', {timeout: 90000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
  await withPhone(async c => {
    await c.goto('/');
    const visible = () => c.evaluate(`['plaid','backup'].filter(id=>document.getElementById(id)?.offsetParent)`);
    assert.deepEqual(await visible(), ['plaid'], 'the highest priority nudge that renders anything');
    await c.tap('#plaid');
    await c.until(`document.getElementById('backup')?.offsetParent`, 'the next nudge after dismissal');

    assert.equal((await c.text()).includes('Synthetic caveat'), false);
    await c.tap('.info-tip');
    await c.until(`document.querySelector('.ant-popover:not(.ant-popover-hidden) .info-tip-content')`, 'the popover');
    assert.ok((await c.text()).includes('Synthetic caveat'));

    await c.tap('.info-tip');
    await c.until(`!document.querySelector('.ant-popover:not(.ant-popover-hidden)')`, 'the popover closed');

    await c.tap('.more-menu-trigger');
    await c.until(`document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item')`, 'the menu');
    await c.tap('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item');
    await c.until(`window.picked.length===1`, 'the chosen action');
    assert.deepEqual(await c.evaluate(`[window.picked,window.rowClicks]`), [['hide'], 0]);
  }, {dir});
});
