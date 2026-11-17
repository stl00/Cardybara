// #471 (split from #416): the cross-device path in real Chrome. The packaged extension signs in with an email and password
// against a local gateway (the gateway's own code on in-memory D1 and mail), reads the synthetic bank and syncs the wallet;
// then the built PWA, in a second profile at phone width with two manual cards, signs in, syncs once and shows the bank-read
// amounts with the 'From your bank' label. The synced document is checked for anything the bank gave that must never leave
// the extension. Synthetic data only; no bank, no live service. Negative control: an extension that never turns sync on
// leaves the PWA without the amounts, and the same assertions fail.
// Runs only in CI's `npm run test:web` (SEPARATE in scripts/run-tests.mjs), where release/ and dist/web are both built.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {run, GATEWAY_HOST, PAGE_HOST} from '../scripts/e2e-extension.mjs';
import {WEB_DIR, withPhone} from './helpers/mobile-chrome.mjs';
import {staticHandler} from '../scripts/web-chrome.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';
import {localGateway, memoryD1, memoryMail} from '../gateway/src/local.mjs';
import {createAccountClient} from '../src/accountClient.js';
import {newWalletCard} from '../src/walletRegistry.js';
import {GUIDE_KEY} from '../src/webFirstLaunch.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const RELEASE = join(root, 'release');
const required = process.env.npm_lifecycle_event === 'test:web';
const EMAIL = 'synthetic.user@example.test', PASSWORD = 'synthetic-pass-0001';
const GATEWAY = 'https://' + GATEWAY_HOST, PAGE = 'https://' + PAGE_HOST;
// What the synthetic bank shows for the two cards, as the main path of the E2E already reads them.
const BANK_AMOUNTS = ['1,234.56', '67.89'];
const MANUAL = [['Synthetic Manual One', '1111'], ['Synthetic Manual Two', '2222']];
const MIGRATION = readFileSync(join(root, 'gateway/migrations/0001_accounts.sql'), 'utf8');

const skip = (!required && !(existsSync(RELEASE) && existsSync(WEB_DIR)) && 'release/ or dist/web is not built; npm run test:web runs this')
  || await findChrome().then(() => false, () => 'no Chrome on this machine');

const setNative = (selector, value) => `(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`;

