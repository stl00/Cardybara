import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {queryKnowledge,getKnowledgeRule,groupKnowledge,inspectRuleRequirements,validateKnowledge,resolveRuleRevisions,benefitProfileView,ruleRevisions,knowledgeManifest,knowledgeSources} from '../src/knowledge.js';
import {profileForCard,benefitStatus,benefitPeriod} from '../src/benefitRules.js';
const csr='chase-us-sapphire-reserve',id=name=>'rule.'+csr+'.'+name;
test('knowledge snapshot has valid foreign keys, provenance and revision chains',()=>{const result=validateKnowledge();assert.equal(result.valid,true);assert.deepEqual(result.errors,[]);assert.ok(result.uniqueRules>=259);assert.ok(result.rules>=result.uniqueRules);assert.ok(result.sources>=54);});
test('agents query and group hotel benefits without classifying prose themselves',()=>{
 const result=queryKnowledge({productId:csr,scenarioId:'hotel-stay',kind:'benefit'});
 assert.ok(result.count>=5);assert.ok(result.rules.some(r=>r.id===id('edit')));
 assert.ok(!result.rules.some(r=>r.id===id('travel')));
 const groups=groupKnowledge(result,'category');assert.ok(groups.membership);assert.ok(groups.credit);assert.ok(groups['spend-unlock']);
});
test('programme relationship does not fabricate status, ratio or account linkage',()=>{
 const result=queryKnowledge({programmeId:'programme.world-of-hyatt',productId:csr});
 const transfer=result.rules.find(r=>r.kind==='transfer-relationship');assert.equal(transfer.terms.grantsEliteStatus,false);assert.equal(transfer.terms.ratio,null);assert.equal(transfer.terms.accountLinked,null);
 assert.ok(result.rules.some(r=>r.id===id('hyatt-explorist')));
});
test('rule assessment separates validity, enrollment window and freshness',()=>{
 assert.equal(getKnowledgeRule(id('apple-tv'),{asOf:'2027-06-23'}).assessment.enrollmentWindow,'closed');
 assert.equal(getKnowledgeRule(id('apple-tv'),{asOf:'2027-06-23'}).assessment.temporal,'start-unknown');
 assert.equal(getKnowledgeRule(id('apple-tv'),{asOf:'2027-06-23'}).assessment.reviewDue,true);
 assert.equal(queryKnowledge({text:'2026 指定酒店抵扣',asOf:'2027-01-01'}).count,0);
 assert.equal(getKnowledgeRule(id('select-hotels-2026'),{asOf:'2027-01-01'}).assessment.temporal,'expired');
});
test('historical knowledge never pretends the first snapshot existed earlier',()=>{
 assert.equal(queryKnowledge({asOf:'2026-10-26'}).count,0);
 assert.throws(()=>queryKnowledge({asOf:'2026-02-30'}),/real YYYY/);
 assert.throws(()=>queryKnowledge({asOf:'2026-10-27',knownAt:'2026-10-28'}),/knownAt/);
 assert.equal(getKnowledgeRule(id('edit'),{asOf:'2026-10-27'}).revision,1);assert.ok(ruleRevisions(id('edit')).length>=1);
});
test('missing and incomplete conditions never produce an eligible or action result',()=>{
 assert.equal(inspectRuleRequirements(id('stubhub')).checks[0].result,'unknown');
 assert.equal(inspectRuleRequirements(id('stubhub'),{account:{enrolled:false}}).result,'requirements-not-met');
 const positive=inspectRuleRequirements(id('stubhub'),{account:{enrolled:true}});assert.equal(positive.result,'needs-verification');assert.equal(positive.actionsAuthorized,false);
 assert.equal(inspectRuleRequirements(id('hyatt-explorist'),{account:{eligibleCalendarYearSpend:'75000'}}).checks[0].result,'unknown');
 assert.equal(inspectRuleRequirements(id('hyatt-explorist'),{account:{eligibleCalendarYearSpend:80000}}).result,'needs-verification');
});
test('migration preserves existing pilot facts, limits, fees, partners and HSBC findings',()=>{
 const archived=JSON.parse(readFileSync(new URL('../docs/knowledge/benefit-profiles-before-normalization-2026-10-27.json',import.meta.url),'utf8')).profiles[0];const view=benefitProfileView({asOf:'2026-10-27'})[0];
 assert.deepEqual(view.fees,archived.fees);assert.deepEqual(view.earningRates,archived.earningRates);
 for(const b of archived.benefits){const migrated=view.benefits.find(x=>x.id===b.id);for(const [k,v] of Object.entries(b))assert.deepEqual(migrated[k],v,`${b.id}.${k}`);assert.ok(migrated.howToUse.length);}
 assert.deepEqual(view.transferPartners.map(p=>p.programme).sort(),archived.transferPartners.map(p=>p.programme).sort());
});
test('query outputs cannot mutate canonical store and unknown IDs fail explicitly',()=>{
 const r=getKnowledgeRule(id('travel'));r.terms.amount=9999;assert.equal(getKnowledgeRule(id('travel')).terms.amount,300);
 const s=knowledgeSources(['csr-terms']);s[0].url='wrong';assert.notEqual(knowledgeSources(['csr-terms'])[0].url,'wrong');
 assert.throws(()=>queryKnowledge({category:'made-up'}),/Unknown/);assert.throws(()=>queryKnowledge({productId:'made-up'}),/Unknown/);
 assert.throws(()=>groupKnowledge(queryKnowledge(),'made-up'),/Unsupported/);
 assert.equal(knowledgeManifest.policy.personalDataAllowed,false);
});

