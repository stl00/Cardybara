import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context={self:{}};vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../extension-next/reader.js',import.meta.url),'utf8'),context);
const reader=context.self.CardyReader;
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/banks/amex-ca-overview.json',import.meta.url),'utf8'));
const hsbcFixture=JSON.parse(fs.readFileSync(new URL('./fixtures/banks/hsbc-hk-card-details.json',import.meta.url),'utf8'));
test('HSBC detail labels preserve credit sign and explicit zero statement/minimum',()=>{
 const f=hsbcFixture;
 const r=reader.parseAccount(f.text,f.bank,f.card,f.locale,'2026-10-26T14:00:00Z');
 assert.deepEqual(JSON.parse(JSON.stringify(r.fields)),f.expected);
 const debt=reader.parseAccount(f.text.replace('25.00','-25.00'),f.bank,f.card,f.locale,'2026-10-26T14:00:00Z');
 assert.equal(debt.fields.balance,25);
});
test('HSBC detail parser does not guess missing billing fields or confuse currencies',()=>{
 const f=hsbcFixture;
 const r=reader.parseAccount(f.text.replace('Current amount due:\n0.00 HKD\n',''),f.bank,f.card,f.locale,'2026-10-26T14:00:00Z');
 assert.equal(r.fields.statement,undefined);assert.equal(r.fields.minimum,0);
 assert.equal(reader.parseAccount(f.text+'\nRMB 100.00',f.bank,f.card,f.locale,'2026-10-26T14:00:00Z'),null);
 assert.equal(reader.parseAccount(f.text,f.bank,{...f.card,tail:'5678'},f.locale,'2026-10-26T14:00:00Z'),null);
});
test('Canada distinguishes unpaid statement and current balance using the printed tooltip',()=>{
 const result=reader.parseAmexOverview(fixture.text,fixture.heading,[fixture.card],fixture.locale,'2026-10-24T12:00:00Z');
 assert.deepEqual(JSON.parse(JSON.stringify(result.fields)),fixture.expected);
 assert.equal(result.capturedAt,'2026-10-24T12:00:00Z');
});
test('Canada never takes the following current balance as a missing minimum',()=>{
 const text=fixture.text.replace('Minimum Amount Due\n$0.00','Minimum Amount Due');
 const result=reader.parseAmexOverview(text,fixture.heading,[fixture.card],fixture.locale,'2026-10-24T12:00:00Z');
 assert.equal(result.fields.minimum,undefined);assert.equal(result.fields.balance,456.78);
});
test('ambiguous outstanding label is not silently relabelled as a statement',()=>{
 const text=fixture.text.replace('More info on remaining_statement_balance_tooltip\n','');
 const result=reader.parseAmexOverview(text,fixture.heading,[fixture.card],fixture.locale,'2026-10-24T12:00:00Z');
 assert.equal(result.fields.statement,undefined);assert.equal(result.fields.balance,undefined);
});
test('a different selected card yields no patch',()=>{
 assert.equal(reader.parseAmexOverview(fixture.text,'Other card 98765',[fixture.card],fixture.locale,'2026-10-24T12:00:00Z'),null);
});

test('US unpaid statement zero remains distinct from nonzero current total',()=>{
 const f=JSON.parse(fs.readFileSync(new URL('./fixtures/banks/amex-us-remaining-statement.json',import.meta.url),'utf8'));
 const result=reader.parseAmexOverview(f.text,f.heading,[f.card],f.locale,'2026-10-25T12:00:00Z');
 assert.deepEqual(JSON.parse(JSON.stringify(result.fields)),f.expected);
});

test('HSBC authentication pages are distinguished from unread financial fields',()=>{
 assert.equal(reader.authState('HSBC HK','/security','Password | Log on | HSBC'),'needs_login');
 assert.equal(reader.authState('HSBC HK','/security','Username | Log on | HSBC'),'needs_login');
 assert.equal(reader.authState('HSBC HK','/security','Security code | Log on | HSBC'),'needs_confirmation');
 assert.equal(reader.authState('HSBC HK','/online/dashboard','Password | Log on | HSBC'),null);
 assert.equal(reader.authState('Chase','/security','Password | Log on | HSBC'),null);
});

