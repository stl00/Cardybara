// #585 (split from #580): bank readings taken on the desktop show on the phone's card detail with the day they were read,
// also when the phone already holds a Plaid-added twin of the same card. Two fresh phone-width profiles (the #452 harness)
// on the built PWA in real headless Chrome, against the gateway's own account code (in-memory D1 and mail stand-ins).
// Profile A is an extension-style wallet: a card the bank page listed, with readings. Profile B signs in to the same account.
// The readings are older than the payment assistant's staleness window: they must still show, dated and labelled as old,
// not turn into "not collected". Plaid is a fixed synthetic answer on the same loopback origin. Synthetic data only.
// Runs only in `npm run test:web` (SEPARATE in scripts/run-tests.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withPhone} from './helpers/mobile-chrome.mjs';
import {prepareWebTestBuild} from './helpers/web-test-build.mjs';
import {staticHandler} from '../scripts/web-chrome.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';
import {localGateway, memoryD1, memoryMail} from '../gateway/src/local.mjs';
import {createAccountClient} from '../src/accountClient.js';
import {LIVE_KEY, mergeBankResult} from '../src/live.js';
import {STALE_DAYS} from '../src/paymentStates.js';
import {GUIDE_KEY} from '../src/webFirstLaunch.js';
import {WALLET_CARDS_KEY, newWalletCard} from '../src/walletRegistry.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIGRATION = ['0001_accounts', '0002_passkeys', '0003_plaid'].map(f => readFileSync(join(root, 'gateway/migrations', f + '.sql'), 'utf8')).join('\n');
let buildDir;
const chrome = await findChrome().then(() => {
  buildDir = prepareWebTestBuild();
  return withPhone(async () => true, {dir: buildDir});
}, () => false).then(ok => ok || false, err => {
  if (process.env.GITHUB_ACTIONS) throw err;
  console.warn('Chrome found but cannot start here, phone tests skipped: ' + err.message);
  return false;
});
const skip = !chrome && 'no working Chrome on this machine';
const EMAIL = 'synthetic.user@example.test', PASSWORD = 'synthetic-pass-0001';

const DAY = 86400000, NOW = Date.now();
const walletDayOf = ms => new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(ms));
// The desktop read the bank 30 days ago; Plaid's own read is older still, so the desktop amounts must win over it.
const BANK_READ = NOW - 30 * DAY, PLAID_READ = NOW - 40 * DAY;
const BANK_DAY = walletDayOf(BANK_READ), PLAID_DAY = walletDayOf(PLAID_READ), PLAID_DUE = walletDayOf(NOW - 10 * DAY);

const BANK_CARD = {id: 'bank-1', bank: 'Chase', name: 'Synthetic Bank Card', tail: '1111', region: 'US', currency: 'USD', identitySource: 'bank-page'};
const READINGS = {Chase: mergeBankResult(undefined, {bank: 'Chase', status: 'updated', attemptedAt: new Date(BANK_READ).toISOString(),
  patches: [{id: 'bank-1', capturedAt: new Date(BANK_READ).toISOString(), fields: {balance: 250.5, statement: 200, minimum: 35}, locale: 'en-US'}]})};
const TWIN = newWalletCard({bank: 'Chase', name: 'Synthetic Plaid Name', tail: '1111'}, 'plaid-1');
const PLAID = {items: [{itemId: 'item_1', institution: 'Chase', status: 'ok', historicalComplete: true}],
  cards: [{itemId: 'item_1', accountId: 'acc_1', institution: 'Chase', name: 'Synthetic Plaid Name', mask: '1111', subtype: 'credit card', currency: 'USD',
    balance: 999.99, available: null, limit: null, statementBalance: 888.88, statementDate: null, minimumPayment: 77, dueDate: PLAID_DUE, aprs: [], readAt: Math.floor(PLAID_READ / 1000)}]};

