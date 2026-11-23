// #415, #452: the account screens in Settings on a 375x812 phone, in real headless Chrome (dist/web, loopback only), against the
// gateway's real account code (in-memory D1 and mail stand-ins) behind the page's own loopback origin. No account service, mail or
// network beyond 127.0.0.1 is used. Synthetic data only.
// Profile A: sign in form -> sign up -> emailed code -> signed in -> sync on (a wallet copy reaches the server) -> change password form.
// Profile B (a second fresh browser profile): sign in with the same email and password -> sync on -> the same wallet appears ->
// delete account (modal) -> every server row gone, the wallet on this device still there, signed out, sync off.
// At every step: no horizontal scroll, nothing outside the viewport, every control at least 44 px, modals inside the screen.
// Screenshots: CARDYBARA_SHOTS=<dir> node --test tests/account-phone.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PHONE, withPhone} from './helpers/mobile-chrome.mjs';
import {prepareWebTestBuild} from './helpers/web-test-build.mjs';
import {staticHandler} from '../scripts/web-chrome.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';
import {localGateway, memoryD1, memoryMail} from '../gateway/src/local.mjs';
import {TABLES} from '../gateway/src/accounts.js';
import {GUIDE_KEY} from '../src/webFirstLaunch.js';
import {WALLET_CARDS_KEY, newWalletCard} from '../src/walletRegistry.js';
import {cardProducts} from '../src/productCatalog.js';

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
const shots = process.env.CARDYBARA_SHOTS ? resolve(process.env.CARDYBARA_SHOTS) : null;
const EMAIL = 'synthetic.user@example.test', PASSWORD = 'synthetic-pass-0001';

// The wallet and the gateway on one loopback origin; only the /v2/account routes go to the gateway.
async function startServer() {
  const files = await staticHandler(buildDir);
  const db = memoryD1(); await db.exec(MIGRATION);
  const mail = memoryMail();
  let gateway;
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (!path.startsWith('/v2/account')) return files(req, res);
    const chunks = []; for await (const c of req.on('error', () => {})) chunks.push(c);
    const body = Buffer.concat(chunks);
    const r = await gateway.handle(new Request('https://gateway.test' + req.url, {method: req.method, body: body.length ? body : undefined,
      headers: {Origin: 'https://app.cardybara.test', ...(req.headers.authorization ? {Authorization: req.headers.authorization} : {}), ...(body.length ? {'Content-Type': 'application/json'} : {})}}));
    res.writeHead(r.status, {'content-type': 'application/json', 'cache-control': 'no-store'}).end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  gateway = localGateway({vars: {ALLOWED_ORIGINS: 'https://app.cardybara.test', PASSKEY_ORIGIN: origin, ACCOUNT_EMAIL_FROM: 'Cardybara <no-reply@mail.cardybara.test>'}, bindings: {DB: db, EMAIL: mail}});
  const lastCode = to => /\b(\d{6})\b/.exec([...mail.sent].reverse().find(x => x.to === to)?.text || '')?.[1] ?? null;
  return {server, origin, db, lastCode};
}

// Runs before the page: sends the gateway calls to this page's own origin and records them. No service worker: it would answer a
// repeated same-origin GET from its cache, which the real gateway (another origin) never gets. A conditional passkey request waits
// (there is no authenticator here), so the sign-in button is what signs in.
const INIT = `(()=>{const real=window.fetch.bind(window);window.__calls=[];navigator.serviceWorker.register=()=>new Promise(()=>{});
const get=navigator.credentials?.get?.bind(navigator.credentials);
if(get)navigator.credentials.get=o=>o?.mediation==='conditional'?new Promise((_,no)=>o.signal?.addEventListener('abort',()=>no(new DOMException('aborted','AbortError')))):get(o);
window.fetch=(url,init={})=>{url=String(url);const k=url.indexOf('/v2/account');if(k<0)return real(url,init);window.__calls.push((init.method||'GET')+' '+url.slice(k));return real(url.slice(k),init);};})();`;

