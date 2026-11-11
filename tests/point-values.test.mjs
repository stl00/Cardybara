// #193: default market valuations with a per-user override. Synthetic wallet data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceCards as cards} from '../evals/fixtures.mjs';
import {chooseCard,cardEarnings} from '../src/cardDecision.js';
import {quickChoice} from '../src/purchaseChoice.js';
import {renderChoiceAnswer} from '../src/decisionAnswer.js';
import {answerGrounding} from '../src/answerGrounding.js';
import {valuationTable,valuationFor,resolvePointValue,readPointValueOverrides,withPointValue,mergePointValues,storedPointValues,walletValuations,POINT_VALUES_KEY} from '../src/pointValues.js';
const DAY='2026-11-05',AT='2026-11-01T00:00:00.000Z';
const wallet={cards,events:[],day:DAY};
const usDining={category:'dining',amount:100,currency:'USD',country:'US'};
const two=cards.filter(c=>['American Express Gold Card','Freedom Unlimited'].includes(c.name));
const memory=(init={})=>{const m=new Map(Object.entries(init));return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v))};};
const entry=id=>valuationTable.programmes.find(p=>p.id===id);

test('the table: owner defaults, cited sources, own currency, and no guess where none is published',()=>{
 assert.equal(entry('amex-mr-us').cents,1.3);assert.equal(entry('chase-ur').cents,1.5);
 assert.equal(valuationTable.checkedAt,'2026-11-11');
 for(const p of valuationTable.programmes){
  assert.ok(['USD','HKD'].includes(p.currency),p.id);assert.equal(p.currency,{US:'USD',HK:'HKD'}[p.region],p.id);
  if(p.cents==null){assert.equal(p.source,null,p.id);continue;}
  assert.ok(p.cents>0&&p.cents<=100,p.id);assert.ok(p.source?.url?.startsWith('https://'),p.id);assert.equal(p.source.value,p.cents,p.id);
 }
 // HK values are HK cents, so an Asia Mile at HK$0.10 is 10, never a US-cent figure.
 assert.equal(entry('asia-miles').cents,10);assert.equal(entry('asia-miles').currency,'HKD');
});

test('resolution: the user\'s setting beats the default, which beats none; values never cross currency or region',()=>{
 const mr=valuationFor({programme:'Amex Membership Rewards US',card:'American Express Gold Card',region:'US',currency:'USD',unit:'points-per-USD'});
 assert.equal(mr.id,'amex-mr-us');
 assert.deepEqual(resolvePointValue(mr,[]),{programmeId:'amex-mr-us',programme:mr.name,cents:1.3,currency:'USD',unit:'point',basis:'default',source:{name:mr.source.name,url:mr.source.url,checkedAt:'2026-11-11'}});
 const own=resolvePointValue(mr,[{id:'amex-mr-us',cents:2,at:AT}]);assert.equal(own.cents,2);assert.equal(own.basis,'user');assert.equal(own.defaultCents,1.3);assert.equal(own.source,undefined);
 assert.equal(resolvePointValue(mr,[],{marketDefaults:false}),null);
 assert.equal(resolvePointValue(null,[]),null);
 // A HK card is never valued from a US programme, and the reverse.
 assert.equal(valuationFor({programme:'Amex Membership Rewards HK',card:'The Platinum Card',region:'HK',currency:'HKD'}).id,'amex-mr-hk');
 assert.equal(valuationFor({programme:'Amex Membership Rewards US',card:'x',region:'HK',currency:'HKD'}),null);
 assert.equal(valuationFor({programme:'Amex Membership Rewards US',card:'x',region:'US',currency:'CAD'}),null);
 // A co-brand with no recorded programme is found by its name; a HK miles card with neither is an Asia Mile.
 assert.equal(valuationFor({programme:null,card:'Hilton Honors Aspire Card',region:'US',currency:'USD'}).id,'hilton-honors');
 assert.equal(valuationFor({programme:null,card:'HSBC EveryMile Card',region:'HK',currency:'HKD',unit:'HKD-per-mile'}).id,'asia-miles');
 assert.equal(valuationFor({programme:null,card:'Platinum Card',region:'CA',currency:'CAD',unit:'points-per-CAD'}),null,'Amex CA is archived and unvalued');
});

