// #461: passkey sign-in on a 375x812 phone in real headless Chrome with a virtual authenticator (Chrome's WebAuthn
// DevTools domain): sign up -> sync on -> add a passkey -> sign out -> sign in with the passkey -> the same account and
// wallet copy. The page talks to the gateway's real account and passkey code (in-memory D1 and mail stand-ins) behind
// the same loopback origin, which is `localhost` because a passkey needs a domain name, not an IP address. Synthetic data only.
// At every step: no horizontal scroll, nothing outside the viewport, every control at least 44 px, modals inside the screen.
// Screenshots: CARDYBARA_SHOTS=<dir> node --test tests/account-passkey-phone.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PHONE, withPhone} from './helpers/mobile-chrome.mjs';
import {prepareWebTestBuild} from './helpers/web-test-build.mjs';
import {staticHandler} from '../scripts/web-chrome.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';
import {localGateway, memoryD1, memoryMail} from '../gateway/src/local.mjs';
import {GUIDE_KEY} from '../src/webFirstLaunch.js';

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

// The wallet and the gateway on one loopback origin. The web build's gateway origin is replaced in the page by this one.
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
  const origin = `http://localhost:${server.address().port}`;
  gateway = localGateway({vars: {ALLOWED_ORIGINS: 'https://app.cardybara.test', PASSKEY_ORIGIN: origin, ACCOUNT_EMAIL_FROM: 'Cardybara <no-reply@mail.cardybara.test>'}, bindings: {DB: db, EMAIL: mail}});
  const lastCode = to => /\b(\d{6})\b/.exec([...mail.sent].reverse().find(x => x.to === to)?.text || '')?.[1] ?? null;
  return {server, origin, db, lastCode};
}

// Runs before the page: sends the gateway calls to this page's own origin and records them. No service worker: it would
// answer a repeated same-origin GET from its cache, which the real gateway (another origin) never gets.
const INIT = `(()=>{const real=window.fetch.bind(window);window.__calls=[];navigator.serviceWorker.register=()=>new Promise(()=>{});
const get=navigator.credentials.get.bind(navigator.credentials);// The virtual authenticator answers a conditional (autofill) request at once; a real one waits for the user to pick it. Wait here, so the sign-in button is what signs in.
navigator.credentials.get=o=>o?.mediation==='conditional'?new Promise((_,no)=>o.signal?.addEventListener('abort',()=>no(new DOMException('aborted','AbortError')))):get(o);
window.fetch=(url,init={})=>{url=String(url);const k=url.indexOf('/v2/account');if(k<0)return real(url,init);window.__calls.push((init.method||'GET')+' '+url.slice(k));return real(url.slice(k),init);};})();`;

const TEXT = {
  'zh-CN': {signup: '注册', add: '添加通行密钥', out: '退出登录', pk: '用通行密钥登录'},
  'en-US': {signup: 'Sign up', add: 'Add a passkey', out: 'Sign out', pk: 'Sign in with a passkey'},
};
const EMAIL = 'synthetic.user@example.test', PASSWORD = 'synthetic-pass-0001';

