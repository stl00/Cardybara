import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {validateModel,mergeRecords} from '../extension-next/agent-core.js';import {mvpSummary,mvpLink,requiredReward} from '../extension-next/mvp.js';
const f=JSON.parse(fs.readFileSync(new URL('./fixtures/banks/amex-hk-mvp.json',import.meta.url))),s={self:{}};vm.createContext(s);vm.runInContext(fs.readFileSync(new URL('../extension-next/reader.js',import.meta.url),'utf8'),s);const reader=s.self.CardyReader;
test('HK pure parser yields distinct current/unpaid/closing balances, printed zero and explicit full date',()=>{const raw=reader.amexHkMvp(f.text,f.card),snapshot={bank:'Amex HK',region:'HK',page:'https://global.americanexpress.com/dashboard',capturedAt:new Date().toISOString(),aliases:[{id:'C1',cardId:f.card.id,currency:'HKD'}],blocks:raw.map(i=>({text:i.evidence})),links:[]};const result=validateModel({items:JSON.parse(JSON.stringify(raw)),nextLinkId:null},snapshot);assert.equal(result.rejected.length,0);const values=Object.fromEntries(result.items.map(i=>[i.key,i.value??i.date]));assert.equal(values.balance,123.45);assert.equal(values.statement,23.45);assert.equal(values.statementClosing,30);assert.equal(values.minimum,0);assert.equal(values.due,'2026-11-06');assert.equal(values['Membership Rewards'],0);assert.equal(mvpSummary(result.items,[f.card]).card.status,'updated');});
test('HK parser does not borrow missing years, conflicting cards, currencies or history balances',()=>{assert.ok(!reader.amexHkMvp(f.text.replace('2026年11月6日','11月6日'),f.card).some(i=>i.key==='due'));assert.equal(reader.amexHkMvp(f.text+'\nOther ••••24680',f.card).length,0);assert.equal(reader.amexHkMvp(f.text,{...f.card,tail:'99999'}).length,0);assert.equal(reader.amexHkMvp(f.text,{...f.card,currency:'CAD'}).length,0);assert.ok(!reader.amexHkMvp(f.text,f.card,'billing').some(i=>i.kind==='card'));assert.ok(!reader.amexHkMvp(f.text.replace('2026年11月6日','2026年2月30日'),f.card).some(i=>i.key==='due'));});
test('HK MVP includes account/billing navigation without offer enrollment or spending collection',()=>{assert.equal(mvpLink({label:'賬項',href:'https://global.americanexpress.com/activity'}),true);assert.equal(mvpLink({label:'賬項',href:'https://global.americanexpress.com/payments'}),false);assert.equal(mvpLink({label:'優惠',href:'https://global.americanexpress.com/offers'}),false);});

test('HK live-shaped minimum label is read while a yearless payment date stays unknown',()=>{const text='Unknown product ••••'+f.card.tail+'\n總結欠\nHK$45.00\n最低還款\nHK$12.00\n請於此日期或之前付款\n11月 23日';const items=reader.amexHkMvp(text,f.card);assert.equal(items.find(i=>i.key==='minimum')?.value,12);assert.ok(!items.some(i=>i.key==='due'));const dated=reader.amexHkMvp(text.replace('11月 23日','2026年11月23日'),f.card);assert.equal(dated.find(i=>i.key==='due')?.date,'2026-11-23');});

