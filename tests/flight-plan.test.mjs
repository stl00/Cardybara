// #82: a flight paid with points, cash or both. Every step comes from code: transfer path and maths from verified
// rules, airline credits from query_credits, and award data marked not checked rather than guessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runWalletTool,validateToolCall} from '../src/walletAgent.js';
import {pointsToReach,convertPoints} from '../src/transferRoutes.js';
import {answerGrounding} from '../src/answerGrounding.js';
import {reduceToolResult,topicItems} from '../src/conversationState.js';
import {planResults} from '../src/creditClaims.js';
const cards=JSON.parse(readFileSync(new URL('./fixtures/wallet-products.json',import.meta.url))).cards;
const ctx={cards,events:[],day:'2026-11-10'};
const call=(args)=>({id:'c1',type:'function',function:{name:'plan_flight',arguments:JSON.stringify(args)}});
const rows=r=>r.transfers.programmes.flatMap(g=>g.partners);

test('pointsToReach rounds up to whole transfer steps and never below the miles',()=>{
 const oneToOne={ratio:{from:1000,to:1000},minimumPoints:1000,incrementPoints:1000};
 assert.deepEqual(pointsToReach(25500,oneToOne),{status:'computed',spend:26000,receive:26000,extraMiles:500,fees:[]});
 assert.equal(pointsToReach(400,oneToOne).spend,1000,'the minimum transfer');
 const fourToThree={ratio:{from:4,to:3},incrementPoints:1000};
 const r=pointsToReach(30000,fourToThree);assert.equal(r.spend,40000);assert.equal(r.receive,30000);
 // The result is the same maths convertPoints does forwards, so the two never disagree.
 for(const miles of [1,750,999,1001,29999,30001])for(const terms of [oneToOne,fourToThree]){
  const back=pointsToReach(miles,terms),fwd=convertPoints(back.spend,terms);
  assert.ok(fwd.receive>=miles,`${miles} reached`);assert.equal(fwd.receive,back.receive);
  const less=convertPoints(back.spend-(terms.incrementPoints||1),terms);assert.ok(less.status!=='computed'||less.receive<miles,`${miles}: no smaller transfer reaches it`);
 }
 assert.deepEqual(pointsToReach(5000,{ratio:{from:1,to:1},maximumPoints:4000}),{status:'above-maximum',maximumPoints:4000});
 assert.equal(pointsToReach(5000,{ratio:null}).status,'ratio-unknown');
});

test('plan_flight gives route, dates, transfer path, points needed and shortfall, and says award data is not checked',()=>{
 const r=runWalletTool(call({airline:'Delta',route:'JFK to LAX',when:'Dec 20-27',milesNeeded:25500,points:20000}),ctx);
 assert.equal(r.kind,'flight-plan');assert.equal(r.route.stated,'JFK to LAX');
 assert.equal(r.dates.start,'2026-12-20');assert.equal(r.dates.end,'2026-12-27');
 assert.equal(r.award.status,'not-checked');assert.match(r.award.reason,/cannot be checked/);
 const delta=rows(r).find(x=>x.partner==='Delta SkyMiles');
 assert.ok(delta.cards.every(c=>c.region==='US'));assert.equal(delta.rate,'published');
 assert.equal(delta.toReachMiles.spend,26000);assert.equal(delta.toReachMiles.receive,26000);
 assert.deepEqual(delta.shortfall,{statedPoints:20000,pointsShort:6000,enough:false});
 assert.ok(delta.toReachMiles.fees.some(f=>f.charge>0),'a published transfer fee is carried');
 assert.ok(delta.sources.some(s=>s.url?.startsWith('https://')));
 assert.ok(rows(r).every(x=>x.partner==='Delta SkyMiles'),'only the named airline');
 assert.equal(r.credits.tool,'query_credits');assert.equal(r.credits.use,'airline');assert.ok(r.credits.totalItems>0);
 // #193: each programme on the path carries its value per point and whose value it is.
 assert.ok(r.valuation.programmes.some(v=>v.programme==='Amex Membership Rewards US'&&v.cents===1.5&&v.basis==='default'&&v.source.url.startsWith('https://')));
 assert.match(runWalletTool(call({airline:'Delta'}),{...ctx,marketDefaults:false}).valuation.note,/No value per point/);
 const own=runWalletTool(call({airline:'Delta'}),{...ctx,pointValues:[{id:'amex-mr-us',cents:2,at:'2026-11-01T00:00:00Z'}]}).valuation.programmes.find(v=>v.programmeId==='amex-mr-us');
 assert.deepEqual([own.cents,own.basis,own.defaultCents],[2,'user',1.5]);
 assert.ok(!JSON.stringify(r).includes('"balance"'),'no balances');
});

