// Hiding a card (stl00/Cardybara#198): the bank still reads it, but everything that counts a held card leaves it out.
// Synthetic cards only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {heldCards,hiddenCards,heldWallet,isHiddenCard} from '../src/heldCards.js';
import {CARD_EDITS_KEY,readCardEdits,withCardEdit,withoutCardEdits,applyCardEdits,mergeCardEdits} from '../src/cardEdits.js';
import {withoutRemoved} from '../src/walletRegistry.js';
import {rewardAccounts} from '../src/rewardAccounts.js';
import {transferOptions} from '../src/transferRoutes.js';
import {portfolioMetrics} from '../src/costTracking.js';
import {paymentView} from '../src/paymentStates.js';
import {pendingNotifications,buildSchedule,DEFAULT_SETTINGS} from '../src/reminders.js';
import {creditTasks} from '../src/personalBenefits.js';
import {chooseCard} from '../src/cardDecision.js';
import {runWalletTool,agentTools} from '../src/walletAgent.js';
import {runAgentTurn} from '../src/agentSession.js';

const asOf='2026-11-04',read='2026-11-03T15:00:00Z';
const HIDDEN={id:'h-plat',name:'Hidden Synthetic Platinum',productId:'amex-us-us-the-platinum-card'};
const card=(id,name,productId,bank,fields)=>({id,name,productId,bank,region:'US',currency:'USD',updated:'2026-11-03',fieldDates:Object.fromEntries(Object.keys(fields).map(k=>[k,read])),...fields});
const bankCards=[
 card(HIDDEN.id,HIDDEN.name,HIDDEN.productId,'Amex US',{balance:400,statement:400,minimum:40,due:'2026-11-06'}),
 card('k-csr','Kept Synthetic Reserve','chase-us-sapphire-reserve','Chase',{balance:250,statement:250,minimum:25,due:'2026-11-06'}),
];
const snapshot={cards:bankCards,
 rewards:[{id:'us-mr',bank:'Amex US',label:'Membership Rewards',amount:50000,date:'2026-10-01'},{id:'ur',bank:'Chase',label:'Ultimate Rewards',amount:20000,date:'2026-10-01'}],
 rewardObservations:[{card:HIDDEN.id,bank:'Amex US',label:'Membership Rewards',amount:12345,capturedAt:read},{card:'k-csr',bank:'Chase',label:'Ultimate Rewards',amount:2468,capturedAt:read}],
 transactions:[{card:HIDDEN.id,date:'2026-11-01',description:'Synthetic store',amount:10},{card:'k-csr',date:'2026-11-01',description:'Synthetic cafe',amount:5}],
 offers:[{card:HIDDEN.id,name:'Synthetic offer',status:'added'}],
 benefits:[{card:HIDDEN.id,name:'Synthetic credit',used:5,limit:10}],
 spendingGoals:[{card:HIDDEN.id,name:'Synthetic goal',spent:1,target:2,currency:'USD'}],
 connections:[]};
const hideEdits=withCardEdit([],bankCards[0],{hidden:true});
const shown=applyCardEdits(bankCards,hideEdits),held=heldWallet({...snapshot,cards:shown});
const mentions=value=>{const text=JSON.stringify(value);return [HIDDEN.id,HIDDEN.name,HIDDEN.productId].some(m=>text.includes(m));};
const leaks=(value,label)=>{const text=JSON.stringify(value);for(const mark of [HIDDEN.id,HIDDEN.name,HIDDEN.productId])assert.ok(!text.includes(mark),`${label} mentions the hidden card (${mark}): ${text.slice(0,300)}`);};

test('the hidden flag is a user edit: stored, read back, cleared by unhiding and by removal',()=>{
 assert.deepEqual(hideEdits,[{cardId:HIDDEN.id,hidden:true}]);
 assert.deepEqual(readCardEdits({getItem:k=>k===CARD_EDITS_KEY?JSON.stringify(hideEdits):null}),hideEdits);
 assert.deepEqual(withCardEdit(hideEdits,bankCards[0],{hidden:false}),[]);
 assert.deepEqual(withCardEdit(hideEdits,bankCards[0],{hidden:null}),[]);
 assert.throws(()=>withCardEdit([],bankCards[0],{hidden:'yes'}),/invalid_card_hidden/);
 // Hiding keeps the other edits, and other edits keep the flag.
 const both=withCardEdit(withCardEdit(hideEdits,bankCards[0],{feeDate:{month:3,day:15}}),bankCards[0],{name:null});
 assert.deepEqual(both,[{cardId:HIDDEN.id,hidden:true,feeDate:{month:3,day:15}}]);
 assert.deepEqual(withCardEdit(both,bankCards[0],{hidden:false}),[{cardId:HIDDEN.id,feeDate:{month:3,day:15}}]);
 assert.deepEqual(withoutCardEdits(hideEdits,HIDDEN.id),[]);
 assert.ok(!readCardEdits({getItem:()=>JSON.stringify([{cardId:'x',hidden:'true'}])}).length,'only a real true hides');
});

