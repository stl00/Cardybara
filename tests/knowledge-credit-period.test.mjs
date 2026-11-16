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
 // The issuer does state a cycle here (12 months from the first day of the month after the annual fee is assessed; first year from account
 // opening), but no existing period value matches that start, and account-anniversary would shift the dates, so period stays null.
 'rule.wells-fargo-us-autograph-journey-visa-card.airline-credit':'issuer states a cycle (12 months from the month after the annual fee posts) but no period value matches it',
 // Page not readable.
 'rule.amex-us-us-business-platinum-card.hotel-credit':'page not readable: Amex Business Platinum product page returned no benefit text to a signed-out fetch',
 'rule.amex-us-us-delta-skymiles-reserve-card.delta-stays':'page not readable: Amex Delta Stays benefit pages returned only navigation text',
 'rule.amex-us-us-delta-skymiles-platinum-business-card.delta-stays':'page not readable: Amex Delta Stays benefit pages returned only navigation text',
 'rule.amex-us-us-delta-skymiles-gold-business-card.delta-stays':'page not readable: Amex Delta Stays benefit pages returned only navigation text',
 'rule.amex-us-us-delta-skymiles-reserve-business-card.delta-stays':'page not readable: Amex Delta Stays benefit pages returned only navigation text',
 'rule.bilt-us-bilt-obsidian-card.bilt-cash-2027':'page not readable: Bilt terms are a PDF/404 to the fetch tool',
 'rule.bilt-us-bilt-palladium-card.bilt-cash':'page not readable: Bilt terms are a PDF/404 to the fetch tool',
 'rule.bilt-us-bilt-palladium-card.bilt-cash-2027':'page not readable: Bilt terms are a PDF/404 to the fetch tool',
 // Non-credit rules from #340 (spend-unlock, lounge, membership): no period value fits what the rule text says; page not re-read in this PR.
 'rule.chase-us-marriott-bonvoy-boundless-credit-card.airline-credit':'dated promo windows per cardholder group, not a repeating cycle; no matching period value',
 'rule.chase-us-ihg-one-rewards-credit-card.fourth-night':'unlocked by a calendar-year spend requirement and lasts into the next year; no matching period value',
 'rule.us-bank-us-altitude-go-visa-signature-card.streaming':'12-month credit, page does not state when the 12 months start: not stated',
 'rule.amex-us-us-delta-skymiles-reserve-business-card.sky-club':'counted per Medallion year; no matching period value',
 'rule.amex-us-us-delta-skymiles-reserve-business-card.mqd-headstart':'granted per Medallion qualification year; no matching period value',
 'rule.chase-us-united-club-business-card.better-together':'annual bonus, start of the year not stated: not stated',
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
