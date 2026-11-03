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

import {mvpSummary,mvpLink} from '../extension-next/mvp.js';
test('MVP requires statement, minimum and full due date per card, not just balances',()=>{
 const cards=[{id:'a'},{id:'b'}],fields={balance:0,statement:0,minimum:0},patches=cards.map(c=>({id:c.id,fields}));const items=[{kind:'reward',cardId:'a'},{kind:'reward',cardId:'b'},{kind:'billing',key:'due',cardId:'a'}];let r=mvpSummary(items,cards,patches);assert.equal(r.card.status,'partial');assert.deepEqual(r.card.coverage[1].missing,['due']);assert.equal(r.reward.status,'updated');r=mvpSummary([...items,{kind:'billing',key:'due',cardId:'b'}],cards,patches);assert.equal(r.card.status,'updated');assert.deepEqual(Object.keys(r).sort(),['card','reward']);
});
test('MVP navigation includes points and statements, excludes transaction and offer links',()=>{
 assert.equal(mvpLink({label:'Membership Rewards'}),true);assert.equal(mvpLink({label:'禮品換領'}),true);assert.equal(mvpLink({label:'Statements'}),true);for(const label of ['View Transactions','Offers','福利','交易记录','Rewards offers'])assert.equal(mvpLink({label}),false);
});
