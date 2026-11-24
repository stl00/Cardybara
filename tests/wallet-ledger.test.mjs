import test from 'node:test';
import assert from 'node:assert/strict';
import {walletLedgerSummary} from '../src/walletLedger.js';
import {creditLedger} from '../src/creditLedger.js';
import {benefitProfiles} from '../src/benefitRules.js';
// #568: synthetic wallet read on 2026-11-20. Two USD cards (Platinum fee date Mar 15, Reserve fee date Aug 1), one card
// that books in HKD (the Platinum product relabelled HKD with its own fee date: no published HKD card has a dated cycle
// credit with an amount to compute against) and a Platinum with no fee date. Expected numbers are hand-computed from the
// per-cycle limits, the same ones tests/credit-ledger.test.mjs works out in full.
const asOf='2026-11-20';
const plat={id:'plat',name:'The Platinum Card',bank:'Amex US',region:'US',currency:'USD',feeDate:{month:3,day:15}};
const csr={id:'csr',name:'Sapphire Reserve',bank:'Chase',region:'US',currency:'USD',feeDate:{month:8,day:1}};
const hkd={...plat,id:'hkd',currency:'HKD',feeDate:{month:6,day:1}};
const bare={...plat,id:'bare',feeDate:undefined};
const rule=(card,id)=>{const p=benefitProfiles.find(p=>p.benefits.some(b=>b.knowledgeRuleId.endsWith('.'+id)&&b.knowledgeRuleId.includes(card.name==='Sapphire Reserve'?'chase-us-sapphire-reserve.':'amex-us-us-the-platinum-card.')));return p.benefits.find(b=>b.knowledgeRuleId.endsWith('.'+id));};
let n=0;
const mark=(card,id,start,end,status)=>{const b=rule(card,id);return {id:'e'+(++n),key:JSON.stringify([card.id,b.knowledgeRuleId,start,end]),status,revisionId:b.revisionId,at:'2026-11-10T00:00:00.000Z'};};
const events=[
 mark(plat,'uber-cash','2026-04-01','2026-04-30','used'),mark(plat,'uber-cash','2026-05-01','2026-05-31','used'),mark(plat,'uber-cash','2026-06-01','2026-06-30','used'),
 mark(plat,'resy','2026-04-01','2026-06-30','used'),mark(plat,'airline-fee','2026-01-01','2026-12-31','used'),
 mark(csr,'travel','2026-08-01','2027-07-31','used'),mark(csr,'lyft','2026-09-01','2026-09-30','used'),mark(csr,'lyft','2026-10-01','2026-10-31','used'),
 // the HKD card has one mark of its own: Uber Cash June 2026, inside its card year starting 2026-06-01
 mark(hkd,'uber-cash','2026-06-01','2026-06-30','used')
];
const cards=[plat,csr,hkd,bare];
const rowOf=(s,id)=>s.rows.find(r=>r.cardId===id);
const totalOf=(s,c)=>s.totals.find(t=>t.currency===c);

test('Platinum and Reserve card-year numbers match the hand-computed ledger totals',()=>{
 const s=walletLedgerSummary([plat,csr],events,asOf);
 // Platinum 2026-03-15..2027-03-14: available 2474.40; used Uber Apr-Jun 3x15=45 + Resy 100 = 145 (the airline credit's cycle in this card year is the 2027 one, so the 2026 mark is not counted).
 const p=rowOf(s,'plat');
 assert.deepEqual(p.period,{start:'2026-03-15',end:'2027-03-14'});
 assert.equal(p.available,2474.4);assert.equal(p.used,145);
 // Reserve 2026-08-01..2027-07-31: available 2030, used travel 300 + Lyft 20 = 320, not captured 115.
 const r=rowOf(s,'csr');
 assert.equal(r.available,2030);assert.equal(r.used,320);assert.equal(r.notCaptured,115);
});
test('USD total is the sum of the two USD cards, in cents',()=>{
 const s=walletLedgerSummary([plat,csr],events,asOf),p=rowOf(s,'plat'),r=rowOf(s,'csr');
 const usd=totalOf(s,'USD');
 assert.equal(usd.cards,2);
 assert.equal(usd.available,Math.round((2474.4+2030)*100)/100);assert.equal(usd.available,4504.4);
 assert.equal(usd.used,465);assert.equal(usd.used,p.used+r.used);
 assert.equal(usd.notCaptured,Math.round((p.notCaptured+r.notCaptured)*100)/100);
});
test('the HKD card is never added into USD: its own total, and the USD total is unchanged by it',()=>{
 const withHkd=walletLedgerSummary(cards,events,asOf),without=walletLedgerSummary([plat,csr],events,asOf);
 assert.deepEqual(withHkd.totals.map(t=>t.currency).sort(),['HKD','USD']);
 assert.deepEqual(totalOf(withHkd,'USD'),totalOf(without,'USD'));
 const h=totalOf(withHkd,'HKD'),row=rowOf(withHkd,'hkd');
 assert.equal(h.cards,1);assert.equal(h.available,row.available);assert.equal(h.used,row.used);assert.ok(h.available>0);
 assert.equal(row.currency,'HKD');assert.equal(row.used,15,'the one Uber Cash month it marked');
});
test('a card without a fee date is listed with no figures and joins no total',()=>{
 const s=walletLedgerSummary(cards,events,asOf),b=rowOf(s,'bare');
 assert.equal(b.needsFeeDate,true);assert.equal(b.period,null);
 assert.equal(b.available,null);assert.equal(b.used,null);assert.equal(b.notCaptured,null);
 assert.equal(totalOf(s,'USD').cards,2,'the undated Platinum is not counted');
 assert.equal(totalOf(s,'USD').available,4504.4);
});
test('one creditLedger call per card year: rows equal the engine output, nothing is mutated',()=>{
 const before=JSON.stringify(events),engine=creditLedger([plat,csr],events,asOf,{basis:'card-year'}),s=walletLedgerSummary([plat,csr],events,asOf);
 assert.equal(JSON.stringify(events),before);
 for(const l of engine){const r=rowOf(s,l.cardId);assert.equal(r.available,l.available);assert.equal(r.used,l.used);assert.equal(r.notCaptured,l.notCaptured);}
 assert.deepEqual(walletLedgerSummary([],[],asOf),{rows:[],totals:[]});
});
