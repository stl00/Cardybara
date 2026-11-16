import test from 'node:test';
import assert from 'node:assert/strict';
import {fixedRedemptions,fixedRedemptionsFor,validateFixedRedemptions} from '../src/fixedRedemptions.js';
import data from '../src/data/knowledge/fixed-redemptions.json' with {type:'json'};
test('shipped fixed-redemption records pass the validator',()=>{assert.deepEqual(validateFixedRedemptions(),[]);});
test('both programmes have records, and only stated values are numbers',()=>{
 assert.ok(fixedRedemptionsFor('programme.chase-ultimate-rewards').length>=4);assert.ok(fixedRedemptionsFor('programme.amex-membership-rewards-us').length>=4);
 const num=Object.fromEntries(fixedRedemptions.filter(r=>typeof r.centsPerPoint==='number').map(r=>[r.id,r.centsPerPoint]));
 assert.deepEqual(num,{'ur-cash-back':1,'ur-gift-cards':1,'mr-business-checking-deposit-business-platinum':1,'mr-checking-deposit-standard':0.8});
 assert.equal(fixedRedemptions.find(r=>r.id==='ur-travel-chase-travel').centsPerPoint,'varies');
 assert.equal(fixedRedemptions.find(r=>r.id==='mr-statement-credit').centsPerPoint,null,'no blog or search-snippet rate');
});
const clone=()=>structuredClone(data);
test('validator rejects a record with no source or check date',()=>{
 const d=clone();d.redemptions[0].sourceIds=[];d.redemptions[1].checkedAt='soon';
 const e=validateFixedRedemptions(d);assert.ok(e.some(m=>/ur-cash-back.*source/.test(m)));assert.ok(e.some(m=>/ur-gift-cards.*checkedAt/.test(m)));
});
test('validator rejects values that are not a number, "varies" or unknown',()=>{
 for(const bad of ['1','about 1',NaN,0,-1,undefined,99]){const d=clone();d.redemptions[0].centsPerPoint=bad;assert.ok(validateFixedRedemptions(d).some(m=>/centsPerPoint/.test(m)),String(bad));}
 const d=clone();d.redemptions[0].centsPerPoint=null;assert.ok(validateFixedRedemptions(d).some(m=>/needs a reason/.test(m)));
});
test('validator rejects programmes outside US MR/UR and non-official sources',()=>{
 for(const p of ['programme.amex-membership-rewards-hk','programme.bilt-rewards']){const d=clone();d.redemptions[0].programmeId=p;assert.ok(validateFixedRedemptions(d).some(m=>/programme outside/.test(m)));}
 const d=clone();d.redemptions[0].region='HK';d.sources[0].authority='blog';const e=validateFixedRedemptions(d);assert.ok(e.some(m=>/region/.test(m)));assert.ok(e.some(m=>/official/.test(m)));
});
test('every record carries English source text and Simplified Chinese',()=>{
 for(const r of fixedRedemptions){assert.ok(r.textEn&&/[一-鿿]/.test(r.textZh),r.id);}
});
