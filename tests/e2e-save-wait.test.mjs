// The E2E saves an edit dialog and must not give up on a click that was dropped (stl00/Cardybara#262).
import assert from 'node:assert/strict';
import test from 'node:test';
import {pressUntil} from '../scripts/e2e-chrome.mjs';

// A fake clock: sleeping advances time, so the test needs no real waiting.
function clock(){let t=0;return {now:()=>t,sleep:async ms=>{t+=ms;}};}

test('a press that is dropped is repeated until the dialog closes',async()=>{
 const c=clock();let presses=0,open=true;
 const ok=await pressUntil({...c,everyMs:1000,budgetMs:20000,press:async()=>{presses++;if(presses===3)open=false;},done:async()=>!open});
 assert.equal(ok,true);
 assert.equal(presses,3);
});

test('a press that works is made once and not again after the dialog closed',async()=>{
 const c=clock();let presses=0,open=true;
 const ok=await pressUntil({...c,everyMs:1000,budgetMs:20000,press:async()=>{presses++;open=false;},done:async()=>!open});
 assert.equal(ok,true);
 assert.equal(presses,1);
});

test('a dialog that never closes gives up after the budget, with bounded presses',async()=>{
 const c=clock();let presses=0;
 const ok=await pressUntil({...c,everyMs:1000,budgetMs:5000,press:async()=>{presses++;},done:async()=>false});
 assert.equal(ok,false);
 assert.ok(presses>=4&&presses<=6,'presses '+presses);
});

test('an already closed dialog is never pressed',async()=>{
 const c=clock();let presses=0;
 assert.equal(await pressUntil({...c,press:async()=>{presses++;},done:async()=>true}),true);
 assert.equal(presses,0);
});
