// #345: the offline coverage-question evals pass on a correct answer and each one fails when a rule is broken.
import test from 'node:test';
import assert from 'node:assert/strict';
import {runWalletTool} from '../src/walletAgent.js';
import {coverageCases,runCoverageCase,FAULTS} from '../evals/coverage-case.mjs';

const failed=r=>Object.entries(r.checks).filter(([,v])=>!v).map(([k])=>k);
const byId=id=>coverageCases.find(c=>c.id===id);

test('every coverage case passes with a correct, record-only answer',async()=>{
 for(const c of coverageCases){const r=await runCoverageCase(c);assert.deepEqual(failed(r),[],c.id);assert.ok(r.detail.toolNames.includes('find_protections'),c.id);}
});

test('saying "not covered" for a card with no record fails the case (not found is not not covered)',async()=>{
 const r=await runCoverageCase(byId('coverage-trip-delay-no-record'),{fault:'not-covered'});
 assert.ok(failed(r).includes('neverNotCovered')||failed(r).includes('saysNoRecord'),JSON.stringify(r.checks));
 assert.equal(r.checks.neverNotCovered,false);
});

test('an invented limit breaks the source trace, and no insurance is given a dollar value',async()=>{
 for(const c of coverageCases){
  const limit=await runCoverageCase(c,{fault:'invented-limit'}),value=await runCoverageCase(c,{fault:'valuation'});
  assert.ok(failed(limit).length,c.id+' invented-limit');assert.ok(failed(value).length,c.id+' valuation');
 }
});

// The shipped answer checker already blocks an invented number; with it out of the way the eval's own trace check must still fail.
const ungated=async({question,context,request})=>{
 const first=(await request({messages:[]})).message,result=runWalletTool(first.tool_calls[0],context);
 const answer=(await request({messages:[{role:'tool',content:JSON.stringify(result)}]})).message.content;return {answer};
};
test('without the shipped checker, the eval itself fails an invented limit and a dollar value',async()=>{
 for(const c of coverageCases){
  assert.equal((await runCoverageCase(c,{fault:'invented-limit',turn:ungated})).checks.limitsTraceable,false,c.id);
  assert.equal((await runCoverageCase(c,{fault:'valuation',turn:ungated})).checks.noValuation,false,c.id);
  assert.deepEqual(failed(await runCoverageCase(c,{turn:ungated})),[],c.id);
 }
});

test('skipping find_protections fails every case',async()=>{
 for(const c of coverageCases){const r=await runCoverageCase(c,{fault:'no-tool'});assert.equal(r.checks.calledFindProtections,false,c.id);}
});

test('the Chinese case states secondary as recorded, and claiming primary fails it',async()=>{
 const c=byId('coverage-rental-recorded-zh');
 assert.equal((await runCoverageCase(c)).checks['basis:secondary'],true);
 assert.equal((await runCoverageCase({...c,basis:{'American Express Gold Card':'primary'}})).checks['basis:primary'],false);
});

test('the fault list is the one the eval script offers',()=>{assert.deepEqual(FAULTS,['not-covered','invented-limit','valuation','no-tool']);});
