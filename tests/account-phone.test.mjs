// #415: the account screens in Settings on a 375x812 phone, in real headless Chrome (dist/web, loopback only). The gateway
// is a tiny in-page stand-in (a fetch stub for /v2/account), so no account service, mail or network is used.
// Sign in form -> sign up -> emailed code -> signed in -> sync on -> change password -> delete account (modal) -> signed out.
// At every step: no horizontal scroll, nothing outside the viewport, every control at least 44 px, modals inside the screen.
// Screenshots: CARDYBARA_SHOTS=<dir> node --test tests/account-phone.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, statSync} from 'node:fs';
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
const shots = process.env.CARDYBARA_SHOTS ? resolve(process.env.CARDYBARA_SHOTS) : null;

// Runs before the page: answers the gateway's account routes from memory, passes every other request through.
const STUB = `(()=>{const real=window.fetch.bind(window);const J=(s,b)=>new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json'}});
window.__calls=[];
window.fetch=async(url,init={})=>{url=String(url);if(!url.includes('/v2/account'))return real(url,init);
 const path=url.slice(url.indexOf('/v2/account')),body=init.body?JSON.parse(init.body):null;window.__calls.push(init.method+' '+path);
 const ok=(b)=>J(200,b),bad=(c,s=401)=>J(s,{error:{code:c}});
 if(path.endsWith('/signup'))return J(202,{status:'code_sent'});
 if(path.endsWith('/verify'))return body.code==='123456'?ok({token:'cbs_'+'A'.repeat(43),expiresAt:Math.floor(Date.now()/1000)+86400}):bad('code_invalid');
 if(path.endsWith('/wallet'))return init.method==='GET'?ok({revision:0,formatVersion:null,document:null,updatedAt:null}):ok({revision:1,size:10});
 if(path.endsWith('/password'))return body.currentPassword==='synthetic-pass-0001'?ok({status:'changed'}):bad('invalid_credentials');
 if(path.endsWith('/session'))return init.method==='DELETE'?ok({status:'signed_out'}):bad('invalid_credentials');
 if(path.endsWith('/v2/account'))return body.password==='synthetic-pass-0001'?ok({status:'deleted'}):bad('invalid_credentials');
 return bad('bad_request',400);};})();`;

const TEXT = {
  'zh-CN': {signup: '注册', del: '删除账号', change: '修改密码', purge: '永久删除账号'},
  'en-US': {signup: 'Sign up', del: 'Delete account', change: 'Change password', purge: 'Delete account permanently'},
};

async function walk(c, lang) {
  const w = TEXT[lang], log = [];
  const check = async step => {
    await c.pause(450);
    const a = await c.audit();
    if (shots) { mkdirSync(shots, {recursive: true}); await c.shot(join(shots, `account-${lang}-${String(log.length + 1).padStart(2, '0')}-${step}.png`)); }
    log.push(step);
    assert.equal(a.vw, PHONE.width, `${lang} ${step}: phone width`);
    assert.ok(a.scrollWidth <= PHONE.width && a.bodyScrollWidth <= PHONE.width, `${lang} ${step}: horizontal scroll (${a.scrollWidth}px)`);
    assert.deepEqual(a.overflow, [], `${lang} ${step}: elements outside the viewport`);
    assert.deepEqual(a.small, [], `${lang} ${step}: controls under 44 px`);
    for (const m of a.modals) assert.ok(m.l >= 0 && m.r <= PHONE.width && m.t >= 0 && m.b <= PHONE.height + 1, `${lang} ${step}: ${m.cls} is outside the screen`);
  };
  const A = '.account-settings';
  await c.goto('/#settings');
  await c.until(`document.querySelector('${A} input[type=email]')`, 'the sign-in form');
  await check('signed-out');
  await c.tap(`${A} .ant-segmented-item`, w.signup);
  await c.pause(200);
  await c.type(`${A} input[type=email]`, 'synthetic.user@example.test');
  await c.type(`${A} input[autocomplete=new-password]`, 'synthetic-pass-0001');
  await check('sign-up');
  await c.tap(`${A} .ant-btn-primary`);
  await c.until(`document.querySelector('${A} input[autocomplete=one-time-code]')`, 'the code step');
  await check('code');
  await c.type(`${A} input[autocomplete=one-time-code]`, '123456');
  await c.tap(`${A} .ant-btn-primary`);
  await c.until(`document.querySelector('${A} .account-email')`, 'the signed-in view');
  assert.ok((await c.text()).includes('synthetic.user@example.test'), `${lang}: the account email shows`);
  await check('signed-in');
  await c.tap(`${A} .ant-switch`);
  await c.until(`document.querySelector('${A} .ant-switch-checked')`, 'sync on');
  assert.ok(await c.evaluate(`JSON.parse(localStorage.getItem('cardybara-sync-v1')).on===true`), `${lang}: sync is on`);
  await c.until(`window.__calls.some(x=>x.startsWith('GET')&&x.endsWith('/wallet'))`, 'the first sync request');
  await check('sync-on');
  await c.tap(`${A} .ant-btn`, w.change);
  await c.until(`document.querySelector('${A} .account-password')`, 'the password form');
  await check('change-password');
  await c.tap(`${A} .account-password .ant-btn:not(.ant-btn-primary)`);
  await c.tap(`${A} .ant-btn-dangerous`, w.del);
  await c.until(`document.querySelector('.ant-modal-container input')`, 'the delete confirmation');
  await check('delete-confirm');
  await c.type('.ant-modal-container input', 'synthetic-pass-0001');
  await c.tap('.ant-modal-container .ant-btn-dangerous', w.purge);
  await c.until(`document.querySelector('${A} input[type=email]')`, 'signed out again');
  assert.equal(await c.evaluate(`localStorage.getItem('cardybara-account-session-v1')`), null, `${lang}: the session is gone`);
  assert.ok(await c.evaluate(`JSON.parse(localStorage.getItem('cardybara-sync-v1')).on===false`), `${lang}: sync is off`);
  assert.ok(await c.evaluate(`window.__calls.includes('DELETE /v2/account')`), `${lang}: the account delete was requested`);
  await check('deleted');
  return log;
}

for (const lang of ['zh-CN', 'en-US']) {
  test(`account screens at 375 px (${lang}): sign up, code, sync on, change password, delete`, {timeout: 120000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
    ensureBuild();
    const steps = await withPhone(c => walk(c, lang), {init: `localStorage.setItem('cardybara-language',${JSON.stringify(lang)});localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');${STUB}`});
    assert.equal(steps.length, 8);
  });
}
