import test from 'node:test';
import assert from 'node:assert/strict';
import {creditLedger,cyclesInWindow,ledgerWindow} from '../src/creditLedger.js';
import {benefitProfiles} from '../src/benefitRules.js';
// Synthetic wallet: a Platinum (fee date Mar 15) and a Sapphire Reserve (fee date Aug 1), read on 2026-11-20.
// Every total below was worked out by hand from the published per-cycle limits; see the comments.
const asOf='2026-11-20';
const plat={id:'plat',name:'The Platinum Card',bank:'Amex US',region:'US',currency:'USD',feeDate:{month:3,day:15}};
const csr={id:'csr',name:'Sapphire Reserve',bank:'Chase',region:'US',currency:'USD',feeDate:{month:8,day:1}};
const rule=(card,id)=>{const p=benefitProfiles.find(p=>p.benefits.some(b=>b.knowledgeRuleId.endsWith('.'+id)&&b.knowledgeRuleId.includes(card.name==='Sapphire Reserve'?'chase-us-sapphire-reserve.':'amex-us-us-the-platinum-card.')));return p.benefits.find(b=>b.knowledgeRuleId.endsWith('.'+id));};
let n=0;
const mark=(card,id,start,end,status,usage)=>{const b=rule(card,id);return {id:'e'+(++n),key:JSON.stringify([card.id,b.knowledgeRuleId,start,end]),status,revisionId:b.revisionId,at:'2026-11-10T00:00:00.000Z',...(usage?{usage:{amount:usage,limit:b.amount}}:{})};};
const month=(m,last)=>[`2026-${m}-01`,`2026-${m}-${last}`];
const events=[
 // Platinum Uber Cash 15/month: Apr-Jun used, Jul 10 of 15 used, Aug skipped, Sep marked unused, Oct unmarked
 ...[['04',30],['05',31],['06',30]].map(([m,l])=>mark(plat,'uber-cash',...month(m,l),'used')),
 mark(plat,'uber-cash',...month('07',31),'partial',10),mark(plat,'uber-cash',...month('08',31),'skipped'),mark(plat,'uber-cash',...month('09',30),'unused'),
 mark(plat,'resy','2026-04-01','2026-06-30','used'),
 mark(plat,'airline-fee','2026-01-01','2026-12-31','used'),
 // Reserve: card-year travel credit, two Lyft months, the first-half dining credit
 mark(csr,'travel','2026-08-01','2027-07-31','used'),
 mark(csr,'lyft',...month('09',30),'used'),mark(csr,'lyft',...month('10',31),'used'),
 mark(csr,'dining','2026-01-01','2026-06-30','used')
];
const by=(rows,id)=>rows.find(r=>r.cardId===id);
const pick=l=>({available:l.available,used:l.used,unused:l.unused,skipped:l.skipped,notCaptured:l.notCaptured,open:l.open});

