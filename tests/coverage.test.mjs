import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {collectCoverage,offerCoverage} from '../extension-next/coverage.js';
import {sectionSummary} from '../extension-next/parser-client.js';
const cards=[{id:'one'},{id:'two'}];
const offer=(cardId,title,status='available')=>({kind:'offer',cardId,title,status});
const view=(cardId,status,expected,confirmedEmpty=false)=>({kind:'offer',cardId,view:status,expected,confirmedEmpty});
test('19 extracted offers from a 20-offer bank list never appear complete',()=>{
 const items=Array.from({length:19},(_,n)=>offer('one','Shop '+n));
 const coverage=[view('one','available',20),view('one','added',0,true)];
 const result=sectionSummary(items,'not_found',[],[cards[0]],coverage).offer;
 assert.equal(result.status,'incomplete');assert.equal(result.count,19);assert.equal(result.expected,20);
});
test('available and registered views must both be covered for every card',()=>{
 const items=[offer('one','Shop A'),offer('one','Shop B','added'),offer('two','Shop A')];
 const coverage=[view('one','available',1),view('one','added',1),view('two','available',1)];
 assert.equal(offerCoverage(items,coverage,cards).complete,false);
 coverage.push(view('two','added',0,true));assert.equal(offerCoverage(items,coverage,cards).complete,true);
 assert.equal(sectionSummary(items,'not_found',[],cards,coverage).offer.status,'updated');
});
test('zero loading counters need explicit empty-state evidence and duplicates do not inflate coverage',()=>{
 const zero=[view('one','available',0),view('one','added',0)];assert.equal(offerCoverage([],zero,[cards[0]]).complete,false);
 assert.equal(sectionSummary([],'not_found',[],[cards[0]],zero).offer.status,'not_found');
 zero.forEach(c=>c.confirmedEmpty=true);assert.equal(sectionSummary([],'not_found',[],[cards[0]],zero).offer.status,'checked_empty');
 const coverage=[view('one','available',2),view('one','added',0,true)];assert.equal(offerCoverage([offer('one','Same'),offer('one','Same')],coverage,[cards[0]]).complete,false);
});
test('coverage is registered-card scoped, bounded and replaced only by a newer observation of the same view',()=>{
 let c=collectCoverage([], [view('one','available',20),view('foreign','available',20),view('one','added',-1),view('two','available',6000)],cards);
 assert.equal(c.length,1);c=collectCoverage(c,[view('one','available',21)],cards);assert.equal(c.length,1);assert.equal(c[0].expected,21);
});
test('Chase mixed-status list denominator is not added to its duplicate wallet rows',()=>{
 const items=[offer('one','A'),offer('one','B','added')];let coverage=collectCoverage([],[view('one','all',3)],cards);assert.equal(offerCoverage(items,coverage,[cards[0]]).complete,false);assert.equal(offerCoverage(items,coverage,[cards[0]]).expected,3);
 coverage=collectCoverage(coverage,[view('one','all',2)],cards);assert.equal(offerCoverage(items,coverage,[cards[0]]).complete,true);
});

test('reward reading completion is separate from unconfirmed shared pool ownership',()=>{
 const cs=[{id:'a'},{id:'b'}],a={kind:'reward',cardId:'a'},b={kind:'reward',cardId:'b'};
 assert.equal(sectionSummary([a],'not_found',[],cs).reward.status,'partial');assert.equal(sectionSummary([a,a],'not_found',[],cs).reward.status,'partial');const complete=sectionSummary([a,b],'not_found',[],cs).reward;assert.equal(complete.status,'updated');assert.equal(complete.readCards,2);assert.equal(complete.expectedCards,2);
});

import {mvpSummary,mvpLink,requiredReward,confirmedOtherProgramme,AMEX_REQUIRED_SOURCE} from '../extension-next/mvp.js';
test('MVP requires statement, minimum and full due date per card, not just balances',()=>{
 const cards=[{id:'a'},{id:'b'}],fields={balance:0,statement:0,minimum:0},patches=cards.map(c=>({id:c.id,fields}));const items=[{kind:'reward',cardId:'a'},{kind:'reward',cardId:'b'},{kind:'billing',key:'due',cardId:'a'}];let r=mvpSummary(items,cards,patches);assert.equal(r.card.status,'partial');assert.deepEqual(r.card.coverage[1].missing,['due']);assert.equal(r.reward.status,'updated');r=mvpSummary([...items,{kind:'billing',key:'due',cardId:'b'}],cards,patches);assert.equal(r.card.status,'updated');assert.deepEqual(Object.keys(r).sort(),['card','reward']);
});
test('MVP navigation includes points and statements, excludes transaction and offer links',()=>{
 assert.equal(mvpLink({label:'Membership Rewards'}),true);assert.equal(mvpLink({label:'禮品換領'}),true);assert.equal(mvpLink({label:'Statements'}),true);for(const label of ['View Transactions','Offers','福利','交易记录','Rewards offers'])assert.equal(mvpLink({label}),false);
});

