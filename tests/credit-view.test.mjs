import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {creditView,daysLeft,ENDING_SOON_DAYS} from '../src/creditView.js';
import {creditTasks} from '../src/personalBenefits.js';
const asOf='2026-11-20';
const task=(id,end,categories=['dining'],title=id)=>({key:JSON.stringify(['c',`rule.${id}`,'2026-11-01',end]),cardId:'c',ruleId:`rule.${id}`,revisionId:`rule.${id}@1`,title,period:{start:'2026-11-01',end},categories});
const mark=(t,status)=>({id:t.key+status,key:t.key,status,revisionId:t.revisionId,at:'2026-11-10T00:00:00.000Z'});
const tasks=[task('soon','2026-11-30'),task('later','2026-12-31',['hotel']),task('both','2026-11-21',['dining','shopping'],'DoorDash')];

test('with no marks nothing is treated as used or as unused',()=>{
 const view=creditView(tasks,[],asOf);
 assert.deepEqual(view.rows.map(r=>r.status),['unknown','unknown','unknown']);assert.equal(view.open.length,3);assert.equal(view.done.length,0);
});
test('only credits close to their end count as ending soon, and handled ones never do',()=>{
 assert.equal(daysLeft(tasks[0],asOf),10);assert.ok(10<=ENDING_SOON_DAYS);
 assert.deepEqual(creditView(tasks,[],asOf).ending.map(r=>r.task.title),['soon','DoorDash']);
 const view=creditView(tasks,[mark(tasks[0],'used')],asOf);assert.deepEqual(view.ending.map(r=>r.task.title),['DoorDash']);assert.equal(view.done.length,1);
 assert.equal(creditView(tasks,[mark(tasks[0],'partial')],asOf).ending.length,2,'partly used is still open');
});
test('a credit with two uses appears under both, and counts follow the state filter',()=>{
 const view=creditView(tasks,[],asOf);
 assert.deepEqual(Object.fromEntries(view.categories.map(c=>[c.id,c.count])),{hotel:1,dining:2,shopping:1});
 assert.deepEqual(creditView(tasks,[],asOf,{category:'shopping'}).rows.map(r=>r.task.title),['DoorDash']);
 assert.deepEqual(creditView(tasks,[mark(tasks[1],'skipped')],asOf,{state:'done'}).categories.map(c=>c.id),['hotel']);
});
test('search uses the supplied text and marks the view as filtered',()=>{
 const view=creditView(tasks,[],asOf,{query:' DOORDASH '});assert.deepEqual(view.rows.map(r=>r.task.title),['DoorDash']);assert.equal(view.filtered,true);
 assert.equal(creditView(tasks,[],asOf,{query:'gold',textOf:t=>t.title+' Gold'}).rows.length,3);
 assert.equal(creditView(tasks,[],asOf).filtered,false);
});
test('real credit tasks reach the view with categories and stay sorted by end date',()=>{
 const cards=JSON.parse(readFileSync(new URL('./fixtures/wallet-products.json',import.meta.url),'utf8')).cards,view=creditView(creditTasks(cards,asOf),[],asOf);
 assert.ok(view.categories.length>=4);const ends=view.rows.map(r=>r.task.period.end);assert.deepEqual(ends,[...ends].sort());
});
test('an empty wallet produces an empty view',()=>{const view=creditView([],[],asOf);assert.deepEqual([view.rows,view.categories,view.ending],[[],[],[]]);});
