import test from 'node:test';
import assert from 'node:assert/strict';
import {benefitProfiles,benefitSources,hsbcRewardCash,profileForCard,benefitPeriod,benefitStatus,currentBenefitProgress} from '../src/benefitRules.js';
const profile=benefitProfiles[0],rule=id=>profile.benefits.find(b=>b.id===id);
test('benefit profile matches personal CSR without attaching business or foreign cards',()=>{
 assert.equal(profileForCard({bank:'Chase',region:'US',name:'Chase Sapphire Reserve'}),profile);
 assert.equal(profileForCard({bank:'Chase',region:'US',name:'Sapphire Reserve for Business'}),null);
 assert.equal(profileForCard({bank:'Chase',region:'CA',name:'Chase Sapphire Reserve'}),null);
 assert.equal(profileForCard({bank:'Chase',region:'US',name:'unknown card'}),null);
});
test('credit periods preserve calendar half-year and unknown anniversary cycles',()=>{
 assert.deepEqual(benefitPeriod(rule('dining'),'2026-06-30'),{start:'2026-01-01',end:'2026-06-30'});
 assert.deepEqual(benefitPeriod(rule('dining'),'2026-07-01'),{start:'2026-07-01',end:'2026-12-31'});
 assert.equal(rule('dining').amount,150);
 assert.equal(rule('edit').amount,500);
 assert.equal(rule('edit').period,'calendar-year');
 assert.equal(benefitPeriod(rule('travel'),'2026-10-27'),null);
 assert.equal(benefitPeriod(rule('global-entry'),'2026-10-27'),null);
 assert.deepEqual(benefitPeriod(rule('peloton'),'2028-02-15'),{start:'2028-02-01',end:'2028-02-29'});
 for(const d of ['2026-02-30','2026-13-01','wrong',null])assert.equal(benefitPeriod(rule('dining'),d),null);
});
test('activation deadline is not treated as membership expiration',()=>{
 assert.equal(benefitStatus(rule('apple-tv'),'2027-06-23'),'enrollment_closed');
 assert.equal(benefitStatus(rule('apple-tv'),'2027-06-23',{enrolled:true}),'rules_valid');
 assert.equal(benefitStatus(rule('stubhub'),'2026-10-27'),'enrollment_required');
 assert.equal(benefitStatus(rule('stubhub'),'2028-01-01',{enrolled:true}),'expired');
 assert.equal(benefitStatus(rule('select-hotels-2026'),'2025-12-31'),'not_started');
});
test('spending unlocked status needs verified spending in the right year',()=>{
 assert.equal(benefitStatus(rule('hyatt-explorist'),'2026-10-27'),'spend_unverified');
 assert.equal(benefitStatus(rule('hyatt-explorist'),'2026-10-27',{spendYear:2025,eligibleSpend:80000}),'spend_unverified');
 assert.equal(benefitStatus(rule('hyatt-explorist'),'2026-10-27',{spendYear:2026,eligibleSpend:74999}),'spend_required');
 assert.equal(benefitStatus(rule('hyatt-explorist'),'2026-10-27',{spendYear:2026,eligibleSpend:75000}),'rules_valid');
});
test('personal usage requires explicit bank label, same period, currency and real timestamp',()=>{
 const row={name:rule('dining').bankAliases[0],metric:'credit_progress',validThrough:'2026-12-31',capturedAt:'2026-10-27T15:00:00Z',value:25,currency:'USD'};
 assert.deepEqual(currentBenefitProgress(rule('dining'),[row],'2026-10-27'),row);
 for(const patch of [{validThrough:'2026-06-30'},{currency:'CAD'},{capturedAt:'2026-07-01T02:00:00Z'},{capturedAt:'invalid'},{capturedAt:'2026-11-01T15:00:00Z'},{value:null},{value:-1},{name:'similar credit'}])assert.equal(currentBenefitProgress(rule('dining'),[{...row,...patch}],'2026-10-27'),null);
 assert.equal(currentBenefitProgress(rule('travel'),[row],'2026-10-27'),null);
 assert.equal(currentBenefitProgress(rule('dining'),[],'2026-10-27'),null);
});
test('public benefits retain provenance and do not pretend personal verification',()=>{
 assert.equal(profile.benefits.length,32);
 assert.equal(profile.transferPartners.length,14);
 for(const b of profile.benefits){assert.equal(b.accountState,'unverified');assert.ok(['2026-10-27','2026-10-29'].includes(b.checkedAt));for(const id of b.sourceIds){assert.ok(benefitSources[id]);assert.notEqual(id,'forum-csr');}}
 for(const p of profile.transferPartners){assert.equal(p.relationship,'transfer-only');assert.equal(p.ratio,null);assert.equal(p.accountLinked,'unverified');}
 assert.equal(hsbcRewardCash.liveAccountVerifiedThisRun,false);
 assert.equal(hsbcRewardCash.capabilities.find(c=>c.feature==='EveryMile／Privé 兑换').channel,'app-only');
 assert.equal(hsbcRewardCash.capabilities.find(c=>c.feature==='独立奖赏钱账户').channel,'app-only');
});
