// Cards outside the development account must read too: page structure decides, names are data.
// All names and values are synthetic. This proves generalization over imagined layouts, not real accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {discoverVisibleCards} from '../extension-next/discovery.js';
import {redactStructureText} from '../scripts/dev-collector/structure-report.js';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const box={self:{}};vm.createContext(box);vm.runInContext(read('../extension-next/reader.js'),box);
const reader=box.self.CardyReader,copy=x=>JSON.parse(JSON.stringify(x));
const holdout=JSON.parse(read('./fixtures/banks/chase-holdout.json'));
const COLLECTION=fs.readdirSync(new URL('../extension-next/',import.meta.url)).filter(f=>f.endsWith('.js'));

// Names allowed per file, each justified where it appears. A new name or a new file fails the test.
const ALLOWED={
 'mvp.js':['Membership Rewards','Ultimate Rewards','美國運通積分','美国运通积分','Hilton','Marriott','Bonvoy','SkyMiles','Reward Dollars','Aeroplan'], // MVP scope and Amex brand list
 'agent-snapshot.js':['Membership Rewards','美國運通積分','美国运通积分','RewardCash'], // required programme; other programme code, off in MVP scope
 'reader.js':['Membership Rewards','Ultimate Rewards','美國運通積分','美国运通积分','MileagePlus','IHG'], // same
 'bank-adapters.js':['美國運通積分','美国运通积分','Ultimate Rewards','IHG','MileagePlus','獎賞錢','奖赏钱','RewardCash','Asia Miles','亞洲萬里通','亚洲万里通','Membership Rewards'] // spelling aliases, never decide what is read
};
test('no product or programme name enters collection logic beyond the justified list',()=>{
 const entities=JSON.parse(read('../src/data/knowledge/entities.json')),products=JSON.parse(read('./fixtures/wallet-products.json'));
 const names=new Set(['Sapphire','Freedom','Aeroplan','MileagePlus','IHG','Ultimate Rewards','Membership Rewards','RewardCash','Atmos','Hilton','Bonvoy','SkyMiles','Asia Miles','亞洲萬里通','亚洲万里通','美國運通積分','美国运通积分','獎賞錢','奖赏钱','Platinum','Centurion','Marriott','Reward Dollars',...entities.programmes.map(p=>p.name),...products.cards.map(c=>c.name)].filter(n=>typeof n==='string'&&n.length>2));
 const found=[];
 for(const file of COLLECTION){const text=read('../extension-next/'+file).toLowerCase();for(const name of names)if(text.includes(name.toLowerCase())&&!(ALLOWED[file]||[]).some(ok=>ok.toLowerCase()===name.toLowerCase()||name.toLowerCase().includes(ok.toLowerCase())))found.push(file+': '+name);}
 assert.deepEqual(found,[]);
});
test('hold-out names appear nowhere else',()=>{
 const others=[...COLLECTION.map(f=>read('../extension-next/'+f)),...fs.readdirSync(new URL('./fixtures/banks/',import.meta.url)).filter(f=>f!=='chase-holdout.json').map(f=>read('./fixtures/banks/'+f)),read('./fixtures/wallet-products.json'),read('../src/data/knowledge/entities.json')].join('\n');
 for(const name of ['Quokka','Zephyrine'])assert.ok(!others.includes(name),name);
});
const mapped=items=>Object.fromEntries(items.map(i=>[i.kind==='reward'?'reward':i.key,i.key==='due'?i.date:i.key==='autopay'?i.status:i.value]));
test('Chase hold-out cards read every billing field and Ultimate Rewards from structure alone',()=>{
 for(const [i,card] of holdout.cards.entries()){const r=reader.chaseDetail(holdout.details[i],card);assert.equal(r.rejected.length,0);assert.deepEqual(mapped(r.items),holdout.expected[i]);}
 const partner=reader.chaseDetail(holdout.details[1],holdout.cards[1]);assert.ok(!partner.items.some(i=>i.kind==='reward'));assert.deepEqual([...partner.otherProgrammes],['unnamed'],'reported, not dropped');
});
test('Chase results do not change with product name, card type or tail',()=>{
 const page=(name,tail='3141')=>({title:name+' (...'+tail+')',fields:{currentBalance:'$10.50','remainingStatementBalance-dataItem':'Remaining statement balance\n$4.25','minimumPaymentDue-dataItem':'Minimum payment due\n$2.00','nextPaymentDueDate-dataItem':'Payment due date\nDec 3, 2031','ultimateRewards-dataItem':'Ultimate Rewards® points\n9,876'}});
 const card=(tail='3141')=>({id:'x',bank:'Chase',tail,currency:'USD'}),base=mapped(reader.chaseDetail(page('Plain'),card()).items);
 for(const name of ['Quokka Business Ink','Authorized User Card','カード','No Annual Fee'])assert.deepEqual(mapped(reader.chaseDetail(page(name),card()).items),base,name);
 assert.deepEqual(mapped(reader.chaseDetail(page('Plain','9999'),card('9999')).items),base,'another tail');
});
function fakePage(texts,{group=false}={}){
 const el=text=>({innerText:text,getClientRects:()=>[1],shadowRoot:null});
 const previous={document:globalThis.document,getComputedStyle:globalThis.getComputedStyle};
 globalThis.getComputedStyle=()=>({visibility:'visible'});
 globalThis.document={documentElement:{lang:'en-US'},getElementById:id=>id==='CARD_ACCOUNTS'&&group?{}:null,querySelectorAll:s=>s==='input[type=password]'||s==='*'?[]:texts.map(el)};
 return ()=>{globalThis.document=previous.document;globalThis.getComputedStyle=previous.getComputedStyle;};
}
test('discovery takes any masked account whatever its product name, and skips only non-card accounts and sentences',()=>{
 const run=(bank,text)=>{const restore=fakePage([text]);try{return discoverVisibleCards(bank,['en-US']);}finally{restore();}};
 for(const bank of ['BOA','HSBC HK','SC HK','Chase','Citi US']){
  for(const name of ['Quokka Voyager','Zephyrine 商務','No Keyword Here','Business Advantage'])assert.deepEqual(run(bank,name+' ending in 3141').cards,[{tail:'3141',name:name+' ending in 3141'}],bank+' '+name);
  for(const name of ['Total Checking','Savings Plus','Home Mortgage','支票賬戶','儲蓄戶口','Adv Plus Banking','Money Market','HKD Current Account','Integrated Account','往來戶口','基金戶口','Home Equity Line','Debit Card']){const r=run(bank,name+' ending in 3141');assert.equal(r.status,'no_data',bank+' '+name);assert.equal(r.skipped,1,'counted, not silently lost');}
  for(const text of ['We sent a code to your phone number ending in 3141','Payment from account ending in 3141'])assert.equal(run(bank,text).status,'no_data',text);
  // Other words in the row, or a card word beside an account word, do not lose a real card.
  for(const text of ['Quokka Visa ending in 3141\nPlan with My Flex Loan','Quokka Card ending in 3141\nAutopay from Savings','信用卡 尾號 3141\n定期回贈','Quokka Credit Line of Credit ending in 3141'])assert.equal(run(bank,text).cards.length,1,text);
 }
 const many=Array.from({length:25},(_,i)=>'Card '+String.fromCharCode(65+i)+' ending in '+(1000+i)),restore=fakePage([...many].reverse());
 try{assert.equal(discoverVisibleCards('BOA',['en-US']).cards.length,25);}finally{restore();}
 assert.equal(run('BOA','Quokka 4111 1111 1111 1111 ending in 1111').status,'no_data','full numbers never pass');
});
test('structure report text keeps generic labels and hides names, tails and values',()=>{
 for(const [text,want] of [['Current balance','Current balance'],['Minimum payment due','Minimum payment due'],['$1,234.56','$#,###.##'],['HK$67.89','HK$##.##'],['...3141','...####'],['Dec 19, 2030','[word] ##, ####'],['Quokka Voyager','[word] [word]'],['Welcome, Alex Example','[word] [word] [word]'],['現時結欠','現時結欠'],['王小明','[字]'],['Quokka 積分','[word] 積分']])assert.equal(redactStructureText(text),want,text);
 for(const secret of ['Alex','Quokka','1234','3141','4111','１２３４','٣١٤١'])assert.ok(!redactStructureText('Alex Quokka 1234 ...3141 4111 1111 １２３４ ٣١٤١').includes(secret),secret);
});
