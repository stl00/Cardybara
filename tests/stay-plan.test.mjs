// #480: the hotel half of a trip. Every branch: no route, rate unpublished, points short, enough, dates missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runWalletTool,validateToolCall,stayRows} from '../src/walletAgent.js';
const cards=JSON.parse(readFileSync(new URL('./fixtures/wallet-products.json',import.meta.url))).cards;
const ctx={cards,events:[],day:'2026-11-10'};
const call=args=>({id:'c1',type:'function',function:{name:'plan_stay',arguments:JSON.stringify(args)}});
const rows=r=>r.transfers.programmes.flatMap(g=>g.partners);
const published={partner:'Test Hotel',rate:'published',ratio:{from:1,to:1},minimumPoints:1000,incrementPoints:1000,sourceIds:[]};
const group=row=>[{programme:'P',partners:[row]}];

test('plan_stay with a held path and no award price says nothing about points needed and marks availability not checked',()=>{
 const r=runWalletTool(call({programme:'Hyatt',nights:3,when:'Dec 20-27'}),ctx);
 assert.equal(r.kind,'stay-plan');assert.equal(r.availability.status,'not-checked');
 assert.equal(r.dates.start,'2026-12-20');assert.equal(r.dates.end,'2026-12-27');
 assert.ok(r.transfers.partnerFound);assert.match(r.transfers.pointsNote,/No award price/);
 assert.ok(rows(r).every(x=>x.stay.status==='no-award-price'));
 assert.equal(r.protections.scored,false);assert.ok(r.protections.cards.length>0);
});
test('no route: a programme no held card reaches is said so, with no rows',()=>{
 const r=runWalletTool(call({programme:'Nowhere Stays',nights:2}),ctx);
 assert.equal(r.transfers.partnerFound,false);assert.match(r.transfers.partnerNote,/No transfer rule/);assert.equal(rows(r).length,0);
});
test('rate unpublished: a stated nightly price gives no points needed',()=>{
 const r=runWalletTool(call({programme:'Hyatt',nights:3,pointsPerNight:20000,points:10000}),ctx);
 assert.ok(rows(r).length>0);
 for(const x of rows(r)){assert.equal(x.rate,'not-published');assert.equal(x.stay.status,'rate-not-published');assert.equal(x.stay.spend,undefined);}
});
test('points short and enough, from a published rate, rounded to whole transfer steps',()=>{
 const short=stayRows(group(published),{nights:3,pointsPerNight:20500,points:50000})[0].partners[0].stay;
 assert.equal(short.status,'computed');assert.equal(short.totalHotelPoints,61500);assert.equal(short.spend,62000);
 assert.deepEqual(short.shortfall,{statedPoints:50000,pointsShort:12000,enough:false});
 const enough=stayRows(group(published),{nights:3,pointsPerNight:20500,points:70000})[0].partners[0].stay;
 assert.deepEqual(enough.shortfall,{statedPoints:70000,pointsShort:0,enough:true});
 const noPoints=stayRows(group(published),{nights:2,pointsPerNight:10000})[0].partners[0].stay;
 assert.equal(noPoints.spend,20000);assert.equal(noPoints.shortfall,undefined);
});
test('dates missing: no date words, or words that give no window, ask for dates instead of guessing',()=>{
 const none=runWalletTool(call({programme:'Hyatt',nights:3}),ctx);
 assert.equal(none.dates.needsDates,true);assert.equal(none.dates.phrase,null);assert.equal(none.dates.start,undefined);
 const vague=runWalletTool(call({programme:'Hyatt',nights:3,when:'sometime soon'}),ctx);
 assert.deepEqual([vague.dates.needsDates,vague.dates.phrase],[true,'sometime soon']);
 assert.equal(runWalletTool(call({programme:'Hyatt',nights:3,when:'December'}),ctx).dates.start,'2026-12-01');
});
test('arguments: nights and programme are required, nights is a whole number, no unknown keys',()=>{
 assert.throws(()=>validateToolCall(call({programme:'Hyatt'})),/invalid_arguments/);
 assert.throws(()=>validateToolCall(call({nights:2})),/invalid_arguments/);
 assert.throws(()=>validateToolCall(call({programme:'Hyatt',nights:2.5})),/invalid_arguments/);
 assert.throws(()=>validateToolCall(call({programme:'Hyatt',nights:0})),/invalid_arguments/);
 assert.throws(()=>validateToolCall(call({programme:'Hyatt',nights:2,cashFare:5})),/invalid_arguments/);
 assert.equal(validateToolCall(call({programme:'Hyatt',nights:2,pointsPerNight:15000})).name,'plan_stay');
});
