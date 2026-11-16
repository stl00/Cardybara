// #83: which card covers a rental car, and other protection questions, answered from sourced terms only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runWalletTool,validateToolCall,agentTools} from '../src/walletAgent.js';
import {validateCoverage,validateKnowledge,queryKnowledge,COVERAGE_TYPES} from '../src/knowledge.js';
import {SYSTEM} from '../src/chatProtocol.js';
const cards=JSON.parse(readFileSync(new URL('./fixtures/wallet-products.json',import.meta.url))).cards;
const context={cards,events:[],day:'2026-11-10',language:'en'};
const call=(name,args={})=>({id:'p1',type:'function',function:{name,arguments:JSON.stringify(args)}});
const protections=args=>runWalletTool(call('find_protections',args),context);

test('rental car coverage states primary only where the terms say so, and the card payment requirement',()=>{
 const result=protections({type:'rental-car'});
 assert.equal(result.kind,'protections');assert.match(result.coverage,/guide to benefits controls/);assert.match(result.coverage,/not insurance advice/);
 const csr=result.rules.find(r=>r.cards.some(c=>c.name==='Sapphire Reserve'));
 assert.equal(csr.coverageType,'rental-car');assert.equal(csr.basis,'primary');assert.equal(csr.requiresCardPayment,true);assert.ok(csr.sources.length&&csr.sources.every(s=>s.url.startsWith('https://')));
 assert.ok(csr.original.quotes.some(q=>/primary/.test(q)));
 // Freedom Unlimited's public summary does not say primary or secondary, so neither is claimed.
 const cfu=result.rules.find(r=>r.cards.some(c=>c.name==='Freedom Unlimited'));
 assert.equal(cfu.basis,'not-stated');assert.equal(cfu.requiresCardPayment,true);assert.equal(cfu.exclusions,'none-stated');
 assert.ok(result.rules.every(r=>r.coverageType==='rental-car'));
});

test('a card without a record is not_found, never reported as having no coverage',()=>{
 const result=protections({type:'rental-car'});
 const gold=result.cards.find(c=>c.name==='American Express Gold Card');
 assert.equal(gold.status,'not_found');assert.deepEqual(gold.coverageTypes,[]);
 assert.match(result.notFoundNote,/Never say they have no coverage/);
 assert.equal(result.cards.find(c=>c.name==='Sapphire Reserve').status,'found');
 const one=protections({type:'rental-car',cardName:'Blue Cash Everyday'});
 assert.equal(one.totalMatches,0);assert.equal(one.cards[0].status,'not_found');assert.ok(one.notFoundNote);
});

test('without a type every protection of the selected card comes back, each typed',()=>{
 const result=protections({cardName:'Sapphire Reserve'});
 assert.deepEqual(result.matchedCards,['Sapphire Reserve']);
 assert.equal(result.cards[0].status,'found');
 assert.ok(result.totalMatches>=9);
 for(const t of ['rental-car','trip-delay','purchase-protection','extended-warranty'])assert.ok(result.cards[0].coverageTypes.includes(t),t);
 assert.ok(result.rules.every(r=>COVERAGE_TYPES.includes(r.coverageType)));
 assert.equal(protections({cardName:'Sapphire Reserve',type:'travel-insurance'}).totalMatches,0);
});

test('a business-only primary basis keeps its scope from the quote',()=>{
 const ink=queryKnowledge({productId:'chase-us-ink-business-preferred-credit-card',category:'protection'}).rules.find(r=>r.terms.coverage?.type==='rental-car');
 assert.equal(ink.terms.coverage.basis,'primary');assert.equal(ink.terms.coverage.basisScope,'when renting for business purposes');
 const csp=queryKnowledge({productId:'chase-us-chase-sapphire-preferred-credit-card',category:'protection'}).rules.find(r=>r.terms.coverage?.type==='rental-car');
 assert.ok(csp.terms.coverage.exclusions.some(e=>/New York|United States/.test(e)));
});

test('the tool is read-only and rejects unknown types or fields',()=>{
 assert.ok(agentTools.some(t=>t.function.name==='find_protections'));
 assert.throws(()=>validateToolCall(call('find_protections',{type:'life-insurance'})),/invalid_arguments/);
 assert.throws(()=>validateToolCall(call('find_protections',{type:'rental-car',claim:true})),/invalid_arguments/);
 assert.match(SYSTEM,/find_protections/);assert.match(SYSTEM,/not insurance advice/);assert.match(SYSTEM,/never uncovered/);
});

