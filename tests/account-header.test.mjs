// #500 (epic #496): the slim header and its account entry, in real headless Chrome on dist/web against a fake gateway
// (a fetch stub for /v2/account plus a virtual passkey in navigator.credentials). Synthetic data only; no network.
// Signed out: one "Sign in" button, nothing opens by itself. Sign in from the header by passkey and by email. Signed in: an
// avatar whose sync dot follows SYNC_STATUS_EVENT. 375 px: the header stays one row in zh-CN, zh-TW and en-US, signed out and in.
// Screenshots: CARDYBARA_SHOTS=<dir> node --test tests/account-header.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WEB_DIR, PHONE, withPhone} from './helpers/mobile-chrome.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';
import {GUIDE_KEY} from '../src/webFirstLaunch.js';
import {maskEmail, syncState, SYNC_STATUS_EVENT} from '../src/accountClient.js';

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
  console.warn('Chrome found but cannot start here, header tests skipped: ' + err.message);
  return false;
});
const shots = process.env.CARDYBARA_SHOTS ? resolve(process.env.CARDYBARA_SHOTS) : null;
const DESKTOP = {width: 1280, height: 800};
const EMAIL = 'synthetic.user@example.test', PASSWORD = 'synthetic-pass-0001';

const STUB = `(()=>{const real=window.fetch.bind(window);const J=(s,b)=>new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json'}});
window.__calls=[];
const session=()=>({token:'cbs_'+'A'.repeat(43),expiresAt:Math.floor(Date.now()/1000)+86400,email:${JSON.stringify(EMAIL)}});
if(typeof window.PublicKeyCredential==='undefined')window.PublicKeyCredential=function(){};
const buf=n=>new Uint8Array([n]).buffer;
Object.defineProperty(navigator,'credentials',{configurable:true,value:{create:async()=>null,get:async o=>o&&o.mediation==='conditional'?new Promise((_,no)=>o.signal&&o.signal.addEventListener('abort',()=>no(new Error('aborted')))):({id:'abc',rawId:buf(1),type:'public-key',response:{clientDataJSON:buf(1),authenticatorData:buf(2),signature:buf(3),userHandle:buf(4)}})}});
window.fetch=async(url,init={})=>{url=String(url);if(!url.includes('/v2/account'))return real(url,init);
 const path=url.slice(url.indexOf('/v2/account')),body=init.body?JSON.parse(init.body):null,m=init.method||'GET';window.__calls.push(m+' '+path);
 if(path.endsWith('/passkey/status'))return J(200,{enabled:true});
 if(path.endsWith('/passkey')&&m==='GET')return J(200,{passkeys:[{id:'k1',name:'Synthetic key'}]});
 if(path.endsWith('/login/options'))return J(200,{challengeId:'c1',publicKey:{challenge:'AQID',rpId:location.hostname}});
 if(path.endsWith('/login/verify'))return J(200,session());
 if(path.endsWith('/v2/account/session')&&m==='POST')return body.password===${JSON.stringify(PASSWORD)}?J(200,session()):J(401,{error:{code:'invalid_credentials'}});
 if(path.endsWith('/v2/account/session'))return J(200,{status:'signed_out'});
 if(path.endsWith('/wallet'))return m==='GET'?J(200,{revision:0,formatVersion:null,document:null,updatedAt:null}):J(200,{revision:1,size:10});
 return J(400,{error:{code:'bad_request'}});};})();`;
const initFor = lang => `localStorage.setItem('cardybara-language',${JSON.stringify(lang)});localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');${STUB}`;
const SIGN_IN = {'zh-CN': '登录', 'zh-TW': '登入', 'en-US': 'Sign in'};
const vis = `const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&+s.opacity!==0};`;
const headerRow = c => c.evaluate(`(()=>{${vis}const hd=document.querySelector('.app-header');const items=[...hd.querySelectorAll('button,.ant-select,.page-title')].filter(vis);const ys=items.map(e=>{const r=e.getBoundingClientRect();return (r.top+r.bottom)/2});return {height:hd.getBoundingClientRect().height,spread:ys.length?Math.max(...ys)-Math.min(...ys):0,n:items.length,right:Math.max(0,...items.map(e=>e.getBoundingClientRect().right)),lines:[...hd.querySelectorAll('.page-title,.account-signin')].map(e=>e.getClientRects().length)}})()`);
const shot = async (c, name) => { if (!shots) return; mkdirSync(shots, {recursive: true}); await c.shot(join(shots, name + '.png')); };
const status = (c, s) => c.evaluate(`window.dispatchEvent(new CustomEvent(${JSON.stringify(SYNC_STATUS_EVENT)},{detail:${JSON.stringify(s)}}))`);
const dot = c => c.evaluate(`document.querySelector('.account-avatar')?.dataset.sync`);
const sheetOpen = c => c.evaluate(`(()=>{${vis}return [...document.querySelectorAll('.account-sheet .ant-drawer-section,.account-sheet .ant-modal-container,.account-sheet.ant-modal')].some(vis)})()`);

