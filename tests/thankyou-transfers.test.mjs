// Citi ThankYou transfer partners as Citi's public product pages state them (#181): seven named partners and a
// 1,000-point minimum for Strata Premier and Strata Elite, and no rate, so conversion maths stays blocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cardProducts} from '../src/productCatalog.js';
import {convertPoints,transferOptions,transferProgrammes,transferRoutes} from '../src/transferRoutes.js';
import {runWalletTool} from '../src/walletAgent.js';
import {knowledgeSources} from '../src/knowledge.js';
const TY='programme.citi-thankyou',PREMIER='citi-us-citi-strata-premier-card',ELITE='citi-us-citi-strata-elite-card';
const product=id=>cardProducts.find(p=>p.id===id),held=id=>({id:'c-'+id,bank:'Citi US',region:'US',name:product(id).name});
const call=(name,args)=>({id:'t1',type:'function',function:{name,arguments:JSON.stringify(args)}});
const PARTNERS=['American Airlines AAdvantage','Cathay Asia Miles','Choice Privileges','EVA Infinity MileageLands','JetBlue TrueBlue','The Leading Hotels of the World Leaders Club','Virgin Atlantic Flying Club'];
test('ThankYou lists the seven partners Citi names, each with the published minimum and nothing else',()=>{
 const routes=transferRoutes(TY);
 assert.deepEqual(routes.map(r=>r.partner).sort(),PARTNERS);
 for(const r of routes){
  assert.deepEqual([...r.productIds].sort(),[ELITE,PREMIER].sort(),r.partner);
  assert.equal(r.terms.ratio,null,r.partner);assert.equal(r.terms.ratioStatement,null,r.partner);
  assert.equal(r.terms.minimumPoints,1000);
  for(const unknown of ['incrementPoints','maximumPoints','estimatedTime','fees','final'])assert.equal(r.terms[unknown],null,`${r.partner} ${unknown}`);
  assert.equal(r.checkedAt,'2026-11-11');
  const urls=knowledgeSources(r.sourceIds).map(s=>s.url);
  assert.deepEqual(urls.sort(),[product(ELITE).sourceUrl,product(PREMIER).sourceUrl].sort());
 }
});
test('only the two Strata cards link to ThankYou transfers; Double Cash and Custom Cash do not',()=>{
 assert.equal(product(PREMIER).transferProgrammeId,TY);assert.equal(product(ELITE).transferProgrammeId,TY);
 for(const id of ['citi-us-citi-double-cash-card','citi-us-citi-custom-cash-card']){
  assert.equal(product(id).transferProgrammeId,undefined,id);
  const r=transferOptions([held(id)]);assert.equal(r.programmes.length,0,id);assert.equal(r.cardsWithoutTransferRecord.length,1,id);
 }
});
test('convert_points returns ThankYou routes for a held Strata Premier and refuses the maths without a rate',()=>{
 const ctx={cards:[held(PREMIER)],events:[],day:'2026-11-11'};
 const result=runWalletTool(call('convert_points',{points:25000}),ctx);
 assert.equal(result.programmes.length,1);const [g]=result.programmes;
 assert.equal(g.programme,'ThankYou Points');assert.equal(g.region,'US');assert.deepEqual(g.cards.map(c=>c.name),[product(PREMIER).name]);
 assert.deepEqual(g.partners.map(p=>p.partner).sort(),PARTNERS);
 for(const p of g.partners){
  assert.equal(p.rate,'not-published',p.partner);assert.equal(p.ratio,null);assert.equal(p.minimumPoints,1000);
  assert.deepEqual(p.conversion,{status:'ratio-unknown'},p.partner);
  assert.ok(p.sources.some(s=>s.url===product(PREMIER).sourceUrl),p.partner);
 }
 assert.equal(result.cardsWithoutTransferRecord.length,0);
 const one=runWalletTool(call('convert_points',{partner:'American Airlines',points:25000}),ctx);
 assert.deepEqual(one.programmes[0].partners.map(p=>p.partner),['American Airlines AAdvantage']);
 // A partner Citi's page does not name is not offered, however familiar.
 const absent=runWalletTool(call('convert_points',{partner:'Turkish'}),ctx);assert.equal(absent.partnerFound,false);assert.equal(absent.totalPartners,0);
});
test('a null ThankYou rate blocks conversion even above the minimum',()=>{
 const [route]=transferRoutes(TY);
 assert.deepEqual(convertPoints(50000,route.terms),{status:'ratio-unknown'});
});
test('ThankYou answers the assistant but adds no tab to the rewards page',()=>{
 const ty=transferProgrammes.find(p=>p.id===TY);assert.equal(ty.tab,false);
 assert.deepEqual(transferProgrammes.filter(p=>p.tab!==false).map(p=>p.label),['Membership Rewards','Ultimate Rewards','Membership Rewards','Bilt Rewards']);
});
