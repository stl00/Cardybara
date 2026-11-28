// #535: Plaid-linked cards land in the wallet on their own, in the built PWA (dist/web) in headless Chrome at phone width.
// The gateway is an in-page fetch stub for /v2/plaid and /v2/account/wallet, so no Plaid, account service or network is used.
// With sync on, two Plaid cards into an empty wallet become two wallet cards with Plaid's balances, and the debounced push
// carries both; with sync off they are added on this device only, and one the user removed is not added back. A card of an unknown institution is added too, with that name as its bank (#676). Negative control: with sync off
// and a card Plaid cannot place (a two-digit mask), nothing is added, the card stays in the Plaid panel, and nothing is sent to the wallet route. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WEB_DIR, withPhone} from './helpers/mobile-chrome.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';
import {assertWalletBody} from './helpers/account-body.mjs';
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

const READ = Math.floor(Date.parse('2026-11-18T12:00:00Z') / 1000);
const card = extra => ({itemId: 'item_1', accountId: 'acc_1', institution: 'Chase', name: 'Synthetic Sapphire', mask: '1234', subtype: 'credit card', currency: 'USD',
  balance: 410.5, available: 1589.5, limit: 2000, statementBalance: 390.25, statementDate: '2026-11-01', minimumPayment: 35, dueDate: '2026-11-26', aprs: [], readAt: READ, ...extra});
const TWO = {items: [{itemId: 'item_1', institution: 'Chase', status: 'ok', historicalComplete: true}, {itemId: 'item_2', institution: 'American Express', status: 'ok', historicalComplete: true}],
  cards: [card(), card({itemId: 'item_2', accountId: 'acc_2', institution: 'American Express', name: 'Synthetic Gold', mask: '71001', balance: 88.25})]};
const UNKNOWN = {items: [{itemId: 'item_3', institution: 'Synthetic Platypus Bank', status: 'ok', historicalComplete: true}],
  cards: [card({itemId: 'item_3', accountId: 'acc_3', institution: 'Synthetic Platypus Bank', name: 'Synthetic Platypus Card', mask: '3333'})]};

// Runs before the page: a signed-in session, sync on or off, and the gateway's Plaid and wallet routes from memory.
const init = ({plaid, syncOn, signedIn = true}) => `(()=>{const real=window.fetch.bind(window);const J=(s,b)=>new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json'}});
window.__puts=[];window.__calls=[];let rev=0;
window.fetch=async(url,init={})=>{url=String(url);const i=url.indexOf('/v2/');if(i<0)return real(url,init);
 const path=url.slice(i).split('?')[0],method=init.method||'GET';window.__calls.push(method+' '+path);
 if(path==='/v2/plaid/cards')return J(200,${JSON.stringify(plaid)});
 if(path==='/v2/account/wallet'){if(method==='GET')return J(200,{revision:rev,formatVersion:null,document:null,updatedAt:null});window.__puts.push(JSON.parse(init.body));rev++;return J(200,{revision:rev,size:10});}
 return J(404,{error:{code:'not_found'}});};
if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');
 localStorage.setItem('cardybara-language','zh-CN');localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');
 ${signedIn ? `localStorage.setItem('cardybara-account-session-v1',JSON.stringify({token:'cbs_'+'A'.repeat(43),expiresAt:Math.floor(Date.now()/1000)+86400,email:'synthetic.user@example.test'}));` : ''}
 ${syncOn ? `localStorage.setItem('cardybara-sync-v1',JSON.stringify({on:true}));` : ''}}})();`;

const UNPLACED = {items: UNKNOWN.items, cards: [{...UNKNOWN.cards[0], mask: '33'}]};

const registry = c => c.evaluate(`JSON.parse(localStorage.getItem('cardybara-wallet-cards-v1')||'[]').map(c=>[c.bank,c.tail,c.identitySource])`);

test('PWA, sync on: two Plaid cards land in an empty wallet with their balances and reach the server copy', {timeout: 120000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
  ensureBuild();
  await withPhone(async c => {
    // The settings page holds the Plaid panel on the web; opening it reads the card list from the gateway.
    await c.goto('/#settings');
    await c.until(`document.body.innerText.includes('Synthetic Gold')`, 'the Plaid panel lists the cards');
    await c.until(`JSON.parse(localStorage.getItem('cardybara-wallet-cards-v1')||'[]').length===2`, 'both cards in the wallet registry', 15000);
    assert.deepEqual((await registry(c)).sort(), [['Amex US', '71001', 'manual'], ['Chase', '1234', 'manual']]);
    await c.goto('/#wallet');
    await c.until(`document.body.innerText.includes('Synthetic Sapphire')&&document.body.innerText.includes('Synthetic Gold')`, 'both cards on the wallet page');
    const text = await c.text();
    for (const s of ['•••• 1234', '•••• 71001', '410.50', '88.25']) assert.ok(text.includes(s), 'wallet page is missing ' + s);
    // A reload (a later refresh) adds nothing more.
    await c.goto('/#settings');
    await c.until(`document.body.innerText.includes('Synthetic Gold')`, 'the panel again');
    await c.pause(1500);
    assert.equal((await registry(c)).length, 2, 'idempotent across a refresh');
    // The push follows the wallet's normal path: the 30 s local check, then the 5 s debounce.
    await c.until(`window.__puts.some(p=>(p.document?.walletCards?.cards||[]).length===2)`, 'a push with both cards', 60000);
    const pushed = await c.evaluate(`window.__puts.at(-1).document.walletCards.cards.map(c=>[c.bank,c.tail,c.name]).sort()`);
    assert.deepEqual(pushed, [['Amex US', '71001', 'Synthetic Gold'], ['Chase', '1234', 'Synthetic Sapphire']]);
    for (const p of await c.evaluate(`window.__puts`)) assertWalletBody(p, 'pushed wallet body');
    // No Plaid amounts or ids ride in the registry rows; the push carries what sync already sends.
    const body = await c.evaluate(`JSON.stringify(window.__puts.at(-1).document.walletCards)`);
    for (const s of ['acc_1', 'acc_2', 'item_1', '410.5']) assert.ok(!body.includes(s), 'registry push carries ' + s);
  }, {init: init({plaid: TWO, syncOn: true})});
});