import {applyAgentRecords,latestDueField,latestNoPayment,supersededByNoPayment} from '../src/agentData.js';
function validateHk(text){
 const raw=JSON.parse(JSON.stringify(reader.amexHkMvp('Synthetic card ••••'+f.card.tail+'\n'+text,f.card))).map(i=>({...i,evidence:'[C1]\n'+i.evidence}));
 const snapshot={bank:'Amex HK',region:'HK',page:'https://global.americanexpress.com/dashboard',capturedAt:'2026-10-29T15:45:00Z',aliases:[{id:'C1',cardId:f.card.id,currency:'HKD'}],blocks:raw.map(i=>({text:i.evidence})),links:[]};
 return {raw,snapshot,...validateModel({items:raw,nextLinkId:null},snapshot)};
}
test('explicit no-payment observation survives production alias evidence and writeback without fabricating minimum/due/autopay',()=>{
 const r=validateHk('總結欠\nHK$0.00\n暫時毋須付款');assert.deepEqual(r.rejected,[]);
 const data=applyAgentRecords({cards:[f.card]},r.items),c=data.cards[0];
 assert.equal(c.paymentStatus,'暫時毋須付款');assert.equal(c.fieldDates.paymentStatus,r.snapshot.capturedAt);assert.match(c.fieldSources.paymentStatus.evidence,/暫時毋須付款/);
 for(const key of ['minimum','due','autopay'])assert.equal(c[key],undefined);
 assert.ok(!mvpSummary(r.items,[f.card]).card.coverage[0].complete);
 assert.ok(!validateHk('總結欠\nHK$0.00').items.some(i=>i.key==='paymentStatus'));
 assert.ok(!validateHk('暫時毋須付款\n最低還款\nHK$1.00').items.some(i=>i.key==='paymentStatus'));
});
test('yearless due observation preserves raw month/day, old full dates and field timestamps independently',()=>{
 const r=validateHk('請於此日期或之前付款\n11月 23日');assert.deepEqual(r.rejected,[]);assert.equal(r.items[0].key,'duePartial');assert.equal(r.items[0].date,'');
 const old={...f.card,due:'2025-11-23',minimum:9,fieldDates:{due:'2025-10-01T00:00:00Z',minimum:'2025-10-01T00:00:00Z'}};
 const c=applyAgentRecords({cards:[old]},r.items).cards[0];assert.equal(c.duePartial,'11月 23日');assert.equal(c.due,old.due);assert.equal(c.fieldDates.due,old.fieldDates.due);assert.equal(c.minimum,9);assert.equal(latestDueField(c),'duePartial');
 assert.equal(latestDueField({...c,fieldDates:{...c.fieldDates,due:'2026-10-30T00:00:00Z'}}),'due');
 assert.equal(applyAgentRecords({cards:[c]},r.items.map(i=>({...i,capturedAt:'2026-10-28T00:00:00Z',title:'12月1日',evidence:'請於此日期或之前付款\n12月1日'}))).cards[0].duePartial,'11月 23日');
});
test('billing observations reject invented years, invalid month/day, conditional wording, wrong labels and ambiguity',()=>{
 for(const date of ['2月30日','13月1日','0月2日','4月31日'])assert.ok(!validateHk('請於此日期或之前付款\n'+date).items.some(i=>i.key==='duePartial'));
 assert.ok(!validateHk('請於此日期或之前付款\n11月23日\n還款到期日\n12月1日').items.some(i=>i.key==='duePartial'));
 const r=validateHk('暫時毋須付款\n請於此日期或之前付款\n11月23日');assert.ok(!r.items.some(i=>i.key==='paymentStatus'));
 const base=validateHk('請於此日期或之前付款\n11月23日');
 for(const change of [{date:'2026-11-23'},{title:'11月24日'},{value:0},{status:'on'},{key:'paymentStatus',title:'No payment due if paid'}]){
  assert.equal(validateModel({items:[{...base.raw[0],...change}],nextLinkId:null},base.snapshot).items.length,0);
 }
});

