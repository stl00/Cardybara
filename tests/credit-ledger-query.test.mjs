import test from 'node:test';
import assert from 'node:assert/strict';
import {queryCreditLedger} from '../src/creditQuery.js';
import {runWalletTool,agentTools} from '../src/walletAgent.js';
import {renderCreditAnswers} from '../src/creditAnswer.js';
import {benefitProfiles} from '../src/benefitRules.js';
// Synthetic Sapphire Reserve (fee date Aug 1) read on 2026-11-20 through the assistant's credit tool. Totals match
// tests/credit-ledger.test.mjs: card year used 300 + 10 + 10, not captured 115; the calendar year adds the first-half
// dining credit, which is not marked here, so 150 sits in not captured (545 + 150 = 695) instead of used.
const day='2026-11-20';
const csr={id:'csr',name:'Sapphire Reserve',bank:'Chase',region:'US',currency:'USD',feeDate:{month:8,day:1}};
const csrNoDate={...csr,feeDate:null};
const rule=id=>benefitProfiles.flatMap(p=>p.benefits).find(b=>b.knowledgeRuleId==='rule.chase-us-sapphire-reserve.'+id);
const mark=(id,start,end,status)=>{const b=rule(id);return {id:'e'+id+start,key:JSON.stringify(['csr',b.knowledgeRuleId,start,end]),status,revisionId:b.revisionId,at:'2026-11-10T00:00:00.000Z'};};
const events=[mark('travel','2026-08-01','2027-07-31','used'),mark('lyft','2026-09-01','2026-09-30','used'),mark('lyft','2026-10-01','2026-10-31','used')];
const get=(r,name)=>r.cards.find(c=>c.card===name);

test('card year and calendar year totals come from the ledger, with not captured kept apart from used',()=>{
 const cy=get(queryCreditLedger({basis:'card-year'},{cards:[csr],events,day}),'Sapphire Reserve');
 assert.deepEqual(cy.returned,{available:2030,used:320,unused:0,skipped:0,notCaptured:115,open:1595});
 const cal=get(queryCreditLedger({basis:'calendar-year'},{cards:[csr],events,day}),'Sapphire Reserve');
 assert.equal(cal.returned.used,320);assert.equal(cal.returned.notCaptured,695);assert.equal(cal.annualFee,795);
});
test('with no marks nothing is used; ended cycles are not captured',()=>{
 const r=get(queryCreditLedger({basis:'card-year'},{cards:[csr],events:[],day}),'Sapphire Reserve');
 assert.equal(r.returned.used,0);assert.equal(r.returned.unused,0);assert.equal(r.returned.skipped,0);
 assert.ok(r.returned.notCaptured>0);assert.equal(r.returned.notCaptured+r.returned.open,r.returned.available);
});
test('a card year without a fee date has no totals and asks for the date; the calendar year still answers',()=>{
 const cy=get(queryCreditLedger({basis:'card-year'},{cards:[csrNoDate],events,day}),'Sapphire Reserve');
 assert.equal(cy.returned,null);assert.equal(cy.needsFeeDate,true);assert.match(cy.nextStep,/set it on the card/);
 const cal=get(queryCreditLedger({basis:'calendar-year'},{cards:[csrNoDate],events,day}),'Sapphire Reserve');
 assert.equal(cal.needsFeeDate,true);assert.ok(cal.returned.available>0);assert.ok(cal.cardYearCreditsLeftOut>0);
});
test('the tool takes yearBasis, rejects a bad basis, and the code-written answer covers all three languages',()=>{
 const def=agentTools.find(t=>t.function.name==='query_credits');
 assert.deepEqual(def.function.parameters.properties.yearBasis.enum,['card-year','calendar-year']);
 const run=(args,question)=>{const r=runWalletTool({id:'t',function:{name:'query_credits',arguments:JSON.stringify(args)}},{cards:[csr],events,day});return [r,renderCreditAnswers([r],question)];};
 const [r,en]=run({yearBasis:'card-year'},'How much did my credits return this card year?');
 assert.equal(r.mode,'ledger');assert.match(en,/not captured \(cycle ended with no mark; not the same as used\): USD 115/);
 assert.match(run({yearBasis:'calendar-year'},'我的 credit 今年返还了多少？')[1],/未记录（周期已结束但没有标记，不代表用过）: USD 695/);
 assert.match(run({yearBasis:'calendar-year'},'我的 credit 今年返還了多少？')[1],/未記錄（週期已結束但沒有標記，不代表用過）: USD 695/);
 assert.throws(()=>queryCreditLedger({basis:'fiscal'},{cards:[csr],events,day}),/invalid_ledger_basis/);
});