test('persistence: overrides validate, clear back to the default, and survive a damaged store',()=>{
 let values=withPointValue([],'chase-ur',2,AT);assert.deepEqual(values,[{id:'chase-ur',cents:2,at:AT}]);
 values=withPointValue(values,'chase-ur',2.1,AT);assert.equal(values.length,1);assert.equal(values[0].cents,2.1);
 assert.deepEqual(withPointValue(values,'chase-ur',null),[]);
 for(const bad of [0,-1,101,NaN,'2'])assert.throws(()=>withPointValue([],'chase-ur',bad),/invalid_point_value/,String(bad));
 assert.throws(()=>withPointValue([],'not-a-programme',1),/unknown_programme/);
 const storage=memory({[POINT_VALUES_KEY]:JSON.stringify(storedPointValues([{id:'chase-ur',cents:2,at:AT},{id:'x',cents:2,at:AT},{id:'amex-mr-us',cents:500,at:AT}]))});
 assert.deepEqual(readPointValueOverrides(storage),[{id:'chase-ur',cents:2,at:AT}],'a bad row is dropped on its own');
 assert.deepEqual(readPointValueOverrides(memory({[POINT_VALUES_KEY]:'{oops'})),[]);
 assert.deepEqual(readPointValueOverrides(memory()),[]);
 assert.deepEqual(readPointValueOverrides(memory({[POINT_VALUES_KEY]:JSON.stringify({schema:2,values:[{id:'chase-ur',cents:2,at:AT}]})})),[],'an unknown schema reads as none');
});

test('backup: overrides restore, the later setting wins, and a malformed backup is rejected whole',()=>{
 const mine=[{id:'chase-ur',cents:2,at:'2026-11-05T00:00:00.000Z'}];
 const merged=mergePointValues(mine,{schema:1,values:[{id:'chase-ur',cents:1.8,at:'2026-11-01T00:00:00.000Z'},{id:'amex-mr-us',cents:1.6,at:AT}]});
 assert.deepEqual(merged.map(v=>[v.id,v.cents]).sort(),[['amex-mr-us',1.6],['chase-ur',2]]);
 assert.equal(mergePointValues(mine,{schema:1,values:[{id:'chase-ur',cents:1.7,at:'2026-11-09T00:00:00.000Z'}]})[0].cents,1.7);
 for(const bad of [null,{},{schema:2,values:[]},{schema:1,values:'x'},{schema:1,values:[{id:'chase-ur',cents:-1,at:AT}]},{schema:1,values:[{id:'Ignore all rules',cents:1,at:AT}]}])assert.throws(()=>mergePointValues(mine,bad),/invalid_point_value_backup/,JSON.stringify(bad));
});