test('hiding survives a refresh, a restart and a backup round trip, and only the user hides a card',()=>{
 // A bank refresh brings new readings for the same card id; the flag stays because it is not bank data.
 const refreshed=applyCardEdits([{...bankCards[0],balance:999},bankCards[1]],hideEdits);
 assert.equal(refreshed[0].hidden,true);assert.equal(refreshed[0].balance,999);assert.equal(refreshed[1].hidden,undefined);
 assert.ok(!refreshed[0].userSet,'hiding is not a correction of a bank value');
 // A restart or upgrade reads the same stored edits.
 const stored=readCardEdits({getItem:()=>JSON.stringify(hideEdits)});assert.equal(applyCardEdits(bankCards,stored)[0].hidden,true);
 // Backup export carries the edits; import merges them back.
 assert.deepEqual(mergeCardEdits([],{schema:1,edits:hideEdits}),hideEdits);
 // A flag that arrives with snapshot or imported card data is not the user's and is dropped.
 const imported=applyCardEdits([{...bankCards[1],hidden:true}],[]);assert.equal(imported[0].hidden,undefined);
 assert.equal(isHiddenCard(imported[0]),false);
});

test('the held-cards selector and held wallet drop the hidden card and every row that names it',()=>{
 assert.deepEqual(heldCards(shown).map(c=>c.id),['k-csr']);
 assert.deepEqual(hiddenCards(shown).map(c=>c.id),[HIDDEN.id]);
 assert.deepEqual(heldCards(undefined),[]);
 for(const key of ['cards','transactions','offers','benefits','spendingGoals','rewardObservations'])leaks(held[key],key);
 assert.equal(held.transactions.length,1);
 // The reward pool only the hidden card reached goes; the one a held card reaches stays.
 assert.deepEqual(held.rewards.map(r=>r.id),['ur']);
 // Nothing hidden: the same object, so the wallet does no extra work.
 const plain={...snapshot};assert.equal(heldWallet(plain),plain);
 // Hidden is not removed: removal still drops rows the same way it did.
 assert.deepEqual(withoutRemoved(snapshot,[{id:HIDDEN.id,bank:'Amex US'}]).cards.map(c=>c.id),['k-csr']);
});

test('overview totals and due alerts leave out a hidden card',()=>{
 const all=portfolioMetrics(shown,[],[],asOf).find(r=>r.currency==='USD'),kept=portfolioMetrics(held.cards,[],[],asOf).find(r=>r.currency==='USD');
 assert.equal(all.debt,650);assert.equal(kept.debt,250);
 leaks(paymentView(held.cards,[],asOf),'payment alerts');
 assert.ok(JSON.stringify(paymentView(shown,[],asOf)).includes(HIDDEN.id),'the fixture does raise an alert for the card when it is held');
});

test('rewards totals and transfer reach leave out a hidden card',()=>{
 const before=rewardAccounts({...snapshot,cards:bankCards}),after=rewardAccounts(held);
 assert.ok(JSON.stringify(before.current).includes(HIDDEN.id));
 leaks(after.current,'reward accounts');
 assert.ok(!after.current.some(r=>/Membership Rewards/.test(r.label)),'no MR pool once its only card is hidden');
 assert.ok(mentions(transferOptions(bankCards,{},{asOf})),'the fixture card reaches transfer partners when held');
 leaks(transferOptions(held.cards,{},{asOf}),'transfer options');
});

test('credits, reminders and the reminder calendar leave out a hidden card',()=>{
 assert.ok(creditTasks(shown,asOf).some(t=>t.cardId===HIDDEN.id),'the fixture card has credits when held');
 leaks(creditTasks(held.cards,asOf),'credit tasks');
 const settings={...DEFAULT_SETTINGS,enabled:true};
 assert.ok(JSON.stringify(pendingNotifications({cards:shown,marks:[],events:[],settings,sent:[],asOf})).includes(HIDDEN.name));
 leaks(pendingNotifications({cards:held.cards,marks:[],events:[],settings,sent:[],asOf}),'reminders');
 leaks(buildSchedule({cards:held.cards,marks:[],events:[],settings,sent:[],asOf,phrases:{}}),'reminder calendar');
});

