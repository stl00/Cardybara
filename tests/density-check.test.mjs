// #683: the density check itself. The budgets file has the screens of #682; report mode never fails; enforcing mode fails
// on a deliberately noisy page in real headless Chrome (a static fixture on loopback, no app build).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SCREENS} from '../scripts/density-budgets.mjs';
import {formatTable, judge, runDensity} from '../scripts/density-check.mjs';
import {withPhone} from './helpers/mobile-chrome.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';

const dir = await mkdtemp(join(tmpdir(), 'cardybara-density-'));
test.after(() => rm(dir, {recursive: true, force: true}));
const tag = '<span class="ant-tag">tag</span>', btn = '<button class="ant-btn">act</button>';
// Noisy: 3 buttons, an alert, a long secondary line and a row with 2 tags and 2 buttons. None of the hidden ones, the one
// below the first viewport or the ⋯ in the row may count.
const NOISY = `<!doctype html><meta name="viewport" content="width=device-width"><div id="root">
  <div class="ant-alert">alert</div>
  <div class="ant-typography ant-typography-secondary">A paragraph.</div>
  <span class="ant-typography ant-typography-secondary">short label</span>
  <div class="row">${tag}${tag}${btn}<button class="ant-btn more-menu-trigger">...</button></div>
  ${btn}
  <div style="display:none">${btn}${tag}</div><div aria-hidden="true">${btn}</div><div style="opacity:0">${btn}</div>
  <div style="margin-top:2000px">${btn}<div class="row">${tag}${tag}${tag}</div></div>
</div>`;
await writeFile(join(dir, 'index.html'), NOISY);
await writeFile(join(dir, '_headers'), '/*\n');
const chrome = await findChrome().then(() => withPhone(async () => true, {dir})).catch(err => {
  if (process.env.GITHUB_ACTIONS) throw err;
  console.warn('no working Chrome, density fixture test skipped: ' + err.message);
  return false;
});

const noisy = mode => ({id: 'noisy', label: 'Noisy', mode, rows: '.row', rowButtonExclude: '.more-menu-trigger', budget: {buttons: 1, tags: 1, alerts: 0, paragraphs: 0, tagsPerRow: 1, buttonsPerRow: 1}});
const routes = {noisy: c => c.goto('/')};

test('enforcing mode fails a noisy page; report mode only prints it', {timeout: 90000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
  const enforced = await runDensity({dir, screens: [noisy('enforce')], routes, init: ''});
  assert.deepEqual(enforced.measured.noisy, {buttons: 3, tags: 2, alerts: 1, paragraphs: 1, rows: 2, tagsPerRow: 3, buttonsPerRow: 1});
  assert.equal(enforced.failed, true);
  assert.deepEqual(enforced.rows.filter(r => r.failed).map(r => r.metric), ['buttons', 'tags', 'alerts', 'paragraphs', 'tagsPerRow']);
  assert.match(formatTable(enforced), /\| Noisy \| buttons \| 3 \| <= 1 \| - \| enforce \| FAIL \|/);
  const reported = await runDensity({dir, screens: [noisy('report')], routes, init: ''});
  assert.equal(reported.failed, false);
  assert.match(formatTable(reported), /\| report \| over \|/);
});

test('within budget passes; an enforcing screen that was not measured fails', () => {
  const screen = {id: 's', label: 'S', mode: 'enforce', budget: {buttons: 2, tagsPerRow: 1}};
  assert.equal(judge([screen], {s: {buttons: 2, rows: 1, tagsPerRow: 1}}).failed, false);
  assert.equal(judge([screen], {s: {buttons: 2, rows: 0, tagsPerRow: 0}}).failed, true, 'no rows on screen');
  assert.equal(judge([screen], {}).failed, true);
});

test('the budgets cover the screens of #683, each with today\'s numbers recorded', () => {
  assert.deepEqual(SCREENS.map(s => s.id), ['overview', 'wallet', 'drawer', 'credits', 'rewards']);
  for (const s of SCREENS) {
    assert.ok(['report', 'enforce'].includes(s.mode), s.id);
    assert.deepEqual(Object.keys(s.baseline), Object.keys(s.budget), s.id);
  }
});

test('CI runs the check after building the web app', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.ok(workflow.indexOf('run: node scripts/density-check.mjs') > workflow.indexOf('run: npm run build:web'));
});
