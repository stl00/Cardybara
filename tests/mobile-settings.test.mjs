// #679: Settings on a 375x812 phone, in real headless Chrome (dist/web, loopback only). Signed in with three synthetic Plaid
// cards over two institutions; the gateway is an in-page stub, so no Plaid, account service or network is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {PHONE, withPhone} from './helpers/mobile-chrome.mjs';
import {prepareWebTestBuild} from './helpers/web-test-build.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';
import {GUIDE_KEY} from '../src/webFirstLaunch.js';

let buildDir;
const chrome = await findChrome().then(() => { buildDir = prepareWebTestBuild(); return withPhone(async () => true, {dir: buildDir}); }, () => false).then(ok => ok || false, err => {
  if (process.env.GITHUB_ACTIONS) throw err;
  console.warn('Chrome found but cannot start here, phone tests skipped: ' + err.message);
  return false;
});
const skip = !chrome && 'no working Chrome on this machine';

const READ = Math.floor(Date.parse('2026-11-18T12:00:00Z') / 1000);
const card = (n, itemId, institution, extra) => ({itemId, accountId: 'acc_' + n, institution, name: `Synthetic Card ${n}`, mask: String(n).repeat(4), currency: 'USD',
  balance: 10 * n, statementBalance: 5 * n, minimumPayment: 1, dueDate: '2026-12-0' + n, isOverdue: false, aprs: [], readAt: READ, ...extra});
// The healthy institution comes first in the answer, so the order on screen shows the sorting.
const PLAID = {
  items: [{itemId: 'item_1', institution: 'Chase', status: 'ok', historicalComplete: true}, {itemId: 'item_2', institution: 'Synthetic Platypus Bank', status: 'login_required', historicalComplete: true}],
  cards: [card(6, 'item_1', 'Chase'), card(7, 'item_1', 'Chase', {isOverdue: true}), card(8, 'item_2', 'Synthetic Platypus Bank')],
};

const init = signedIn => `(()=>{const real=window.fetch.bind(window);const J=(s,b)=>new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json'}});
window.__calls=[];let plaid=${JSON.stringify(PLAID)};
window.fetch=async(url,o={})=>{url=String(url);const i=url.indexOf('/v2/');if(i<0)return real(url,o);
 const path=url.slice(i).split('?')[0],method=o.method||'GET';window.__calls.push(method+' '+path);
 if(path==='/v2/plaid/cards')return J(200,plaid);
 if(path==='/v2/plaid/item'&&method==='DELETE'){const id=JSON.parse(o.body).itemId;plaid={items:plaid.items.filter(x=>x.itemId!==id),cards:plaid.cards.filter(x=>x.itemId!==id)};return J(200,{status:'removed'});}
 return J(404,{error:{code:'not_found'}});};
if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');
 localStorage.setItem('cardybara-language','en-US');localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');
 ${signedIn ? `localStorage.setItem('cardybara-account-session-v1',JSON.stringify({token:'cbs_'+'A'.repeat(43),expiresAt:Math.floor(Date.now()/1000)+86400,email:'synthetic.user@example.test'}));localStorage.setItem('cardybara-sync-v1',JSON.stringify({on:false}));` : ''}}})();`;
const run = (signedIn, fn) => withPhone(fn, {dir: buildDir, init: init(signedIn)});
const shot = (c, name) => process.env.CARDYBARA_SHOTS && c.shot(join(process.env.CARDYBARA_SHOTS, name + '.png'));
const ROWS = `[...document.querySelectorAll('.plaid-row')]`;
const loaded = async c => {
  await c.goto('/#settings');
  await c.until(`${ROWS}.length===3&&JSON.parse(localStorage.getItem('cardybara-wallet-cards-v1')||'[]').length===3&&!${ROWS}.some(r=>r.open)`, 'three connected rows, each in the wallet', 15000);
  await c.pause(800);
};