test('card year: Platinum 2026-03-15..2027-03-14 matches the hand-computed totals',()=>{
 // Credits: Uber Cash 12x15=180, Uber One 120, airline 200 (the 2027 cycle), CLEAR 219 (2027), Resy 4x100, digital 12x25=300,
 // lululemon 4x75=300, Walmart+ 12x12.95=155.40 -> 1874.40. Used: 45+10+100. Unused: 5 (rest of July) + 15 (Sep). Skipped 15.
 // Not captured (ended, no mark): Uber Oct 15, Resy Q3 100, digital Apr-Oct 175, lululemon 2 quarters 150, Walmart 7x12.95=90.65 -> 530.65.
 const l=by(creditLedger([plat,csr],events,asOf,{basis:'card-year'}),'plat');
 assert.deepEqual(l.period,{start:'2026-03-15',end:'2027-03-14'});
 assert.deepEqual(pick(l),{available:1874.4,used:155,unused:20,skipped:15,notCaptured:530.65,open:1153.75});
 assert.equal(l.credits.find(c=>c.ruleId.endsWith('.uber-cash')).cycles,12,'a monthly credit counts all 12 cycles');
 assert.equal(l.credits.find(c=>c.ruleId.endsWith('.resy')).cycles,4);
 assert.equal(l.annualFee,895);assert.deepEqual(l.netOfFee,{used:-740,available:979.4});
});
test('calendar year: the same Platinum over 2026 matches the hand-computed totals',()=>{
 // Same marks over Jan-Dec 2026. Uber Cash adds Jan-Mar 45 not captured; airline 2026 cycle is the used 200.
 // Used 45+10+100+200=355. Not captured: Uber 15+45, Resy Q1+Q3 200, digital Jan-Oct 250, lululemon Q1-Q3 225, Walmart 10x12.95=129.50 -> 864.50.
 const l=by(creditLedger([plat,csr],events,asOf,{basis:'calendar-year'}),'plat');
 assert.deepEqual(l.period,{start:'2026-01-01',end:'2026-12-31'});
 assert.deepEqual(pick(l),{available:1874.4,used:355,unused:20,skipped:15,notCaptured:864.5,open:619.9});
});
test('Sapphire Reserve totals for both bases, including a credit that starts mid-year',()=>{
 // Card year 2026-08-01..2027-07-31: travel 300 used; Lyft 12x10 (Sep, Oct used); DoorDash 10 monthly 15 (from Oct 2026), retail 12x20;
 // dining 2x150 (2027 halves, open); StubHub 2x150; Edge 500 (2027); Peloton 12x10 -> 2030. Not captured: Lyft Aug 10, DoorDash Oct 15, retail 3x20, Peloton 3x10 = 115.
 const card=by(creditLedger([csr],events,asOf,{basis:'card-year'}),'csr');
 assert.deepEqual(pick(card),{available:2030,used:320,unused:0,skipped:0,notCaptured:115,open:1595});
 // Calendar 2026: travel 300, select hotels 250, Lyft 120, Edge 500, dining 2x150, DoorDash Oct-Dec 3x15, retail 240, StubHub 300, Peloton 120 -> 2175.
 // Used 300+20+150. Not captured: Lyft 8x10, DoorDash Oct 15, retail 10x20, Peloton 100, StubHub H1 150 -> 545.
 const cal=by(creditLedger([csr],events,asOf,{basis:'calendar-year'}),'csr');
 assert.deepEqual(pick(cal),{available:2175,used:470,unused:0,skipped:0,notCaptured:545,open:1160});
 assert.equal(cal.annualFee,795);assert.deepEqual(cal.netOfFee,{used:-325,available:1380});
});
test('every bucket adds up to what is available, for both bases and any marks',()=>{
 for(const basis of ['card-year','calendar-year'])for(const l of creditLedger([plat,csr],events,asOf,{basis})){
  assert.equal(Math.round((l.used+l.unused+l.skipped+l.notCaptured+l.open)*100),Math.round(l.available*100));
 }
});
test('with no marks nothing is used: ended cycles are not captured, never used',()=>{
 for(const basis of ['card-year','calendar-year'])for(const l of creditLedger([plat,csr],[],asOf,{basis})){assert.equal(l.used,0);assert.ok(l.notCaptured>0);assert.equal(l.unused+l.skipped,0);}
});
test('a mark made against an older rule revision does not count',()=>{
 const stale={...events[0],revisionId:'rule.x@0'};
 const l=by(creditLedger([plat],[stale],asOf,{basis:'card-year'}),'plat');assert.equal(l.used,0);
});
test('a partly used cycle with no amount written down is not captured, not used',()=>{
 const m=mark(plat,'uber-cash',...month('04',30),'partial');
 const l=by(creditLedger([plat],[m],asOf,{basis:'card-year'}),'plat');assert.equal(l.used,0);assert.equal(l.notCaptured,720.65,'nothing moves out of not captured');
});
test('without a fee date the card-year basis says so and the calendar basis leaves out card-year credits',()=>{
 const bare={...plat,feeDate:undefined},cc={...csr,feeDate:undefined};
 const [year]=creditLedger([cc],[],asOf,{basis:'card-year'});
 assert.equal(year.needsFeeDate,true);assert.equal(year.period,null);assert.equal(year.available,0);assert.equal(year.annualFee,795);
 const [cal]=creditLedger([cc],[],asOf,{basis:'calendar-year'});
 assert.equal(cal.needsFeeDate,true);assert.equal(cal.excluded.cardYearCredits,1);assert.equal(cal.available,1875,'2175 minus the 300 travel credit');
 assert.ok(creditLedger([bare],[],asOf,{basis:'calendar-year'})[0].available>0);
});
test('a dismissed credit leaves the ledger and restoring brings it back',()=>{
 const key=JSON.stringify(['csr','rule.chase-us-sapphire-reserve.edit']);
 const gone=by(creditLedger([csr],[{id:'d',key,status:'dismissed',at:'2026-11-01T00:00:00.000Z'}],asOf,{basis:'calendar-year'}),'csr');
 assert.equal(gone.available,1675);
 const back=by(creditLedger([csr],[{id:'d',key,status:'dismissed',at:'2026-11-01T00:00:00.000Z'},{id:'r',key,status:'restored',at:'2026-11-02T00:00:00.000Z'}],asOf,{basis:'calendar-year'}),'csr');
 assert.equal(back.available,2175);
});
test('cycle counts: 12, 4, 2 and 1 in any 12-month window, and the card year does not double a calendar-year credit',()=>{
 const w=ledgerWindow('card-year',{month:3,day:15},asOf),count=(period)=>cyclesInWindow({period},w,{month:3,day:15}).length;
 assert.deepEqual(['calendar-month','calendar-quarter','calendar-half-year','calendar-year','account-anniversary'].map(count),[12,4,2,1,1]);
});
test('it is pure: marks are not changed and an unknown card or empty wallet gives nothing',()=>{
 const before=JSON.stringify(events);creditLedger([plat,csr],events,asOf);assert.equal(JSON.stringify(events),before);
 assert.deepEqual(creditLedger([],[],asOf),[]);assert.deepEqual(creditLedger([{id:'x',name:'Unknown Card',bank:'Nowhere',region:'US'}],[],asOf),[]);
 assert.throws(()=>creditLedger([plat],[],asOf,{basis:'fiscal'}),/invalid_ledger_basis/);
});
// Off-cycle credits (four-year, one-off): counted only in the window where the user used them, on a separate line.
const geRule=profile=>profile.benefits.find(b=>b.knowledgeRuleId==='rule.chase-us-sapphire-reserve.global-entry');
const geProfile=benefitProfiles.find(p=>geRule(p)),ge=geRule(geProfile);
const hyatt={id:'hy',name:'World of Hyatt Credit Card',bank:'Chase',region:'US',currency:'USD',feeDate:{month:8,day:1}};
const hyProfile=benefitProfiles.find(p=>p.benefits.some(b=>b.knowledgeRuleId==='rule.chase-us-world-of-hyatt-credit-card.doordash-promo')),promo=hyProfile.benefits.find(b=>b.knowledgeRuleId.endsWith('.doordash-promo'));
const fourYear=(usedOn,status='used',id='g'+(++n))=>({id,key:JSON.stringify([csr.id,ge.knowledgeRuleId,'four-year']),status,at:'2026-11-10T00:00:00.000Z',...(usedOn?{usedOn}:{}),revisionId:ge.revisionId});
const oneOff=(at,status='used')=>({id:'o'+(++n),key:JSON.stringify([hyatt.id,promo.knowledgeRuleId,'one-off']),status,at,revisionId:promo.revisionId});
const off=(card,evs,day,basis)=>creditLedger([card],evs,day,{basis})[0].offCycle;
test('a four-year credit used inside the card year counts once there and not in the next card year',()=>{
 // Global Entry public limit 120, used 2026-09-10: inside card year 2026-08-01..2027-07-31 and calendar 2026.
 assert.deepEqual(off(csr,[fourYear('2026-09-10')],asOf,'card-year'),{available:120,used:120,count:1,credits:[{ruleId:ge.knowledgeRuleId,title:ge.title,kind:'four-year',usedOn:'2026-09-10'}]});
 assert.equal(off(csr,[fourYear('2026-09-10')],asOf,'calendar-year').used,120);
 assert.equal(off(csr,[fourYear('2026-09-10')],'2027-11-20','card-year').count,0,'next card year');
 assert.equal(off(csr,[fourYear('2026-09-10')],'2027-11-20','calendar-year').count,0,'next calendar year');
});
test('a four-year credit used outside the window, unmarked or marked not used does not count',()=>{
 assert.equal(off(csr,[fourYear('2026-05-01')],asOf,'card-year').count,0,'before the card year');
 assert.equal(off(csr,[fourYear('2026-05-01')],asOf,'calendar-year').used,120,'but inside the calendar year');
 assert.equal(off(csr,[],asOf,'card-year').available,0);
 assert.equal(off(csr,[fourYear(null,'unknown')],asOf,'card-year').count,0);
 assert.equal(off(csr,[fourYear('2026-09-10'),{...fourYear(null,'unknown','later'),at:'2026-11-12T00:00:00.000Z'}],asOf,'card-year').count,0,'the latest mark wins');
});
test('off-cycle credits stay out of the cycle totals',()=>{
 const base=creditLedger([csr],events,asOf,{basis:'card-year'})[0],withGe=creditLedger([csr],[...events,fourYear('2026-09-10')],asOf,{basis:'card-year'})[0];
 assert.deepEqual(pick(withGe),pick(base));assert.equal(withGe.offCycle.used,120);
});
test('a one-off credit marked used inside the window counts once; skipped or outside does not',()=>{
 assert.deepEqual(off(hyatt,[oneOff('2026-09-05T10:00:00.000Z')],asOf,'card-year').used,10);
 assert.equal(off(hyatt,[oneOff('2026-09-05T10:00:00.000Z')],asOf,'card-year').count,1);
 assert.equal(off(hyatt,[oneOff('2026-05-05T10:00:00.000Z')],asOf,'card-year').count,0);
 assert.equal(off(hyatt,[oneOff('2026-09-05T10:00:00.000Z','skipped')],asOf,'card-year').count,0);
 assert.equal(off(hyatt,[],asOf,'card-year').count,0);
});
