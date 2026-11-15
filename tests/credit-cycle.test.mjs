import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cycleFacts,CYCLE_LABELS,CYCLE_ORDER,cycleGroup,cycleGroupLabel,cycleLabel,nextResetDay} from '../src/creditCycle.js';
import {benefitPeriod} from '../src/benefitRules.js';
import {creditView} from '../src/creditView.js';
import {creditTasks} from '../src/personalBenefits.js';
import {catalogFiles} from '../src/i18n/index.js';

const json=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const rules=json('../src/data/knowledge/rules.json'),taxonomy=json('../src/data/knowledge/taxonomy.json');
// Next reset of a rule on a day: the day after the cycle it is in ends.
const next=(period,asOf,feeDate)=>nextResetDay({period:benefitPeriod({period},asOf,{feeDate})});

test('every terms.period used in rules.json and the taxonomy has a cycle label',()=>{
 const used=new Set(rules.map(r=>r.terms?.period).filter(Boolean));
 assert.ok(used.size>=10,'rules.json should use many period values');
 for(const p of [...used,...taxonomy.periods])assert.ok(cycleLabel(p),`terms.period "${p}" has no cycle label in src/creditCycle.js`);
 assert.equal(cycleLabel('some-new-period'),null,'an unmapped value is null, never a guess');
 assert.deepEqual(Object.keys(CYCLE_LABELS).sort(),[...taxonomy.periods].sort(),'labels cover the taxonomy and nothing else');
});
test('the seven cycles of the issue map to their own labels',()=>{
 assert.deepEqual(['calendar-month','calendar-quarter','calendar-half-year','calendar-year','account-anniversary','rolling-four-years','per-trip'].map(cycleLabel),['每月','每季度','每半年','每个日历年','每个持卡年度','每四年','一次性']);
 for(const p of ['per-trip','per-stay','activation-based','fixed-date','promotion-period'])assert.equal(cycleGroup(p),'one-off');
 assert.equal(cycleGroup('ongoing'),null);assert.equal(cycleGroup('nope'),null);assert.equal(cycleGroupLabel('one-off'),'一次性');
 assert.ok(CYCLE_ORDER.every(g=>cycleGroupLabel(g)));
});
test('every cycle label has an English and a Traditional Chinese translation',()=>{
 const merged={'en-US':{},'zh-TW':{}};
 for(const f of Object.values(catalogFiles))for(const l of Object.keys(merged))Object.assign(merged[l],f[l]);
 const keys=[...new Set(Object.values(CYCLE_LABELS)),'全部周期','按周期筛选','公开上限 {0} · 本期至 {1} · {2} 开始下一周期','公开上限 {0} · 本期至 {1}'];
 for(const l of Object.keys(merged))for(const k of keys)assert.ok(merged[l][k],`${l} is missing ${k}`);
 assert.match(merged['en-US']['公开上限 {0} · 本期至 {1} · {2} 开始下一周期'],/\{2\}/);
});
test('next reset: month boundaries, including a leap February and the year end',()=>{
 assert.equal(next('calendar-month','2026-11-15'),'2026-12-01');
 assert.equal(next('calendar-month','2026-11-30'),'2026-12-01');
 assert.equal(next('calendar-month','2026-12-31'),'2027-01-01');
 assert.equal(next('calendar-month','2027-02-28'),'2027-03-01');
 assert.equal(next('calendar-month','2028-02-29'),'2028-03-01');
});
test('next reset: quarter, half-year and calendar-year boundaries',()=>{
 assert.equal(next('calendar-quarter','2026-03-31'),'2026-04-01');
 assert.equal(next('calendar-quarter','2026-04-01'),'2026-07-01');
 assert.equal(next('calendar-quarter','2026-12-31'),'2027-01-01');
 assert.equal(next('calendar-half-year','2026-06-30'),'2026-07-01');
 assert.equal(next('calendar-half-year','2026-07-01'),'2027-01-01');
 assert.equal(next('calendar-year','2026-01-01'),'2027-01-01');
 assert.equal(next('calendar-year','2026-12-31'),'2027-01-01');
});
test('next reset: card year follows the fee date, and Feb 29 falls on Feb 28 in a common year',()=>{
 const mar={month:3,day:15};
 assert.equal(next('account-anniversary','2026-03-14',mar),'2026-03-15');
 assert.equal(next('account-anniversary','2026-03-15',mar),'2027-03-15');
 assert.equal(next('account-anniversary','2026-12-31',mar),'2027-03-15');
 const leap={month:2,day:29};
 assert.equal(next('account-anniversary','2027-03-01',leap),'2028-02-29','common-year card year ends before the leap fee date');
 assert.equal(next('account-anniversary','2028-02-28',leap),'2028-02-29');
 assert.equal(next('account-anniversary','2028-02-29',leap),'2029-02-28','from the leap day, the next fee date is Feb 28');
 assert.equal(next('account-anniversary','2027-02-27',leap),'2027-02-28');
 assert.equal(next('account-anniversary','2026-06-01',{month:2,day:29,year:2024}),'2027-02-28');
});
test('a period without a cycle or without a fee date has no next reset',()=>{
 assert.equal(next('account-anniversary','2026-06-01',undefined),null);
 assert.equal(next('rolling-four-years','2026-06-01'),null);
 assert.equal(nextResetDay({}),null);
});
const cards=json('./fixtures/wallet-products.json').cards;
test('real credit tasks carry their cycle and the view can filter and group by it',()=>{
 const asOf='2026-11-20',tasks=creditTasks(cards.map(c=>({...c,feeDate:{month:3,day:15}})),asOf);
 assert.ok(tasks.length>0&&tasks.every(t=>cycleLabel(t.cycle)),'every cycle task has a mapped label');
 const view=creditView(tasks,[],asOf);
 assert.ok(view.cycles.length>=2);assert.equal(view.cycles.reduce((n,c)=>n+c.count,0),view.pool.length,'counts add up to the pool');
 const pick=view.cycles[0],only=creditView(tasks,[],asOf,{cycle:pick.id});
 assert.equal(only.cycle,pick.id);assert.equal(only.rows.length,pick.count);assert.equal(only.filtered,true);
 assert.ok(only.rows.every(r=>cycleGroup(r.task.cycle)===pick.id));
 assert.equal(creditView(tasks,[],asOf,{cycle:'rolling-four-years'}).cycle,'all','an absent cycle falls back to all');
 assert.equal(view.filtered,false);
});
test('row facts: a recurring cycle shows its next start, a one-off or promotion row does not',()=>{
 const period={start:'2026-11-01',end:'2026-11-30'};
 assert.deepEqual(cycleFacts({cycle:'calendar-month',period}),{label:'每月',next:'2026-12-01'});
 for(const cycle of ['promotion-period','fixed-date','per-trip','rolling-four-years','ongoing'])assert.equal(cycleFacts({cycle,period:{start:'2026-10-03',end:'2026-12-17'}}).next,null,cycle);
 assert.equal(cycleFacts({cycle:'promotion-period',period}).label,'一次性');
 assert.deepEqual(cycleFacts({cycle:null,period}),{label:null,next:null});
});
test('PersonalWallet renders the cycle row from cycleFacts and hides the next-start text without one',()=>{
 const src=readFileSync(new URL('../src/PersonalWallet.jsx',import.meta.url),'utf8');
 assert.match(src,/facts=cycleFacts\(task\)/);assert.match(src,/facts\.next\?t\('公开上限 \{0\} · 本期至 \{1\} · \{2\} 开始下一周期'/);
 assert.match(src,/facts\.label&&<Tag>/);assert.ok(!/nextResetDay/.test(src),'the row must not call nextResetDay directly');
});
