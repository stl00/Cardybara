// Cards outside the development account must read too: page structure decides, names are data.
// All names and values are synthetic. This proves generalization over imagined layouts, not real accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {discoverVisibleCards} from '../extension-next/discovery.js';
import {enrichBank,PARSER_SETTINGS} from '../extension-next/parser-client.js';
import {redactStructureText} from '../scripts/dev-collector/structure-report.js';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const box={self:{}};vm.createContext(box);vm.runInContext(read('../extension-next/reader.js'),box);
const reader=box.self.CardyReader,copy=x=>JSON.parse(JSON.stringify(x));
const holdout=JSON.parse(read('./fixtures/banks/chase-holdout.json'));
const COLLECTION=fs.readdirSync(new URL('../extension-next/',import.meta.url)).filter(f=>f.endsWith('.js'));

test('no product or programme name enters collection logic',()=>{
 const entities=JSON.parse(read('../src/data/knowledge/entities.json')),products=JSON.parse(read('./fixtures/wallet-products.json'));
 const names=new Set(['Sapphire','Freedom','Aeroplan','MileagePlus','IHG','Ultimate Rewards','Membership Rewards','RewardCash','Atmos','Hilton','Bonvoy','SkyMiles','Asia Miles','亞洲萬里通','亚洲万里通','美國運通積分','美国运通积分','獎賞錢','奖赏钱','Platinum','Centurion','Marriott','Reward Dollars','CashBack',...entities.programmes.map(p=>p.name),...products.cards.map(c=>c.name)].filter(n=>typeof n==='string'&&n.length>3));
 const found=[];
 for(const file of COLLECTION)for(const [i,line] of read('../extension-next/'+file).split('\n').entries()){
  // Justified: spelling aliases for grouping; they never decide what is read (see the file's comment).
  if(file==='bank-adapters.js'&&line.startsWith('export const canonicalProgramme='))continue;
  for(const name of names)if(line.toLowerCase().includes(name.toLowerCase()))found.push(file+':'+(i+1)+' '+name);
 }
 assert.deepEqual(found,[]);
});
test('hold-out names appear nowhere else',()=>{
 const others=[...COLLECTION.map(f=>read('../extension-next/'+f)),...fs.readdirSync(new URL('./fixtures/banks/',import.meta.url)).filter(f=>f!=='chase-holdout.json').map(f=>read('./fixtures/banks/'+f)),read('./fixtures/wallet-products.json'),read('../src/data/knowledge/entities.json')].join('\n');
 for(const name of ['Quokka','Zephyrine'])assert.ok(!others.includes(name),name);
});
const mapped=items=>Object.fromEntries(items.map(i=>[i.kind==='reward'?'reward':i.key,i.key==='due'?i.date:i.key==='autopay'?i.status:i.value]));
test('Chase hold-out cards read every field from structure alone',()=>{
 for(const [i,card] of holdout.cards.entries()){const r=reader.chaseDetail(holdout.details[i],card);assert.equal(r.rejected.length,0);assert.deepEqual(mapped(r.items),holdout.expected[i]);}
 assert.equal(reader.chaseDetail(holdout.details[0],holdout.cards[0]).items.find(i=>i.kind==='reward').key,'Quokka Trail Miles');
 assert.equal(reader.chaseDetail(holdout.details[1],holdout.cards[1]).items.find(i=>i.kind==='reward').key,'Zephyrine Club Points');
});
test('Chase results do not change with product, programme or card type',()=>{
 const page=(name,programme,tail='3141')=>({title:name+' (...'+tail+')',rewardLabel:programme,fields:{currentBalance:'$10.50','remainingStatementBalance-dataItem':'Remaining statement balance\n$4.25','minimumPaymentDue-dataItem':'Minimum payment due\n$2.00','nextPaymentDueDate-dataItem':'Payment due date\nDec 3, 2031','partnerRewards-dataItem':'9,876'}});
 const card=(tail='3141')=>({id:'x',bank:'Chase',tail,currency:'USD'}),base=mapped(reader.chaseDetail(page('Plain','Plain Points'),card()).items);
 for(const [name,programme] of [['Quokka Business Ink','Quokka Trail Miles'],['Authorized User Card','Some Hotel Rewards points'],['カード','Airline Miles'],['No Annual Fee','Cash Back Rewards']])assert.deepEqual(mapped(reader.chaseDetail(page(name,programme),card()).items),base,name);
 assert.deepEqual(mapped(reader.chaseDetail(page('Plain','Plain Points','9999'),card('9999')).items),base,'another tail');
});
test('an unnamed or unclear rewards row is reported, and never guessed',()=>{
 const card=holdout.cards[0],page=holdout.details[0];
 for(const change of [{rewardLabel:undefined},{rewardLabel:null}]){const r=reader.chaseDetail({...page,...change},card);assert.ok(!r.items.some(i=>i.kind==='reward'));assert.ok(r.rejected.includes('unrecognized_programme'));}
 const twoNumbers=reader.chaseDetail({...page,fields:{...page.fields,'partnerRewards-dataItem':'9,876\n1,234'}},card);assert.ok(!twoNumbers.items.some(i=>i.kind==='reward'));assert.ok(twoNumbers.rejected.includes('unrecognized_programme'));
});
test('an unrecognized programme reaches the run result as partial with its reason',async()=>{
 const card=holdout.cards[0],previous=globalThis.chrome,previousFetch=globalThis.fetch;let url='https://secure.chase.com/web/auth/dashboard#/dashboard/overview';
 globalThis.chrome={permissions:{contains:async()=>false},storage:{local:{get:async()=>({[PARSER_SETTINGS]:{enabled:false,scope:'mvp'}})}},tabs:{get:async()=>({id:2,url,status:'complete'})},scripting:{executeScript:async o=>{
  if(o.files||o.target.documentIds)return [{documentId:'doc',result:true}];
  if(o.func.name==='chaseCards')return [{result:[]}];
  return [{documentId:'doc',result:{pageHref:url,capturedAt:new Date().toISOString(),aliases:[{id:'C1',cardId:card.id,currency:'USD'}],observations:[{kind:'card',cardId:'C1',key:'balance',title:'Current balance',value:1,currency:'USD',date:'',status:'unknown',evidence:'[C1] Current balance $1.00'}],blocks:[{text:'[C1] Current balance $1.00'}],links:[],unrecognized:['unrecognized_programme'],rulesComplete:false}}];
 }}};
 globalThis.fetch=async()=>assert.fail('no model call');
 try{
  const r=await enrichBank({bank:'Chase',cards:[card],tabId:2},{current:async()=>true,progress:async()=>{},checkpoint:async()=>{},navigate:async()=>{}});
  assert.equal(r.rejectReasons.unrecognized_programme,1);assert.equal(r.rejected,1);assert.equal(r.sections.reward.status,'not_found');assert.deepEqual(r.sections.reward.coverage[0].missing,['reward']);
 }finally{globalThis.chrome=previous;globalThis.fetch=previousFetch;}
});
test('rewards label shape: units are generic, actions and values are not labels',()=>{
 for(const label of ['Some Hotel Rewards points','Airline Miles','Cash Back','Quokka Trail Miles','亞太里數','某某積分','現金回贈'])assert.equal(reader.rewardLabel(label),true,label);
 for(const label of ['Redeem points','View rewards','Current balance','12,345 points','Payment due date','兌換積分','',null])assert.equal(reader.rewardLabel(label),false,String(label));
});
function fakePage(texts,{group=false}={}){
 const el=text=>({innerText:text,getClientRects:()=>[1],shadowRoot:null});
 const previous={document:globalThis.document,getComputedStyle:globalThis.getComputedStyle};
 globalThis.getComputedStyle=()=>({visibility:'visible'});
 globalThis.document={documentElement:{lang:'en-US'},getElementById:id=>id==='CARD_ACCOUNTS'&&group?{}:null,querySelectorAll:s=>s==='input[type=password]'||s==='*'?[]:texts.map(el)};
 return ()=>{globalThis.document=previous.document;globalThis.getComputedStyle=previous.getComputedStyle;};
}
test('discovery takes any masked account whatever its product name, and skips only non-card account types',()=>{
 for(const bank of ['BOA','HSBC HK','SC HK','Chase']){
  for(const name of ['Quokka Voyager','Zephyrine 商務','No Keyword Here','Business Advantage']){
   const restore=fakePage([name+' ending in 3141']);
   try{assert.deepEqual(discoverVisibleCards(bank,['en-US']).cards,[{tail:'3141',name:name+' ending in 3141'}],bank+' '+name);}finally{restore();}
  }
  for(const name of ['Total Checking','Savings Plus','Home Mortgage','支票賬戶','儲蓄戶口']){
   const restore=fakePage([name+' ending in 3141']);
   try{assert.equal(discoverVisibleCards(bank,['en-US']).status,'no_data',bank+' '+name);}finally{restore();}
  }
 }
 // Card count and order do not matter, and full numbers never pass.
 const many=Array.from({length:25},(_,i)=>'Card '+String.fromCharCode(65+i)+' ending in '+(1000+i)),restore=fakePage([...many].reverse());
 try{assert.equal(discoverVisibleCards('BOA',['en-US']).cards.length,25);}finally{restore();}
 const full=fakePage(['Quokka 4111 1111 1111 1111 ending in 1111']);try{assert.equal(discoverVisibleCards('BOA',['en-US']).status,'no_data');}finally{full();}
});
test('structure report text keeps generic labels and hides names, tails and values',()=>{
 for(const [text,want] of [['Current balance','Current balance'],['Minimum payment due','Minimum payment due'],['$1,234.56','$#,###.##'],['HK$67.89','HK$##.##'],['...3141','...####'],['Dec 19, 2030','[word] ##, ####'],['Quokka Voyager','[word] [word]'],['Welcome, Alex Example','[word] [word] [word]'],['現時結欠','現時結欠'],['王小明','[字]'],['Quokka 積分','[word] 積分']])assert.equal(redactStructureText(text),want,text);
 for(const secret of ['Alex','Quokka','1234','3141','4111'])assert.ok(!redactStructureText('Alex Quokka 1234 ...3141 4111 1111').includes(secret),secret);
});