test('signed in: every connection row and its status is on the first screen, problems first; no sign-in form', {timeout: 90000, skip}, async () => {
  await run(true, async c => {
    await loaded(c);
    await shot(c, 'settings-signed-in');
    const rows = await c.evaluate(`(()=>{const bar=document.querySelector('.mobile-tabbar').getBoundingClientRect().top;
      return ${ROWS}.map(r=>{const tags=[...r.querySelectorAll('summary .ant-tag')],b=r.querySelector('summary').getBoundingClientRect(),t=tags[0].getBoundingClientRect();
        return {name:r.querySelector('.plaid-row-name').innerText,tags:tags.map(x=>x.innerText),seen:b.top>=0&&b.bottom<=bar&&t.bottom<=bar&&b.height>=44}})})()`);
    assert.deepEqual(rows, [
      {name: 'Synthetic Card 8 ••8888', tags: ['Sign-in needed'], seen: true},
      {name: 'Synthetic Card 7 ••7777', tags: ['Overdue'], seen: true},
      {name: 'Synthetic Card 6 ••6666', tags: ['Connected'], seen: true},
    ]);
    assert.equal(await c.evaluate(`!!document.querySelector('input[type=email],input[type=password]')`), false, 'no sign-in form');
    assert.equal(await c.evaluate(`document.querySelectorAll('.plaid-cards .ant-alert').length`), 1, 'one banner');
    assert.match(await c.evaluate(`document.querySelector('.account-row').innerText`), /synthetic\.user@example\.test[\s\S]*Sync is off/);
    const order = await c.evaluate(`['.plaid-cards','.reminder-settings','.account-row','.settings-preferences','.settings-advanced'].map(s=>document.querySelector(s).getBoundingClientRect().top)`);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), 'section order');
    assert.equal(await c.evaluate(`!!document.querySelector('.backup-guide-settings,.parser-settings')`), false, 'advanced starts collapsed');
    assert.ok((await c.audit()).scrollWidth <= PHONE.width, 'no horizontal scroll');
    assert.deepEqual(c.errors, []);
  });
});

test('a row opens to the full figures; disconnect is in the institution menu and asks first', {timeout: 90000, skip}, async () => {
  await run(true, async c => {
    await loaded(c);
    await c.tap('.plaid-row summary', 'Synthetic Card 6');
    await c.until(`document.querySelector('.plaid-row[open] .ant-descriptions')`, 'the detail');
    assert.match(await c.evaluate(`document.querySelector('.plaid-row[open]').innerText`), /Minimum[\s\S]*Credit limit[\s\S]*Purchase APR/i);
    await c.tap('.plaid-group:last-of-type .more-menu-trigger');
    await c.until(`document.querySelector('.ant-dropdown-menu-item-danger')`, 'the menu');
    await c.tap('.ant-dropdown-menu-item-danger');
    await c.until(`document.querySelector('.ant-modal-confirm .ant-btn-dangerous')`, 'the confirmation');
    assert.equal(await c.evaluate(`window.__calls.includes('DELETE /v2/plaid/item')`), false, 'nothing is removed before confirming');
    await c.pause(400);
    await c.tap('.ant-modal-confirm .ant-btn-dangerous');
    await c.until(`${ROWS}.length===1`, 'the connection removed');
  });
});

test('account row and advanced: the account page has sign out and delete; advanced holds import and the guide', {timeout: 90000, skip}, async () => {
  await run(true, async c => {
    await loaded(c);
    await c.tap('.account-row');
    await c.until(`document.querySelector('.account-settings .account-signout')`, 'the account page');
    assert.equal(await c.evaluate(`location.hash`), '#account');
    assert.match(await c.text(), /Change password[\s\S]*Sign out[\s\S]*Delete account/);
    await c.tap('.settings-back');
    await c.until(`document.querySelector('.settings-advanced .ant-collapse-header')`, 'back on settings');
    await c.tap('.settings-advanced .ant-collapse-header');
    await c.until(`document.querySelector('.backup-guide-settings')&&document.querySelector('.parser-settings')`, 'advanced opened');
    const text = await c.evaluate(`document.querySelector('.settings-advanced').innerText`);
    assert.match(text, /First-use guide|guide/i);
    assert.doesNotMatch(text, /Archived experimental/i, 'not a dev build');
  });
});

test('signed out: one Sign in row, which opens the form on the account page', {timeout: 90000, skip}, async () => {
  await run(false, async c => {
    await c.goto('/#settings');
    await c.until(`document.querySelector('.account-row')`, 'the account row');
    await shot(c, 'settings-signed-out');
    assert.equal(await c.evaluate(`!!document.querySelector('input[type=email]')`), false, 'no inline form');
    assert.match(await c.evaluate(`document.querySelector('.account-row').innerText`), /^Sign in/);
    await c.tap('.account-row');
    await c.until(`document.querySelector('.account-settings input[type=email]')`, 'the sign-in form');
  });
});