test('PWA: a card of an unknown institution is added, with the institution as its bank, and shows on the wallet page', {timeout: 60000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
  ensureBuild();
  await withPhone(async c => {
    await c.goto('/#wallet');
    await c.until(`document.body.innerText.includes('Synthetic Platypus Card')`, 'the card on the wallet page', 15000);
    assert.deepEqual(await registry(c), [['Synthetic Platypus Bank', '3333', 'manual']]);
    assert.ok((await c.text()).includes('•••• 3333'), 'the mask beside the name');
    // A reload reads the stored generic card back without error and adds nothing.
    await c.goto('/#settings');
    await c.until(`document.body.innerText.includes('Synthetic Platypus Card')`, 'the panel');
    await c.pause(1500);
    assert.equal((await registry(c)).length, 1);
  }, {init: init({plaid: UNKNOWN, syncOn: false})});
});

test('PWA, sync off (negative control): a card Plaid cannot place stays in the panel and nothing is added or sent', {timeout: 60000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
  ensureBuild();
  await withPhone(async c => {
    await c.goto('/#settings');
    await c.until(`document.body.innerText.includes('Synthetic Platypus Card')`, 'the Plaid panel lists the card');
    await c.pause(1500);
    assert.deepEqual(await registry(c), [], 'a card without four mask digits is not added');
    assert.ok((await c.text()).includes('还没有对应到钱包里的卡'), 'the card stays in the panel, unmatched');
    assert.ok(!(await c.evaluate(`window.__calls.some(x=>x.includes('/v2/account/wallet'))`)), 'sync off: no wallet route is called');
  }, {init: init({plaid: UNPLACED, syncOn: false})});
});

test('PWA, sync off: placeable cards are still added on this device; a removed one is not added back on the next read', {timeout: 90000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
  ensureBuild();
  await withPhone(async c => {
    await c.goto('/#settings');
    await c.until(`JSON.parse(localStorage.getItem('cardybara-wallet-cards-v1')||'[]').length===2`, 'both cards in the wallet registry', 15000);
    await c.goto('/#wallet');
    await c.tap('.wallet-card .card-title', 'Synthetic Sapphire');
    await c.tap('.ant-drawer-footer .ant-btn-dangerous');
    await c.tap('.ant-modal .ant-btn-dangerous');
    await c.until(`JSON.parse(localStorage.getItem('cardybara-wallet-cards-v1')||'[]').length===1`, 'the Chase card removed');
    await c.goto('/#settings');
    await c.until(`document.body.innerText.includes('添加到钱包')`, 'the removed card is offered back in the panel');
    await c.pause(1500);
    assert.deepEqual(await registry(c), [['Amex US', '71001', 'manual']], 'not re-added after removal');
    assert.ok(!(await c.evaluate(`window.__calls.some(x=>x.includes('/v2/account/wallet'))`)), 'sync off: no wallet route is called');
  }, {init: init({plaid: TWO, syncOn: false})});
});

// #580: a new device (an iPhone Home Screen app has its own storage) never opens the Plaid panel. The wallet page reads
// the card list itself, so the Plaid card lands with its numbers without a visit to Settings.
test('PWA, no Plaid panel: opening the wallet page reads Plaid and fills the card', {timeout: 60000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
  ensureBuild();
  await withPhone(async c => {
    await c.goto('/#wallet');
    await c.until(`document.body.innerText.includes('Synthetic Sapphire')`, 'the Plaid card on the wallet page', 15000);
    const text = await c.text();
    for (const s of ['•••• 1234', '410.50']) assert.ok(text.includes(s), 'wallet page is missing ' + s);
    assert.ok(await c.evaluate(`window.__calls.includes('GET /v2/plaid/cards')`), 'the wallet read the Plaid card list');
    assert.ok(!(await c.evaluate(`location.hash.includes('settings')`)), 'never left the wallet page');
  }, {init: init({plaid: {items: [TWO.items[0]], cards: [TWO.cards[0]]}, syncOn: false})});
});

test('PWA, signed out: the wallet makes no Plaid request', {timeout: 60000, skip: !chrome && 'no working Chrome on this machine'}, async () => {
  ensureBuild();
  await withPhone(async c => {
    await c.goto('/#wallet');
    await c.pause(2500);
    assert.ok(!(await c.evaluate(`window.__calls.some(x=>x.includes('/v2/plaid'))`)), 'signed out: no Plaid call');
  }, {init: init({plaid: TWO, syncOn: false, signedIn: false})});
});