// The wallet, the account routes and the Plaid card list on one loopback origin.
async function startServer() {
  const files = await staticHandler(buildDir);
  const db = memoryD1(); await db.exec(MIGRATION);
  const mail = memoryMail();
  let gateway;
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const json = (status, body) => res.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'}).end(body);
    if (path === '/v2/plaid/cards') return json(200, JSON.stringify(server.plaid || {items: [], cards: []}));
    if (!path.startsWith('/v2/account')) return files(req, res);
    const chunks = []; for await (const c of req.on('error', () => {})) chunks.push(c);
    const body = Buffer.concat(chunks);
    const r = await gateway.handle(new Request('https://gateway.test' + req.url, {method: req.method, body: body.length ? body : undefined,
      headers: {Origin: 'https://app.cardybara.test', ...(req.headers.authorization ? {Authorization: req.headers.authorization} : {}), ...(body.length ? {'Content-Type': 'application/json'} : {})}}));
    json(r.status, Buffer.from(await r.arrayBuffer()));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  gateway = localGateway({vars: {ALLOWED_ORIGINS: 'https://app.cardybara.test', PASSKEY_ORIGIN: origin, ACCOUNT_EMAIL_FROM: 'Cardybara <no-reply@mail.cardybara.test>'}, bindings: {DB: db, EMAIL: mail}, log: () => {}});
  // The account exists before either device opens (sign-up screens are covered by account-phone.test.mjs).
  const api = createAccountClient({gateway: 'https://gateway.test', storage: {getItem: () => null, setItem() {}, removeItem() {}},
    fetchFn: (url, init) => gateway.handle(new Request(url, {method: init.method, body: init.body, headers: {Origin: 'https://app.cardybara.test', ...init.headers}}))});
  assert.equal((await api.signUp(EMAIL, PASSWORD)).ok, true);
  assert.equal((await api.verify(EMAIL, /\b(\d{6})\b/.exec(mail.sent.at(-1)?.text || '')?.[1])).ok, true);
  return {server, origin, document: () => JSON.stringify([...(db.tables.get('wallets') || [])])};
}

// Before the page: Chinese, no first-run guide, gateway calls sent to this origin, no service worker, no passkey prompt.
const init = (cards, live) => `(()=>{const real=window.fetch.bind(window);navigator.serviceWorker.register=()=>new Promise(()=>{});
const get=navigator.credentials?.get?.bind(navigator.credentials);
if(get)navigator.credentials.get=o=>o?.mediation==='conditional'?new Promise((_,no)=>o.signal?.addEventListener('abort',()=>no(new DOMException('aborted','AbortError')))):get(o);
window.fetch=(url,init={})=>{url=String(url);const k=url.indexOf('/v2/');return real(k<0?url:url.slice(k),init);};
if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');
localStorage.setItem('cardybara-language','zh-CN');localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');
${cards ? `localStorage.setItem(${JSON.stringify(WALLET_CARDS_KEY)},${JSON.stringify(JSON.stringify(cards))});` : ''}
${live ? `localStorage.setItem(${JSON.stringify(LIVE_KEY)},${JSON.stringify(JSON.stringify(live))});` : ''}}})();`;

async function signIn(c) {
  await c.goto('/#account');
  await c.until(`document.querySelector('.account-settings input[type=email]')`, 'the sign-in form');
  await c.type('.account-settings input[type=email]', EMAIL);
  await c.type('.account-settings input[autocomplete=current-password]', PASSWORD);
  await c.tap('.account-settings .account-email-submit');
  await c.until(`document.querySelector('.account-email')`, 'signed in', 15000);
  await c.until(`JSON.parse(localStorage.getItem('cardybara-sync-v1')||'{}').syncedAt`, 'the first sync', 20000);
}

// The card detail drawer's rows as {name: {label, value}}; the label carries the read day ("余额 · 2026-01-31").
const detailRows = c => c.evaluate(`Object.fromEntries([...document.querySelectorAll('.ant-drawer .ant-descriptions-item')].map(e=>{
  const label=e.querySelector('.ant-descriptions-item-label')?.innerText.trim()||'';
  return [label.split(' · ')[0],{label,value:e.querySelector('.ant-descriptions-item-content')?.innerText.trim()||''}];}))`);

