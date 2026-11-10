import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceCards as cards} from '../evals/fixtures.mjs';
import {getKnowledgeRule,queryKnowledge,validateKnowledge} from '../src/knowledge.js';
import {creditApplicability,validateDecisionFields,DECISION_FIELDS} from '../src/creditApplicability.js';
import {chooseCard} from '../src/cardDecision.js';
import {queryCredits} from '../src/creditQuery.js';
const DAY='2026-11-05',csr='rule.chase-us-sapphire-reserve.',gold='rule.amex-us-us-american-express-gold-card.';
const rule=id=>getKnowledgeRule(id,{asOf:DAY});
const reserve=cards.filter(c=>c.name==='Sapphire Reserve');

test('every recorded decision field quotes the rule\'s own official source',()=>{
 assert.equal(validateKnowledge().valid,true);
 const withFields=queryKnowledge({kind:'benefit',asOf:DAY}).rules.filter(r=>r.decisionFields);
 assert.ok(withFields.length>=10);
 for(const r of withFields)for(const [key,f] of Object.entries(r.decisionFields)){
  assert.ok(DECISION_FIELDS[key],key);
  assert.ok(r.original.quotes.some(q=>q.sourceId===f.sourceId&&q.text.includes(f.quote)),`${r.id} ${key}`);
 }
});

test('a credit that claims a field without a source fails validation',()=>{
 const base=structuredClone(rule(csr+'edit'));
 const noSource=structuredClone(base);delete noSource.decisionFields.minimumNights.sourceId;
 assert.ok(validateDecisionFields(noSource).some(e=>/minimumNights: needs a source/.test(e)));
 const madeUp=structuredClone(base);madeUp.decisionFields.minimumNights.quote='stays of 3 nights or more';
 assert.ok(validateDecisionFields(madeUp).some(e=>/minimumNights: quote must be copied/.test(e)));
 const unknown=structuredClone(base);unknown.decisionFields.loungeAccess={value:true,sourceId:base.evidence.sourceIds[0],quote:'Pay Now'};
 assert.ok(validateDecisionFields(unknown).some(e=>/unknown field loungeAccess/.test(e)));
 const disagrees=structuredClone(rule(gold+'dining'));disagrees.decisionFields.enrollment.value='not-required';
 assert.ok(validateDecisionFields(disagrees).some(e=>/enrollment disagrees/.test(e)));
 const noCoupon=structuredClone(disagrees);delete noCoupon.terms.coupon;noCoupon.terms.requiresEnrollment=true;
 assert.ok(validateDecisionFields(noCoupon).some(e=>/enrollment disagrees/.test(e)),'terms.requiresEnrollment is checked too');
 const loneWord=structuredClone(rule(gold+'dining'));loneWord.decisionFields.enrollment.quote='Enrollment';
 assert.ok(validateDecisionFields(loneWord).some(e=>/enrollment: quote/.test(e)));
 const badVia=structuredClone(base);badVia.decisionFields.channels.via='Amex Travel';
 assert.ok(validateDecisionFields(badVia).some(e=>/via must appear in the quote/.test(e)));
 assert.deepEqual(validateDecisionFields(base),[]);
});

test('fields decide applicable, not applicable or conditional',()=>{
 const edit=rule(csr+'edit');
 assert.equal(creditApplicability(edit,{channel:'direct',nights:3}).status,'not-applicable');
 assert.deepEqual(creditApplicability(edit,{channel:'portal',portal:'Chase Travel',nights:1}).unmet,['minimum-nights']);
 assert.deepEqual(creditApplicability(edit,{channel:'portal',portal:'Amex Travel',nights:3}).unmet,['booked-through-portal']);
 const ok=creditApplicability(edit,{channel:'portal',portal:'Chase Travel',nights:2});
 assert.equal(ok.status,'conditional');assert.deepEqual(ok.needs,['prepaid'],'prepaid Pay Now is a stated requirement code cannot see');
 const open=creditApplicability(edit,{});
 assert.equal(open.status,'conditional');assert.deepEqual(open.needs,['booked-through-portal','minimum-nights','prepaid']);
 // "Automatically applied" says how it posts, not that no enrollment exists, so enrollment stays unrecorded.
 assert.deepEqual(open.unrecorded,['enrollment']);
 // A portal name code can't place is a need, never an exclusion.
 for(const portal of ['The Edit','大通旅行','UR','UR portal','my travel site']){
  const r=creditApplicability(edit,{channel:'portal',portal,nights:3});
  assert.equal(r.status,'conditional',portal);assert.equal(r.unmet,undefined,portal);
 }
 for(const portal of ['Amex Travel','美国运通旅行','Citi Travel'])assert.deepEqual(creditApplicability(edit,{channel:'portal',portal,nights:3}).unmet,['booked-through-portal'],portal);
 // Nights only count against a stay.
 assert.equal(creditApplicability(edit,{channel:'portal',portal:'Chase Travel',nights:1,category:'car-rental'}).unmet,undefined);
 // No channel recorded: never applicable, and the gap is named.
 const dining=creditApplicability(rule(gold+'dining'),{channel:'direct'});
 assert.equal(dining.status,'conditional');assert.deepEqual(dining.unrecorded,['channels']);assert.deepEqual(dining.needs,['enrolled']);
 // No fields at all: conditional, with nothing invented.
 const bare=creditApplicability({decisionFields:undefined},{channel:'portal',nights:1});
 assert.equal(bare.status,'conditional');assert.equal(bare.unmet,undefined);
 // Every recorded field satisfied and nothing left to ask.
 const synthetic={decisionFields:{enrollment:{value:'not-required'},channels:{value:['direct']}}};
 assert.equal(creditApplicability(synthetic,{channel:'direct'}).status,'applicable');
});

test('query_credits carries the decision and its needs',()=>{
 const result=queryCredits({use:'hotel'},{cards:reserve,day:DAY});
 const edit=Object.values(result.groups).flat().find(i=>i.decision?.minimumNights===2);
 assert.ok(edit,'The Edit credit is listed for hotel');
 assert.equal(edit.decision.status,'conditional');assert.ok(edit.decision.needs.includes('minimum-nights'));
 const narrowed=queryCredits({use:'hotel'},{cards:reserve,day:DAY,purchase:{channel:'portal',portal:'Chase Travel',nights:1}});
 assert.equal(Object.values(narrowed.groups).flat().find(i=>i.decision?.minimumNights===2).decision.status,'not-applicable');
});

test('choose_card never counts or suggests a credit its fields rule out',()=>{
 const hotel={category:'hotel',amount:600,currency:'USD',country:'US'};
 const editOf=r=>r.rows.flatMap(x=>x.credits).find(c=>/The Edit/.test(c.titles?.en||''));
 const oneNight=chooseCard({...hotel,channel:'portal',portal:'Chase Travel',nights:1},{cards:reserve,events:[],day:DAY});
 const c1=editOf(oneNight);assert.ok(c1);assert.equal(c1.applies,'not-applicable');assert.equal(c1.counted,false);
 assert.ok(!oneNight.couldChange.some(x=>x.kind==='credit-if-it-applies'&&x.title===c1.title));
 const direct=chooseCard({...hotel,channel:'direct',nights:3},{cards:reserve,events:[],day:DAY});
 assert.equal(editOf(direct).applies,'not-applicable');assert.deepEqual(editOf(direct).notApplicableBecause,['booked-through-portal']);
 const twoNights=chooseCard({...hotel,channel:'portal',portal:'Chase Travel',nights:2},{cards:reserve,events:[],day:DAY});
 assert.equal(editOf(twoNights).applies,'conditional');
});
