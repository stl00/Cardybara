// Guard for stl00/Cardybara#340: a credit rule with a published amount needs a cycle, otherwise
// offCycleRows files it as "ongoing" with no task or reminder. Synthetic checks only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const all=JSON.parse(readFileSync(new URL('../src/data/knowledge/rules.json',import.meta.url),'utf8'));
// Only the newest revision of each rule counts; older revisions stay for history.
const latest=new Map();for(const r of all)if(!latest.has(r.id)||latest.get(r.id).revision<r.revision)latest.set(r.id,r);
const rules=[...latest.values()];
const today=new Date().toISOString().slice(0,10);
// Rules whose period stays null. Each entry needs a reason; remove it once a period is set from a page that was read.
// "page not readable": the issuer page is script-rendered or missing and returned no benefit text to a signed-out fetch (checked 2026-11-16),
// so no period is recorded rather than guessing from search excerpts or sibling cards.
const NO_STATED_CYCLE={
 'rule.boa-us-bank-of-america-premium-rewards-elite-credit-card.airline-incidental':'The Bank of America page says annually without saying calendar or card year',
 'rule.boa-us-bank-of-america-premium-rewards-elite-credit-card.lifestyle':'The Bank of America page says annually without saying calendar or card year',
 // Page not readable. Amex pages re-tried 2026-11-24 (signed-out WebFetch of the card pages, ?intlink variants and /terms/ paths returned only navigation text, truncated); not bypassed.
 'rule.amex-us-us-business-platinum-card.hotel-credit':'page not readable: Amex Business Platinum product page returned no benefit text to a signed-out fetch (re-tried 2026-11-24: card page, ?intlink and /terms/ URLs)',
 'rule.amex-us-us-delta-skymiles-reserve-card.delta-stays':'page not readable: Amex Delta Stays benefit pages returned only navigation text (re-tried 2026-11-24: card page, ?intlink and /terms/ URLs for Reserve; Platinum Business page errored)',
 'rule.amex-us-us-delta-skymiles-platinum-business-card.delta-stays':'page not readable: Amex Delta Stays benefit pages returned only navigation text (re-tried 2026-11-24: card page, ?intlink and /terms/ URLs for Reserve; Platinum Business page errored)',
 'rule.amex-us-us-delta-skymiles-gold-business-card.delta-stays':'page not readable: Amex Delta Stays benefit pages returned only navigation text (re-tried 2026-11-24: card page, ?intlink and /terms/ URLs for Reserve; Platinum Business page errored)',
 'rule.amex-us-us-delta-skymiles-reserve-business-card.delta-stays':'page not readable: Amex Delta Stays benefit pages returned only navigation text (re-tried 2026-11-24: card page, ?intlink and /terms/ URLs for Reserve; Platinum Business page errored)',
 // Rules where no period value fits what the page says, or the page does not state a start (re-checked in #348 for Marriott Bonvoy Boundless and IHG One, which now carry a period).
 'rule.us-bank-us-altitude-go-visa-signature-card.streaming':'12-month credit, page does not state when the 12 months start: not stated',
 'rule.amex-us-us-delta-skymiles-reserve-business-card.sky-club':'counted per Medallion year; no matching period value',
 'rule.amex-us-us-delta-skymiles-reserve-business-card.mqd-headstart':'granted per Medallion qualification year; no matching period value',
 'rule.chase-us-united-club-business-card.better-together':'annual bonus, start of the year not stated: not stated',
 'rule.citi-us-citi-aadvantage-globe-card.turo':'up to $240 "annually"; the page does not say which year (calendar or cardmember): not stated',
 'rule.bilt-us-bilt-palladium-card.priority-pass':'membership with no repeating amount; no cycle stated',
};
const needsCycle=r=>r.status==='published'&&r.kind==='benefit'
 &&(r.terms?.category!=='credit'||Number.isFinite(r.terms.amount)||(r.terms.monthlyAmounts||[]).some(Number.isFinite))
 &&!(r.validity?.effectiveThrough&&r.validity.effectiveThrough<today);
test('active benefit rules have a period unless allow-listed with a reason',()=>{
 const missing=rules.filter(r=>needsCycle(r)&&r.terms.period==null&&!NO_STATED_CYCLE[r.id]).map(r=>r.id);
 assert.deepEqual(missing,[],'set terms.period from the issuer page, or add the rule to NO_STATED_CYCLE with a reason');
});
test('the allow-list only names rules that still need it',()=>{
 for(const [id,reason] of Object.entries(NO_STATED_CYCLE)){
  const r=rules.find(x=>x.id===id);assert.ok(r,id+' exists');assert.ok(reason.length>10,id+' has a reason');
  assert.ok(needsCycle(r)&&r.terms.period==null,id+' now has a period or is no longer an active credit; remove it from the list');
 }
});
// stl00/Cardybara#348: the cycle the issuer page states is recorded, not left null.
test('rules with a stated cycle carry the matching period (#348)',()=>{
 const byId=new Map(rules.map(r=>[r.id,r]));
 assert.equal(byId.get('rule.chase-us-ihg-one-rewards-credit-card.fourth-night').terms.period,'earned-year-plus-next');
 assert.equal(byId.get('rule.chase-us-marriott-bonvoy-boundless-credit-card.airline-credit').terms.period,'promotion-period');
});
// stl00/Cardybara#612: the Bilt terms PDF states the cycle (credited at account opening and on each Card Anniversary Date).
test('Bilt Cash rules carry the account-anniversary period (#612)',()=>{
 const byId=new Map(rules.map(r=>[r.id,r]));
 for(const id of ['rule.bilt-us-bilt-obsidian-card.bilt-cash-2027','rule.bilt-us-bilt-palladium-card.bilt-cash','rule.bilt-us-bilt-palladium-card.bilt-cash-2027'])assert.equal(byId.get(id).terms.period,'account-anniversary',id);
});

// stl00/Cardybara#614: Wells Fargo states 12 months from the first of the month after the annual fee is assessed (page read 2026-11-24).
test('Autograph Journey airline credit carries the fee-month-year period (#614)',()=>{
 const rule=rules.filter(r=>r.id==='rule.wells-fargo-us-autograph-journey-visa-card.airline-credit').sort((a,b)=>b.revision-a.revision)[0];
 assert.equal(rule.revision,2);assert.equal(rule.terms.period,'fee-month-year');
});