// Desktop first (uploads its readings), then the phone: one sync, the card detail, then the overview's payment row.
async function scenario({live = READINGS, twin = false} = {}) {
  const srv = await startServer();
  try {
    if (twin) srv.server.plaid = PLAID;
    const errors = [];
    await withPhone(async c => {
      await signIn(c);
      // Signing in pushes at once (#579); wait until the server copy holds the card.
      for (let i = 0; i < 200 && !srv.document().includes('bank-1'); i++) await c.pause(100);
      assert.ok(srv.document().includes('bank-1'), 'the desktop wallet reached the server');
      errors.push(...c.errors);
    }, {origin: srv.origin, init: init([BANK_CARD], live)});
    const seen = await withPhone(async c => {
      await signIn(c);
      await c.evaluate(`location.hash='wallet'`);
      await c.until(`document.querySelector('.wallet-card .card-title')`, 'the card on the phone', 15000);
      // With a twin, the due date arrives from the Plaid read the wallet makes by itself.
      if (twin) await c.until(`document.querySelector('.wallet-card .card-bottom').innerText.includes(${JSON.stringify(PLAID_DUE.slice(5).replace('-', '/'))})`, 'the Plaid due date', 15000);
      const cards = await c.evaluate(`document.querySelectorAll('.wallet-card').length`);
      await c.tap('.wallet-card .card-title');
      await c.until(`document.querySelector('.ant-drawer .ant-descriptions-item')`, 'the card detail');
      await c.pause(400);
      const detail = await detailRows(c);
      await c.evaluate(`location.hash='overview'`);
      await c.until(`document.querySelector('.payment-assistant')&&!document.querySelector('.ant-drawer-open')`, 'the overview');
      if (await c.evaluate(`!!document.querySelector('.payment-rest .ant-collapse-header')`)) await c.tap('.payment-rest .ant-collapse-header');
      await c.until(`document.querySelector('.payment-row')`, 'the payment row');
      const row = await c.evaluate(`document.querySelector('.payment-row').innerText`);
      const state = await c.evaluate(`document.querySelector('.payment-row').dataset.state`);
      // Minimum and read day sit one tap away, behind the row's info tip (#686).
      await c.tap('.payment-row .info-tip');
      await c.until(`document.querySelector('.info-tip-content')?.innerText.includes('读取')`, 'the row facts');
      const facts = await c.evaluate(`document.querySelector('.info-tip-content').innerText`);
      errors.push(...c.errors);
      return {cards, detail, row, facts, state};
    }, {origin: srv.origin, init: init(twin ? [TWIN] : null, null)});
    return {...seen, errors};
  } finally { srv.server.closeAllConnections?.(); srv.server.close(); }
}

function assertReadings({cards, detail}) {
  assert.equal(cards, 1, 'one card for the bank and digits');
  for (const [name, amount] of [['余额', '250.50'], ['账单金额', '200.00'], ['最低还款', '35.00']]) {
    assert.ok(detail[name]?.value.includes(amount), `${name} shows the desktop reading: ${JSON.stringify(detail[name])}`);
    assert.equal(detail[name].label, `${name} · ${BANK_DAY}`, `${name} carries the day it was read`);
  }
}

test('the readings are older than the staleness window', () => {
  assert.ok((NOW - BANK_READ) / DAY > STALE_DAYS + 1);
});

test('phone: old desktop readings show on the card detail with their read day, labelled old, never as zero or a made-up date', {timeout: 150000, skip}, async () => {
  const r = await scenario();
  assertReadings(r);
  // A bank reading holds no due date: it stays "not collected", with no date made up for it.
  assert.deepEqual(r.detail['还款日'], {label: '还款日 · 未采集', value: '未采集'});
  for (const s of ['200.00', '读数已过期']) assert.ok(r.row.includes(s), `the overview row is missing ${s}: ${r.row}`);
  for (const s of ['35.00', `读取于 ${BANK_DAY}`]) assert.ok(r.facts.includes(s), `the row facts are missing ${s}: ${r.facts}`);
  assert.deepEqual(r.errors, []);
});

test('phone with a Plaid-added twin: one card, the newer desktop amounts and the Plaid due date, each with its read day', {timeout: 150000, skip}, async () => {
  const r = await scenario({twin: true});
  assertReadings(r);
  assert.equal(r.detail['还款日'].label, `还款日 · ${PLAID_DAY}`);
  assert.ok(r.detail['还款日'].value.includes(PLAID_DUE), 'the due date as Plaid gave it: ' + r.detail['还款日'].value);
  // The row is as old as its oldest reading, and an old past due date is not called overdue.
  for (const s of ['200.00', PLAID_DUE, '读数已过期']) assert.ok(r.row.includes(s), `the overview row is missing ${s}: ${r.row}`);
  for (const s of ['35.00', `读取于 ${PLAID_DAY}`]) assert.ok(r.facts.includes(s), `the row facts are missing ${s}: ${r.facts}`);
  assert.equal(r.state, 'stale');
  assert.deepEqual(r.errors, []);
});

test('negative control: a desktop with no readings leaves the phone without amounts, so the checks fail', {timeout: 150000, skip}, async () => {
  const r = await scenario({live: null});
  assert.equal(r.detail['余额']?.label, '余额 · 未采集');
  assert.throws(() => assertReadings(r));
});