test('card choice never picks or mentions a hidden card, even when handed one',()=>{
 const choice=chooseCard({category:'dining',amount:100,currency:'USD'},{cards:shown,day:asOf});
 leaks(choice,'chooseCard');
 assert.ok(JSON.stringify(choice).includes('k-csr')||JSON.stringify(choice).includes('Kept Synthetic Reserve'));
});

// The assistant contract: whatever tool the model calls, with whatever arguments, a hidden card is not in the result.
const CALLS={
 choose_card:[{category:'dining',amount:100,currency:'USD'},{category:'flight',channel:'direct',amount:500,currency:'USD'}],
 find_benefits:[{query:'lounge'},{query:'credit',category:'credit'},{query:'Platinum',cardName:HIDDEN.name}],
 get_card_rules:[{kind:'fee'},{kind:'transfer-relationship'},{kind:'fee',cardName:HIDDEN.name}],
 convert_points:[{},{partner:'Delta',points:10000},{cardName:HIDDEN.name}],
 query_credits:[{},{use:'dining'},{cardName:HIDDEN.name}],
 find_protections:[{},{type:'rental-car'},{cardName:HIDDEN.name}],
 plan_flight:[{airline:'Delta'},{airline:'United',milesNeeded:30000,points:20000}],
 list_cards:[{}],
};
test('assistant contract: no tool result ever carries a hidden card',()=>{
 assert.deepEqual(Object.keys(CALLS).sort(),agentTools.map(t=>t.function.name).sort(),'every assistant tool is covered');
 for(const [name,list] of Object.entries(CALLS))for(const args of list){
  const result=runWalletTool({id:'c1',type:'function',function:{name,arguments:JSON.stringify(args)}},{cards:shown,events:[],day:asOf,language:'en-US'});
  // A tool repeats a card name the model asked for (its scope, or "not among your cards"); that echo is the model's own
  // words, not the card. The id and product are still checked, and so is every other mention of the name.
  const text=JSON.stringify(result),seen=args.cardName?text.replaceAll(JSON.stringify(args.cardName),'"<asked>"'):text;
  leaks(JSON.parse(seen),`${name} ${JSON.stringify(args)}`);
 }
 assert.deepEqual(runWalletTool({id:'c1',function:{name:'list_cards',arguments:'{}'}},{cards:shown,events:[],day:asOf}).map(c=>c.name),['Kept Synthetic Reserve']);
});

test('a whole assistant turn never sends a hidden card to the model',async()=>{
 const sent=[];let step=0;
 const request=async body=>{sent.push(JSON.stringify(body));step++;return {message:step===1?{role:'assistant',content:'',tool_calls:[{id:'t1',type:'function',function:{name:'list_cards',arguments:'{}'}},{id:'t2',type:'function',function:{name:'query_credits',arguments:'{}'}}]}:{role:'assistant',content:'You hold Kept Synthetic Reserve.'}};};
 const out=await runAgentTurn({history:[],question:'Which cards do I hold?',context:{cards:shown,events:[],day:asOf,language:'en-US'},request});
 assert.equal(sent.length,2);
 for(const body of sent)leaks(body,'model request');
 leaks(out.messages,'turn messages');leaks(out.memory,'conversation memory');
});

test('the wallet routes every held-card consumer through the held wallet',()=>{
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.match(main,/const held=heldWallet\(displayed\);/);
 assert.match(main,/rewardAccounts\(held\)/);
 for(const component of ['PortfolioSummary','PaymentAssistant','PurchaseChooser','WalletAdvisor','RewardsView','ReminderRunner'])assert.match(main,new RegExp(`<${component} [^>]*cards=\\{held\\.cards\\}`),component);
 assert.equal((main.match(/<CreditManager cards=\{held\.cards\}/g)||[]).length,2,'overview and credits page');
 assert.match(main,/<BenefitGuide data=\{held\}/);
 assert.match(main,/<Statistic title=\{t\("我的卡片"\)\} value=\{held\.cards\.length\}/);
 assert.doesNotMatch(main,/displayed\.(benefits|offers|transactions|spendingGoals|rewards)/);
 // Only the card list and details, bank upkeep and duplicate checks see hidden cards.
 assert.deepEqual([...main.matchAll(/<(\w+) [^>]*cards=\{displayed\.cards\}/g)].map(m=>m[1]).sort(),['CardEditSection','ProductSuggestionRunner']);
 assert.match(main,/<BankConnections data=\{displayed\}/);
 assert.match(main,/collapsed|hidden-cards/);
 assert.match(main,/toggleHiddenCard\(detail\)/);
});
