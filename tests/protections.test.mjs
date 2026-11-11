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
