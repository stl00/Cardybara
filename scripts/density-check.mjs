// `node scripts/density-check.mjs`: the quiet-UI density check (stl00/Cardybara#683). Builds dist/web if stale, opens each
// screen at 375x812 in headless Chrome with a synthetic 5-card wallet and a fixed clock (loopback only; every other
// request is answered by an in-page stub), counts what is visible in the first viewport, and prints the table against
// scripts/density-budgets.mjs. Exits 1 when an enforcing screen is over budget or a screen cannot be measured.
// Without Chrome it skips locally and fails on GitHub Actions.
import {appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {PHONE, withPhone} from '../tests/helpers/mobile-chrome.mjs';
import {prepareWebTestBuild} from '../tests/helpers/web-test-build.mjs';
import {findChrome} from './dev-collector/chrome-launcher.mjs';
import {GUIDE_KEY} from '../src/webFirstLaunch.js';
import {PARAGRAPH_CHARS, SCREENS} from './density-budgets.mjs';

// ---- the synthetic wallet: made-up cards, tails, dates and amounts -------------------------------------------------
const NOW = '2026-11-10T18:00:00.000Z';
const card = (id, bank, name, tail, currency = 'USD') => ({id, bank, name, tail, currency, identitySource: 'manual'});
const CARDS = [
  card('synthetic-a', 'Amex US', 'The Platinum Card', '1111'),
  card('synthetic-b', 'Chase', 'Sapphire Reserve', '2222'),
  card('synthetic-c', 'Amex US', 'American Express Gold Card', '3333'),
  card('synthetic-d', 'Bilt', 'Synthetic Card', '4444'),
  card('synthetic-e', 'Amex HK', 'The Platinum Card', '5555', 'HKD'),
];
const bill = (statement, due) => ({statement, minimum: 10, due, at: '2026-11-08T12:00:00.000Z'});
const EDITS = [
  {cardId: 'synthetic-a', feeDate: {month: 3, day: 15}, bill: bill(120, '2026-11-13')},
  {cardId: 'synthetic-b', feeDate: {month: 8, day: 1}, bill: bill(80, '2026-11-08')},
  {cardId: 'synthetic-c', feeDate: {month: 6, day: 1}, bill: bill(60, '2026-11-25')},
  {cardId: 'synthetic-e', feeDate: {month: 12, day: 20}},
];
const set = (key, value) => `localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(value)});`;
const FIXED_CLOCK = `(()=>{const Real=Date,shift=Real.parse(${JSON.stringify(NOW)})-Real.now();
  globalThis.Date=class extends Real{constructor(...a){super(...(a.length?a:[Real.now()+shift]));}static now(){return Real.now()+shift;}};})();`;
const NO_NETWORK = `(()=>{const real=window.fetch.bind(window);window.fetch=async(url,init)=>{url=String(url);if(url.startsWith(location.origin)||url.startsWith('/'))return real(url,init);return new Response('{}',{status:400,headers:{'Content-Type':'application/json'}});};})();`;
export const INIT = FIXED_CLOCK + NO_NETWORK + set('cardybara-language', 'en-US') + set(GUIDE_KEY, '1')
  + set('cardybara-wallet-cards-v1', JSON.stringify(CARDS)) + set('cardybara-card-edits-v1', JSON.stringify(EDITS))
  + set('cardybara-backup-nudge-v1', JSON.stringify({firstCardAt: Date.parse(NOW) - 10 * 86400000}));

// Settings (#679) is measured signed in with three synthetic Plaid cards over two institutions, one needing a new login.
// Sync is off, and the gateway's card list is answered in the page.
const READ = Date.parse(NOW) / 1000 - 3600;
const plaidCard = (n, itemId, institution, extra) => ({itemId, accountId: 'acc_' + n, institution, name: `Synthetic Card ${n}`, mask: String(n).repeat(4), currency: 'USD',
  balance: 10 * n, statementBalance: 5 * n, minimumPayment: 1, dueDate: '2026-12-0' + n, isOverdue: false, aprs: [], readAt: READ, ...extra});
export const PLAID = {
  items: [{itemId: 'item_1', institution: 'Chase', status: 'ok', historicalComplete: true}, {itemId: 'item_2', institution: 'Synthetic Platypus Bank', status: 'login_required', historicalComplete: true}],
  cards: [plaidCard(6, 'item_1', 'Chase'), plaidCard(7, 'item_1', 'Chase'), plaidCard(8, 'item_2', 'Synthetic Platypus Bank')],
};
const SETTINGS_SETUP = `(()=>{const real=window.fetch;window.fetch=async(url,init)=>String(url).includes('/v2/plaid/cards')?new Response(JSON.stringify(${JSON.stringify(PLAID)}),{status:200,headers:{'Content-Type':'application/json'}}):real(url,init);})();`
  + set('cardybara-account-session-v1', JSON.stringify({token: 'cbs_' + 'A'.repeat(43), expiresAt: 4000000000, email: 'synthetic.user@example.test'}))
  + set('cardybara-sync-v1', JSON.stringify({on: false})) + set('cardybara-plaid-cards-v1', JSON.stringify(PLAID));

// ---- how each screen is reached ------------------------------------------------------------------------------------
const ROUTES = {
  overview: async c => { await c.goto('/#overview'); await c.until(`document.querySelector('.credit-manager')`, 'Overview'); },
  wallet: async c => { await c.goto('/#wallet'); await c.until(`document.querySelectorAll('.wallet-card').length===5`, 'five card tiles'); },
  drawer: async c => { await ROUTES.wallet(c); await c.tap('.wallet-card .card-title'); await c.until(`document.querySelector('.ant-drawer-open .ant-drawer-section')`, 'the card drawer'); },
  credits: async c => { await c.goto('/#credits'); await c.until(`document.querySelector('.credit-row')`, 'credit rows'); },
  rewards: async c => { await c.goto('/#rewards'); await c.until(`document.querySelector('.ant-layout-content')?.innerText.trim().length>0`, 'Rewards'); },
  settings: async c => { await c.goto('/#settings'); await c.until(`document.querySelector('.plaid-cards')?.innerText.includes('Synthetic Card 8')`, 'the connected cards'); },
};
const SETUP = {settings: SETTINGS_SETUP};

// Runs in the page.
const measureExpression = screen => `(()=>{
  const cfg=${JSON.stringify({within: screen.within || null, rows: screen.rows || null, rowButtonExclude: screen.rowButtonExclude || null, filters: screen.filters || null})};
  const root=cfg.within?document.querySelector(cfg.within):document.body;
  if(!root)return null;
  const rendered=el=>{const r=el.getBoundingClientRect();if(!(r.width>0&&r.height>0))return false;
    for(let e=el;e&&e!==document.documentElement;e=e.parentElement){const s=getComputedStyle(e);if(s.display==='none'||s.visibility==='hidden'||+s.opacity===0)return false;}
    return !el.closest('[aria-hidden="true"],[inert]');};
  const inView=el=>{const r=el.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;};
  const all=(sel,scope=root)=>[...scope.querySelectorAll(sel)].filter(rendered);
  const seen=sel=>all(sel).filter(inView);
  const paragraphs=seen('.ant-typography-secondary').filter(e=>(e.tagName==='DIV'||e.innerText.trim().length>=${PARAGRAPH_CHARS})&&!e.parentElement.closest('.ant-typography-secondary'));
  const out={buttons:seen('.ant-btn').length,tags:seen('.ant-tag').length,alerts:seen('.ant-alert').length,paragraphs:paragraphs.length};
  if(cfg.rows){const rows=all(cfg.rows),most=f=>Math.max(0,...rows.map(f));out.rows=rows.length;
    out.tagsPerRow=most(r=>all('.ant-tag',r).length);
    out.buttonsPerRow=most(r=>all('.ant-btn',r).filter(b=>!cfg.rowButtonExclude||!b.matches(cfg.rowButtonExclude)).length);}
  if(cfg.filters)out.filterRows=all(cfg.filters).length;
  return out;
})()`;

// Counts once the screen has stopped changing: the same numbers three times running, 300 ms apart.
export async function measure(c, screen) {
  let last = '', same = 0;
  for (let i = 0; i < 40; i++) {
    const counts = await c.evaluate(measureExpression(screen));
    const text = JSON.stringify(counts);
    same = counts && text === last ? same + 1 : 0;
    if (same >= 2) return counts;
    last = text;
    await c.pause(300);
  }
  throw Error(`${screen.id}: the counts never settled (last ${last})`);
}

export function judge(screens, measured) {
  const rows = [];
  for (const screen of screens) for (const [metric, budget] of Object.entries(screen.budget)) {
    const count = measured[screen.id]?.[metric];
    // A screen with rows to judge but none on screen has not met its per-row budget; it was not measured.
    const missing = count === undefined || (metric.endsWith('PerRow') && !measured[screen.id].rows);
    const over = !missing && count > budget;
    rows.push({screen: screen.label, metric, count: missing ? null : count, budget, baseline: screen.baseline?.[metric], mode: screen.mode, over, failed: screen.mode === 'enforce' && (over || missing)});
  }
  return {rows, failed: rows.some(r => r.failed)};
}

export function formatTable({rows}) {
  const status = r => r.failed ? 'FAIL' : r.count === null ? 'not measured' : r.over ? 'over' : 'ok';
  return ['| Screen | Metric | Now | Budget | Recorded | Mode | Result |', '|---|---|---|---|---|---|---|',
    ...rows.map(r => `| ${r.screen} | ${r.metric} | ${r.count ?? '-'} | <= ${r.budget} | ${r.baseline ?? '-'} | ${r.mode} | ${status(r)} |`)].join('\n');
}

export async function runDensity({dir = prepareWebTestBuild(), screens = SCREENS, routes = ROUTES, init = INIT, setup = SETUP} = {}) {
  const measured = {};
  for (const screen of screens) {
    // One browser per screen: no state carries over.
    await withPhone(async c => { await routes[screen.id](c); measured[screen.id] = await measure(c, screen); }, {dir, init: init + (setup[screen.id] || '')});
  }
  return {measured, ...judge(screens, measured)};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const usable = await findChrome().then(() => true).catch(() => false);
  if (!usable) {
    console.log('density-check: no Chrome on this machine, not run');
    process.exit(process.env.GITHUB_ACTIONS ? 1 : 0);
  }
  const result = await runDensity();
  const table = formatTable(result);
  console.log(`First viewport, ${PHONE.width}x${PHONE.height}, synthetic 5-card wallet\n\n${table}`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### UI density (${PHONE.width}x${PHONE.height})\n\n${table}\n`);
  if (result.failed) { console.error('\ndensity-check: an enforcing screen is over its budget (scripts/density-budgets.mjs)'); process.exit(1); }
}
