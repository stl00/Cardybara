// #500: the header's account entry in real headless Chrome (dist/web, loopback only). The gateway is an in-page fetch stub for
// /v2/account and navigator.credentials.get answers a synthetic credential, so no account service, authenticator or network is
// used. Signed out: a plain Sign in button, nothing opens by itself. Sign in from the header by passkey and by email, see the
// avatar, watch its sync dot follow the sync status event, sign out. Phone: bottom sheet; desktop: modal and popover.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WEB_DIR, PHONE, withPhone} from './helpers/mobile-chrome.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';
import {GUIDE_KEY} from '../src/webFirstLaunch.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const newest = dir => readdirSync(dir, {withFileTypes: true}).reduce((m, e) => Math.max(m, e.isDirectory() ? newest(join(dir, e.name)) : statSync(join(dir, e.name)).mtimeMs), 0);
function ensureBuild() {
  const index = join(WEB_DIR, 'index.html');
  if (existsSync(index) && statSync(index).mtimeMs >= Math.max(newest(join(root, 'src')), statSync(join(root, 'index.html')).mtimeMs)) return;
  const built = spawnSync('npm', ['run', 'build:web'], {cwd: root, encoding: 'utf8'});
  assert.equal(built.status, 0, 'npm run build:web failed:\n' + built.stdout.slice(-2000) + built.stderr.slice(-2000));
}
const chrome = await findChrome().then(() => { ensureBuild(); return withPhone(async () => true); }, () => false).then(ok => ok || false, err => {
  if (process.env.GITHUB_ACTIONS) throw err;
  console.warn('Chrome found but cannot start here, phone tests skipped: ' + err.message);
  return false;
});

const EMAIL = 'synthetic.user@example.test', PASSWORD = 'synthetic-pass-0001';
// Runs before the page: answers the gateway's account and passkey routes from memory and fakes the authenticator.
const STUB = `(()=>{const real=window.fetch.bind(window);const J=(s,b)=>new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json'}});
window.__calls=[];const token=()=>({token:'cbs_'+'A'.repeat(43),expiresAt:Math.floor(Date.now()/1000)+86400});
window.fetch=async(url,init={})=>{url=String(url);if(!url.includes('/v2/account'))return real(url,init);
 const path=url.slice(url.indexOf('/v2/account')).split('?')[0],method=init.method||'GET',body=init.body?JSON.parse(init.body):null;window.__calls.push(method+' '+path);
 if(path==='/v2/account/passkey/status')return J(200,{enabled:true});
 if(path==='/v2/account/passkey/login/options')return J(200,{challengeId:'synthetic-challenge',publicKey:{challenge:'AAAA',rpId:location.hostname,allowCredentials:[],userVerification:'preferred'}});
 if(path==='/v2/account/passkey/login/verify')return J(200,{...token(),email:${JSON.stringify(EMAIL)}});
 if(path==='/v2/account/passkey')return J(200,{passkeys:[]});
 if(path==='/v2/account/session')return method==='DELETE'?J(200,{status:'signed_out'}):body?.password===${JSON.stringify(PASSWORD)}?J(200,token()):J(401,{error:{code:'invalid_credentials'}});
 if(path==='/v2/account/wallet')return method==='GET'?J(200,{revision:0,formatVersion:null,document:null,updatedAt:null}):J(200,{revision:1,size:10});
 return J(400,{error:{code:'bad_request'}});};
const buf=n=>new Uint8Array(n).buffer;
Object.defineProperty(navigator.credentials,'get',{configurable:true,value:async()=>({id:'synthetic-credential',rawId:buf(4),type:'public-key',response:{clientDataJSON:buf(8),authenticatorData:buf(8),signature:buf(8),userHandle:buf(4)}})});})();`;
const init = lang => `${STUB}localStorage.setItem('cardybara-language',${JSON.stringify(lang)});localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');`;
const entry = c => c.evaluate(`(()=>{const e=document.querySelector('.app-header .account-entry');return e?{text:e.innerText.split(' ').join('').trim(),avatar:e.classList.contains('account-avatar'),sync:e.dataset.sync||null}:null})()`);
const openDialogs = c => c.evaluate(`document.querySelectorAll('.ant-modal-wrap:not([style*="display: none"]) .ant-modal-container,.ant-drawer-open .ant-drawer-section').length`);
// The header stays one 64 px row (title and account entry centred on the same line) with no horizontal scroll.
async function oneRow(c, what) {
  const h = await c.evaluate(`(()=>{const hd=document.querySelector('.app-header').getBoundingClientRect(),mid=e=>{const r=document.querySelector(e).getBoundingClientRect();return (r.top+r.bottom)/2};return {h:Math.round(hd.height),d:Math.abs(mid('.app-header .page-title')-mid('.app-header .account-entry')),sw:document.documentElement.scrollWidth}})()`);
  assert.ok(h.h <= 72, `${what}: header ${h.h}px tall`);
  assert.ok(h.d <= 4, `${what}: title and account entry are not on one row (${h.d}px apart)`);
  assert.ok(h.sw <= PHONE.width, `${what}: horizontal scroll (${h.sw}px)`);
}
const SIGN_IN = {'zh-CN': '登录', 'zh-TW': '登入', 'en-US': 'Signin'};