async function walk(c, srv, lang) {
  const w = TEXT[lang], log = [];
  const check = async step => {
    await c.pause(450);
    const a = await c.audit();
    if (shots) { mkdirSync(shots, {recursive: true}); await c.shot(join(shots, `passkey-${lang}-${String(log.length + 1).padStart(2, '0')}-${step}.png`)); }
    log.push(step);
    assert.equal(a.vw, PHONE.width, `${lang} ${step}: phone width`);
    assert.ok(a.scrollWidth <= PHONE.width && a.bodyScrollWidth <= PHONE.width, `${lang} ${step}: horizontal scroll (${a.scrollWidth}px)`);
    assert.deepEqual(a.overflow, [], `${lang} ${step}: elements outside the viewport`);
    assert.deepEqual(a.small, [], `${lang} ${step}: controls under 44 px`);
    for (const m of a.modals) assert.ok(m.l >= 0 && m.r <= PHONE.width && m.t >= 0 && m.b <= PHONE.height + 1, `${lang} ${step}: ${m.cls} is outside the screen`);
  };
  const A = '.account-settings';
  // Chrome's own virtual authenticator: an internal, user-verifying, discoverable-credential authenticator.
  await c.page('WebAuthn.enable');
  const {authenticatorId} = await c.page('WebAuthn.addVirtualAuthenticator', {options: {protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true}});
  await c.goto('/#settings');
  await c.until(`document.querySelector('${A} input[type=email]')`, 'the sign-in form');
  await c.until(`window.__calls.includes('GET /v2/account/passkey/status')`, 'the passkey status call');
  await check('signed-out');
  // Sign up with an emailed code (the code is read from the stand-in mailbox).
  await c.tap(`${A} .ant-segmented-item`, w.signup);
  await c.pause(200);
  await c.type(`${A} input[type=email]`, EMAIL);
  await c.type(`${A} input[autocomplete=new-password]`, PASSWORD);
  await c.tap(`${A} .ant-btn-primary`);
  await c.until(`document.querySelector('${A} input[autocomplete=one-time-code]')`, 'the code step');
  await c.type(`${A} input[autocomplete=one-time-code]`, srv.lastCode(EMAIL));
  await c.tap(`${A} .ant-btn-primary`);
  await c.until(`document.querySelector('${A} .account-email')`, 'the signed-in view');
  // Sync is on by default after sign-in (#579): the switch is already on, no tap.
  await c.until(`document.querySelector('${A} .ant-switch-checked')`, 'sync on');
  await c.until(`window.__calls.some(x=>x.startsWith('PUT')&&x.endsWith('/wallet'))`, 'the wallet copy upload');
  await check('signed-in');
  const wallet = srv.db.tables.get('wallets')[0];
  assert.ok(wallet && wallet.revision >= 1, `${lang}: the server holds a wallet copy`);
  const walletBefore = JSON.stringify(wallet);
  // The signed-in browser session's user, read from the server's own session table.
  const sessionUser = async () => {
    const token = await c.evaluate(`JSON.parse(localStorage.getItem('cardybara-account-session-v1')).token`);
    const hash = createHash('sha256').update(token).digest('hex');
    return srv.db.tables.get('sessions').find(r => r.token_hash === hash)?.user_id;
  };
  assert.equal(await sessionUser(), wallet.user_id, `${lang}: the password session belongs to the wallet's user`);
  // Add a passkey.
  await c.until(`document.querySelector('${A} .account-passkeys')`, 'the passkey section');
  await c.tap(`${A} .account-passkeys .ant-btn`, w.add);
  await c.until(`document.querySelectorAll('${A} .account-passkeys .ant-flex').length>=1`, 'the passkey in the list');
  const {credentials} = await c.page('WebAuthn.getCredentials', {authenticatorId});
  assert.equal(credentials.length, 1, `${lang}: the authenticator holds one discoverable credential`);
  assert.equal(srv.db.tables.get('passkeys').length, 1, `${lang}: the gateway stored it`);
  await check('passkey-added');
  // Sign out: the session goes, the wallet stays.
  await c.tap(`${A} .ant-btn`, w.out);
  await c.until(`document.querySelector('${A} input[type=email]')`, 'signed out');
  assert.equal(await c.evaluate(`localStorage.getItem('cardybara-account-session-v1')`), null, `${lang}: the session is gone`);
  await check('signed-out-again');
  // Sign in with the passkey: no email, no password.
  await c.tap(`${A} .account-passkey-signin`, w.pk);
  await c.until(`document.querySelector('${A} .account-email')`, 'signed in with the passkey');
  assert.ok((await c.text()).includes(EMAIL), `${lang}: the passkey signs in the same account`);
  assert.equal(await sessionUser(), wallet.user_id, `${lang}: the passkey session belongs to the same user as the wallet copy`);
  assert.equal(JSON.stringify(srv.db.tables.get('wallets')[0]), walletBefore, `${lang}: the wallet copy is unchanged`);
  const after = (await c.page('WebAuthn.getCredentials', {authenticatorId})).credentials[0].signCount;
  assert.ok(after > credentials[0].signCount, `${lang}: the authenticator counted the sign-in`);
  assert.equal(srv.db.tables.get('passkeys')[0].sign_count, after, `${lang}: the counter moved with the authenticator`);
  await check('passkey-signed-in');
  // Removing it ends passkey sign-in.
  await c.tap(`${A} .account-passkeys .ant-btn-sm`);// the small button beside the passkey is Remove
  await c.until(`window.__calls.some(x=>x.startsWith('DELETE /v2/account/passkey/'))`, 'the passkey removal');
  await c.until(`window.__calls.some(x=>x.startsWith('DELETE /v2/account/passkey/'))&&document.querySelectorAll('${A} .account-passkeys .ant-flex').length===0`, 'the empty list');
  assert.equal(srv.db.tables.get('passkeys').length, 0, `${lang}: the gateway forgot it`);
  await check('passkey-removed');
  await c.page('WebAuthn.removeVirtualAuthenticator', {authenticatorId});
  return log;
}

for (const lang of ['zh-CN', 'en-US']) {
  test(`passkey sign-in at 375 px (${lang}): add, sign out, sign in with it, same wallet`, {timeout: 120000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
    const srv = await startServer();
    try {
      const steps = await withPhone(c => walk(c, srv, lang), {origin: srv.origin, init: `localStorage.setItem('cardybara-language',${JSON.stringify(lang)});localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');${INIT}`});
      assert.equal(steps.length, 6);
    } finally { srv.server.closeAllConnections?.(); srv.server.close(); }
  });
}