test('masked email and sync dot state are pure', () => {
  assert.equal(maskEmail(EMAIL), 's***r@example.test');
  assert.equal(maskEmail('ab@example.test'), 'a@example.test');
  assert.equal(maskEmail(''), '');
  assert.equal(syncState(false, 'synced'), 'off');
  assert.equal(syncState(true, null), 'off');
  assert.deepEqual(['syncing', 'synced', 'offline', 'signed_out', 'newer', 'error'].map(s => syncState(true, s)), ['syncing', 'synced', 'offline', 'error', 'error', 'error']);
});

for (const lang of ['zh-CN', 'zh-TW', 'en-US']) {
  test(`${lang} 375 px: header is one row; sign in by passkey then email; avatar dot follows the sync status`, {timeout: 180000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
    await withPhone(async c => {
      await c.goto('/');
      await c.pause(600);
      // Signed out: one plain button, no sheet on its own, no breadcrumb, no collapse button, no language select.
      assert.ok(await c.evaluate(`!!document.querySelector('.account-signin')`), 'the Sign in button shows');
      assert.equal((await c.evaluate(`document.querySelector('.account-signin').innerText`)).replace(/\s/g, ''), SIGN_IN[lang].replace(/\s/g, ''));
      assert.equal(await sheetOpen(c), false, 'nothing opens on its own');
      assert.equal(await c.evaluate(`document.querySelectorAll('.app-header .ant-breadcrumb,.app-header .ant-select,.app-header [aria-label="折叠导航"],.app-header [aria-label="Collapse navigation"]').length`), 0, 'phone header: title and controls only');
      assert.ok(!(await c.evaluate(`window.__calls.join()`)).includes('passkey'), 'no gateway request before the sheet opens');
      let h = await headerRow(c);
      assert.ok(h.spread <= 8 && h.height <= 72 && h.right <= PHONE.width + 1 && h.lines.every(n => n === 1), `${lang}: signed-out header wrapped ${JSON.stringify(h)}`);
      await shot(c, `header-${lang}-signed-out`);
      // Passkey stub from the sheet.
      await c.tap('.account-signin');
      await c.until(`document.querySelector('.account-sheet .account-passkey-signin')`, 'the sign-in sheet with a passkey button');
      await c.pause(400);
      assert.ok(await c.evaluate(`!!document.querySelector('.account-sheet .account-passkey-signin.ant-btn-primary')`), 'the passkey button is the primary one');
      assert.ok(await c.evaluate(`!document.querySelector('.account-sheet .account-email-submit.ant-btn-primary')`), 'the email button is second');
      await shot(c, `header-${lang}-sheet`);
      const a = await c.audit();
      assert.deepEqual(a.small, [], `${lang}: sheet controls under 44 px`);
      assert.ok(a.scrollWidth <= PHONE.width, `${lang}: sheet causes horizontal scroll`);
      await c.tap('.account-sheet .account-passkey-signin');
      await c.until(`document.querySelector('.account-avatar')`, 'the avatar after the passkey sign-in');
      assert.ok((await c.evaluate(`window.__calls`)).includes('POST /v2/account/passkey/login/verify'), 'the passkey assertion reached the gateway');
      assert.equal((await c.evaluate(`document.querySelector('.account-avatar .ant-avatar').innerText`)).trim(), 'S');
      await c.pause(500);
      assert.equal(await sheetOpen(c), false, 'the sheet closes after signing in');
      assert.equal(await dot(c), 'off', 'sync is off by default: no dot');
      // Sync dot follows the event once sync is on.
      await c.until(`!document.querySelector('.ant-message-notice')`, 'the signed-in toast to clear', 8000); // it sits over the avatar for a few seconds
      await c.tap('.account-avatar');
      await c.until(`document.querySelector('.account-menu .ant-switch')`, 'the account drawer');
      await c.pause(400);
      const menuText = await c.evaluate(`document.querySelector('.account-menu').innerText`);
      assert.ok(menuText.includes('s***r@example.test') && !menuText.includes(EMAIL), 'the email is masked');
      await c.tap('.account-menu .ant-switch');
      await c.until(`document.querySelector('.account-avatar')?.dataset.sync==='syncing'||document.querySelector('.account-avatar')?.dataset.sync==='synced'`, 'sync on');
      await shot(c, `header-${lang}-menu`);
      await c.evaluate(`document.querySelector('.ant-drawer-mask').click()`);
      await c.until(`!document.querySelector('.ant-drawer')`, 'the drawer to close');
      const seen = [];
      for (const s of ['syncing', 'synced', 'offline', 'error']) { await status(c, s); await c.pause(100); seen.push(await dot(c)); }
      assert.deepEqual(seen, ['syncing', 'synced', 'offline', 'error'], 'the dot follows SYNC_STATUS_EVENT');
      assert.equal(await c.evaluate(`document.querySelector('.sync-dot')?.className`), 'sync-dot sync-dot-error');
      h = await headerRow(c);
      assert.ok(h.spread <= 8 && h.height <= 72 && h.right <= PHONE.width + 1, `${lang}: signed-in header wrapped ${JSON.stringify(h)}`);
      await shot(c, `header-${lang}-signed-in`);
      // Sign out from the menu, then sign in by email.
      await c.tap('.account-avatar');
      await c.until(`document.querySelector('.account-menu')`, 'the account drawer again');
      await c.pause(600);
      await c.tap('.account-menu [data-action="sign-out"]');
      await c.until(`document.querySelector('.account-signin')`, 'signed out again');
      assert.equal(await c.evaluate(`localStorage.getItem('cardybara-account-session-v1')`), null);
      await c.until(`!document.querySelector('.ant-message-notice')`, 'the signed-out toast to clear', 8000);
      await c.tap('.account-signin');
      await c.until(`document.querySelector('.account-sheet input[type=email]')`, 'the email field');
      await c.type('.account-sheet input[type=email]', EMAIL);
      await c.type('.account-sheet input[type=password]', PASSWORD);
      await c.tap('.account-sheet .account-email-submit');
      await c.until(`document.querySelector('.account-avatar')`, 'the avatar after the email sign-in');
      assert.ok((await c.evaluate(`window.__calls`)).includes('POST /v2/account/session'), 'the email sign-in reached the gateway');
    }, {init: initFor(lang)});
  });
}