// Profile A starts with two manual cards; profile B starts with none.
const CARDS = [newWalletCard({bank: cardProducts[0].bank, name: 'Synthetic One', tail: '1111'}, 'card-1'), newWalletCard({bank: cardProducts[0].bank, name: 'Synthetic Two', tail: '2222'}, 'card-2')];
const seed = (lang, cards) => `localStorage.setItem('cardybara-language',${JSON.stringify(lang)});localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');${cards ? `if(!localStorage.getItem(${JSON.stringify(WALLET_CARDS_KEY)}))localStorage.setItem(${JSON.stringify(WALLET_CARDS_KEY)},${JSON.stringify(JSON.stringify(cards))});` : ''}${INIT}`;

const TEXT = {
  'zh-CN': {signup: '注册', change: '修改密码', del: '删除账号', purge: '永久删除账号'},
  'en-US': {signup: 'Sign up', change: 'Change password', del: 'Delete account', purge: 'Delete account permanently'},
};
const A = '.account-settings';
const walletNames = c => c.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(WALLET_CARDS_KEY)})||'{"cards":[]}')`).then(v => (Array.isArray(v) ? v : v.cards || []).map(x => x.name + ':' + x.tail).sort());

function checker(c, lang, prefix, log) {
  return async step => {
    await c.pause(450);
    const a = await c.audit();
    if (shots) { mkdirSync(shots, {recursive: true}); await c.shot(join(shots, `${prefix}-${lang}-${String(log.length + 1).padStart(2, '0')}-${step}.png`)); }
    log.push(step);
    assert.equal(a.vw, PHONE.width, `${lang} ${step}: phone width`);
    assert.ok(a.scrollWidth <= PHONE.width && a.bodyScrollWidth <= PHONE.width, `${lang} ${step}: horizontal scroll (${a.scrollWidth}px)`);
    assert.deepEqual(a.overflow, [], `${lang} ${step}: elements outside the viewport`);
    assert.deepEqual(a.small, [], `${lang} ${step}: controls under 44 px`);
    for (const m of a.modals) assert.ok(m.l >= 0 && m.r <= PHONE.width && m.t >= 0 && m.b <= PHONE.height + 1, `${lang} ${step}: ${m.cls} is outside the screen`);
  };
}

// Profile A: create the account, turn sync on, and wait for the wallet copy to reach the server.
async function firstDevice(c, srv, lang) {
  const w = TEXT[lang], log = [], check = checker(c, lang, 'account-a', log);
  await c.goto('/#settings');
  await c.until(`document.querySelector('${A} input[type=email]')`, 'the sign-in form');
  await check('signed-out');
  await c.tap(`${A} .ant-segmented-item`, w.signup);
  await c.pause(200);
  await c.type(`${A} input[type=email]`, EMAIL);
  await c.type(`${A} input[autocomplete=new-password]`, PASSWORD);
  await check('sign-up');
  await c.tap(`${A} .account-email-submit`);
  await c.until(`document.querySelector('${A} input[autocomplete=one-time-code]')`, 'the code step');
  await check('code');
  await c.type(`${A} input[autocomplete=one-time-code]`, srv.lastCode(EMAIL));
  await c.tap(`${A} .ant-btn-primary`);
  await c.until(`document.querySelector('${A} .account-email')`, 'the signed-in view');
  assert.ok((await c.text()).includes(EMAIL), `${lang}: the account email shows`);
  await check('signed-in');
  assert.deepEqual(await walletNames(c), ['Synthetic One:1111', 'Synthetic Two:2222'], `${lang}: A holds its two cards`);
  await c.tap(`${A} .ant-switch`);
  await c.until(`document.querySelector('${A} .ant-switch-checked')`, 'sync on');
  assert.ok(await c.evaluate(`JSON.parse(localStorage.getItem('cardybara-sync-v1')).on===true`), `${lang}: sync is on`);
  await c.until(`window.__calls.some(x=>x.startsWith('PUT')&&x.endsWith('/wallet'))`, 'the wallet copy upload');
  await check('sync-on');
  assert.equal(srv.db.tables.get('wallets').length, 1, `${lang}: the server holds one wallet copy`);
  await c.tap(`${A} .ant-btn`, w.change);
  await c.until(`document.querySelector('${A} .account-password')`, 'the password form');
  await check('change-password');
  return log;
}

// Profile B: a second fresh profile with the same email and password gets the same wallet, then deletes the account.
async function secondDevice(c, srv, lang) {
  const w = TEXT[lang], log = [], check = checker(c, lang, 'account-b', log);
  await c.goto('/#settings');
  await c.until(`document.querySelector('${A} input[type=email]')`, 'the sign-in form');
  assert.equal(await c.evaluate(`localStorage.getItem(${JSON.stringify(WALLET_CARDS_KEY)})`), null, `${lang}: B starts with no wallet`);
  await check('signed-out');
  await c.type(`${A} input[type=email]`, EMAIL);
  await c.type(`${A} input[autocomplete=current-password]`, PASSWORD);
  await c.tap(`${A} .account-email-submit`);
  await c.until(`document.querySelector('${A} .account-email')`, 'the signed-in view');
  assert.ok((await c.text()).includes(EMAIL), `${lang}: B is signed in as the same account`);
  await check('signed-in');
  await c.tap(`${A} .ant-switch`);
  await c.until(`document.querySelector('${A} .ant-switch-checked')`, 'sync on');
  await c.until(`localStorage.getItem(${JSON.stringify(WALLET_CARDS_KEY)})&&JSON.stringify(JSON.parse(localStorage.getItem(${JSON.stringify(WALLET_CARDS_KEY)}))).includes('Synthetic Two')`, 'the wallet copy on B', 15000);
  assert.deepEqual(await walletNames(c), ['Synthetic One:1111', 'Synthetic Two:2222'], `${lang}: B holds the same wallet as A`);
  await check('sync-on');
  await c.tap(`${A} .ant-btn-dangerous`, w.del);
  await c.until(`document.querySelector('.ant-modal-container input')`, 'the delete confirmation');
  await check('delete-confirm');
  await c.type('.ant-modal-container input', PASSWORD);
  await c.tap('.ant-modal-container .ant-btn-dangerous', w.purge);
  await c.until(`document.querySelector('${A} input[type=email]')`, 'signed out again');
  assert.equal(await c.evaluate(`localStorage.getItem('cardybara-account-session-v1')`), null, `${lang}: the session is gone`);
  assert.ok(await c.evaluate(`JSON.parse(localStorage.getItem('cardybara-sync-v1')).on===false`), `${lang}: sync is off`);
  assert.ok(await c.evaluate(`window.__calls.includes('DELETE /v2/account')`), `${lang}: the account delete was requested`);
  // The page asks for an anonymous passkey challenge when the sign-in form opens; those rows belong to no user and expire by themselves.
  for (const name of TABLES) assert.equal(srv.db.tables.get(name).filter(r => name !== 'passkey_challenges' || r.user_id).length, 0, `${lang}: ${name} is empty on the server`);
  assert.deepEqual(await walletNames(c), ['Synthetic One:1111', 'Synthetic Two:2222'], `${lang}: the wallet on this device is untouched`);
  await check('deleted');
  return log;
}

for (const lang of ['zh-CN', 'en-US']) {
  test(`account across two fresh profiles at 375 px (${lang}): sign up, sync on, sign in elsewhere, same wallet, delete`, {timeout: 180000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
    const srv = await startServer();
    try {
      const a = await withPhone(c => firstDevice(c, srv, lang), {origin: srv.origin, init: seed(lang, CARDS)});
      assert.equal(a.length, 6);
      const b = await withPhone(c => secondDevice(c, srv, lang), {origin: srv.origin, init: seed(lang, null)});
      assert.equal(b.length, 5);
    } finally { srv.server.closeAllConnections?.(); srv.server.close(); }
  });
}
