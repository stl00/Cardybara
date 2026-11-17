/** Issuer redemption values for the points page (#308): rounding, card-dependent options, pools without evidence, unknown values. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {redemptionValue,redemptionsFor,REDEMPTION_PROGRAMMES} from '../src/issuerRedemptions.js';
const rec=(over={})=>({id:'r',programmeId:'programme.chase-ultimate-rewards',kind:'cash-back',centsPerPoint:1,productIds:null,conditionText:'',sourceIds:[],checkedAt:'2026-01-01',...over});
test('a numeric value is computed in whole cents and rounded once',()=>{
 assert.deepEqual(redemptionValue(10000,rec()),{status:'computed',cents:10000});
 assert.equal(redemptionValue(1999,rec({centsPerPoint:0.7})).cents,1399);
 assert.equal(redemptionValue(1,rec({centsPerPoint:0.5})).cents,1,'half a cent rounds up');
 assert.equal(redemptionValue(3,rec({centsPerPoint:0.1})).cents,0);
});
test('a card-dependent option needs a held qualifying card; a pool without evidence shows the condition only',()=>{
 const r=rec({centsPerPoint:1.5,productIds:['card.a']});
 assert.deepEqual(redemptionValue(10000,r,['card.a','card.b']),{status:'computed',cents:15000});
 assert.deepEqual(redemptionValue(10000,r,['card.b']),{status:'needs-card'});
 assert.deepEqual(redemptionValue(10000,r,null),{status:'needs-card'});
 assert.deepEqual(redemptionValue(10000,r,[]),{status:'needs-card'});
 assert.equal(redemptionValue(10000,rec({centsPerPoint:1}),null).status,'computed','an option for any card needs no evidence');
});
test('varies and unknown never become numbers, and bad balances give no value',()=>{
 assert.deepEqual(redemptionValue(10000,rec({centsPerPoint:'varies'})),{status:'varies'});
 for(const bad of [null,undefined,'1.5',-1,NaN])assert.equal(redemptionValue(10000,rec({centsPerPoint:bad})).status,'unknown');
 for(const bad of [0,-5,1.5,NaN,null,'1000'])assert.deepEqual(redemptionValue(bad,rec()),{status:'no-points'});
 assert.equal(redemptionValue(null,rec({centsPerPoint:'varies'})).status,'varies');
});
test('only Membership Rewards US and Ultimate Rewards get issuer redemptions',()=>{
 const all=[rec(),rec({id:'m',programmeId:'programme.amex-membership-rewards-us'}),rec({id:'h',programmeId:'programme.amex-membership-rewards-hk'})];
 assert.deepEqual(REDEMPTION_PROGRAMMES,['programme.amex-membership-rewards-us','programme.chase-ultimate-rewards']);
 assert.deepEqual(redemptionsFor('programme.amex-membership-rewards-hk',all),[]);
 assert.deepEqual(redemptionsFor('programme.chase-ultimate-rewards',all).map(r=>r.id),['r']);
});
