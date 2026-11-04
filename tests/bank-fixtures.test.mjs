import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateModel} from '../extension-next/agent-core.js';
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

const issuer=name=>JSON.parse(fs.readFileSync(new URL('./fixtures/banks/'+name+'.json',import.meta.url),'utf8'));
const fieldsOf=items=>Object.fromEntries(items.map(i=>[i.key,i.key==='due'?i.date:['paymentStatus','duePartial'].includes(i.key)?i.title:i.value]));
for(const name of ['boa-card-details','boa-no-payment','sc-hk-zh-card-details','sc-hk-en-card-details','citi-card-details','citi-no-payment'])test('issuer rules read billing fields and pass the validator: '+name,()=>{
 const f=issuer(name),items=JSON.parse(JSON.stringify(reader.issuerBilling(f.text,f.bank,f.card)));
 assert.deepEqual(fieldsOf(items),f.expected);
 const snapshot={bank:f.bank,region:f.bank==='SC HK'?'HK':'US',page:'https://example.test/account',capturedAt:'2030-01-01T00:00:00Z',aliases:[{id:'C1',cardId:f.card.id,currency:f.card.currency}],blocks:items.map(i=>({text:i.evidence})),links:[]};
 const checked=validateModel({items,nextLinkId:null},snapshot);assert.deepEqual(checked.rejected,[]);assert.equal(checked.items.length,items.length);
 // Results do not change with the product name.
 const renamed=f.text.replace(/Numbat Voyager|Bilby|Kakapo|Tuatara|Wallaby Traveler|Dingo/,'Another Product');assert.deepEqual(fieldsOf(reader.issuerBilling(renamed,f.bank,f.card)),f.expected);
});
test('issuer rules never mix cards or guess',()=>{
 const f=issuer('boa-card-details'),boa=(t,others=[])=>fieldsOf(reader.issuerBilling(t,'BOA',f.card,others)),sc=issuer('sc-hk-en-card-details'),hk=t=>fieldsOf(reader.issuerBilling(t,'SC HK',sc.card));
 for(const other of ['Visa - 5678','XXXX-XXXX-XXXX-5678','…5678','(-5678)','Ending in: 5678','Another Visa ending in 5678','••••5678','...5678','Visa x5678','*5678','• 5678','(5678)','#5678','Plain 5678 row','ends in 5678','ending with 5678','末四位 5678','尾数 5678','后四位 5678','••••5678.','ending in 5678,'])assert.deepEqual(boa(f.text+'\n'+other+'\nCurrent Balance\n$5.00'),{},other);
 for(const other of ['ending in 2030','••••2030','尾號 2030','XXXX-XXXX-XXXX-2045','Visa 5678,','Visa/5678'])assert.deepEqual(boa(f.text+'\n'+other+'\nCurrent Balance\n$5.00'),{},other);
 assert.deepEqual(boa(f.text+'\nVisa 2030',['2030']),{},'a year-shaped tail already in the wallet');
 // Phone numbers, dates, ranges, amounts and years neither identify a card nor stand in for another one.
 assert.deepEqual(boa('Visa 5678\nCall 1-800-555-1234\nCurrent Balance\n$5.00'),{},'a phone number does not identify the card');
 for(const noise of ['Call 1-800-432-1000','Call 2886-8888','01-01-2030','© 2000-2030','Statement ending 2030','Dec 19, 2030','$1,234.56','1234.56'])assert.equal(boa('Visa ending in 1234\nCurrent Balance\n$5.00\n'+noise).balance,5,noise);
 assert.equal(JSON.parse(JSON.stringify(reader.issuerBilling('Visa ending in 1234\nMinimum Payment Due\n$5.00\nCredit Limit\n$35.00','BOA',f.card))).find(i=>i.key==='minimum').evidence.includes('5.00'),true);
 const window=JSON.parse(JSON.stringify(reader.issuerBilling('Visa ending in 1234\nMinimum Payment Due\n$35.00\nNote\nMinimum Payment Due\n$35.00','BOA',f.card))).find(i=>i.key==='minimum');assert.match(window.evidence,/35\.00/);
 assert.deepEqual(boa('No card here\nCurrent Balance\n$5.00'),{},'card not identified');
 assert.equal(boa('Visa ending in 1234\nCurrent Balance\n-$1,234.56').balance,-1234.56,'a negative amount is not a card number');
 assert.deepEqual(boa('Visa ending in 1234\nCurrent Balance\n$5.00'),{balance:5},'nothing invented');
 assert.equal(boa('Visa ending in 1234\nPayment Due Date\nDec 19').due,undefined,'yearless English date');
 assert.equal(boa('Visa ending in 1234\nPayment Due Date\n12/19/2030\nDue Date\n12/20/2030').due,undefined,'conflicting dates');
 assert.equal(hk(sc.text).due,'2030-12-19');assert.equal(hk(sc.text.replace('19/12/2030','03/04/2030')).due,undefined,'ambiguous day and month');
 assert.equal(boa('Visa ending in 1234\nMinimum Payment Due\n$5.00\nNo payment due').paymentStatus,undefined);assert.equal(boa('Visa ending in 1234\nPayment Due Date\n12/19/2030\nNo payment due').paymentStatus,undefined);
 // Evidence is the labelled line carrying the value, and only forms the validator accepts are parsed.
 const late=JSON.parse(JSON.stringify(reader.issuerBilling('Visa ending in 1234\nMinimum Payment Due\nNot available\nMinimum Payment Due\n$5.00','BOA',f.card))).find(i=>i.key==='minimum');assert.match(late.evidence,/5\.00/);
 for(const form of ['Dec. 19, 2030','Sept 19, 2030','19 Dec, 2030','19 Dec. 2030'])assert.equal(boa('Visa ending in 1234\nPayment Due Date\n'+form).due,undefined,form);
 assert.equal(fieldsOf(reader.issuerBilling('尾號 8765\n還款到期日\n12月19日','SC HK',sc.card)).duePartial,'12月19日');
 assert.equal(fieldsOf(reader.issuerBilling('尾號 8765\n最後還款日期\n12月19日','SC HK',sc.card)).duePartial,undefined,'only labels the validator accepts');
 // The validator refuses an ambiguous model date too.
 const snapshot={bank:'SC HK',region:'HK',page:'https://example.test/account',capturedAt:'2030-01-01T00:00:00Z',aliases:[{id:'C1',cardId:'x',currency:'HKD'}],blocks:[{text:'Payment Due Date\n04/03/2030'},{text:'Payment Due Date\n19/12/2030'}],links:[]};
 const item=(date,evidence)=>({kind:'billing',cardId:'C1',key:'due',title:'Payment due date',value:null,currency:'HKD',date,status:'unknown',evidence});
 assert.equal(validateModel({items:[item('2030-03-04','Payment Due Date\n04/03/2030')],nextLinkId:null},snapshot).items.length,0);assert.equal(validateModel({items:[item('2030-12-19','Payment Due Date\n19/12/2030')],nextLinkId:null},snapshot).items.length,1);
});
test('Amex US due date: labelled full date only',()=>{
 const due=text=>JSON.parse(JSON.stringify(reader.issuerDue(text.split('\n'),'Amex US',{tail:'12345',currency:'USD'})));
 assert.equal(due('Payment Due Date\nDec 19, 2030')[0].date,'2030-12-19');assert.equal(due('Payment Due Date\n12/03/2030')[0].date,'2030-12-03');assert.equal(due('Payment Due Date\nDec 19').length,0);assert.equal(due('Minimum Amount Due\n$0.00').length,0);
});
test('Citi US reads month-first dates, leaves missing fields unknown and reports rewards as not collected',async()=>{
 const f=issuer('citi-card-details'),citi=t=>fieldsOf(reader.issuerBilling(t,'Citi US',f.card));
 assert.equal(citi('Card ending in 2345\nPayment Due Date\n12/03/2030').due,'2030-12-03');
 assert.deepEqual(citi('Card ending in 2345\nCurrent Balance\n$5.00'),{balance:5},'nothing invented');
 assert.deepEqual(citi('Card ending in 2345\nCurrent Balance\n$5.00\nOther Card ending in 6789'),{},'another card in scope');
 const {mvpSummary}=await import('../extension-next/mvp.js'),r=mvpSummary([],[{id:'a',bank:'Citi US'}]);assert.equal(r.reward.status,'not_collected');
});
test('Citi US is a registered provider with exact hosts',async()=>{
 const {PROVIDERS,ACTIVE_BANKS,allowed,guidedPage}=await import('../extension-next/providers.js'),manifest=JSON.parse(fs.readFileSync(new URL('../extension-next/manifest.json',import.meta.url),'utf8'));
 assert.ok(ACTIVE_BANKS.includes('Citi US'));assert.equal(PROVIDERS['Citi US'].currency,'USD');assert.deepEqual(PROVIDERS['Citi US'].locales,['en-US']);
 for(const host of PROVIDERS['Citi US'].hosts)assert.ok(manifest.host_permissions.includes('https://'+host+'/*'),host);
 assert.equal(allowed('Citi US',PROVIDERS['Citi US'].url),true);assert.equal(guidedPage('Citi US','https://online.citi.com/US/ag/dashboard'),true);
 for(const url of ['https://citi.com.evil.test/','https://evil.test/www.citi.com','http://online.citi.com/','https://online.citi.com:8443/','https://creditcards.citi.com/','https://online.citi.com/US/logout','https://user:x@online.citi.com/'])assert.equal(allowed('Citi US',url),false,url);
 const seed=JSON.parse(fs.readFileSync(new URL('../public/data.example.json',import.meta.url),'utf8'));assert.ok(seed.connections.some(c=>c.bank==='Citi US'));
});
