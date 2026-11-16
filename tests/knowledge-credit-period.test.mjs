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
// Issuer does not state a cycle Cardybara can represent. Each entry needs a reason; remove it once a period is set.
const NO_STATED_CYCLE={
 // Public page: the 12-month credit period starts the first day of the month after the annual fee is assessed, and the first
 // year runs from account opening. No existing period value matches that start, and account-anniversary would shift the dates.
 'rule.wells-fargo-us-autograph-journey-visa-card.airline-credit':'12 months from the month after the annual fee posts; no matching period value',
};
const needsCycle=r=>r.status==='published'&&r.kind==='benefit'&&r.terms?.category==='credit'
 &&(Number.isFinite(r.terms.amount)||(r.terms.monthlyAmounts||[]).some(Number.isFinite))
 &&!(r.validity?.effectiveThrough&&r.validity.effectiveThrough<today);
test('active credit rules with an amount have a period unless allow-listed with a reason',()=>{
 const missing=rules.filter(r=>needsCycle(r)&&r.terms.period==null&&!NO_STATED_CYCLE[r.id]).map(r=>r.id);
 assert.deepEqual(missing,[],'set terms.period from the issuer page, or add the rule to NO_STATED_CYCLE with a reason');
});
test('the allow-list only names rules that still need it',()=>{
 for(const [id,reason] of Object.entries(NO_STATED_CYCLE)){
  const r=rules.find(x=>x.id===id);assert.ok(r,id+' exists');assert.ok(reason.length>10,id+' has a reason');
  assert.ok(needsCycle(r)&&r.terms.period==null,id+' now has a period or is no longer an active credit; remove it from the list');
 }
});
