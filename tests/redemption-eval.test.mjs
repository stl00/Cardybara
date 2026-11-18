// #464: the offline issuer-redemption evals pass on a correct answer and each one fails when a rule is broken.
import test from 'node:test';
import assert from 'node:assert/strict';
import {redemptionCases,runRedemptionCase,ungatedTurn,REDEMPTION_FAULTS} from '../evals/redemption-case.mjs';

const failed=r=>Object.entries(r.checks).filter(([,v])=>!v).map(([k])=>k);
const byId=id=>redemptionCases.find(c=>c.id===id);

test('there are at least four cases, in English and Chinese, one for each redemption status',()=>{
 assert.ok(redemptionCases.length>=4);
 assert.deepEqual([...new Set(redemptionCases.map(c=>c.status))].sort(),['computed','needs-card','unknown','varies']);
 assert.ok(redemptionCases.some(c=>c.language==='en')&&redemptionCases.some(c=>/^zh/.test(c.language)));
});

test('every case passes with a correct, tool-only answer, with and without the shipped checker',async()=>{
 for(const c of redemptionCases)for(const turn of [undefined,ungatedTurn]){
  const r=await runRedemptionCase(c,{turn});assert.deepEqual(failed(r),[],c.id);assert.ok(r.detail.toolNames.includes('points_accounts'),c.id);
 }
});

test('each fault makes its case fail, in the eval itself and through the shipped loop',async()=>{
 for(const f of REDEMPTION_FAULTS.filter(x=>x!=='no-tool')){
  const applicable=redemptionCases.filter(c=>c.fault===f);
  assert.ok(applicable.length,f+' has a case');
  for(const c of applicable){
   assert.ok(failed(await runRedemptionCase(c,{fault:f,turn:ungatedTurn})).length,c.id+' '+f+' (eval checks)');
   assert.ok(failed(await runRedemptionCase(c,{fault:f})).length,c.id+' '+f+' (shipped loop)');
  }
 }
});

test('the named failures: wrong dollars, an invented value per point, a number for "varies", a value for a card not held',async()=>{
 assert.equal((await runRedemptionCase(byId('redemption-ur-cash-back-en'),{fault:'wrong-dollars',turn:ungatedTurn})).checks.dollarsMatchTool,false);
 assert.equal((await runRedemptionCase(byId('redemption-mr-unknown-zh'),{fault:'invented-cpp',turn:ungatedTurn})).checks.givesNoValue,false);
 assert.equal((await runRedemptionCase(byId('redemption-ur-varies-en'),{fault:'varies-number',turn:ungatedTurn})).checks.givesNoValue,false);
 assert.equal((await runRedemptionCase(byId('redemption-mr-needs-card-zh'),{fault:'needs-card-value',turn:ungatedTurn})).checks.givesNoValue,false);
});

test('answering without calling points_accounts fails every case',async()=>{
 for(const c of redemptionCases){
  assert.ok(failed(await runRedemptionCase(c,{fault:'no-tool'})).length,c.id+' shipped loop');
  assert.equal((await runRedemptionCase(c,{fault:'no-tool',turn:ungatedTurn})).checks.calledPointsAccounts,false,c.id);
 }
});

test('the needs-card answer names the condition, and dropping it fails',async()=>{
 const c=byId('redemption-mr-needs-card-zh');
 assert.equal((await runRedemptionCase(c)).checks.namesCondition,true);
 const r=await runRedemptionCase(c,{fault:'needs-card-value',turn:ungatedTurn});assert.equal(r.checks.namesCondition,false);
});

test('the fault list is the one the eval script offers',()=>{assert.deepEqual(REDEMPTION_FAULTS,['wrong-dollars','invented-cpp','varies-number','needs-card-value','no-tool']);});

test('multi-turn: "and as a statement credit?" is scored against the Membership Rewards programme, not the Ultimate Rewards one before it',async()=>{
 const {dialogues}=await import('../evals/multiturn/dialogues.mjs'),{argumentsMatch}=await import('../evals/multiturn/live.mjs'),{replay,contextSources,resolvable,checkLabels}=await import('../evals/multiturn/harness.mjs');
 const d=dialogues.find(x=>x.id==='red-statement-credit-en');assert.ok(d);
 assert.deepEqual(checkLabels(d),[]);
 const r=await replay(d);assert.deepEqual(r.fixtureIssues,[]);
 assert.equal(resolvable(d.target,contextSources(r.sent)).resolvable,true);
 const call=args=>({name:'points_accounts',args});
 assert.equal(argumentsMatch(d.expect,call({programme:'Membership Rewards',region:'US'})),true);
 assert.equal(argumentsMatch(d.expect,call({programme:'Ultimate Rewards',region:'US'})),false);
});
