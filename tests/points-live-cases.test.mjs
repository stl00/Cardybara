// #481: the three live cases for points_accounts and convert_points pass offline with a correct, tool-only answer
// and each fails when the expected tool is not called or the answer breaks its rule. No model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {pointsCases,runPointsCase,POINTS_CASE_IDS,POINTS_FAULTS} from '../evals/points-case.mjs';
import {liveCases} from '../evals/fixtures.mjs';
import {READ_ONLY_TOOLS,caseWallet} from '../evals/live-case.mjs';

const failed=r=>Object.entries(r.checks).filter(([,v])=>!v).map(([k])=>k);
const config=JSON.parse(fs.readFileSync(fileURLToPath(new URL('../evals/live/config.json',import.meta.url)),'utf8'));

test('the three cases exist, are in the nightly config and use tools the live run allows',()=>{
 assert.equal(pointsCases.length,3);assert.ok(pointsCases.every(Boolean));
 for(const id of POINTS_CASE_IDS)assert.ok(config.cases.includes(id),id+' is in config.json');
 assert.ok(config.cases.length<=config.maxCases);assert.ok(['points_accounts','convert_points'].every(t=>READ_ONLY_TOOLS.includes(t)));
 assert.ok(liveCases.some(c=>c.expectTool==='points_accounts')&&liveCases.some(c=>c.expectTool==='convert_points'));
});

test('each case passes with a correct answer written only from the tool result',async()=>{
 for(const c of pointsCases){const r=await runPointsCase(c);assert.deepEqual(failed(r),[],c.id);assert.ok(r.detail.toolNames.includes(c.expectTool||(c.expectTools[0])),c.id);}
});

test('not calling the expected tool fails the case',async()=>{
 for(const c of pointsCases)for(const fault of ['no-tool','wrong-tool']){
  const r=await runPointsCase(c,{fault});
  assert.equal(r.checks.expectedTool,false,c.id+' '+fault);assert.ok(failed(r).length,c.id+' '+fault);
 }
});

test('rounding the leftover up, or denying the combine route, fails the case',async()=>{
 const by=id=>pointsCases.find(c=>c.id===id);
 assert.ok(failed(await runPointsCase(by('convert-stated-points'),{fault:'rounded-up'})).length);
 for(const id of ['points-add-up','convert-through-pooled-card'])assert.ok(failed(await runPointsCase(by(id),{fault:'no-combine'})).length,id);
 assert.deepEqual(POINTS_FAULTS,['no-tool','wrong-tool','rounded-up','no-combine']);
});

test('the pooled case reaches Hyatt through the card that has the record, and the wallet date puts the rule in force',()=>{
 const c=pointsCases.find(x=>x.id==='convert-through-pooled-card'),w=caseWallet(c);
 assert.equal(w.day,'2026-11-16');assert.deepEqual(w.cards.map(x=>x.productId).sort(),['chase-us-chase-sapphire-preferred-credit-card','chase-us-freedom-unlimited']);
 assert.equal(caseWallet(liveCases.find(x=>x.id==='dining')).day,'2026-10-29','other cases keep the shared day');
});
