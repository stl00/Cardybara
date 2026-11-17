// Card merges through the real wallet page (stl00/Cardybara#457): `npm run dev`'s page (Vite dev server, so the page has bank
// collection) in headless Chrome, synthetic cards only, no bank and no network beyond loopback. The extension's state message is
// posted the way the real extension posts it. Needs Chrome that can start; skipped otherwise, never on GitHub Actions.
import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {cardProducts} from '../src/productCatalog.js';
import {ACTIVE_BANKS} from '../extension-next/providers.js';
import {withPhone} from './helpers/mobile-chrome.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';

const A = cardProducts.find(p => ACTIVE_BANKS.includes(p.bank));
const manual = (id, tail) => ({id, bank: A.bank, region: A.region, name: A.name, currency: A.currency || 'USD', identitySource: 'manual', ...(tail ? {tail} : {})});
const bankCard = {id: `discovered-${A.bank.toLowerCase().replaceAll(' ', '-')}-4321`, bank: A.bank, region: A.region, currency: A.currency || 'USD', tail: '4321', name: A.name, identitySource: 'bank-page'};
const state = (revision, runId) => ({channel: 'cardybara-extension', version: '1.1.0', ok: true, state: {schema: 2, revision, discoveredCards: [bankCard], run: {id: runId, status: 'complete', startedAt: Date.now(), jobs: []}, records: {}, disabled: [], lastBankJobs: {}, agentRecords: []}});
const seed = (cards, edits) => `localStorage.setItem('cardybara-wallet-cards-v1', ${JSON.stringify(JSON.stringify(cards))});localStorage.setItem('cardybara-card-edits-v1', ${JSON.stringify(JSON.stringify(edits))});`;

const ok = await findChrome().then(() => withPhone(async () => true, {origin: 'http://127.0.0.1:1'}), () => false).catch(err => {
  if (process.env.GITHUB_ACTIONS) throw err;
  console.warn('Chrome cannot start here, merge page test skipped: ' + err.message);
  return false;
});

async function withDevPage(init, fn) {
  process.env.CARDYBARA_DEV_COLLECTOR = '0';
  const snapshot = readFileSync(new URL('../public/data.example.json', import.meta.url), 'utf8');
  const server = await createServer({server: {host: '127.0.0.1', port: 0, strictPort: false}, logLevel: 'silent', plugins: [{name: 'test-wallet', configureServer(s) { s.middlewares.use((req, res, next) => req.url?.split('?')[0] === '/data.json' ? (res.setHeader('content-type', 'application/json'), res.end(snapshot)) : next()); }}]});
  await server.listen();
  try { return await withPhone(fn, {origin: `http://127.0.0.1:${server.config.server.port}`, init}); } finally { await server.close(); }
}
const stored = (c, key) => c.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})||'[]')`);
const ids = async c => (await stored(c, 'cardybara-wallet-cards-v1')).map(x => x.id).sort();

test('a manual card and the bank card of its product merge once, keep what the user set, and can be undone', {skip: !ok && 'no usable Chrome', timeout: 120000}, async () => {
  await withDevPage(seed([manual('manual-1', '4321')], [{cardId: 'manual-1', feeDate: {month: 3, day: 15}}]), async c => {
    await c.goto('/');
    // A cost and a benefit record on the manual card, written by the page's own stores.
    await c.evaluate(`(async()=>{const cost=await import('/src/costStore.js');await cost.appendCostEvent('fee','manual-1',{start:'2026-01-01',end:'2026-12-31',currency:'USD',listedFee:95,charged:95,refund:0,waiver:'none',note:''});const p=await import('/src/personalStore.js');await p.appendBenefitEvent(JSON.stringify(['manual-1','rule.x','2026-01-01','2026-12-31']),'used','rule.x@1');})()`);
    await c.evaluate(`window.postMessage(${JSON.stringify(state(1, 'run-1'))},location.origin)`);
    await c.until(`document.querySelector('.card-merge-undo')`, 'the undo notice');
    assert.deepEqual(await ids(c), [bankCard.id], 'one card, no duplicate');
    const edits = await stored(c, 'cardybara-card-edits-v1');
    assert.deepEqual(edits.find(e => e.cardId === bankCard.id)?.feeDate?.month, 3, 'the fee date the user set is kept');
    const moved = await c.evaluate(`(async()=>{const cost=await import('/src/costStore.js'),p=await import('/src/personalStore.js');return {cost:(await cost.readCostEvents()).map(e=>e.cardId),benefit:(await p.readBenefitEvents()).map(e=>JSON.parse(e.key)[0])}})()`);
    assert.deepEqual(moved, {cost: [bankCard.id], benefit: [bankCard.id]});
    // The same state again (a later refresh) changes nothing.
    await c.evaluate(`window.postMessage(${JSON.stringify(state(2, 'run-1'))},location.origin)`);
    await c.pause(500);
    assert.deepEqual(await ids(c), [bankCard.id]);
    await c.tap('.card-merge-undo button');
    await c.until(`!document.querySelector('.card-merge-undo')`, 'the undo notice to go');
    assert.deepEqual(await ids(c), [bankCard.id, 'manual-1'].sort());
    const back = await c.evaluate(`(async()=>{const cost=await import('/src/costStore.js');return (await cost.readCostEvents()).map(e=>e.cardId)})()`);
    assert.deepEqual(back, ['manual-1']);
    // The undone pair is not suggested again by the next refresh.
    await c.evaluate(`window.postMessage(${JSON.stringify(state(3, 'run-2'))},location.origin)`);
    await c.pause(500);
    assert.deepEqual(await ids(c), [bankCard.id, 'manual-1'].sort());
  });
});

test('two manual cards of one product: the page asks once, and the answer leaves no duplicate', {skip: !ok && 'no usable Chrome', timeout: 120000}, async () => {
  await withDevPage(seed([manual('manual-1', '4321'), manual('manual-2', '4321')], []), async c => {
    await c.goto('/');
    await c.evaluate(`window.postMessage(${JSON.stringify(state(1, 'run-1'))},location.origin)`);
    await c.until(`document.querySelector('.card-merge-modal')`, 'the prompt');
    assert.equal(await c.evaluate(`document.querySelectorAll('.card-merge-modal .card-merge-question').length`), 1, 'one question');
    assert.equal((await ids(c)).length, 3, 'nothing was merged before the answer');
    await c.tap('.card-merge-modal .ant-radio-wrapper', {text: A.name});
    await c.tap('.card-merge-ok');
    await c.until(`!document.querySelector('.card-merge-modal')`, 'the prompt to close');
    await c.until(`document.querySelector('.card-merge-undo')`, 'the undo notice');
    assert.equal((await ids(c)).length, 2, 'the chosen card merged, the other stays');
  });
});
