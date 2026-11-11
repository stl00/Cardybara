// Owner pooling rules (#192), on synthetic wallets only: totals count a shared pool once and add per-card accounts up
// once, and transfer reach follows the rule (pool, own card, or the union of the holder's combinable cards).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {POOLING_TEXT,cardProgramme,pointsReach,poolingRule,poolingRules,programmeTotals,rewardSummary,validatePooling} from '../src/pointsPooling.js';
import {rewardAccounts} from '../src/rewardAccounts.js';
import {transferOptions} from '../src/transferRoutes.js';
import {runWalletTool,validateToolCall} from '../src/walletAgent.js';
import {translations as i18nCatalog} from '../src/i18n/index.js';

const card=(id,bank,region,name)=>({id,bank,region,name,currency:region==='HK'?'HKD':'USD'});
const reading=(c,amount,capturedAt,label)=>({id:'r-'+c.id+'-'+capturedAt,card:c.id,bank:c.bank,region:c.region,label,amount,unit:'points',date:capturedAt.slice(0,10),capturedAt,cardReading:true});
const usGold=card('ug','Amex US','US','American Express Gold Card'),usPlat=card('up','Amex US','US','The Platinum Card');
const hkPlat=card('hp','Amex HK','HK','The Platinum Card'),hkExplorer=card('he','Amex HK','HK','American Express Explorer Credit Card');
const csp=card('cp','Chase','US','Chase Sapphire Preferred'),cfu=card('cf','Chase','US','Freedom Unlimited'),ink=card('ci','Chase','US','Ink Business Cash'),united=card('cu','Chase','US','United Quest');
const MR='Membership Rewards',UR='Ultimate Rewards',T1='2026-11-01T10:00:00Z',T2='2026-11-02T10:00:00Z';
const call=(name,args={})=>({id:'c1',type:'function',function:{name,arguments:JSON.stringify(args)}});
const tool=(cards,args)=>runWalletTool(call('points_accounts',args),{cards,events:[],day:'2026-11-11',language:'zh-CN'});
const totalOf=(rows,id)=>programmeTotals(rows).totals.find(t=>t.programmeId===id);

test('the pooling data is valid, owner-stated and sourced, one rule per programme and region',()=>{
 assert.deepEqual(validatePooling(),[]);
 assert.deepEqual(poolingRules.map(r=>[r.region,r.label,r.pooling,r.ownerOverride]),[['US',MR,'shared',true],['HK',MR,'per-card',true],['US',UR,'per-card-combinable',true]]);
 assert.ok(poolingRules.every(r=>r.checkedAt==='2026-11-11'&&r.caveats.length));
 assert.deepEqual(validatePooling([{...poolingRules[0],pooling:'family',sourceIds:['nope']}]).length>1,true,'unknown kinds and sources fail');
 const catalog=i18nCatalog;
 const texts=[...poolingRules.flatMap(r=>[r.summary,...r.caveats.map(c=>c.summary)]),...Object.values(POOLING_TEXT).flatMap(Object.values)];
 for(const language of ['en-US','zh-TW'])for(const text of texts)assert.ok(catalog[language][text],language+': '+text);
});

test('Amex US MR is one pool: the balance counts once, never per card',()=>{
 const same=totalOf([reading(usGold,50000,T1,MR),reading(usPlat,50000,T2,MR)],'programme.amex-membership-rewards-us');
 assert.equal(same.amount,50000);assert.equal(same.cardCount,2);assert.equal(same.pooling,'shared');assert.equal(same.readingsDiffer,false);
 // Different amounts on cards of one pool point to a card not linked yet: the newest reading stands and the caveat shows.
 const differ=totalOf([reading(usGold,50000,T2,MR),reading(usPlat,1200,T1,MR)],'programme.amex-membership-rewards-us');
 assert.equal(differ.amount,50000);assert.equal(differ.readingsDiffer,true);
 assert.match(poolingRule('programme.amex-membership-rewards-us').caveats[0].summaryEn,/newly opened/);
});