test('an explicit no-payment statement satisfies minimum and due with its reason and invents nothing',()=>{
 const reason="You don't have a payment due right now.",card={id:'a'},notice={kind:'billing',cardId:'a',key:'paymentStatus',title:reason,value:null};
 const read=[{kind:'card',cardId:'a',key:'balance',value:0},{kind:'card',cardId:'a',key:'statement',value:0},{kind:'reward',cardId:'a'}];
 const r=mvpSummary([...read,notice],[card]);
 assert.deepEqual(r.card.coverage[0],{cardId:'a',missing:[],complete:true,notApplicable:['minimum','due'],reason});assert.equal(r.card.status,'updated');
 // No explicit statement: stays partial.
 const none=mvpSummary(read,[card]);assert.deepEqual(none.card.coverage[0],{cardId:'a',missing:['minimum','due'],complete:false});assert.equal(none.card.status,'partial');
 // Another card's statement does not apply here.
 assert.deepEqual(mvpSummary([...read,{...notice,cardId:'b'}],[card]).card.coverage[0].missing,['minimum','due']);
 // A printed positive minimum or due date overrides the statement, from any source.
 assert.deepEqual(mvpSummary([...read,notice,{kind:'card',cardId:'a',key:'minimum',value:5}],[card]).card.coverage[0].missing,['due']);
 assert.deepEqual(mvpSummary([...read,notice,{kind:'billing',cardId:'a',key:'due',value:null}],[card]).card.coverage[0].missing,['minimum']);
 assert.deepEqual(mvpSummary([...read,notice],[card],[{id:'a',fields:{minimum:5}}]).card.coverage[0].missing,['due']);
 // A printed zero minimum stays observed; only the due date is satisfied by the statement.
 const zero=mvpSummary([...read,notice,{kind:'card',cardId:'a',key:'minimum',value:0}],[card]).card.coverage[0];assert.deepEqual(zero.notApplicable,['due']);assert.equal(zero.complete,true);
 // A yearless due date also overrides it; a zero minimum from the overview does not.
 assert.deepEqual(mvpSummary([...read,notice,{kind:'billing',cardId:'a',key:'duePartial',value:null}],[card]).card.coverage[0].missing,['minimum','due']);
 const patched=mvpSummary([...read,notice],[card],[{id:'a',fields:{minimum:0}}]).card.coverage[0];assert.deepEqual(patched.notApplicable,['due']);assert.equal(patched.complete,true);
 // Balance and statement are never satisfied by it.
 assert.deepEqual(mvpSummary([notice],[card]).card.coverage[0].missing,['balance','statement']);
});