for (const lang of ['zh-CN', 'zh-TW', 'en-US']) {
  test(`${lang} phone: signed out shows Sign in and opens nothing; passkey sign-in from the header; sync dot; sign out`, {timeout: 90000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
    ensureBuild();
    await withPhone(async c => {
      await c.goto('/#overview');
      await c.pause(1200);
      assert.deepEqual(await entry(c), {text: SIGN_IN[lang], avatar: false, sync: null}, `${lang}: a plain Sign in button`);
      assert.equal(await openDialogs(c), 0, `${lang}: nothing opens by itself while signed out`);
      await oneRow(c, `${lang} signed out`);
      await c.tap('.app-header .account-entry');
      await c.until(`document.querySelector('.account-drawer.ant-drawer-open .account-passkey-signin')`, 'the sign-in sheet with the passkey first');
      await c.pause(400);
      const first = await c.evaluate(`(()=>{const b=[...document.querySelectorAll('.account-drawer .account-sheet .ant-btn')];return {first:b[0]?.classList.contains('account-passkey-signin'),primary:b[0]?.classList.contains('ant-btn-primary')}})()`);
      assert.deepEqual(first, {first: true, primary: true}, `${lang}: the passkey is the first, primary action`);
      await c.tap('.account-drawer .account-passkey-signin');
      await c.until(`document.querySelector('.app-header .account-avatar')`, 'the avatar after a passkey sign-in');
      await c.pause(600);
      assert.equal((await entry(c)).text, 'S', `${lang}: the avatar shows the email's first letter`);
      await oneRow(c, `${lang} signed in`);
      assert.ok((await c.evaluate('window.__calls')).includes('POST /v2/account/passkey/login/verify'), `${lang}: signed in through the passkey route`);
      assert.equal(await c.evaluate(`!!document.querySelector('.account-drawer.ant-drawer-open')`), false, `${lang}: the sheet closes after signing in`);
      assert.equal((await entry(c)).sync, 'off', `${lang}: no sync dot while sync is off`);

      // Sync on from the avatar sheet, then the dot follows the status event.
      await c.tap('.app-header .account-avatar');
      await c.until(`document.querySelector('.account-drawer.ant-drawer-open .account-sync-switch .ant-switch')`, 'the account sheet');
      await c.pause(400);
      await c.tap('.account-drawer .account-sync-switch .ant-switch');
      await c.until(`document.querySelector('.app-header .account-avatar').dataset.sync!=='off'`, 'a sync dot');
      for (const s of ['offline', 'error', 'synced']) {
        await c.evaluate(`window.dispatchEvent(new CustomEvent('cardybara-sync-status',{detail:${JSON.stringify(s)}}))`);
        await c.pause(150);
        assert.equal((await entry(c)).sync, s, `${lang}: the dot shows ${s}`);
        assert.equal(await c.evaluate(`!!document.querySelector('.app-header .sync-dot-${s}')`), true);
      }
      await c.tap('.account-drawer .account-signout');
      await c.until(`document.querySelector('.app-header .account-entry:not(.account-avatar)')`, 'Sign in again after signing out');
      await c.pause(700);
      assert.equal(await openDialogs(c), 0, `${lang}: signing out opens nothing by itself`);
    }, {init: init(lang)});
  });
}

test('phone: email sign-in from the header sheet, with the existing error text for a wrong password', {timeout: 60000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
  ensureBuild();
  await withPhone(async c => {
    await c.goto('/#wallet');
    await c.pause(1000);
    await c.tap('.app-header .account-entry');
    await c.until(`document.querySelector('.account-drawer.ant-drawer-open input[type=email]')`, 'the email form');
    await c.pause(400);
    await c.type('.account-drawer input[type=email]', EMAIL);
    await c.type('.account-drawer input[autocomplete=current-password]', 'wrong-password-000');
    await c.tap('.account-drawer .account-email-submit');
    await c.until(`document.querySelector('.account-drawer [role=alert]')`, 'the error');
    assert.match(await c.evaluate(`document.querySelector('.account-drawer [role=alert]').innerText`), /email or password/i);
    await c.type('.account-drawer input[autocomplete=current-password]', PASSWORD);
    await c.tap('.account-drawer .account-email-submit');
    await c.until(`document.querySelector('.app-header .account-avatar')`, 'the avatar after an email sign-in');
    const a = await c.audit();
    assert.ok(a.scrollWidth <= PHONE.width, 'no horizontal scroll');
  }, {init: init('en-US')});
});

test('desktop: Sign in opens a modal; the signed-in avatar opens a popover with the account', {timeout: 60000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
  ensureBuild();
  await withPhone(async c => {
    await c.page('Emulation.setDeviceMetricsOverride', {width: 1280, height: 800, deviceScaleFactor: 1, mobile: false});
    await c.goto('/#overview');
    await c.pause(1000);
    await c.tap('.app-header .account-entry');
    await c.until(`document.querySelector('.account-modal .account-passkey-signin')`, 'the sign-in modal');
    await c.pause(400);
    await c.type('.account-modal input[type=email]', EMAIL);
    await c.type('.account-modal input[autocomplete=current-password]', PASSWORD);
    await c.tap('.account-modal .account-email-submit');
    await c.until(`document.querySelector('.app-header .account-avatar')`, 'the avatar');
    await c.pause(500);
    await c.tap('.app-header .account-avatar');
    await c.until(`document.querySelector('.account-popover .account-email')`, 'the account popover');
    const shown = await c.evaluate(`document.querySelector('.account-popover .account-email').innerText`);
    assert.equal(shown, 'sy•••@example.test', 'the popover masks the email');
    assert.ok(await c.evaluate(`!!document.querySelector('.account-settings')===false`), 'the full Settings card is not in the header');
    await c.tap('.account-popover .account-signout');
    await c.until(`document.querySelector('.app-header .account-entry:not(.account-avatar)')`, 'Sign in after signing out');
    await c.pause(700);
    assert.equal(await openDialogs(c), 0, 'signing out on desktop opens no sign-in modal');
  }, {init: init('en-US')});
});