test('HSBC transaction columns determine sign without guessing merchant semantics',()=>{
 const card=hsbcFixture.card;const row={date:'04 Oct 2026',tail:card.tail,description:'Merchant',amountIn:'',amountOut:'25.00 HKD'};
 const r=reader.hsbcTransactionRows([row,{...row,description:'PAYMENT',amountIn:'30.00 HKD',amountOut:''},row],card);
 assert.deepEqual(Array.from(r.items,i=>i.value),[25,-30,25]);assert.ok(r.items.every(i=>i.status==='unknown'));assert.notEqual(r.items[0].key,r.items[2].key);assert.equal(r.items[0].date,'2026-10-04');
 for(const change of [{tail:'5678'},{date:'04 Oct'},{date:'31 Feb 2026'},{amountIn:'3.00 HKD'},{amountOut:'25.00 CAD'},{amountOut:'-25.00 HKD'}])assert.equal(reader.hsbcTransactionRows([{...row,...change}],card).items.length,0);
});
test('HK transaction rows use printed statement years, signed amounts and posting state',()=>{
 const card={id:'hk-test',currency:'HKD'},row={date:'6月28日',description:'TEST CREDIT',status:'入賬交易',amount:'-HK$600.00'};
 const r=reader.amexHkTransactionRows([row,row],card,'2026年6月29日 至 2026年7月28日');
 assert.equal(r.items.length,2);assert.equal(r.items[0].date,'2026-06-28');assert.equal(r.items[0].value,-600);assert.equal(r.items[0].status,'posted');assert.notEqual(r.items[0].key,r.items[1].key);
 assert.equal(reader.amexHkTransactionRows([row],card,'6月29日 至 7月28日').items.length,0);
 assert.equal(reader.amexHkTransactionRows([{...row,date:'2月30日'}],card,'2026年2月1日 至 2026年3月1日').items.length,0);
 assert.equal(reader.amexHkTransactionRows([row],card,'2025年6月29日 至 2026年6月28日').items.length,0);
 assert.equal(reader.amexHkTransactionRows([{...row,amount:'USD 600.00'}],card,'2026年6月29日 至 2026年7月28日').items.length,0);
});
test('HK unpaid statement remains distinct from a credit statement closing balance',()=>{
 const card={id:'hk',tail:'12345',currency:'HKD'};
 const r=reader.parseAccount('Card 12345\n未繳付月結單結欠\nHK$0.00\n月結單結欠\n6月 29o - 7月 28o\n-HK$1,357.90\n總結欠\n-HK$1,357.90\n信用限額\nHK$25,000.00','Amex HK',card,'zh-HK','2026-10-26T14:00:00Z');
 assert.equal(r.fields.statement,0);assert.equal(r.fields.statementClosing,-1357.9);assert.equal(r.fields.balance,-1357.9);assert.equal(r.fields.creditLimit,25000);
});
test('Chase detail keeps current debt, remaining bill, historical bill, due date and autopay separate',()=>{
 const card={id:'freedom',tail:'1234',currency:'USD'},p={title:'Freedom Unlimited (...1234)',fields:{currentBalance:'$44.98\n|\nShow details','lastStatementBalance-dataItem':'Last statement balance\n$44.98','remainingStatementBalance-dataItem':'$0.00','minimumPaymentDue-dataItem':'$20.00','autoPay-dataItem':'Automatic payments\nOn\n|\nDetails','ultimateRewards-dataItem':'Ultimate Rewards® points\n35,612\n|Redeem'},dataItems:[{key:'nextPaymentDueDate-dataItem',text:'Payment due date\nNov 19, 2026'}],tables:[]};
 const r=reader.chaseDetail(p,card);assert.equal(r.items.find(i=>i.key==='statement').value,0);assert.equal(r.items.find(i=>i.key==='statementClosing').value,44.98);assert.equal(r.items.find(i=>i.key==='due').date,'2026-11-19');assert.equal(r.items.find(i=>i.key==='autopay').status,'on');assert.equal(r.items.find(i=>i.kind==='reward').value,35612);
 assert.equal(reader.chaseDetail(p,{...card,tail:'5678'}).items.length,0);
});
test('Chase transaction dates are fully evidenced and repeated credits remain separate',()=>{
 const row={date:'10/18/2026',description:'TEST REFUND\nTEST REFUND',amount:'−$23.74'},card={currency:'USD'};
 const r=reader.chaseTransactions([row,row],card);assert.equal(r.items.length,2);assert.equal(r.items[0].date,'2026-10-18');assert.equal(r.items[0].value,-23.74);assert.equal(r.items[0].status,'unknown');assert.notEqual(r.items[0].key,r.items[1].key);
 for(const date of ['10/18','02/30/2026','Oct 18'])assert.equal(reader.chaseTransactions([{...row,date}],card).items.length,0);
});
test('Chase offer summaries distinguish already added offers and reject unsupported status',()=>{
 const card={currency:'USD'},a=reader.chaseOffer({label:'1 of 20 Shop Name Up to 5% back Expiring soon Add Offer'},card),b=reader.chaseOffer({label:'19 of 20 Test Video $11 cash back 9 days left Success Added'},card);
 assert.equal(a.title,'Shop Name');assert.equal(a.status,'available');assert.equal(b.title,'Test Video');assert.equal(b.status,'added');assert.equal(b.date,'');assert.equal(reader.chaseOffer({label:'1 of 20 Shop Name 5% cash back'},card),null);
});
test('Chase benefit states require printed evidence and period gauge keeps 150 distinct from annual 300',()=>{
 const c={currency:'USD'},e=reader.chaseBenefitText('Complimentary membership*\nActivation required',c);assert.equal(e.status,'requires_activation');assert.equal(e.value,null);
 assert.equal(reader.chaseBenefitText('Complimentary membership*\nActivated\nActivation required',c),null);
 const items=reader.chaseBenefitGauge('$300 Annual Dining Credit*','$0/$150','Good through 12/31/2026',c);assert.equal(items[0].key,'credit_progress');assert.equal(items[0].value,0);assert.equal(items[1].key,'credit_limit');assert.equal(items[1].value,150);assert.equal(items[0].date,'2026-12-31');
});
