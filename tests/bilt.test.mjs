// Bilt is a manual-only issuer (#231): its cards are added by hand and never read, but they get the catalogue
// product, benefits, credits, Bilt Rewards transfers, pooling and a default point value like any other card.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cardProducts,matchCardProduct} from '../src/productCatalog.js';
import {newWalletCard,mergeWalletCards,visibleConnections,defaultRefreshBanks} from '../src/walletRegistry.js';
import {PICKER_BANKS,pickerEntries,groupEntries} from '../src/productPicker.js';
import {request} from '../extension-next/protocol.js';
import {transferOptions,transferRoutes} from '../src/transferRoutes.js';
import {cardProgramme,pointsReach} from '../src/pointsPooling.js';
import {valuationFor,resolvePointValue,withPointValue} from '../src/pointValues.js';
import {chooseCard} from '../src/cardDecision.js';
import {creditTasks} from '../src/personalBenefits.js';
import {runWalletTool} from '../src/walletAgent.js';
import {queryKnowledge} from '../src/knowledge.js';

const DAY='2026-11-11';
const IDS={blue:'bilt-us-bilt-blue-card',obsidian:'bilt-us-bilt-obsidian-card',palladium:'bilt-us-bilt-palladium-card'};
const card=(key,id='t-'+key)=>{const p=cardProducts.find(x=>x.id===IDS[key]);return {id,productId:p.id,name:p.name,bank:p.bank,region:p.region,currency:'USD',tail:'1234'};};
const call=(name,args)=>({id:'t',type:'function',function:{name,arguments:JSON.stringify(args)}});

test('the three Bilt Card 2.0 products are in the catalogue as a manual-only US issuer',()=>{
 for(const id of Object.values(IDS)){const p=cardProducts.find(x=>x.id===id);assert.equal(p.bank,'Bilt');assert.equal(p.region,'US');assert.equal(p.collection,'not-supported');assert.equal(p.transferProgrammeId,'programme.bilt-rewards');
  for(const name of [p.name,...p.aliases])assert.equal(matchCardProduct({bank:'Bilt',region:'US',name}).product?.id,id,name);}
 const fees=Object.fromEntries(Object.entries(IDS).map(([k,id])=>[k,queryKnowledge({productId:id,kind:'fee',asOf:DAY}).rules.find(r=>r.terms.cardholderRole==='primary').terms.amount]));
 assert.deepEqual(fees,{blue:0,obsidian:95,palladium:495});
});

test('a Bilt card is added by hand, gets no connection row and never joins a refresh',()=>{
 const added=newWalletCard({bank:'Bilt',name:'Bilt Obsidian Card',tail:'1234'},'bilt-1');
 assert.deepEqual([added.region,added.currency,added.identitySource],['US','USD','manual']);
 const wallet=mergeWalletCards({cards:[],connections:[{bank:'Chase',note:''}]},[added]);
 assert.ok(!wallet.connections.some(c=>c.bank==='Bilt'),'no connection row for a manual-only issuer');
 assert.ok(!visibleConnections({...wallet,connections:[...wallet.connections,{bank:'Bilt',note:''}]},null).some(c=>c.bank==='Bilt'),'an old row is not shown either');
 assert.deepEqual(defaultRefreshBanks(wallet.cards,null),[]);
 // The collector rejects a refresh that names a card of a bank it does not know, so the page leaves Bilt cards out.
 const chase={id:'c1',bank:'Chase',tail:'1111',currency:'USD'},bilt={id:'b1',bank:'Bilt',tail:'2222',currency:'USD'};
 assert.throws(()=>request({type:'refresh',requestId:'r1',banks:['Chase'],cards:[chase,bilt],channel:'cardybara-dashboard'}),/invalid_card/);
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.match(main,/cards:data\.cards\.filter\(c=>!manualOnly\(c\.bank\)\)\.map\(refreshCard\)/);
 // Removing a Bilt card sends nothing to the collector, which would reject the unknown bank with an error toast.
 assert.throws(()=>request({type:'remove-card',requestId:'r2',bank:'Bilt',cardId:'b1',tail:'2222',channel:'cardybara-dashboard'}));
 assert.match(main,/if\(v2\.current&&!manualOnly\(card\.bank\)\)sendCollector\('remove-card'/);
 assert.match(main,/Bilt:'Bilt'\}\);/,'the wallet bank filter offers Bilt');
});

test('the visual picker lists Bilt after Chase and Amex US and finds it by name',()=>{
 assert.deepEqual(PICKER_BANKS.slice(0,2),['Chase','Amex US']);assert.ok(PICKER_BANKS.includes('Bilt'));
 assert.ok(PICKER_BANKS.indexOf('Bilt')<PICKER_BANKS.indexOf('HSBC HK'),'with the US banks');
 const entries=pickerEntries(cardProducts.filter(p=>p.bank==='Bilt'));
 const found=groupEntries(entries,{query:'bilt palladium'}).flatMap(g=>g.items.map(i=>i.id));
 assert.equal(found[0],IDS.palladium);
});