test('future-announced revision does not displace a currently effective rule',()=>{
 const old=getKnowledgeRule(id('travel'));old.validity.effectiveFrom='2026-01-01';old.validity.effectiveThrough='2026-12-31';
 const next=structuredClone(old);next.revision=2;next.revisionId=next.id+'@2026-12-01.2';next.supersedes=old.revisionId;next.evidence.checkedAt='2026-12-01';next.validity.effectiveFrom='2027-01-01';next.validity.effectiveThrough='2027-12-31';
 assert.equal(resolveRuleRevisions([old,next],{asOf:'2026-12-15'})[0].revision,1);
 assert.equal(resolveRuleRevisions([old,next],{asOf:'2027-01-01'})[0].revision,2);
 assert.equal(resolveRuleRevisions([old,next],{asOf:'2028-01-01'}).length,0);
 assert.equal(resolveRuleRevisions([old,next],{asOf:'2027-01-01',knownAt:'2026-11-01',includeInactive:true})[0].revision,1);
});
test('enrollment query does not confuse unknown enrollment requirement with no enrollment',()=>{
 const yes=queryKnowledge({requiresEnrollment:true});assert.ok(yes.count>0);assert.ok(yes.rules.every(r=>r.terms.requiresEnrollment===true));
 const no=queryKnowledge({requiresEnrollment:false});assert.ok(no.rules.every(r=>r.terms.requiresEnrollment===false));assert.ok(!no.rules.some(r=>r.id===id('travel')));
 assert.throws(()=>queryKnowledge({requiresEnrollment:'yes'}),/boolean/);
});

test('all 22 held products are included with public fees, benefits and explicit corporate uncertainty',()=>{
 const held=JSON.parse(readFileSync(new URL('./fixtures/wallet-products.json',import.meta.url),'utf8')).cards;
 const profiles=benefitProfileView();assert.equal(profiles.length,22);
 for(const card of held){const p=profileForCard(card);assert.ok(p,card.name);assert.ok(p.benefits.length,card.name);assert.ok(p.fees.sourceIds.length,card.name);}
 const corporate=profiles.find(p=>p.productId==='amex-us-us-corporate-card');assert.equal(corporate.fees.primaryAnnual,null);assert.equal(corporate.coverage,'variant-unconfirmed');
});
test('multicurrency rates, shared allowances and account-version transitions survive projection',()=>{
 const all=benefitProfileView(),find=id=>all.find(p=>p.productId===id);
 assert.equal(find('amex-ca-ca-platinum-card').fees.currency,'CAD');assert.equal(find('amex-hk-hk-the-platinum-card').fees.currency,'HKD');
 assert.equal(find('boa-us-customized-cash-rewards-visa-signature').earningRates[0].unit,'cashback-percent');
 assert.ok(find('hsbc-hk-hk-hsbc-everymile-card').earningRates.every(r=>r.unit==='HKD-per-mile'));
 const explorer=find('amex-hk-hk-american-express-explorer-credit-card');assert.equal(explorer.benefits.find(b=>b.id==='lounge').sharing,'account-shared');
 assert.equal(benefitStatus(explorer.benefits.find(b=>b.id==='waiver'),'2026-10-27',{spendYear:2026,eligibleSpend:200000}),'spend_unverified');
 const ihg=find('chase-us-ihg-premier');assert.equal(benefitStatus(ihg.benefits.find(b=>b.id==='status-new'),'2026-10-27'),'account_version_unverified');
});
test('quarterly credits use the correct calendar boundaries and future Canadian policy remains future',()=>{
 assert.deepEqual(benefitPeriod({period:'calendar-quarter'},'2026-10-27'),{start:'2026-10-01',end:'2026-12-31'});
 assert.deepEqual(benefitPeriod({period:'calendar-quarter'},'2028-02-29'),{start:'2028-01-01',end:'2028-03-31'});
 const ca=benefitProfileView().find(p=>p.productId==='amex-ca-ca-platinum-card');
 assert.equal(benefitStatus(ca.benefits.find(b=>b.id==='lounge-2027'),'2026-10-27'),'not_started');
 assert.equal(benefitStatus(ca.benefits.find(b=>b.id==='lounge'),'2027-01-01'),'expired');
});