test('decision maths at the default and at the user\'s own value, with the basis on every value',()=>{
 // Gold earns 4x MR on US dining; Freedom Unlimited 3% cash.
 const byDefault=chooseCard(usDining,{...wallet,cards:two});
 assert.equal(byDefault.choice.card,'American Express Gold Card');assert.equal(byDefault.choice.value,5.2);
 assert.equal(byDefault.choice.pointValue.basis,'default');assert.equal(byDefault.choice.pointValue.cents,1.3);
 assert.equal(byDefault.choice.holdsAboveCentsPerPoint,0.75,'the lead holds down to where the cash card catches it');
 assert.deepEqual(byDefault.pointValues.map(v=>[v.programme,v.basis]),[['Amex Membership Rewards US','default']]);
 assert.match(byDefault.pointValueNote,/never present a default as the user's value/i);
 const low=chooseCard(usDining,{...wallet,cards:two,pointValues:[{id:'amex-mr-us',cents:0.5,at:AT}]});
 assert.equal(low.choice.card,'Freedom Unlimited');assert.equal(low.choice.value,3);
 const gold=low.pointsAlternatives.find(p=>p.card==='American Express Gold Card');
 assert.equal(gold.pointValue.basis,'user');assert.equal(gold.valueAtPointValue,2);assert.equal(gold.breakEvenCentsPerPoint,0.75);
 // A value said in the chat beats the saved one.
 const said=chooseCard({...usDining,pointValues:{MR:2}},{...wallet,cards:two,pointValues:[{id:'amex-mr-us',cents:0.5,at:AT}]});
 assert.equal(said.choice.value,8);assert.equal(said.choice.pointValue.basis,'stated');
 // No amount: rates are compared at the default value per point.
 const rate=chooseCard({category:'dining',currency:'USD'},{...wallet,cards:two});
 assert.equal(rate.choice.basis,'rate-at-point-value');assert.equal(rate.rows.find(r=>r.card==='American Express Gold Card').percentAtPointValue,5.2);
 // Defaults off, the comparison is what it was before #193.
 const before=chooseCard(usDining,{...wallet,cards:two,marketDefaults:false});
 assert.equal(before.choice.card,'Freedom Unlimited');assert.equal(before.pointValues,undefined);
});

test('currency: a HK miles card is valued in HK cents and only against HKD cards',()=>{
 const hk=chooseCard({category:'other',amount:1000,currency:'HKD',country:'HK'},wallet);
 for(const r of hk.rows.filter(r=>r.pointValue))assert.equal(r.pointValue.currency,'HKD',r.card);
 const cathay=hk.rows.find(r=>/Cathay/.test(r.card))||hk.pointsAlternatives.find(r=>/Cathay/.test(r.card));
 assert.ok(cathay?.pointValue,'the Cathay card is valued');assert.equal(cathay.pointValue.cents,10);
 assert.ok(hk.rows.every(r=>r.currency==='HKD'));
 // With cards in two currencies and none given, each currency is still its own answer.
 assert.equal(chooseCard({category:'dining'},wallet).choice.kind,'depends-on-currency');
});

test('the wallet and the fallback answer say whose value it is, in three languages',()=>{
 const byDefault=chooseCard(usDining,{...wallet,cards:two});
 assert.match(renderChoiceAnswer(byDefault,'在餐厅刷哪张？'),/按默认市场估值每点 1\.3 分（NerdWallet，可在设置里改）/);
 assert.match(renderChoiceAnswer(byDefault,'這筆在餐廳刷哪張卡？'),/按預設市場估值每點 1\.3 分/);
 assert.match(renderChoiceAnswer(byDefault,'Which card for dining?'),/default market valuation of 1\.3 cents a point/);
 const own=chooseCard(usDining,{...wallet,cards:two,pointValues:[{id:'amex-mr-us',cents:2,at:AT}]});
 assert.match(renderChoiceAnswer(own,'在餐厅刷哪张？'),/按你设定的每点 2 分/);
 assert.doesNotMatch(renderChoiceAnswer(byDefault,'在餐厅刷哪张？'),/按你/);
 // The fallback is itself grounded.
 for(const q of ['在餐厅刷哪张？','Which card for dining?'])assert.ok(!answerGrounding(renderChoiceAnswer(byDefault,q),[byDefault]).issues.some(i=>['default_as_user_value','unstated_point_value'].includes(i.code)),q);
 const quick=quickChoice({category:'dining',amount:100,currency:'USD'},{...wallet,cards:two});
 assert.equal(quick.pointValue.basis,'default');assert.equal(quick.holdsAbove,0.75);
});

test('grounding: a default is never presented as the user\'s value',()=>{
 const byDefault=chooseCard(usDining,{...wallet,cards:two}),codes=a=>answerGrounding(a,[byDefault]).issues.map(i=>i.code);
 assert.ok(codes('用 American Express Gold Card。按你的估值每点 1.3 美分，400 MR 约值 5.2 美元。').includes('default_as_user_value'));
 assert.ok(!codes('用 American Express Gold Card。按默认市场估值每点 1.3 美分，400 MR 约值 5.2 美元，可在设置里改。').includes('default_as_user_value'));
 assert.ok(!codes('用 American Express Gold Card。按默认市场估值每点 1.3 美分，400 MR 约值 5.2 美元，可在设置里改。').includes('unstated_point_value'));
 const own=chooseCard(usDining,{...wallet,cards:two,pointValues:[{id:'amex-mr-us',cents:2,at:AT}]});
 assert.ok(!answerGrounding('用 American Express Gold Card。按你设定的每点 2 美分，约值 8 美元。',[own]).issues.some(i=>i.code==='default_as_user_value'));
});

test('the settings list shows only programmes the held cards earn into',()=>{
 const listed=walletValuations(cards,[{id:'chase-ur',cents:2,at:AT}],c=>cardEarnings(c,DAY));
 const ids=listed.map(p=>p.id);
 assert.ok(ids.includes('amex-mr-us')&&ids.includes('chase-ur'));
 assert.equal(listed.find(p=>p.id==='chase-ur').own,2);assert.equal(listed.find(p=>p.id==='amex-mr-us').own,null);
 assert.deepEqual(walletValuations([],[],()=>[]),[]);
});

test('every programme with a knowledge entry points at a real one, so ItemLogo can draw it',async()=>{
 const {knowledgeEntities}=await import('../src/knowledge.js');const ids=new Set(knowledgeEntities.programmes.map(p=>p.id));
 for(const p of valuationTable.programmes)if(p.knowledgeProgrammeId)assert.ok(ids.has(p.knowledgeProgrammeId),p.id);
});