test('Bilt Rewards transfers at the published rates, in whole 1,000-point steps',()=>{
 const routes=transferRoutes('programme.bilt-rewards');assert.equal(routes.length,27);
 const rate=id=>routes.find(r=>r.partnerId===id).terms.ratio;
 assert.deepEqual(rate('programme.world-of-hyatt'),{from:1,to:1});assert.deepEqual(rate('programme.all-accor'),{from:3,to:2});
 assert.deepEqual(rate('programme.i-prefer'),{from:1,to:2});assert.deepEqual(rate('programme.amtrak-guest-rewards'),{from:2,to:1});
 assert.equal(routes.find(r=>r.partnerId==='programme.amtrak-guest-rewards').kind,'rail');
 assert.ok(routes.every(r=>r.terms.minimumPoints===null&&r.terms.incrementPoints===1000&&r.terms.minimumByStatus.blue===2000));
 const found=transferOptions([card('blue')],{partner:'Accor',points:4500});
 const [group]=found.programmes;assert.equal(group.programme,'Bilt Rewards');assert.equal(group.pooling.kind,'shared');
 assert.deepEqual(group.partners[0].conversion,{status:'computed',spend:4000,receive:2666,unusedPoints:500,capped:false,fees:[]});
});

test('every Bilt card is one pool, so a balance is counted once',()=>{
 const cards=[card('blue','a'),card('palladium','b')];
 assert.equal(cardProgramme(cards[0]).rule.pooling,'shared');
 assert.ok(pointsReach(cards).every(m=>m.reachProductIds.includes(IDS.blue)&&m.reachProductIds.includes(IDS.palladium)));
 const result=runWalletTool(call('points_accounts',{programme:'Bilt Rewards'}),{cards,events:[],day:DAY});
 assert.equal(result.programmes[0].pooling,'shared');assert.equal(result.programmes[0].held,true);
});

test('the default value is the lower of FM RRV and TPG, and the user can override it',()=>{
 const entry=valuationFor({programme:'Bilt Rewards',card:'Bilt Blue Card',region:'US',currency:'USD',unit:'points-per-USD'});
 assert.equal(entry.cents,1.55);assert.ok(entry.cents<=Math.min(entry.source.value,...entry.otherSources.map(s=>s.value)));
 assert.equal(resolvePointValue(entry).basis,'default');
 assert.equal(resolvePointValue(entry,withPointValue([],entry.id,2,'2026-11-10T00:00:00Z')).cents,2);
 assert.equal(valuationFor({programme:'Bilt Rewards',region:'HK',currency:'HKD'}),null,'never applied to another region');
});

test('card choice reads the Bilt earning rules, with conditions kept',()=>{
 const cards=[card('obsidian','o'),card('palladium','p')],ctx={cards,events:[],day:DAY,marketDefaults:false};
 const row=(r,name)=>r.rows.find(x=>x.card===name);
 const dining=chooseCard({category:'dining',amount:100,currency:'USD',country:'US'},ctx);
 assert.equal(row(dining,'Bilt Palladium Card').earn.rate,2);
 const obs=row(dining,'Bilt Obsidian Card');assert.equal(obs.earn.rate,1,'the chosen category is not assumed');
 assert.ok(obs.optional.some(o=>o.rate===3&&o.needs.includes('chosen-category')));
 const hotel=chooseCard({category:'hotel',channel:'portal',portal:'Bilt Travel',amount:300,currency:'USD',country:'US'},ctx);
 assert.equal(row(hotel,'Bilt Obsidian Card').earn.rate,4);assert.equal(row(hotel,'Bilt Palladium Card').earn.rate,4);
 // Obsidian's 2X travel is airlines, hotels, cruise lines and car rental bought directly; transit and Lyft stay 1X.
 const transit=chooseCard({category:'transit',amount:20,currency:'USD',country:'US'},ctx);assert.equal(row(transit,'Bilt Obsidian Card').earn.rate,1);
 assert.equal(row(chooseCard({category:'car-rental',amount:200,currency:'USD',country:'US'},ctx),'Bilt Obsidian Card').earn.rate,2);
 const lyft=chooseCard({category:'transit',merchant:'Lyft',amount:20,currency:'USD',country:'US'},ctx);
 assert.ok(row(lyft,'Bilt Palladium Card').optional.some(o=>o.rate===4&&o.needs.includes('linked-account')));
 assert.equal(row(lyft,'Bilt Obsidian Card').earn.rate,1);
 const grocery=queryKnowledge({productId:IDS.obsidian,kind:'earning-rate',asOf:DAY}).rules.find(r=>r.terms.spendCategory==='超市（自选类别）');
 assert.deepEqual([grocery.terms.spendCap.amount,grocery.terms.afterCapPercent],[25000,1]);
});

test('hotel credits become half-year credit tasks; Bilt Cash is not a credit to track',()=>{
 const tasks=creditTasks([card('obsidian','o'),card('palladium','p')],DAY);
 const hotel=tasks.filter(t=>t.ruleId.endsWith('.hotel-credit'));
 assert.deepEqual(hotel.map(t=>[t.cardId,t.limit,t.period.start,t.period.end]),[['o',50,'2026-07-01','2026-12-31'],['p',200,'2026-07-01','2026-12-31']]);
 assert.ok(!tasks.some(t=>/bilt-cash/.test(t.ruleId)));
 const housing=queryKnowledge({productId:IDS.blue,asOf:DAY}).rules.find(r=>r.id.endsWith('.housing-points'));
 assert.match(housing.original.quotes.map(q=>q.text).join(' '),/5-transaction monthly minimum/);
});

test('the assistant reads the Bilt fee and partners from its knowledge, with sources',()=>{
 const ctx={cards:[card('palladium')],events:[],day:DAY};
 const fee=runWalletTool(call('get_card_rules',{kind:'fee'}),ctx);assert.ok(JSON.stringify(fee).includes('legal.cardless.com'));
 const convert=runWalletTool(call('convert_points',{partner:'Hyatt',points:10000}),ctx);
 assert.equal(convert.programmes[0].partners[0].conversion.receive,10000);
});
