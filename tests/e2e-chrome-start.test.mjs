// The packaged-extension E2E waits for Chrome within a bound and launches it once more if it never answers
// (stl00/Cardybara#211). A fake Chrome on the same debugging pipe stands in for a slow, stuck or dying one.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {pipeCdp,startChrome} from '../scripts/e2e-chrome.mjs';

const fake=fileURLToPath(new URL('./helpers/fake-chrome.mjs',import.meta.url));
const children=[];
function fakeChrome(...args){
 const child=spawn(process.execPath,[fake,...args],{stdio:['ignore','ignore','pipe','pipe','pipe']});
 children.push(child);
 return {child,cdp:pipeCdp(child,{timeoutMs:()=>5000})};
}
test.after(()=>{for(const c of children)if(c.exitCode===null&&c.signalCode===null)c.kill('SIGKILL');});
// Short waits keep the test quick; a launch that must answer gets a budget well above a loaded runner's
// Node start-up, so only a launch that is meant to hang ever runs out.
const quick={budgetMs:1500,firstWaitMs:100,maxWaitMs:400};

test('a slow-starting Chrome is waited for on the first launch, with a growing wait between attempts',async()=>{
 const notes=[],launched=[];
 const {browser,version}=await startChrome(async n=>{launched.push(n);return fakeChrome('answer','700');},{...quick,budgetMs:10000,note:m=>notes.push(m)});
 assert.equal(version.product,'FakeChrome/1.0');
 assert.deepEqual(launched,[1]);
 const line=notes.find(m=>m.startsWith('chrome answered'));
 assert.match(line,/^chrome answered on launch 1 of 2, attempt ([2-9]|\d\d+), after \d+ ms$/);
 // The pipe still works after the readiness attempts that timed out.
 assert.equal((await browser.cdp.send('Browser.getVersion')).product,'FakeChrome/1.0');
});

test('a Chrome that never answers is killed and launched once more',async()=>{
 const notes=[],first=[];
 const {version}=await startChrome(async n=>{const b=n===1?fakeChrome('hang'):fakeChrome('answer','0');if(n===1)first.push(b.child);return b;},{...quick,budgetMs:4000,note:m=>notes.push(m)});
 assert.equal(version.product,'FakeChrome/1.0');
 assert.ok(first[0].signalCode==='SIGKILL','the stuck Chrome was killed');
 assert.match(notes.join('\n'),/chrome launch 1 of 2 gave no DevTools answer \(Browser\.getVersion: no answer, \d+ ms\); killing it and launching again/);
 assert.match(notes.join('\n'),/chrome answered on launch 2 of 2, attempt \d+,/);
});

test('a Chrome that exits is noticed at once, not after the whole budget',async()=>{
 const notes=[],t0=Date.now();
 const {version}=await startChrome(async n=>n===1?fakeChrome('exit','3'):fakeChrome('answer','0'),{...quick,budgetMs:10000,note:m=>notes.push(m)});
 assert.equal(version.product,'FakeChrome/1.0');
 assert.ok(Date.now()-t0<5000,'the exit did not wait out the 10 s budget');
 assert.match(notes.join('\n'),/launch 1 of 2 gave no DevTools answer \(Browser\.getVersion: (Chrome exited \(3\)|pipe closed)/);
});

test('a Chrome that never answers on either launch fails the start, with each launch named',async()=>{
 let launches=0;
 await assert.rejects(startChrome(async()=>{launches++;return fakeChrome('hang');},quick),
  /^Error: Chrome never answered over DevTools \(launch 1: Browser\.getVersion: no answer after \d+ ms; launch 2: Browser\.getVersion: no answer after \d+ ms\)$/);
 assert.equal(launches,2,'no more than one relaunch');
 for(const c of children.slice(-2))assert.ok(c.exitCode!==null||c.signalCode!==null,'no Chrome is left running');
});

test('a Chrome that keeps dying fails after two launches without spinning',async()=>{
 let launches=0;
 await assert.rejects(startChrome(async()=>{launches++;return fakeChrome('exit','1');},{...quick,budgetMs:10000}),/launch 1: Browser\.getVersion: (Chrome exited \(1\)|pipe closed).*launch 2: Browser\.getVersion: (Chrome exited \(1\)|pipe closed)/);
 assert.equal(launches,2);
});
