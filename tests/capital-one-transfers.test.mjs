// Capital One Miles transfer partners as Capital One's public transfer article states them (#182): 23 partners with a
// rate each and a 1,000-mile floor, for Venture, Venture X and Venture X Business. Wells Fargo's signed-out pages name
// no partner, so Autograph Journey has no transfer record.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cardProducts} from '../src/productCatalog.js';
import {convertPoints,transferOptions,transferProgrammes,transferRoutes} from '../src/transferRoutes.js';
import {runWalletTool} from '../src/walletAgent.js';
import {knowledgeSources} from '../src/knowledge.js';
const C1='programme.capital-one-miles',VENTURE='capital-one-us-venture-rewards-credit-card',VENTURE_X='capital-one-us-venture-x-rewards-credit-card',VENTURE_X_BIZ='capital-one-us-venture-x-business-card';
const ARTICLE='https://www.capitalone.com/learn-grow/money-management/venture-miles-transfer-partnerships/';
const product=id=>cardProducts.find(p=>p.id===id),held=id=>({id:'c-'+id,bank:product(id).bank,region:'US',name:product(id).name});
const call=(name,args)=>({id:'t1',type:'function',function:{name,arguments:JSON.stringify(args)}});
// Partner -> [Capital One miles, partner units], as published. 2:1.5 on the page is 4:3 here.
const RATES={'Aeromexico Rewards':[1,1],'Air Canada Aeroplan':[1,1],'avianca lifemiles':[1,1],'The British Airways Club':[1,1],'Cathay Asia Miles':[1,1],'Etihad Guest':[1,1],
 'Finnair Plus':[1,1],'Air France KLM Flying Blue':[1,1],'Qantas Frequent Flyer':[1,1],'Qatar Airways Privilege Club':[1,1],'Singapore Airlines KrisFlyer':[1,1],'TAP Miles&Go':[1,1],
 'Turkish Airlines Miles&Smiles':[1,1],'Virgin Red':[1,1],'Copa Airlines ConnectMiles':[4,3],'Emirates Skywards':[4,3],'EVA Infinity MileageLands':[4,3],'Japan Airlines Mileage Bank':[4,3],
 'JetBlue TrueBlue':[5,3],'Choice Privileges':[1,1],'Wyndham Rewards':[1,1],'I Prefer Hotel Rewards':[1,2],'ALL Accor':[2,1]};
test('Capital One Miles lists the 23 partners Capital One names, each with its published rate and floor and nothing else',()=>{
 const routes=transferRoutes(C1);
 assert.deepEqual(routes.map(r=>r.partner).sort(),Object.keys(RATES).sort());
 for(const r of routes){
  assert.deepEqual([...r.productIds].sort(),[VENTURE,VENTURE_X,VENTURE_X_BIZ].sort(),r.partner);
  assert.deepEqual([r.terms.ratio.from,r.terms.ratio.to],RATES[r.partner],r.partner);
  assert.equal(r.terms.minimumPoints,1000);assert.equal(r.terms.final,true);
  for(const unknown of ['incrementPoints','maximumPoints','estimatedTime','fees'])assert.equal(r.terms[unknown],null,`${r.partner} ${unknown}`);
  assert.equal(r.checkedAt,'2026-11-11');
  const urls=knowledgeSources(r.sourceIds).map(s=>s.url);
  assert.deepEqual(urls.sort(),[ARTICLE,...[VENTURE,VENTURE_X,VENTURE_X_BIZ].map(id=>product(id).sourceUrl)].sort());
 }
 assert.match(routes.find(r=>r.partner==='Choice Privileges').summary,/美国的 Choice Privileges/);
});
test('only Venture, Venture X and Venture X Business link to Capital One transfers; cash cards do not',()=>{
 for(const id of [VENTURE,VENTURE_X,VENTURE_X_BIZ])assert.equal(product(id).transferProgrammeId,C1,id);
 for(const id of ['capital-one-us-savor-credit-card','capital-one-us-spark-cash-plus-card']){
  assert.equal(product(id).transferProgrammeId,undefined,id);
  const r=transferOptions([held(id)]);assert.equal(r.programmes.length,0,id);assert.equal(r.cardsWithoutTransferRecord.length,1,id);
 }
});
test('convert_points returns Capital One routes for a held Venture X and does whole-number maths at each published rate',()=>{
 const ctx={cards:[held(VENTURE_X)],events:[],day:'2026-11-11'};
 const result=runWalletTool(call('convert_points',{points:25000}),ctx);
 assert.equal(result.programmes.length,1);const [g]=result.programmes;
 assert.equal(g.programme,'Capital One Miles');assert.equal(g.region,'US');assert.deepEqual(g.cards.map(c=>c.name),[product(VENTURE_X).name]);
 assert.deepEqual(g.partners.map(p=>p.partner).sort(),Object.keys(RATES).sort());
 for(const p of g.partners){
  const [from,to]=RATES[p.partner];
  assert.equal(p.rate,'published',p.partner);assert.equal(p.minimumPoints,1000);
  assert.equal(p.conversion.status,'computed',p.partner);assert.equal(p.conversion.spend,25000,p.partner);
  assert.equal(p.conversion.receive,Math.floor(25000*to/from),p.partner);
  assert.ok(p.sources.some(s=>s.url===ARTICLE),p.partner);
 }
 assert.equal(result.cardsWithoutTransferRecord.length,0);
 const receive=name=>runWalletTool(call('convert_points',{partner:name,points:25000}),ctx).programmes[0].partners[0].conversion.receive;
 assert.equal(receive('Emirates Skywards'),18750);assert.equal(receive('JetBlue'),15000);assert.equal(receive('I Prefer'),50000);assert.equal(receive('Accor'),12500);
 // A partner Capital One's article does not name is not offered, however familiar.
 const absent=runWalletTool(call('convert_points',{partner:'United'}),ctx);assert.equal(absent.partnerFound,false);assert.equal(absent.totalPartners,0);
});
test('fewer miles than the published 1,000 floor are not converted, and a missing rate would block the maths',()=>{
 const route=transferRoutes(C1).find(r=>r.partner==='Emirates Skywards');
 assert.deepEqual(convertPoints(999,route.terms),{status:'below-minimum',minimumPoints:1000});
 assert.deepEqual(convertPoints(50000,{...route.terms,ratio:null}),{status:'ratio-unknown'});
 // No increment is published, so every mile above the floor transfers and partner units are floored.
 const odd=convertPoints(1001,route.terms);assert.equal(odd.spend,1001);assert.equal(odd.receive,750);assert.equal(odd.unusedPoints,0);
});
test('Wells Fargo Autograph Journey has no transfer record: no signed-out Wells Fargo page names a partner',()=>{
 const JOURNEY='wells-fargo-us-autograph-journey-visa-card';
 assert.equal(product(JOURNEY).transferProgrammeId,undefined);
 assert.ok(!transferProgrammes.some(p=>p.bank==='Wells Fargo'));
 const r=runWalletTool(call('convert_points',{points:25000}),{cards:[held(JOURNEY)],events:[],day:'2026-11-11'});
 assert.equal(r.programmes.length,0);assert.equal(r.cardsWithoutTransferRecord.length,1);
});
test('Capital One Miles answers the assistant but adds no tab to the rewards page',()=>{
 assert.equal(transferProgrammes.find(p=>p.id===C1).tab,false);
 assert.deepEqual(transferProgrammes.filter(p=>p.tab!==false).map(p=>p.label),['Membership Rewards','Ultimate Rewards','Membership Rewards','Bilt Rewards']);
});