test('Amex HK MR is one account per card: balances add up once and the newest reading of each card is used',()=>{
 const rows=[reading(hkPlat,10000,T1,MR),reading(hkPlat,12000,T2,MR),reading(hkExplorer,30000,T1,MR)];
 const hk=totalOf(rows,'programme.amex-membership-rewards-hk');
 assert.equal(hk.amount,42000);assert.equal(hk.cardCount,2);assert.equal(hk.pooling,'per-card');assert.equal(hk.basis,'sum-of-cards');
});

test('Chase UR adds each card once, and a stored record is not added to card readings',()=>{
 const record={id:'ur',bank:'Chase',region:'US',label:UR,amount:99999,date:'2026-11-03'};
 const ur=totalOf([reading(csp,5000,T1,UR),reading(cfu,3000,T2,UR),record],'programme.chase-ultimate-rewards');
 assert.equal(ur.amount,8000);assert.equal(ur.notCounted,1);assert.equal(ur.pooling,'per-card-combinable');
 assert.equal(totalOf([record],'programme.chase-ultimate-rewards').amount,99999,'a record alone still shows');
 assert.equal(totalOf([record],'programme.chase-ultimate-rewards').basis,'record');
});

test('regions, programmes and cash never join a pool; uncovered balances pass through unchanged',()=>{
 const cash={id:'boa',bank:'BOA',region:'US',label:'Cash Rewards',amount:12,unit:'USD',date:'2026-11-01'};
 const hilton={id:'hilton',bank:'Hilton',region:'US',label:'Hilton Honors',amount:7000,date:'2026-11-01'};
 const rows=[reading(usGold,50000,T1,MR),reading(hkPlat,10000,T1,MR),cash,hilton];
 const {totals}=programmeTotals(rows);
 assert.deepEqual(totals.map(t=>[t.region,t.amount]).sort(),[['HK',10000],['US',50000]]);
 const summary=rewardSummary(rows);
 assert.deepEqual(summary.filter(r=>!r.total),[cash,hilton]);
 assert.equal(cardProgramme(hkPlat).rule.region,'HK');assert.equal(cardProgramme(usPlat).rule.region,'US');
 assert.equal(cardProgramme(united),null,'a co-brand card is not an Ultimate Rewards card');
});

test('totals work on the wallet\'s own reward accounts',()=>{
 const data={cards:[usGold,usPlat,csp,cfu],rewards:[],rewardObservations:[reading(usGold,40000,T1,MR),reading(usPlat,40000,T1,MR),reading(csp,1000,T1,UR),reading(cfu,2000,T1,UR)]};
 const summary=rewardSummary(rewardAccounts(data).current);
 assert.deepEqual(summary.map(r=>[r.label,r.amount,r.total]),[[MR,40000,true],[UR,3000,true]]);
});

test('transfer reach follows the rule: pool, own card only, or the union of the holder\'s combinable cards',()=>{
 const reach=Object.fromEntries(pointsReach([usGold,usPlat,hkPlat,hkExplorer,csp,cfu,ink,united]).map(r=>[r.card.id,r]));
 assert.deepEqual(reach.ug.reachProductIds.sort(),['amex-us-us-american-express-gold-card','amex-us-us-the-platinum-card'],'the pool reaches both cards');
 assert.deepEqual(reach.hp.reachProductIds,['amex-hk-hk-the-platinum-card']);assert.deepEqual(reach.he.reachProductIds,['amex-hk-hk-american-express-explorer-credit-card'],'HK never reaches another card');
 assert.deepEqual(reach.cf.reachProductIds,['chase-us-chase-sapphire-preferred-credit-card']);assert.deepEqual(reach.cf.via.map(c=>c.id),['cp']);
 assert.deepEqual(reach.ci.reachProductIds,['chase-us-chase-sapphire-preferred-credit-card']);
 assert.equal(reach.cu,undefined);
});