test('payment reminders prefer newer billing evidence and do not suppress a newer amount due',()=>{
 const card={paymentStatus:'暫時毋須付款',fieldDates:{paymentStatus:'2026-10-29T15:00:00Z',due:'2026-10-28T15:00:00Z'}};
 assert.equal(latestNoPayment(card),true);assert.equal(latestNoPayment({...card,fieldDates:{...card.fieldDates,minimum:'2026-10-30T15:00:00Z'}}),false);
 assert.equal(latestNoPayment({...card,paymentStatus:'Balance is zero'}),false);
 // A positive minimum or a due date read in the same run contradicts the statement; a zero minimum does not.
 const at='2026-10-29T15:00:00Z',minutes=m=>new Date(Date.parse(at)-m*60000).toISOString(),same={paymentStatus:'暫時毋須付款',fieldDates:{paymentStatus:at}};
 assert.equal(latestNoPayment({...same,minimum:12,fieldDates:{...same.fieldDates,minimum:minutes(1)}}),false);
 assert.equal(latestNoPayment({...same,minimum:0,fieldDates:{...same.fieldDates,minimum:minutes(1)}}),true);
 assert.equal(latestNoPayment({...same,due:'2026-11-23',fieldDates:{...same.fieldDates,due:minutes(1)}}),false);
 assert.equal(latestNoPayment({...same,duePartial:'11月23日',fieldDates:{...same.fieldDates,duePartial:minutes(1)}}),false);
 assert.equal(latestNoPayment({...same,minimum:12,fieldDates:{...same.fieldDates,minimum:'not-a-date'}}),false);
 // An older run's reading is replaced, and the drawer can say so.
 const older={...same,minimum:12,due:'2026-11-23',fieldDates:{...same.fieldDates,minimum:minutes(60),due:minutes(60)}};
 assert.equal(latestNoPayment(older),true);assert.equal(supersededByNoPayment(older,'minimum'),true);assert.equal(supersededByNoPayment(older,'due'),true);
 assert.equal(supersededByNoPayment(older,'duePartial'),false);assert.equal(supersededByNoPayment({...older,paymentStatus:undefined},'minimum'),false);
});

test('Amex reports another named programme as not collected, and Membership Rewards pools stay separate by region',()=>{
 const required=t=>requiredReward('Amex US',t);
 assert.deepEqual([...reader.otherRewardLabels(['Some Hotel Points','12,345','Membership Rewards','999','Redeem points','5','Current balance','7'],required)],['Some Hotel Points']);
 // A generic or required label is not another programme, so a missing required value stays missing.
 for(const label of ['Available Points','Total Points','Available Membership Rewards Points','American Express Membership Rewards','可用積分','積分結餘','MR points'])assert.equal(reader.otherRewardLabels([label,'100'],required).length,0,label);
 // Only a labelled balance names a programme: activity lines, badges and spend words do not.
 for(const label of ['Some Hotel Points','Some SkyStyleMiles','Airline Miles','某某積分'])assert.equal(reader.rewardLabel(label),true,label);
 for(const label of ['Points earned','Bonus points','Points expiring soon','Points redeemed','Rewards multiplier','Spend milestone','Rewards','Points','Redeem points','Rewards activity','Offers and rewards','12,345 points','Current balance','兌換積分'])assert.equal(reader.rewardLabel(label),false,label);
 const cards=[{id:'us',bank:'Amex US',currency:'USD'},{id:'hk',bank:'Amex HK',currency:'HKD'},{id:'hk2',bank:'Amex HK',currency:'HKD'}];
 const record=(cardId,bank,region,value)=>({kind:'reward',cardId,bank,region,key:'Membership Rewards',title:'Membership Rewards',value,currency:'points',date:'',status:'unknown',evidence:'Membership Rewards\n'+value,capturedAt:'2030-01-01T00:00:00Z',page:'https://example.test',method:'rules'});
 const data=applyAgentRecords({cards},[record('us','Amex US','US',100),record('hk','Amex HK','HK',200),record('hk2','Amex HK','HK',200)]);
 assert.equal(data.rewardObservations.length,3);assert.ok(data.rewardObservations.every(r=>r.poolStatus==='unconfirmed'));
 assert.deepEqual(data.rewardObservations.map(r=>r.region),['US','HK','HK']);
});
