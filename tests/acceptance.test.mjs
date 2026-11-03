import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAcceptance,REQUIRED_CASES,REQUIRED_BANKS} from '../scripts/acceptance.mjs';
function fixture(){return {schema:1,artifactSha256:'a'.repeat(64),runtimeBuild:'fixture-build',verifiedAt:new Date().toISOString(),environment:{freshChromeProfile:true,oldBackupImported:false,developerServicesRequired:false,extensionId:'a'.repeat(32)},cases:Object.fromEntries(REQUIRED_CASES.map(c=>[c,{status:'passed',mode:'real-chrome',evidence:'Synthetic validator test; not real acceptance.'}])),banks:Object.fromEntries(REQUIRED_BANKS.map(bank=>[bank,{status:'passed',cardCount:1,visibleCardCount:1,runtimeBuild:'fixture-build',capturedAt:new Date().toISOString(),cards:[{fields:Object.fromEntries(['reward','balance','statement','minimum','due'].map(f=>[f,{status:'observed',capturedAt:new Date().toISOString()}]))}]}]))};}
const options={sha256:'a'.repeat(64),runtimeBuild:'fixture-build'};
test('release gate fails closed without actual installation and every bank field',()=>{
 assert.equal(validateAcceptance({},options).passed,false);const r=fixture();assert.equal(validateAcceptance(r,options).passed,true);
 for(const key of REQUIRED_CASES){const copy=structuredClone(r);copy.cases[key].mode='mock';assert.equal(validateAcceptance(copy,options).passed,false);}
 for(const bank of REQUIRED_BANKS){const copy=structuredClone(r);copy.banks[bank].cards[0].fields.reward.status='not_found';assert.equal(validateAcceptance(copy,options).passed,false);}
});
test('the gate matches the MVP regions and reward scope, and still fails closed',()=>{
 assert.deepEqual([...REQUIRED_BANKS].sort(),['Amex HK','Amex US','BOA','Chase','Citi US','HSBC HK','SC HK']);
 const r=fixture(),set=(bank,change)=>{const copy=structuredClone(r);Object.assign(copy.banks[bank].cards[0].fields.reward,change);return validateAcceptance(copy,options).passed;};
 const out={status:'not_collected',reason:'Not collected in this version.',programme:'Hilton Honors Points'};
 assert.equal(set('BOA',out),true);assert.equal(set('Chase',out),true,'a co-brand card');
 assert.equal(set('BOA',{...out,programme:undefined}),false,'must name the programme');assert.equal(set('BOA',{...out,reason:''}),false,'must say why');
 assert.equal(set('Chase',{...out,programme:'Ultimate Rewards points'}),false);assert.equal(set('Amex US',{...out,programme:'Membership Rewards'}),false);assert.equal(set('Amex HK',{...out,programme:'美國運通積分計劃'}),false);
 for(const programme of ['Ultimate  Rewards','Ultimate\u00a0Rewards','Ultimate-Rewards','Ultimate Reward','UR'])assert.equal(set('Chase',{...out,programme}),false,programme);
 for(const programme of ['MembershipRewards','Membership Reward','會員 積分','MR','Points','積分','n/a','Some Unlisted Points'])assert.equal(set('Amex US',{...out,programme}),false,programme);
 for(const programme of ['Points','n/a','none'])assert.equal(set('BOA',{...out,programme}),false,programme);
 assert.equal(set('BOA',{...out,reason:'        '}),false,'blank reason');
 assert.equal(set('Chase',{status:'explicit_not_applicable',reason:'Bank shows no reward.'}),false,'a reward cannot be waived that way');
 for(const field of ['balance','statement','minimum','due']){const copy=structuredClone(r);Object.assign(copy.banks.BOA.cards[0].fields[field],out);assert.equal(validateAcceptance(copy,options).passed,false,field);}
 const noCiti=structuredClone(r);delete noCiti.banks['Citi US'];assert.equal(validateAcceptance(noCiti,options).passed,false);
 for(const field of ['balance','statement']){const copy=structuredClone(r);Object.assign(copy.banks.BOA.cards[0].fields[field],{status:'explicit_not_applicable',reason:'Bank states no payment is due.'});assert.equal(validateAcceptance(copy,options).passed,false,field);}
 const noPay=structuredClone(r);Object.assign(noPay.banks.BOA.cards[0].fields.minimum,{status:'explicit_not_applicable',reason:'Bank states no payment is due.'});assert.equal(validateAcceptance(noPay,options).passed,true);
});
test('release gate refuses changed bytes, stale/old workers, imported backups and developer dependencies',()=>{
 for(const mutate of [r=>r.artifactSha256='b'.repeat(64),r=>r.runtimeBuild='old',r=>r.environment.oldBackupImported=true,r=>r.environment.freshChromeProfile=false,r=>r.environment.developerServicesRequired=true,r=>r.verifiedAt='2020-01-01']){const r=fixture();mutate(r);assert.equal(validateAcceptance(r,options).passed,false);}
});
