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
test('release gate refuses changed bytes, stale/old workers, imported backups and developer dependencies',()=>{
 for(const mutate of [r=>r.artifactSha256='b'.repeat(64),r=>r.runtimeBuild='old',r=>r.environment.oldBackupImported=true,r=>r.environment.freshChromeProfile=false,r=>r.environment.developerServicesRequired=true,r=>r.verifiedAt='2020-01-01']){const r=fixture();mutate(r);assert.equal(validateAcceptance(r,options).passed,false);}
});
