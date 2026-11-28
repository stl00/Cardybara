// #472: the PWA half of the extension passkey sign-in, in real headless Chrome with a virtual authenticator. A passkey is made on
// the web origin; then the sign-in route /#extension-signin/<extension-id> signs in with it and sends the browser to
// https://<extension-id>.chromiumapp.org/ with the session in the fragment (seen as the navigation Chrome is asked to make).
// An invalid id shows an error and navigates nowhere. Synthetic data only; the loopback origin is `localhost` because a passkey needs a name.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PHONE, withPhone} from './helpers/mobile-chrome.mjs';
import {prepareWebTestBuild} from './helpers/web-test-build.mjs';
import {staticHandler} from '../scripts/web-chrome.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';
import {localGateway, memoryD1, memoryMail} from '../gateway/src/local.mjs';
import {GUIDE_KEY} from '../src/webFirstLaunch.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIGRATION = ['0001_accounts', '0002_passkeys'].map(f => readFileSync(join(root, 'gateway/migrations', f + '.sql'), 'utf8')).join('\n');
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

const INIT = `(()=>{const real=window.fetch.bind(window);window.__calls=[];navigator.serviceWorker.register=()=>new Promise(()=>{});
const get=navigator.credentials.get.bind(navigator.credentials);
navigator.credentials.get=o=>o?.mediation==='conditional'?new Promise((_,no)=>o.signal?.addEventListener('abort',()=>no(new DOMException('aborted','AbortError')))):get(o);
window.fetch=(url,init={})=>{url=String(url);const k=url.indexOf('/v2/account');if(k<0)return real(url,init);window.__calls.push((init.method||'GET')+' '+url.slice(k));return real(url.slice(k),init);};})();`;
const ID = 'abcdefghijklmnopabcdefghijklmnop';
const EMAIL = 'synthetic.user@example.test', PASSWORD = 'synthetic-pass-0001';
const A = '.account-settings';

test('extension sign-in route: passkey made on the web signs in and redirects to the extension target with a fragment', {timeout: 120000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
  const srv = await startServer();
  const navigations = [];
  try {
    await withPhone(async c => {
      await c.page('WebAuthn.enable');
      await c.page('WebAuthn.addVirtualAuthenticator', {options: {protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true}});
      // Make an account and a passkey on the web origin.
      await c.goto('/#account');
      await c.until(`document.querySelector('${A} input[type=email]')`, 'the sign-in form');
      await c.until(`window.__calls.includes('GET /v2/account/passkey/status')`, 'the passkey status call');
      await c.tap(`${A} .ant-segmented-item`, 'Sign up');
      await c.pause(200);
      await c.type(`${A} input[type=email]`, EMAIL);
      await c.type(`${A} input[autocomplete=new-password]`, PASSWORD);
      await c.tap(`${A} .ant-btn-primary`);
      await c.until(`document.querySelector('${A} input[autocomplete=one-time-code]')`, 'the code step');
      await c.type(`${A} input[autocomplete=one-time-code]`, srv.lastCode(EMAIL));
      await c.tap(`${A} .ant-btn-primary`);
      await c.until(`document.querySelector('${A} .account-email')`, 'the signed-in view');
      await c.until(`document.querySelector('${A} .account-passkeys')`, 'the passkey section');
      await c.tap(`${A} .account-passkeys .ant-btn`, 'Add a passkey');
      await c.until(`document.querySelectorAll('${A} .account-passkeys .ant-flex').length>=1`, 'the passkey in the list');
      assert.equal(srv.db.tables.get('passkeys').length, 1);
      await c.tap(`${A} .ant-btn`, 'Sign out');
      await c.until(`document.querySelector('${A} input[type=email]')`, 'signed out');
      const wallet = JSON.stringify(srv.db.tables.get('wallets') ?? []);

      // An invalid id: an error, no button, no navigation.
      await c.page('Page.navigate', {url: 'about:blank'});// a fresh load, as launchWebAuthFlow does
      await c.goto('/#extension-signin/evil.example');
      await c.until(`document.querySelector('.extension-signin')`, 'the sign-in route');
      assert.equal(await c.evaluate(`!!document.querySelector('.extension-signin .ant-btn')`), false, 'no sign-in button for a bad id');
      assert.ok((await c.text()).includes('isn\'t valid'));
      assert.deepEqual(navigations.filter(u => u.includes('chromiumapp')), []);

      // A valid id: the passkey signs in and the browser is sent to the exact target with the session in the fragment.
      await c.page('Page.navigate', {url: 'about:blank'});
      await c.goto('/#extension-signin/' + ID);
      await c.until(`document.querySelector('.extension-signin .ant-btn-primary')`, 'the sign-in button');
      await c.tap('.extension-signin .ant-btn-primary');
      for (let i = 0; i < 100 && !navigations.some(u => u.includes('chromiumapp')); i++) await c.pause(100);
      const target = navigations.find(u => u.includes('chromiumapp'));
      assert.ok(target, 'the browser was sent to the extension redirect target');
      const u = new URL(target);
      assert.equal(u.origin + u.pathname, `https://${ID}.chromiumapp.org/`);
      assert.equal(u.search, '', 'nothing in the query');
      const p = new URLSearchParams(u.hash.slice(1));
      assert.equal(p.get('email'), EMAIL);
      assert.ok(p.get('token'));
      // The token is a session for the same account whose wallet copy is untouched.
      const hash = createHash('sha256').update(p.get('token')).digest('hex');
      assert.ok(srv.db.tables.get('sessions').some(r => r.token_hash === hash), 'the token is a live session');
      assert.equal(JSON.stringify(srv.db.tables.get('wallets') ?? []), wallet);
    }, {origin: srv.origin, init: `localStorage.setItem('cardybara-language','en-US');localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');${INIT}`,
      onEvent: msg => { if (msg.method === 'Page.frameRequestedNavigation') navigations.push(msg.params.url); }});
  } finally { srv.server.closeAllConnections?.(); srv.server.close(); }
});