test('plan_flight hides rates a rule does not publish, never pools programmes, and asks for the award price',()=>{
 const r=runWalletTool(call({airline:'Flying Blue',milesNeeded:25000,points:30000}),ctx);
 const ur=r.transfers.programmes.find(g=>g.programme==='Ultimate Rewards');
 for(const row of ur?.partners||[])if(row.rate!=='published'){assert.equal(row.toReachMiles,undefined);assert.equal(row.shortfall,undefined);}
 if(r.transfers.programmes.length>1)assert.match(r.transfers.pointsNote,/separately/);
 const enough=rows(r).find(x=>x.shortfall);assert.deepEqual(enough.shortfall,{statedPoints:30000,pointsShort:0,enough:true});
 const bare=runWalletTool(call({airline:'Delta'}),ctx);
 assert.ok(rows(bare).every(x=>!x.toReachMiles&&!x.shortfall));assert.match(bare.transfers.milesNote,/award price/);
 assert.equal(bare.dates.precision,'current-cycle');assert.equal(bare.route.stated,null);
 const none=runWalletTool(call({airline:'Mars Air'}),ctx);assert.equal(none.transfers.partnerFound,false);assert.ok(none.transfers.partnerNote);
 assert.ok(runWalletTool(call({airline:'Delta',cardName:'Blue Cash Everyday'}),ctx).transfers.withoutRecordNote);
});

test('plan_flight validates its arguments',()=>{
 for(const bad of [{},{airline:''},{airline:'Delta',milesNeeded:1.5},{airline:'Delta',points:'1000'},{airline:'Delta',destination:'usa'},{airline:'Delta',balance:1}])
  assert.throws(()=>validateToolCall(call(bad)),/invalid_arguments/);
 assert.equal(validateToolCall(call({airline:'达美',route:'纽约飞洛杉矶',milesNeeded:25500})).name,'plan_flight');
});

test('answers from a flight plan are checked like transfer and credit answers, and price no point',()=>{
 const r=runWalletTool(call({airline:'Delta',route:'JFK to LAX',when:'Dec 20-27',milesNeeded:25500,points:20000}),{...ctx,marketDefaults:false});
 const evidence=[r,r.credits,r.transfers];
 assert.equal(planResults(evidence).length,1,'its credits count as a credit plan');
 assert.ok(answerGrounding('Membership Rewards to Delta SkyMiles moves at 1:1; you need 26,000 points and are 6,000 short.',evidence).issues.every(i=>!['unsupported_number','unsupported_transfer_ratio'].includes(i.code)));
 assert.ok(answerGrounding('Delta SkyMiles at 1:2.',evidence).issues.some(i=>i.code==='unsupported_transfer_ratio'));
 assert.ok(answerGrounding('You are 7,000 points short.',evidence).issues.some(i=>i.code==='unsupported_number'));
 assert.ok(answerGrounding('Each point is worth about 1.2 cents, so pay with points.',evidence).issues.some(i=>i.code==='unstated_point_value'));
 assert.ok(!answerGrounding('If you value a point above 1 cent, compare it with the cash fare.',evidence).issues.some(i=>i.code==='unstated_point_value'));
 const dropped=answerGrounding('Membership Rewards to Delta SkyMiles moves at 1:1.',evidence).issues.map(i=>i.code);
 assert.ok(dropped.includes('plan_dates_not_stated'),'the dates used must be stated');
});

test('a flight plan remembers its dates and topics for the follow-up',()=>{
 const r=runWalletTool(call({airline:'Delta',when:'Dec 20-27',milesNeeded:25500}),ctx);
 const state=reduceToolResult({},{name:'plan_flight',args:{airline:'Delta'},result:r},{cards});
 assert.equal(state.trip.start,'2026-12-20');assert.equal(state.trip.use,'airline');
 assert.ok(topicItems({name:'plan_flight',result:r},cards).some(i=>i.card));
});

test('#193: a flight plan priced at the default market valuation says so, and never calls it the user\'s',()=>{
 const r=runWalletTool(call({airline:'Delta',route:'JFK to LAX',milesNeeded:25500,points:20000}),ctx);
 const evidence=[r,r.credits,r.transfers],codes=a=>answerGrounding(a,evidence).issues.map(i=>i.code);
 assert.ok(!codes('按默认市场估值每点 1.5 美分，26,000 点约值 390 美元，可在设置里改。').includes('unstated_point_value'));
 assert.ok(codes('按你的估值每点 1.5 美分，26,000 点约值 390 美元。').includes('default_as_user_value'));
 assert.ok(codes('At your 1.5 cents a point, 26,000 points are worth about 390 dollars.').includes('default_as_user_value'));
 const set=runWalletTool(call({airline:'Delta',milesNeeded:25500}),{...ctx,pointValues:[{id:'amex-mr-us',cents:2,at:'2026-11-01T00:00:00Z'}]});
 assert.ok(!answerGrounding('按你设定的每点 2 美分。',[set,set.credits,set.transfers]).issues.some(i=>i.code==='default_as_user_value'));
});