test('rewards are required only for Membership Rewards and Ultimate Rewards',()=>{
 const reward=(cardId,key)=>({kind:'reward',cardId,key});
 for(const [bank,key] of [['Chase','Ultimate Rewards® points'],['Amex US','Membership Rewards®'],['Amex HK','美國運通積分計劃']])assert.equal(requiredReward(bank,key),true,key);
 for(const [bank,key] of [['Chase','Some Airline Miles'],['Amex US','Some Hotel Points'],['BOA','Ultimate Rewards'],['HSBC HK','Membership Rewards'],['SC HK','Some Miles']])assert.equal(requiredReward(bank,key),false,bank+key);
 for(const [bank,key] of [['Amex US','American Express Membership Rewards'],['Amex US','Available Membership Rewards Points'],['Amex US','MR points'],['Amex HK','會員積分'],['Chase','Chase Ultimate Rewards points'],['Chase','UR points']])assert.equal(requiredReward(bank,key),true,key);
 assert.ok(readFileSync(new URL('../extension-next/agent-snapshot.js',import.meta.url),'utf8').includes("new RegExp('"+AMEX_REQUIRED_SOURCE.replaceAll('\\','\\\\')+"','i')"),'the injected copy matches the scope');
 // A bank with no required programme is complete on billing alone and says what it did not collect.
 const boa=mvpSummary([],[{id:'a',bank:'BOA'}],[],{a:new Set(['Some Miles'])});assert.equal(boa.reward.status,'not_collected');assert.deepEqual(boa.reward.coverage[0],{cardId:'a',complete:true,missing:[],notCollected:['Some Miles']});
 assert.deepEqual(mvpSummary([],[{id:'a',bank:'HSBC HK'}]).reward.coverage[0].notCollected,[]);
 // An Amex or Chase card showing only another programme is not left partial.
 const cobrand=mvpSummary([],[{id:'a',bank:'Chase'}],[],{a:new Set(['unnamed'])});assert.equal(cobrand.reward.status,'not_collected');assert.equal(cobrand.reward.coverage[0].complete,true);
 // Amex wording alone cannot prove another programme: an unlisted name stays partial, shown with its reason.
 for(const name of ['可兌換積分','您的積分','Redeemable Points','Amex Points','Points available to redeem','Some New Hotel Points']){const r=mvpSummary([],[{id:'a',bank:'Amex US'}],[],{a:new Set([name])}).reward.coverage[0];assert.equal(r.complete,false,name);assert.equal(r.reason,'programme_unconfirmed');assert.deepEqual(r.unconfirmed,[name]);}
 for(const name of ['Hilton Honors Points','Marriott Bonvoy Points','Delta SkyMiles','Reward Dollars']){const r=mvpSummary([],[{id:'a',bank:'Amex US'}],[],{a:new Set([name])}).reward.coverage[0];assert.equal(r.complete,true,name);assert.deepEqual(r.notCollected,[name]);}
 // Amex HK prints these brands in Chinese.
 for(const name of ['萬豪旅享家積分','万豪旅享家积分','希爾頓榮譽客會積分','現金回贈']){const r=mvpSummary([],[{id:'a',bank:'Amex HK'}],[],{a:new Set([name])}).reward.coverage[0];assert.equal(r.complete,true,name);assert.deepEqual(r.notCollected,[name]);}
 // A brand matching the card's own name confirms a co-brand (synthetic names).
 for(const [card,name] of [['Hilton Honors Surpass Card','Hilton Honors Points'],['Marriott Bonvoy Brilliant®','Marriott Bonvoy Points'],['Delta SkyMiles® Gold Card','Delta SkyMiles'],['Blue Cash Everyday® Card','Reward Dollars'],['萬豪旅享家信用卡','萬豪旅享家積分'],['Blue Cash 信用卡','現金回贈']]){const r=mvpSummary([],[{id:'a',bank:card.includes('信用卡')?'Amex HK':'Amex US',name:card}],[],{a:new Set([name])}).reward.coverage[0];assert.equal(r.complete,true,card);assert.deepEqual(r.notCollected,[name]);}
 // A brand printed as a promotion on a card that does not carry it leaves the missing required value partial.
 for(const [bank,card,name] of [['Amex US','American Express Gold Card','Marriott Bonvoy Points'],['Amex US','The Platinum Card®','Hilton Honors Points'],['Amex US','Delta SkyMiles® Gold Card','Hilton Honors Points'],['Amex HK','American Express Explorer(TM) Credit Card','萬豪旅享家積分'],['Amex HK','美國運通白金卡','現金回贈']]){const r=mvpSummary([],[{id:'a',bank,name:card}],[],{a:new Set([name])}).reward.coverage[0];assert.equal(r.complete,false,card+name);assert.equal(r.reason,'programme_unconfirmed');assert.deepEqual(r.unconfirmed,[name]);}
 // A promoted brand never hides a missing value next to a real co-brand balance either: only the matching brand counts.
 const both=mvpSummary([],[{id:'a',bank:'Amex US',name:'Hilton Honors Card'}],[],{a:new Set(['Hilton Honors Points','Marriott Bonvoy Points'])}).reward.coverage[0];assert.equal(both.complete,true);assert.deepEqual(both.notCollected,['Hilton Honors Points']);
 // Acceptance applies the same rule to a named card.
 assert.equal(confirmedOtherProgramme('Amex US','Marriott Bonvoy Points','American Express Gold Card'),false);assert.equal(confirmedOtherProgramme('Amex US','Marriott Bonvoy Points','Marriott Bonvoy Brilliant'),true);assert.equal(confirmedOtherProgramme('Amex US','Marriott Bonvoy Points'),true);assert.equal(confirmedOtherProgramme('Chase','Some Miles','Anything'),true);
 // No sign of any programme on such a card stays partial, with a reason.
 const missing=mvpSummary([],[{id:'a',bank:'Amex HK'}]);assert.deepEqual(missing.reward.coverage[0],{cardId:'a',complete:false,missing:['reward'],reason:'reward_not_seen'});assert.equal(missing.reward.status,'not_found');
 // Mixed: a required reading, a co-brand and a missing value.
 const cards=[{id:'a',bank:'Chase'},{id:'b',bank:'Chase'},{id:'c',bank:'Chase'}],mixed=mvpSummary([reward('a','Ultimate Rewards')],cards,[],{b:new Set(['Some Miles'])});
 assert.equal(mixed.reward.status,'partial');assert.deepEqual(mixed.reward.coverage.map(c=>c.complete),[true,true,false]);
 assert.equal(mvpSummary([reward('a','Ultimate Rewards')],cards.slice(0,2),[],{b:new Set(['Some Miles'])}).reward.status,'updated');
});