async function scenario({syncOn}) {
  assert.ok(!required || (existsSync(RELEASE) && existsSync(WEB_DIR)), 'release/ and dist/web must be built before npm run test:web');
  const db = memoryD1(); await db.exec(MIGRATION);
  const mail = memoryMail();
  const out = {};
  const walletDoc = () => JSON.stringify([...db.tables.get('wallets')]);
  await run(RELEASE, {
    out: join(root, '.debug/e2e-sync'),
    afterMain: async ctx => {
      const {id, evaluate, until, pageText, bank, note, StepError, words} = ctx;
      // The gateway: its own account code, allowing the extension's origin and the PWA's.
      const g = localGateway({vars: {ALLOWED_ORIGINS: `chrome-extension://${id},${PAGE}`, ACCOUNT_EMAIL_FROM: 'Cardybara <no-reply@mail.cardybara.test>'}, bindings: {DB: db, EMAIL: mail}, log: () => {}});
      bank.gateway.handle = g.handle;
      // The account exists already (sign-up needs the emailed code); both devices then sign in with email and password.
      const api = createAccountClient({gateway: GATEWAY, storage: {getItem: () => null, setItem() {}, removeItem() {}}, fetchFn: (url, init) => g.handle(new Request(url, {method: init.method, body: init.body, headers: {Origin: PAGE, ...init.headers}}))});
      assert.equal((await api.signUp(EMAIL, PASSWORD)).ok, true);
      const code = /\b(\d{6})\b/.exec(mail.sent.at(-1)?.text || '')?.[1];
      assert.ok(code, 'the verification mail carried a code');
      assert.equal((await api.verify(EMAIL, code)).ok, true);

      // The extension: sign in from the settings page with the email and the password, turn sync on, wait for the first sync.
      await evaluate('wallet', 'location.hash="settings"');
      await until('the sign-in form', () => evaluate('wallet', `!!document.querySelector('.account-settings input[type=email]')`));
      await evaluate('wallet', setNative('.account-settings input[type=email]', EMAIL));
      await evaluate('wallet', setNative('.account-settings input[type=password]', PASSWORD));
      await until('the sign-in to finish', async () => {
        await evaluate('wallet', `(()=>{const b=document.querySelector('.account-settings .ant-btn-primary');if(b&&!b.disabled&&!document.querySelector('.account-email'))b.click();return true})()`);
        return evaluate('wallet', `!!document.querySelector('.account-email')`);
      });
      assert.ok((await pageText('wallet')).includes(EMAIL), 'the extension shows the signed-in account');
      if (syncOn) {
        await until('sync to be turned on', async () => { await evaluate('wallet', `(()=>{const s=document.querySelector('.account-sync-switch button[role=switch]');if(s&&s.getAttribute('aria-checked')!=='true')s.click();return true})()`); return evaluate('wallet', `document.querySelector('.account-sync-switch button[role=switch]')?.getAttribute('aria-checked')==='true'`); });
        await until('the extension to sync', async () => { const t = await pageText('wallet'); return JSON.parse(words('已同步')).some(w => t.includes(w)); });
        await until('the wallet document on the server', async () => walletDoc().includes('1234.56'));
      }
      note('extension signed in' + (syncOn ? ' and synced' : ' with sync left off'));

      // The PWA: a second profile at phone width, two manual cards, signed in with the same account, one sync.
      bank.page.handle = await staticHandler(WEB_DIR);
      const cards = MANUAL.map(([name, tail], i) => newWalletCard({bank: 'Chase', name, tail}, 'manual-' + (i + 1)));
      const requested = [];
      out.pwa = await withPhone(async c => {
        await c.goto('/#settings');
        await c.until(`document.querySelector('.account-settings input[type=email]')`, 'the PWA sign-in form');
        await c.type('.account-settings input[type=email]', EMAIL);
        await c.type('.account-settings input[type=password]', PASSWORD);
        await c.tap('.account-settings .ant-btn-primary');
        await c.until(`document.querySelector('.account-email')`, 'the PWA to sign in', 15000);
        await c.tap('.account-sync-switch .ant-switch');
        await c.until(`document.querySelector('.account-sync-status')&&/Synced|已同步|已同步/.test(document.querySelector('.account-sync-status').innerText)`, 'the PWA to sync', 20000);
        await c.evaluate(`location.hash='wallet'`);
        await c.until(`document.querySelector('.card-title')`, 'the cards');
        await c.pause(500);
        return {text: await c.text(), audit: await c.audit(), sources: await c.evaluate(`[...document.querySelectorAll('.card-source')].map(e=>e.innerText)`)};
      }, {
        origin: PAGE,
        args: [`--host-rules=MAP ${GATEWAY_HOST} 127.0.0.1:${bank.port}, MAP ${PAGE_HOST} 127.0.0.1:${bank.port}`, '--ignore-certificate-errors-spki-list=' + bank.spki],
        init: `localStorage.setItem('cardybara-language','en-US');localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');if(!localStorage.getItem('cardybara-wallet-cards-v1'))localStorage.setItem('cardybara-wallet-cards-v1',${JSON.stringify(JSON.stringify(cards))});`,
        onEvent: msg => { if (msg.method === 'Network.requestWillBeSent') requested.push(msg.params?.request?.url); },
      });
      out.requested = requested;
    },
  });
  out.document = walletDoc();
  out.mail = mail;
  return out;
}

function assertPwa(r) {
  for (const amount of BANK_AMOUNTS) assert.ok(r.pwa.text.includes(amount), `the PWA shows the bank-read amount ${amount}`);
  assert.ok(r.pwa.sources.length >= 2 && r.pwa.sources.every(s => s.includes('From your bank')), 'the bank cards carry the "From your bank" label: ' + JSON.stringify(r.pwa.sources));
  for (const [name] of MANUAL) assert.ok(r.pwa.text.includes(name), `the manual card ${name} is still there`);
}

test('the extension signs in, reads the fixture bank and syncs; the PWA shows the bank amounts after one sync', {timeout: 240000, skip}, async () => {
  const r = await scenario({syncOn: true});
  assertPwa(r);
  assert.ok(r.pwa.audit.scrollWidth <= 375, `no horizontal scroll on the PWA (${r.pwa.audit.scrollWidth}px)`);
  // Only the page's own origin and the gateway were reached.
  for (const u of r.requested.filter(u => u && !/^(data|blob|about):/.test(u))) assert.ok([PAGE, GATEWAY].includes(new URL(u).origin), 'a request went to ' + u);

  // The synced document holds the amounts and read times; nothing of the bank login or the page.
  const doc = r.document;
  assert.ok(doc.includes('1234.56') && doc.includes('67.89'), 'the document holds the bank-read amounts');
  assert.ok(!doc.includes(PASSWORD), 'the account password is not in the document');
  for (const bad of ['cookie', 'evidence', 'pageText', 'html', 'tabId', 'sign-in', 'Sign in', 'one-time', 'passcode', 'Authorization'])
    assert.ok(!doc.toLowerCase().includes(bad.toLowerCase()), `${bad} is not in the document`);
});

test('negative control: an extension that never turns sync on leaves the PWA without the bank amounts, so the checks fail', {timeout: 240000, skip}, async () => {
  const r = await scenario({syncOn: false});
  assert.ok(!r.document.includes('1234.56'), 'nothing was synced from the extension');
  assert.throws(() => assertPwa(r), 'the positive assertions fail on this PWA');
});
