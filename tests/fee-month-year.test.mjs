import test from 'node:test';
import assert from 'node:assert/strict';
import {benefitPeriod} from '../src/benefitRules.js';
import {feeMonthPeriod} from '../src/feeDate.js';
import {cycleFacts,cycleLabel} from '../src/creditCycle.js';
import {ledgerWindow,cyclesInWindow} from '../src/creditLedger.js';
import {feeDateNeededRows,creditTasks,offCycleRows} from '../src/personalBenefits.js';
import {queryCredits} from '../src/creditQuery.js';
// stl00/Cardybara#614: 12 months from the first day of the month after the annual fee posts. Synthetic fee dates only.
const rule={period:'fee-month-year'};
const win=(feeDate,asOf)=>feeMonthPeriod(feeDate,asOf);
test('window starts the first of the month after the fee date, whatever the day',()=>{
 assert.deepEqual(win({month:11,day:10},'2026-12-01'),{start:'2026-12-01',end:'2027-11-30'});
 assert.deepEqual(win({month:11,day:10},'2026-11-30'),{start:'2025-12-01',end:'2026-11-30'});
 assert.deepEqual(win({month:3,day:31},'2026-04-01'),{start:'2026-04-01',end:'2027-03-31'},'fee date late in a month');
 assert.deepEqual(win({month:3,day:31},'2026-03-31'),{start:'2025-04-01',end:'2026-03-31'});
 assert.deepEqual(win({month:1,day:31},'2026-02-01'),{start:'2026-02-01',end:'2027-01-31'});
});
test('a December fee date crosses the year: the window starts Jan 1 of the next year',()=>{
 assert.deepEqual(win({month:12,day:20},'2026-06-15'),{start:'2026-01-01',end:'2026-12-31'});
 assert.deepEqual(win({month:12,day:31},'2027-01-01'),{start:'2027-01-01',end:'2027-12-31'});
 assert.deepEqual(win({month:12,day:31},'2026-12-31'),{start:'2026-01-01',end:'2026-12-31'});
});
test('Feb 29 fee date and a known opening year',()=>{
 assert.deepEqual(win({month:2,day:29},'2027-03-01'),{start:'2027-03-01',end:'2028-02-29'});
 assert.equal(win({month:6,day:1,year:2026},'2026-06-30'),null,'before the first window');
 assert.deepEqual(win({month:6,day:1,year:2026},'2026-07-01'),{start:'2026-07-01',end:'2027-06-30'});
});
test('no fee date gives no window, and benefitPeriod routes the new period',()=>{
 assert.equal(win(undefined,'2026-11-24'),null);
 assert.equal(benefitPeriod(rule,'2026-11-24',{}),null);
 assert.deepEqual(benefitPeriod(rule,'2026-11-24',{feeDate:{month:11,day:10}}),{start:'2025-12-01',end:'2026-11-30'});
});
test('label and next reset day',()=>{
 assert.ok(cycleLabel('fee-month-year'));
 const task={cycle:'fee-month-year',period:{start:'2025-12-01',end:'2026-11-30'}};
 assert.equal(cycleFacts(task).next,'2026-12-01');
});
test('ledger counts one cycle in a card year and in a calendar year',()=>{
 const fee={month:11,day:10},card=ledgerWindow('card-year',fee,'2026-11-24'),cal=ledgerWindow('calendar-year',fee,'2026-11-24');
 assert.equal(cyclesInWindow(rule,card,fee).length,1);
 assert.equal(cyclesInWindow(rule,cal,fee).length,1);
 const dec={month:12,day:20},w=ledgerWindow('card-year',dec,'2026-12-25');
 assert.equal(cyclesInWindow(rule,w,dec).length,1);
});
const journey={id:'j',name:'Wells Fargo Autograph Journey Visa Card',bank:'Wells Fargo',region:'US',currency:'USD'};
test('the Wells Fargo airline credit needs a fee date, then becomes a cycle task',()=>{
 const id='rule.wells-fargo-us-autograph-journey-visa-card.airline-credit';
 const before=feeDateNeededRows([journey],'2026-11-24');
 assert.ok(before.some(r=>r.ruleId===id),'asks for the fee date');
 assert.ok(!creditTasks([journey],'2026-11-24').some(t=>t.ruleId===id));
 assert.ok(!offCycleRows([journey],'2026-11-24').some(r=>r.ruleId===id),'not listed as cycle-not-stated');
 const set={...journey,feeDate:{month:11,day:10}};
 assert.ok(!feeDateNeededRows([set],'2026-11-24').some(r=>r.ruleId===id));
 const task=creditTasks([set],'2026-11-24').find(t=>t.ruleId===id);
 assert.deepEqual(task.period,{start:'2025-12-01',end:'2026-11-30'});assert.equal(task.cycle,'fee-month-year');
});
test('query_credits reports a missing fee date for the period',()=>{
 const out=queryCredits({},{cards:[journey],day:'2026-11-24'});
 const row=out.groups.cycleUnknown.find(x=>x.periodType==='fee-month-year');
 assert.ok(row&&row.needsFeeDate);
 const known=queryCredits({},{cards:[{...journey,feeDate:{month:11,day:10}}],day:'2026-11-24'});
 assert.ok(!known.groups.cycleUnknown.some(x=>x.periodType==='fee-month-year'));
});
