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
import {upToByProductFor} from '../src/fixedRedemptions.js';
import products from '../src/data/card-products.json' with {type:'json'};
test('Chase Travel Points Boost limits are per-product upper bounds on a "varies" record (#532)',()=>{
 const r=fixedRedemptions.find(x=>x.id==='ur-travel-chase-travel'),list=upToByProductFor('ur-travel-chase-travel');
 assert.equal(r.centsPerPoint,'varies');assert.equal(r.dependsOn,'card-with-points-boost');
 assert.ok(list.length>=1);
 const byId=new Map(products.products.map(p=>[p.id,p])),src=new Map(data.sources.map(s=>[s.id,s]));
 const ids=new Set();
 for(const u of list){
  const p=byId.get(u.productId);assert.ok(p,`${u.productId} in catalogue`);assert.ok(p.rewardPrograms.includes('Ultimate Rewards'),u.productId);
  assert.ok(!ids.has(u.productId));ids.add(u.productId);
  assert.match(src.get(u.sourceId).url,/^https:\/\/[a-z.]*chase\.com\//);
  const n=u.upToCentsPerPoint;assert.ok(u.textEn.includes('$'+n.toFixed(2)),`quote holds the number for ${u.productId}`);assert.ok(/[一-鿿]/.test(u.textZh)&&u.textZh.includes(n.toFixed(2)),`Simplified Chinese text holds the number for ${u.productId}`);assert.ok(!/[們點動這與優]/.test(u.textZh),`Simplified Chinese for ${u.productId}`);
 }
 assert.deepEqual(upToByProductFor('ur-cash-back'),[]);
});
test('validator rejects bad Points Boost entries and any entry on a record with a fixed number',()=>{
 const mk=f=>{const d=clone();f(d.redemptions.find(x=>x.id==='ur-travel-chase-travel'));return validateFixedRedemptions(d);};
 assert.ok(mk(r=>{r.upToByProduct[0].upToCentsPerPoint='2';}).some(m=>/upToCentsPerPoint/.test(m)));
 assert.ok(mk(r=>{r.upToByProduct[0].sourceId='amex-mr-terms';}).some(m=>/chase\.com/.test(m)));
 assert.ok(mk(r=>{r.centsPerPoint=1;}).some(m=>/varies/.test(m)));
});