test('a Freedom reaches Sapphire partners only when a Sapphire is held, and HK cards never borrow each other\'s partners',()=>{
 const alone=transferOptions([cfu],{},{asOf:'2026-11-11'});
 assert.deepEqual(alone.programmes,[]);assert.deepEqual(alone.cardsWithoutTransferCard,[{name:'Freedom Unlimited',region:'US',programme:UR,pooling:'per-card-combinable'}]);
 const pair=transferOptions([cfu,csp],{partner:'Hyatt',points:2000},{asOf:'2026-11-11'});
 const hyatt=pair.programmes[0].partners[0];
 assert.deepEqual(hyatt.ratio,{from:4,to:3});assert.equal(hyatt.conversion.receive,1500);
 assert.deepEqual(hyatt.cards.find(c=>c.name==='Freedom Unlimited').through,['Chase Sapphire Preferred']);
 const hk=transferOptions([hkPlat,hkExplorer],{},{asOf:'2026-11-11'}).programmes[0];
 assert.equal(hk.pooling.kind,'per-card');assert.equal(hk.pooling.usableOnAnotherCard,false);
 assert.ok(hk.partners.every(p=>p.cards.every(c=>!c.through)),'no HK card reaches a rate through another card');
});

test('the assistant tool explains each rule with its caveats and sources, and reads no balance',()=>{
 const hk=tool([hkPlat,hkExplorer,usGold],{region:'HK'});
 assert.equal(hk.kind,'points-accounts');assert.equal(hk.programmes.length,1);
 const rule=hk.programmes[0];assert.equal(rule.pooling,'per-card');assert.equal(rule.usableOnAnotherCard,false);assert.equal(rule.ownerOverride,true);assert.equal(rule.held,true);
 assert.deepEqual(rule.caveats.map(c=>c.id),['linking-possible','explorer-corporate-separate']);
 assert.ok(rule.caveats.every(c=>c.sources.some(s=>s.authority==='official'&&s.url.startsWith('https://www.americanexpress.com/en-hk/'))));
 assert.ok(!/amount|balance"/.test(JSON.stringify(Object.keys(rule))),'no balance field');
 const us=tool([usGold,usPlat],{programme:MR,region:'US'}).programmes[0];
 assert.equal(us.pooling,'shared');assert.equal(us.caveats[0].id,'new-card-needs-linking');assert.equal(us.caveats[0].since,'2026-10');
 const ur=tool([cfu,csp],{programme:UR}).programmes[0];
 assert.equal(ur.pooling,'per-card-combinable');assert.deepEqual(ur.cards.find(c=>c.name==='Freedom Unlimited'),{name:'Freedom Unlimited',region:'US',ownTransferPartners:false,transfersThrough:['Chase Sapphire Preferred']});
 // A named region with no held card still gets the public rule, marked as not held.
 const none=tool([csp],{region:'HK'});assert.equal(none.programmes[0].held,false);assert.equal(none.programmes[0].cards,undefined);
 assert.deepEqual(tool([united],{}).cardsOutside,[{name:'United Quest',region:'US'}]);
 assert.throws(()=>validateToolCall(call('points_accounts',{region:'CA'})),/invalid_arguments/);
});

test('a card named alone still reaches the held card it combines into (review of #194)',()=>{
 const one=runWalletTool(call('convert_points',{cardName:'Freedom Unlimited',partner:'Hyatt',points:2000}),{cards:[cfu,csp],events:[],day:'2026-11-11'});
 assert.equal(one.partnerFound,true);assert.deepEqual(one.matchedCards,['Freedom Unlimited']);
 const hyatt=one.programmes[0].partners.find(p=>p.ratio);assert.deepEqual(hyatt.ratio,{from:4,to:3});
 assert.deepEqual(hyatt.cards,[{name:'Freedom Unlimited',region:'US',through:['Chase Sapphire Preferred']}],'only the named card is listed');
 assert.deepEqual(tool([cfu,csp],{cardName:'Freedom Unlimited'}).programmes[0].cards[0].transfersThrough,['Chase Sapphire Preferred']);
 const alone=runWalletTool(call('convert_points',{cardName:'Freedom'}),{cards:[cfu],events:[],day:'2026-11-11'});
 assert.ok(alone.withoutTransferCardNote,'a card with no transfer card held is explained, not called non-transferable');
});
test('a sum of card readings shows its oldest date',()=>{
 const hk=totalOf([reading(hkPlat,1,'2026-10-20T10:00:00Z',MR),reading(hkExplorer,2,T2,MR)],'programme.amex-membership-rewards-hk');
 assert.equal(hk.date,'2026-10-20');assert.equal(hk.readingsSpanDays,13);
});
