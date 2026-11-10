import test from 'node:test';
import assert from 'node:assert/strict';
import {convertPoints,readingsFor,routesForCard,transferOptions,transferProgrammes,transferRoutes} from '../src/transferRoutes.js';
const [mrUs,ur,mrHk]=transferProgrammes;
const route=(programme,id)=>transferRoutes(programme.id).find(r=>r.partnerId===id&&(!r.cardSpecific||r.terms.ratio));
test('published rates convert in whole units and never round leftovers up',()=>{
 assert.deepEqual(convertPoints(1500,route(mrUs,'programme.aeromexico-rewards').terms),{status:'computed',spend:1000,receive:1600,unusedPoints:500,capped:false,fees:[]});
 assert.equal(convertPoints(10000,route(mrUs,'programme.cathay-asia-miles').terms).receive,8000);
 assert.equal(convertPoints(1000,route(mrUs,'programme.hilton-honors').terms).receive,2000);
 assert.equal(convertPoints(1000,route(mrUs,'programme.leaders-club').terms).receive,250);
 const jet=convertPoints(1100,route(mrUs,'programme.jetblue-trueblue').terms);assert.equal(jet.spend,1000);assert.equal(jet.receive,800);assert.equal(jet.unusedPoints,100);
});
test('Hong Kong steps from its minimum and keeps its own rates',()=>{
 const cathay=route(mrHk,'programme.cathay-asia-miles').terms;
 assert.equal(convertPoints(17999,cathay).status,'below-minimum');assert.equal(convertPoints(17999,cathay).minimumPoints,18000);
 const r=convertPoints(30000,cathay);assert.equal(r.spend,27000);assert.equal(r.receive,1500);assert.equal(r.unusedPoints,3000);
 assert.equal(convertPoints(8000,route(mrHk,'programme.hilton-honors').terms).receive,1250);
 assert.equal(convertPoints(40000,route(mrHk,'programme.all-accor').terms).spend,37500);
 assert.equal(convertPoints(40000,route(mrHk,'programme.all-accor').terms).receive,1500);
 assert.equal(cathay.ratioCondition,'turbo-program');
});
test('an unstated rate gives no number and a stated programme-wide phrase does not fill it',()=>{
 const united=route(ur,'programme.united-mileageplus').terms;assert.equal(united.ratio,null);assert.deepEqual(convertPoints(50000,united),{status:'ratio-unknown'});assert.deepEqual(convertPoints(null,united),{status:'ratio-unknown'},'unknown shows before any amount is entered');
 assert.equal(convertPoints(1500,route(ur,'programme.world-of-hyatt').terms).receive,750);
 for(const bad of [0,-1,1.5,NaN,null,'1000'])assert.deepEqual(convertPoints(bad,route(mrUs,'programme.delta-skymiles').terms),{status:'no-points'});
});
test('a chosen card only gets rates that list it, and every partner stays visible',()=>{
 const routes=transferRoutes(ur.id),hyatt=rows=>rows.filter(r=>r.partnerId==='programme.world-of-hyatt');
 const of=productId=>routesForCard(routes,{hasCard:true,productId});
 assert.deepEqual(hyatt(of('chase-us-chase-sapphire-preferred-credit-card')).map(r=>r.terms.ratio),[{from:4,to:3}]);
 assert.deepEqual(hyatt(of('chase-us-sapphire-reserve')).map(r=>r.terms.ratio),[null]);
 for(const unlisted of ['chase-us-freedom-unlimited',null]){const rows=of(unlisted);assert.equal(rows.length,14,'one row per partner');assert.ok(rows.every(r=>r.coverage==='card-not-listed'&&r.terms.ratio===null&&!r.terms.ratioStatement));}
 assert.equal(hyatt(routesForCard(routes)).length,2,'no card chosen shows both, each labelled');
});
test('an Amex card outside the evidence gets no number, even with a published programme rate',()=>{
 for(const [programme,productId] of [[mrUs,'amex-us-us-blue-cash-everyday'],[mrUs,null],[mrHk,null]]){const rows=routesForCard(transferRoutes(programme.id),{hasCard:true,productId});assert.ok(rows.every(r=>r.coverage==='card-not-listed'&&convertPoints(50000,r.terms).status==='ratio-unknown'));}
 assert.ok(routesForCard(transferRoutes(mrUs.id),{hasCard:true,productId:'amex-us-us-american-express-gold-card'}).every(r=>r.coverage==='listed'&&r.terms.ratio));
});
test('an unstated minimum is not reported as a minimum',()=>{
 const hyatt=route(ur,'programme.world-of-hyatt').terms;assert.deepEqual(convertPoints(999,hyatt),{status:'below-increment',incrementPoints:1000});
 assert.equal(convertPoints(100,route(mrUs,'programme.delta-skymiles').terms).status,'below-minimum');
});
test('fees and per-transfer maximums come from the rule',()=>{
 const delta=convertPoints(100000,route(mrUs,'programme.delta-skymiles').terms);assert.equal(delta.fees[0].charge,60);
 assert.equal(convertPoints(999000,route(mrUs,'programme.delta-skymiles').terms).fees[0].charge,99,'capped at the published maximum');
 const capped=convertPoints(800000,route(mrUs,'programme.avianca-lifemiles').terms);assert.equal(capped.capped,true);assert.equal(capped.spend,750000);assert.equal(capped.unusedPoints,50000);
 assert.equal(convertPoints(18000,route(mrHk,'programme.qantas-frequent-flyer').terms).fees[0].charge,300);
});
test('readings stay per card, per programme and per market',()=>{
 const cards=[{id:'a',bank:'Amex US',region:'US',name:'American Express Gold Card'},{id:'b',bank:'Amex US',region:'US',name:'Unknown Card'},{id:'c',bank:'Amex HK',region:'HK',name:'The Platinum Card'}];
 const accounts={current:[{id:'1',bank:'Amex US',region:'US',label:'Membership Rewards',amount:1000,card:'a',cardReading:true},{id:'2',bank:'Amex US',region:'US',label:'Membership Rewards',amount:1000,card:'b',cardReading:true},{id:'3',bank:'Amex HK',region:'HK',label:'Membership Rewards',amount:5000,card:'c',cardReading:true},{id:'4',bank:'Chase',region:'US',label:'Ultimate Rewards',amount:700,card:'z'},{id:'5',bank:'BOA',region:'US',label:'Cash Rewards',amount:9,unit:'USD'}]};
 const us=readingsFor(mrUs,accounts,cards);assert.deepEqual(us.map(r=>r.amount),[1000,1000],'not summed');assert.equal(us[0].productId,'amex-us-us-american-express-gold-card');assert.equal(us[1].productId,null);
 assert.deepEqual(readingsFor(mrHk,accounts,cards).map(r=>r.amount),[5000]);
 assert.deepEqual(readingsFor(ur,accounts,cards).map(r=>r.amount),[700]);
 assert.deepEqual(readingsFor(ur,{current:[]},cards),[]);
 const partial=readingsFor(ur,{current:[{id:'6',bank:'Chase',region:'US',label:'Ultimate Rewards',amount:12.5,card:'z'}]},cards);assert.equal(partial.length,1,'a non-integer reading is shown, not dropped');assert.equal(partial[0].usable,false);
 const both=readingsFor(mrUs,{current:[{id:'a',bank:'Amex US',region:'US',label:'Membership Rewards',amount:1,card:'g'},{id:'us-mr',bank:'Amex US',region:'US',label:'Membership Rewards',amount:2,card:'g',historical:true}]},cards);assert.equal(new Set(both.map(r=>r.key)).size,2,'each reading can be chosen');
});
test('every partner lands in the airline or hotel list so none disappears from the page',()=>{
 for(const programme of transferProgrammes)for(const r of transferRoutes(programme.id))assert.ok(['airline','hotel'].includes(r.kind),r.partner);
 assert.equal(transferRoutes(mrUs.id).length,20);assert.equal(transferRoutes(mrHk.id).length,10);assert.equal(transferRoutes(ur.id).length,15);
});
test('transfer options give each held card only the rates its rules list, and never pool cards (#72)',()=>{
 const csr={id:'s1',name:'Sapphire Reserve',bank:'Chase',region:'US'},csp={id:'s2',name:'Sapphire Preferred',bank:'Chase',region:'US'},cfu={id:'s3',name:'Freedom Unlimited',bank:'Chase',region:'US'};
 const r=transferOptions([csr,csp,cfu],{partner:'凯悦',points:1500},{asOf:'2026-11-10'});
 assert.equal(r.programmes.length,1);assert.equal(r.programmes[0].programme,'Ultimate Rewards');
 const hyatt=r.programmes[0].partners,of=name=>hyatt.find(p=>p.cards.some(c=>c.name===name));
 assert.deepEqual(of('Sapphire Preferred').ratio,{from:4,to:3});assert.equal(of('Sapphire Preferred').conversion.receive,750);assert.equal(of('Sapphire Preferred').conversion.unusedPoints,500);
 assert.equal(of('Sapphire Reserve').ratio,null,'the Reserve has no stated Hyatt rate');assert.equal(of('Sapphire Reserve').conversion.status,'ratio-unknown');
 assert.ok(hyatt.every(p=>p.cards.length===1),'rates stay per card');
 assert.deepEqual(r.cardsWithoutTransferRecord.map(c=>c.name),['Freedom Unlimited'],'no transfer rule lists it, so it gets no partner');
});
test('transfer options hide every number from a card the evidence does not reach',()=>{
 const gold={id:'g',name:'American Express Gold Card',bank:'Amex US',region:'US'};
 const all=transferOptions([gold],{points:10000},{asOf:'2026-11-10'});
 assert.equal(all.programmes[0].programme,'Membership Rewards');assert.equal(all.totalPartners,transferRoutes(mrUs.id,{asOf:'2026-11-10'}).length);
 assert.equal(all.programmes[0].partners.find(p=>p.partner==='Cathay Asia Miles'||/Asia Miles/.test(p.partner)).conversion.receive,8000);
 const notListed=transferOptions([{id:'x',name:'Sapphire Reserve',bank:'Chase',region:'US'}],{partner:'Hyatt'},{asOf:'2026-11-10'}).programmes[0].partners[0];
 assert.equal(notListed.conversion,undefined,'no points stated, no conversion');
 assert.equal(transferOptions([gold],{partner:'Mars Miles'},{asOf:'2026-11-10'}).partnerFound,false);
 assert.deepEqual(transferOptions([],{},{asOf:'2026-11-10'}),{programmes:[],cardsWithoutTransferRecord:[],totalPartners:0,truncated:false,partnerFound:true});
});
