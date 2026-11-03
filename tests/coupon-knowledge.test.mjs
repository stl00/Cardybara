import test from 'node:test';
import assert from 'node:assert/strict';
import {getKnowledgeRule,queryKnowledge,knowledgeSources,benefitProfileView,validateKnowledge} from '../src/knowledge.js';
import {validateCoupon} from '../src/couponKnowledge.js';
import {creditTasks} from '../src/personalBenefits.js';
import {runWalletTool} from '../src/walletAgent.js';
import {context} from '../evals/fixtures.mjs';
const day='2026-10-29',gold='rule.amex-us-us-american-express-gold-card.',csr='rule.chase-us-sapphire-reserve.',aspire='rule.amex-us-us-hilton-honors-aspire-card.';
const rule=id=>getKnowledgeRule(id,{asOf:day});

test('the dated batch preserves prior knowledge and exposes bounded editorial coverage',()=>{
 const rows=queryKnowledge({kind:'benefit',asOf:day}).rules.filter(r=>r.terms.coupon);
 assert.equal(rows.length,22);assert.equal(validateKnowledge().valid,true);
 for(const r of rows){assert.deepEqual(validateCoupon(r.terms.coupon,r.terms,r.evidence.sourceIds),[]);assert.equal(r.evidence.fullTermsReviewed,false);assert.equal(r.personalState,'not-in-public-knowledge');assert.ok(r.terms.coupon.review.unresolved.length);}
 assert.equal(getKnowledgeRule(gold+'dining',{asOf:'2026-10-28'}).revision,1);
 assert.equal(getKnowledgeRule(gold+'dining',{asOf:day,knownAt:'2026-10-28'}).revision,1);
 assert.equal(rule(gold+'dining').revision,2);
 assert.ok(benefitProfileView({asOf:'2026-10-27'}).every(p=>p.benefits.every(b=>!b.coupon)));
});

test('coupon units are not cumulative cash and refund does not restore a redeemed DoorDash coupon',()=>{
 const r=rule(csr+'doordash-retail'),c=r.terms.coupon;
 assert.equal(c.delivery,'checkout-discount');assert.equal(c.redemption.mode,'multiple-coupons');
 assert.equal(c.redemption.couponsPerPeriod,2);assert.equal(c.redemption.perCouponAmount,10);assert.equal(c.redemption.separateOrders,true);assert.equal(c.redemption.unusedPortionForfeited,true);assert.equal(c.carryover,false);assert.match(c.refundPolicy,/不会返还/);
 const tasks=creditTasks(context.cards,day),task=tasks.find(t=>t.ruleId===r.id);assert.equal(task.limit,20);assert.equal(task.coupon.redemption.perCouponAmount,10);
 const result=runWalletTool({id:'coupons',function:{name:'list_credits',arguments:'{}'}},{...context,day});
 assert.ok(result.some(x=>x.coupon?.redemption.mode==='multiple-coupons'));
});

test('merchant, channel, ambiguous gift-card and timing distinctions survive projection',()=>{
 const dining=rule(gold+'dining').terms.coupon;
 assert.ok(dining.eligibleMerchants.includes('Wonder'));assert.ok(!dining.eligibleMerchants.some(m=>/Goldbelly/.test(m)));assert.equal(dining.additionalCards.sharesCap,true);
 const dunkin=rule(gold+'dunkin').terms.coupon;assert.ok(dunkin.excludedPurchases.includes('网上购买礼品卡'));assert.ok(dunkin.conditionalPurchases.some(x=>/充值/.test(x)));
 const uber=rule(gold+'uber').terms.coupon;assert.equal(uber.delivery,'wallet-credit');assert.equal(uber.posting.deadlineTimeZone,'Pacific/Honolulu');assert.equal(uber.additionalCards.eligible,null);
 const edit=rule(csr+'edit').terms.coupon;assert.equal(edit.minimumNights,2);assert.equal(edit.posting.deadlineTimeZone,'America/New_York');assert.equal(rule(csr+'edit').terms.period,'calendar-year');
 const resort=rule(aspire+'resort').terms.coupon;assert.ok(resort.excludedPurchases.includes('SLH酒店'));assert.ok(resort.eligibleChannels.some(x=>x.includes('挂房账')));assert.equal(resort.posting.maximumDays,null);
 assert.ok(rule(csr+'peloton').terms.coupon.review.unresolved.some(x=>x.includes('新持卡人')));
});

test('malformed editorial facts cannot erase unknowns or misstate coupon denominations',()=>{
 const r=rule(csr+'doordash-retail'),c=structuredClone(r.terms.coupon),sources=r.evidence.sourceIds;
 const mutations=[x=>x.redemption.couponsPerPeriod=3,x=>delete x.carryover,x=>x.posting.deadlineTimeZone='not/a-zone',x=>x.review.sourceIds=['invented'],x=>x.review.checkedAt='2026-02-30',x=>x.additionalCards.accountNumber='no',x=>x.eligibleCountries='US',x=>delete x.redemption.separateOrders,x=>x.review=null];
 for(const mutate of mutations){const candidate=structuredClone(c);mutate(candidate);assert.ok(validateCoupon(candidate,r.terms,sources).length);}
 const copy=knowledgeSources(sources);copy[0].title='bad';assert.notEqual(knowledgeSources(sources)[0].title,'bad');
});


test('Morgan Stanley rules distinguish monthly membership billing and future lodging conditions',()=>{
 const base='rule.amex-us-us-morgan-stanley-platinum-card.';
 const current=rule(base+'lodging');assert.equal(current.terms.coupon.minimumNights,null);assert.equal(current.terms.coupon.posting.maximumDays,90);assert.equal(current.terms.coupon.posting.deadlineTimeZone,'America/Chicago');
 assert.ok(current.terms.coupon.eligibleMerchants.includes('Airbnb Luxe'));
 const future=getKnowledgeRule(base+'lodging',{asOf:'2027-01-01',knownAt:day});assert.equal(future.terms.coupon.minimumNights,2);assert.equal(future.validity.effectiveFrom,'2027-01-01');
 assert.equal(rule(base+'walmart').terms.coupon.excludedPurchases.includes('年付Walmart+会员'),true);
 assert.ok(rule(base+'uber-one').content.summary.includes('月付或年付'));
 assert.ok(rule(base+'lululemon').terms.coupon.excludedPurchases.includes('礼品卡'));
 assert.ok(rule(base+'airline-fee').terms.coupon.excludedPurchases.includes('机票'));
 const uber=rule(base+'uber');assert.equal(uber.terms.monthlyAmounts[11],35);assert.equal(uber.terms.coupon.delivery,'wallet-credit');
});


test('missing public enrollment requirement remains unknown instead of false',()=>{
 const tasks=creditTasks(context.cards,day);
 const ms=tasks.find(t=>t.ruleId==='rule.amex-us-us-morgan-stanley-platinum-card.walmart');assert.equal(ms.requiresEnrollment,null);
 const dining=tasks.find(t=>t.ruleId===gold+'dining');assert.equal(dining.requiresEnrollment,true);
 const edit=tasks.find(t=>t.ruleId===csr+'edit');assert.equal(edit.requiresEnrollment,false);
});
