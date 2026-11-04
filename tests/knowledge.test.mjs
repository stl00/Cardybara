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
const transferRule=(from,to,productId)=>queryKnowledge({kind:'transfer-relationship',programmeId:from,productId}).rules.filter(r=>r.terms.toProgrammeId===to);
const mrUs='programme.amex-membership-rewards-us',mrHk='programme.amex-membership-rewards-hk',ur='programme.chase-ultimate-rewards',gold='amex-us-us-american-express-gold-card',hkPlatinum='amex-hk-hk-the-platinum-card',csp='chase-us-chase-sapphire-preferred-credit-card',csrBusiness='chase-us-sapphire-reserve-for-business-credit-card';
test('verified transfer rows keep the published rate per programme and market',()=>{
 const one=(from,to,product)=>{const rows=transferRule(from,to,product);assert.equal(rows.length,1,to);return rows[0];};
 assert.deepEqual(one(mrUs,'programme.aeromexico-rewards',gold).transferRate.rate,{from:1000,to:1600});
 assert.deepEqual(one(mrUs,'programme.cathay-asia-miles',gold).transferRate.rate,{from:1000,to:800});
 assert.deepEqual(one(mrUs,'programme.hilton-honors',gold).transferRate.rate,{from:1000,to:2000});
 assert.equal(one(mrUs,'programme.jetblue-trueblue',gold).terms.incrementPoints,250);
 assert.equal(one(mrUs,'programme.delta-skymiles',gold).terms.fees[0].kind,'excise-tax-offset');
 const hk=one(mrHk,'programme.hilton-honors',hkPlatinum);assert.deepEqual(hk.transferRate.rate,{from:64,to:10});assert.equal(hk.transferRate.condition,'turbo-program');assert.equal(hk.terms.minimumPoints,8000);assert.equal(hk.terms.maximumPoints,null);
 assert.deepEqual(one(mrHk,'programme.cathay-asia-miles',hkPlatinum).transferRate.rate,{from:18000,to:1000},'a US rate never leaks into HK');
});
test('"most partners at 1:1" and a 4:3 stated for other cards are not applied where a page is silent',()=>{
 const hyatt=transferRule(ur,'programme.world-of-hyatt',csp);assert.equal(hyatt.length,1);assert.deepEqual(hyatt[0].transferRate.rate,{from:4,to:3});assert.equal(hyatt[0].validity.effectiveFrom,'2026-10-01');
 const reserve=transferRule(ur,'programme.world-of-hyatt',csr);assert.equal(reserve.length,1);assert.equal(reserve[0].transferRate.rate,null);assert.equal(reserve[0].transferRate.statement,null);
 const united=transferRule(ur,'programme.united-mileageplus',csr)[0];assert.equal(united.transferRate.rate,null);assert.equal(united.transferRate.statement.scope,'most-partners');assert.deepEqual(united.transferRate.statement.statedForProductIds,[csp]);
 assert.equal(united.terms.minimumPoints,null);assert.equal(united.terms.incrementPoints,1000);
});
test('a fee the agreement says may apply is not recorded as no fee',()=>{
 const united=transferRule(ur,'programme.united-mileageplus',csp)[0].terms;assert.equal(united.fees,null);assert.equal(united.feeStatement,'may-be-charged');
});
test('a card whose page names no partner gets no partner row',()=>{
 assert.equal(queryKnowledge({kind:'transfer-relationship',productId:csrBusiness}).count,0);
});
test('catalogue links decide which cards a programme rule reaches, and rates stay out of terms',()=>{
 assert.ok(transferRule(mrUs,'programme.delta-skymiles','amex-us-us-morgan-stanley-platinum-card').length);
 assert.equal(transferRule(mrUs,'programme.delta-skymiles','amex-us-us-blue-cash-everyday').length,0);
 assert.equal(transferRule(mrUs,'programme.delta-skymiles',hkPlatinum).length,0);
 for(const r of queryKnowledge({kind:'transfer-relationship'}).rules)assert.equal(r.terms.ratio,null,r.id);
});
test('verified transfers list every official partner and carry a dated official source',()=>{
 const all=queryKnowledge({kind:'transfer-relationship'}).rules;
 const count=id=>all.filter(r=>r.terms.fromProgrammeId===id).length;
 assert.equal(count(mrUs),20);assert.equal(count(mrHk),10);assert.equal(count(ur),15);
 for(const r of all.filter(r=>[mrUs,mrHk,ur].includes(r.terms.fromProgrammeId))){assert.ok(knowledgeSources(r.evidence.sourceIds).every(s=>s.authority==='official'&&s.url.startsWith('https://')&&s.checkedAt==='2026-11-04'),r.id);assert.equal(r.terms.final,true,r.id);assert.equal(r.terms.accountLinked,null,r.id);assert.equal(r.terms.grantsEliteStatus,false,r.id);}
 assert.equal(all.filter(r=>r.terms.toProgrammeId==='programme.emirates-skywards'&&r.terms.fromProgrammeId===mrHk).length,0,'HK says Emirates is unavailable');
});
test('a withdrawn revision leaves current answers but stays in history, and its replacement covers the same card',()=>{
 const old='rule.chase-us-sapphire-reserve.transfer-world-of-hyatt';
 assert.equal(getKnowledgeRule(old),null);assert.equal(getKnowledgeRule(old,{asOf:'2026-11-03'}).revision,1);
 const rows=ruleRevisions(old);assert.equal(rows.at(-1).status,'withdrawn');
 const next=getKnowledgeRule(rows.at(-1).terms.replacedByRuleId);assert.ok(next.productIds.includes(csr));assert.equal(next.transferRate.rate,null);
 assert.equal(resolveRuleRevisions(rows,{asOf:'2026-11-04'}).length,0);
});
test('rule text gives the assistant no rate to repeat for another card',async()=>{
 const {runWalletTool}=await import('../src/walletAgent.js');const {answerGrounding}=await import('../src/answerGrounding.js');
 const cards=[{id:'a',bank:'Chase',region:'US',name:'Sapphire Reserve'},{id:'b',bank:'Chase',region:'US',name:'Chase Sapphire Preferred Credit Card'}];
 const result=runWalletTool({id:'t',type:'function',function:{name:'get_card_rules',arguments:JSON.stringify({kind:'transfer-relationship',programme:'Hyatt'})}},{cards,day:'2026-11-04'});
 assert.ok(result.rules.length);assert.ok(!JSON.stringify(result).includes('750'));assert.ok(!/4\s*:\s*3/.test(JSON.stringify(result)));
 assert.ok(answerGrounding('Your Sapphire Reserve gets 750 Hyatt points for 1,000 points.',[result]).issues.some(i=>i.code==='unsupported_number'));
});
test('published rates cannot loosen the answer check before the assistant can tell cards apart',async()=>{
 const {answerGrounding}=await import('../src/answerGrounding.js');
 const evidence=[{rules:queryKnowledge({kind:'transfer-relationship',productId:csp}).rules}];
 assert.ok(answerGrounding('Your Sapphire Preferred moves to United at 1:1.',evidence).issues.some(i=>i.code==='unsupported_transfer_ratio'));
 assert.ok(answerGrounding('Your Sapphire Reserve moves to Hyatt at 4:3.',evidence).issues.some(i=>i.code==='unsupported_transfer_ratio'));
});