test('coverage fields must be grounded in the rule\'s own quotes',()=>{
 assert.deepEqual(validateKnowledge().errors,[]);
 const base=queryKnowledge({productId:'chase-us-freedom-unlimited',category:'protection'}).rules[0];
 const withCoverage=c=>({...base,terms:{...base.terms,coverage:{...base.terms.coverage,...c}}});
 assert.deepEqual(validateCoverage(withCoverage({})),[]);
 assert.ok(validateCoverage(withCoverage({basis:'secondary'})).includes('basis not stated in a quote'));
 assert.ok(validateCoverage(withCoverage({exclusions:['exotic cars']})).includes('exclusions must quote the source'));
 assert.ok(validateCoverage(withCoverage({requiresCardPayment:false})).length);
 assert.ok(validateCoverage(withCoverage({type:'pet-insurance'})).includes('unknown type'));
 assert.ok(validateCoverage({...base,terms:{...base.terms,coverage:undefined}}).length);
 // Every protection benefit in the knowledge base carries coverage fields.
 for(const r of queryKnowledge({kind:'benefit',category:'protection'}).rules)assert.ok(r.terms.coverage,r.id);
});

// #304: Chase personal cards that state protections on their public product page.
test('a wallet holding two Chase airline and hotel cards gets the newly recorded protections with sources (#304)',()=>{
 const held=[{id:'ugw',name:'United Gateway Card',bank:'Chase',region:'US',currency:'USD'},{id:'bold',name:'Marriott Bonvoy Bold Credit Card',bank:'Chase',region:'US',currency:'USD'}];
 const ctx={cards:held,events:[],day:'2026-11-15',language:'en'};
 const all=runWalletTool(call('find_protections',{}),ctx);
 const types=name=>all.cards.find(c=>c.name===name).coverageTypes;
 assert.deepEqual(types('United Gateway Card').sort(),['extended-warranty','purchase-protection','rental-car','trip-cancellation']);
 assert.deepEqual(types('Marriott Bonvoy Bold Credit Card').sort(),['baggage-delay','purchase-protection','trip-delay']);
 assert.ok(all.rules.every(r=>r.sources.length&&r.sources.every(s=>s.url.startsWith('https://creditcards.chase.com/'))));
 // Gateway's page says secondary in the U.S., and Bold's page says nothing about rental cover, so it stays absent.
 const rental=runWalletTool(call('find_protections',{type:'rental-car'}),ctx);
 assert.equal(rental.rules.length,1);assert.equal(rental.rules[0].basis,'secondary');assert.equal(rental.rules[0].requiresCardPayment,true);
 assert.equal(rental.cards.find(c=>c.name==='Marriott Bonvoy Bold Credit Card').status,'not_found');
 // A page that showed only a heading records nothing, never a sibling's protections.
 assert.equal(queryKnowledge({productId:'chase-us-united-explorer-card',category:'protection'}).count,0);
 assert.equal(queryKnowledge({productId:'chase-us-united-gateway-card',category:'protection'}).rules.every(r=>r.evidence.verification==='official-summary'&&r.evidence.checkedAt==='2026-11-15'),true);
});

// #305: Chase business cards that state protections on their public product page.
test('a wallet holding an Ink card and a co-brand business card gets the newly recorded protections with sources (#305)',()=>{
 const held=[{id:'cash',name:'Ink Business Cash Credit Card',bank:'Chase',region:'US',currency:'USD'},{id:'ucb',name:'United Club Business Card',bank:'Chase',region:'US',currency:'USD'}];
 const ctx={cards:held,events:[],day:'2026-11-15',language:'en'};
 const all=runWalletTool(call('find_protections',{}),ctx);
 const types=name=>all.cards.find(c=>c.name===name).coverageTypes;
 assert.deepEqual(types('Ink Business Cash Credit Card').sort(),['extended-warranty','purchase-protection','rental-car','roadside']);
 assert.deepEqual(types('United Club Business Card').sort(),['baggage-delay','extended-warranty','rental-car','return-protection','purchase-protection','trip-cancellation','trip-delay'].sort());
 assert.ok(all.rules.every(r=>r.sources.length&&r.sources.every(s=>s.url.startsWith('https://creditcards.chase.com/'))));
 // Rental cover is primary only for business rentals, and the scope travels with it.
 const rental=runWalletTool(call('find_protections',{type:'rental-car'}),ctx);
 assert.equal(rental.rules.length,2);assert.ok(rental.rules.every(r=>r.basis==='primary'&&r.requiresCardPayment===true));
 // The Ink Cash page states no trip cover, so it stays absent rather than copied from a sibling.
 assert.equal(runWalletTool(call('find_protections',{type:'trip-cancellation'}),ctx).cards.find(c=>c.name==='Ink Business Cash Credit Card').status,'not_found');
 // Ink Business Preferred keeps its earlier rental rule and gains the others; an unreadable page records nothing.
 const pref=queryKnowledge({productId:'chase-us-ink-business-preferred-credit-card',category:'protection'}).rules.map(r=>r.terms.coverage.type).sort();
 assert.deepEqual(pref,['extended-warranty','purchase-protection','rental-car','roadside','trip-cancellation']);
 assert.equal(queryKnowledge({productId:'chase-us-ihg-one-rewards-business-credit-card',category:'protection'}).count,0);
});
