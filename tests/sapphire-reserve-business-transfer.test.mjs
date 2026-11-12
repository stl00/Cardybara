// Sapphire Reserve for Business is a transfer-capable Ultimate Rewards card (#201): Chase's product page states a
// points transfer to hotel and airline programmes, so a holder's UR points reach the programme's partners through
// it. The page names no partner and the wallet records no rate for this card, so no conversion maths is done.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cardProducts} from '../src/productCatalog.js';
import {cardProgramme,pointsReach} from '../src/pointsPooling.js';
import {transferOptions} from '../src/transferRoutes.js';
import {runWalletTool} from '../src/walletAgent.js';
const UR='programme.chase-ultimate-rewards',BIZ='chase-us-sapphire-reserve-for-business-credit-card';
const card=(id,name)=>({id,bank:'Chase',region:'US',name,currency:'USD'});
const biz=card('b','Sapphire Reserve for Business'),cfu=card('f','Freedom Unlimited'),united=card('u','United Quest');
const convert=(cards,args)=>runWalletTool({id:'t1',type:'function',function:{name:'convert_points',arguments:JSON.stringify(args)}},{cards,events:[],day:'2026-11-12'});

test('the catalogue links the business card to Ultimate Rewards transfers, with the page and date it was checked',()=>{
 const p=cardProducts.find(x=>x.id===BIZ);
 assert.equal(p.transferProgrammeId,UR);
 assert.deepEqual(p.transferSource,{url:'https://creditcards.chase.com/business-credit-cards/sapphire/reserve',checkedAt:'2026-11-12'});
 assert.equal(p.transferSource.url,p.sourceUrl,'the source is the issuer product page');
});
test('a holder with only the business card reaches Ultimate Rewards partners',()=>{
 const m=cardProgramme(biz);assert.equal(m.rule.programmeId,UR);assert.equal(m.transfers,true);
 const r=transferOptions([biz]);
 assert.equal(r.programmes.length,1);assert.equal(r.programmes[0].programme,'Ultimate Rewards');assert.equal(r.cardsWithoutTransferRecord.length,0);
 const partners=r.programmes[0].partners.map(p=>p.partner);
 for(const name of ['United MileagePlus','Southwest Rapid Rewards','Marriott Bonvoy'])assert.ok(partners.includes(name),name);
});
test('a Freedom card reaches partners through a held business card, and has no route without it',()=>{
 const reach=pointsReach([biz,cfu]),freedom=reach.find(r=>r.card.id==='f');
 assert.equal(freedom.ownTransfer,false);assert.deepEqual(freedom.reachProductIds,[BIZ]);assert.deepEqual(freedom.via.map(c=>c.id),['b']);
 const group=transferOptions([cfu,biz]).programmes[0];
 assert.deepEqual(group.cards.find(c=>c.name==='Freedom Unlimited').transfersThrough,['Sapphire Reserve for Business']);
 const alone=transferOptions([cfu]);assert.equal(alone.programmes.length,0);
 assert.equal(pointsReach([cfu])[0].reachProductIds.length,0);
});
test('a co-brand card still does not join the pool through the business card',()=>{
 assert.equal(cardProgramme(united),null);
 assert.deepEqual(pointsReach([biz,united]).map(r=>r.card.id),['b']);
});
test('no rate is borrowed from another card: maths stays blocked and the Hyatt row is not applied',()=>{
 const u=convert([biz],{points:25000,partner:'United'}).programmes[0].partners[0];
 assert.equal(u.rate,'not-published');assert.equal(u.ratio,null);assert.deepEqual(u.conversion,{status:'ratio-unknown'});assert.equal(u.incrementPoints,1000);
 const h=convert([biz],{points:25000,partner:'World of Hyatt'}).programmes[0].partners[0];
 assert.equal(h.rate,'card-not-listed');assert.equal(h.ratio,null);assert.equal(h.conversion,undefined);
});