test('1280 px: language stays, account opens a popover and a modal', {timeout: 120000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
  await withPhone(async c => {
    await c.page('Emulation.setDeviceMetricsOverride', {...DESKTOP, deviceScaleFactor: 1, mobile: false});
    await c.goto('/');
    await c.pause(600);
    assert.ok(await c.evaluate(`!!document.querySelector('.app-header .ant-select')`), 'language select on desktop');
    assert.ok(await c.evaluate(`!!document.querySelector('.app-header [aria-label="Collapse navigation"]')`), 'collapse button on desktop');
    assert.equal(await sheetOpen(c), false);
    await c.tap('.account-signin');
    await c.until(`document.querySelector('.account-sheet .account-passkey-signin')`, 'the modal');
    await c.pause(400);
    assert.ok(await c.evaluate(`!!document.querySelector('.account-sheet .ant-modal-container')`), 'desktop uses a Modal');
    await shot(c, 'header-1280-modal');
    await c.tap('.account-sheet .account-passkey-signin');
    await c.until(`document.querySelector('.account-avatar')`, 'the avatar');
    await c.until(`!document.querySelector('.ant-message-notice')`, 'the toast to clear', 8000);
    await c.tap('.account-avatar');
    await c.until(`document.querySelector('.ant-popover .account-menu')`, 'the popover');
    assert.ok(await c.evaluate(`document.querySelector('.ant-popover .account-menu').innerText.includes('s***r@example.test')`));
    await shot(c, 'header-1280-popover');
  }, {init: initFor('en-US')});
});
