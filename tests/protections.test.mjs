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

// Cards added later by knowledge batch 15 (#631) were checked on their own day.
const BATCH_15=JSON.parse(readFileSync(new URL('../docs/knowledge/card-batches/batch-15.json',import.meta.url))).cards.map(c=>c.id);
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

// #306: Amex US pages that name protections; most Amex pages return no benefit text signed out.
test('a wallet holding Platinum and a Delta card gets Platinum protections with sources and Delta stays not_found (#306)',()=>{
 const held=[{id:'plat',name:'The Platinum Card',bank:'Amex US',region:'US',currency:'USD'},{id:'dg',name:'Delta SkyMiles Gold Card',bank:'Amex US',region:'US',currency:'USD'},{id:'gold',name:'American Express Gold Card',bank:'Amex US',region:'US',currency:'USD'}];
 const ctx={cards:held,events:[],day:'2026-11-16',language:'en'};
 const all=runWalletTool(call('find_protections',{}),ctx);
 const card=name=>all.cards.find(c=>c.name===name);
 assert.deepEqual(card('The Platinum Card').coverageTypes.sort(),['rental-car','trip-cancellation','trip-delay']);
 assert.deepEqual(card('American Express Gold Card').coverageTypes.sort(),['lost-luggage','rental-car','trip-delay']);
 assert.equal(card('Delta SkyMiles Gold Card').status,'not_found');
 assert.ok(all.rules.every(r=>r.sources.length&&r.sources.every(s=>s.url.startsWith('https://www.americanexpress.com/'))));
 // A heading on the page is not terms: no basis, payment condition or exclusions are claimed.
 const rental=runWalletTool(call('find_protections',{type:'rental-car'}),ctx);
 assert.equal(rental.rules.length,2);assert.ok(rental.rules.every(r=>r.requiresCardPayment!==true));
 // Platinum's page shows only the heading, so no basis; Gold's page states it is secondary (#326).
 assert.deepEqual(rental.rules.map(r=>r.basis).sort(),['not-stated','secondary']);
 // #441: Business Platinum has only the car rental rule, from Amex's public Description of Coverage PDF; its terms page is still unreadable.
 const bp=queryKnowledge({productId:'amex-us-us-business-platinum-card',category:'protection'});
 assert.equal(bp.count,1);assert.equal(bp.rules[0].terms.coverage.type,'rental-car');assert.equal(bp.rules[0].evidence.checkedAt,'2026-11-23');
 assert.equal(bp.rules[0].terms.coverage.basis,null);assert.match(bp.rules[0].original.summary,/excess insurance/);
 for(const id of ['business-gold-card','blue-business-plus-credit-card','blue-business-cash-card'])
  assert.equal(queryKnowledge({productId:'amex-us-us-'+id,category:'protection'}).count,0,id);
});

// #316: Lost Luggage Reimbursement on Chase personal cards, and the pages that showed no protection text.
test('lost luggage reimbursement is a coverage type recorded from the pages that state it (#316)',()=>{
 assert.ok(COVERAGE_TYPES.includes('lost-luggage'));
 assert.deepEqual(validateKnowledge().errors,[]);
 const held=[{id:'sw',name:'Southwest Rapid Rewards Plus Credit Card',bank:'Chase',region:'US',currency:'USD'},{id:'ihg',name:'IHG One Rewards Credit Card',bank:'Chase',region:'US',currency:'USD'}];
 const ctx={cards:held,events:[],day:'2026-11-16',language:'en'};
 const lost=runWalletTool(call('find_protections',{type:'lost-luggage'}),ctx);
 assert.equal(lost.rules.length,1);
 assert.equal(lost.rules[0].basis,'not-stated');
 assert.ok(lost.rules[0].sources.every(s=>s.url.startsWith('https://creditcards.chase.com/')));
 // IHG One's page showed no lost luggage text on 2026-11-16, so its other recorded protections stay and this one is absent.
 assert.equal(lost.cards.find(c=>c.name==='IHG One Rewards Credit Card').status,'not_found');
 for(const id of ['southwest-rapid-rewards-plus-credit-card','marriott-bonvoy-bold-credit-card','world-of-hyatt-credit-card','united-club-card','british-airways-visa-signature-credit-card','aer-lingus-visa-signature-credit-card']){
  const r=queryKnowledge({productId:'chase-us-'+id,category:'protection'}).rules.find(r=>r.terms.coverage.type==='lost-luggage');
  assert.ok(r,id);assert.equal(r.evidence.checkedAt,'2026-11-16');assert.equal(r.evidence.verification,'official-summary');
 }
 // Pages that showed only a heading record nothing, never a sibling's protections.
 for(const id of ['united-explorer-card','united-quest','ihg-premier','iberia-visa-signature-credit-card','disney-inspire-visa-card','prime-visa'])
  assert.equal(queryKnowledge({productId:'chase-us-'+id,category:'protection'}).count,0,id);
});

// #326: the Gold page text read on 2026-11-16 states limits, so Gold's rules are revision 2; pages that still show no text stay unrecorded.
test('Amex Gold protections carry the terms its product page states and the others stay unknown (#326)',()=>{
 assert.deepEqual(validateKnowledge().errors,[]);
 const all=queryKnowledge({productId:'amex-us-us-american-express-gold-card',category:'protection'}).rules;
 const rules=all.filter(r=>r.evidence.checkedAt==='2026-11-16');
 const by=t=>rules.find(r=>r.terms.coverage.type===t);
 assert.equal(rules.length,3);
 // 2026-11-17: the signed-out benefits page also names Purchase Protection (90 days, no amount stated).
 const pp=all.find(r=>r.terms.coverage.type==='purchase-protection');
 assert.equal(all.length,4);assert.equal(pp.evidence.checkedAt,'2026-11-17');assert.equal(pp.terms.amount,null);assert.match(pp.original.summary,/90 days/);
 assert.equal(by('rental-car').revision,2);assert.equal(by('rental-car').terms.coverage.basis,'secondary');
 assert.deepEqual(by('rental-car').terms.coverage.exclusions,['Coverage is not available for vehicles rented in Australia, Italy, and New Zealand.']);
 assert.equal(by('trip-delay').revision,2);assert.match(by('trip-delay').original.summary,/12 hours.*\$300 per trip/);
 const bag=by('lost-luggage');assert.equal(bag.revision,1);assert.match(bag.original.summary,/\$1,250 for carry-on and \$500 for checked/);
 assert.ok(rules.every(r=>r.evidence.checkedAt==='2026-11-16'&&r.evidence.verification==='official-summary'&&r.evidence.fullTermsReviewed===false));
 // Platinum's product page shows only headings: nothing beyond the type is claimed (#439 added four more from its terms page).
 const plat=queryKnowledge({productId:'amex-us-us-the-platinum-card',category:'protection'}).rules;
 assert.equal(plat.length,7);assert.ok(plat.every(r=>r.terms.coverage.basis===null&&r.revision===1||/\.(trip-cancel|trip-delay)$/.test(r.id)));
});

// #343: Capital One and Citi US pages that name protections; a page that names none records nothing.
test('a wallet holding a Strata card and a Venture card gets their recorded protections with sources, others stay not_found (#343)',()=>{
 const held=[{id:'el',name:'Citi Strata Elite Card',bank:'Citi US',region:'US',currency:'USD'},{id:'v',name:'Venture Rewards Credit Card',bank:'Capital One',region:'US',currency:'USD'},{id:'vx',name:'Venture X Rewards Credit Card',bank:'Capital One',region:'US',currency:'USD'}];
 const ctx={cards:held,events:[],day:'2026-11-16',language:'en'};
 const all=runWalletTool(call('find_protections',{}),ctx);
 const card=name=>all.cards.find(c=>c.name===name);
 assert.deepEqual(card('Citi Strata Elite Card').coverageTypes.sort(),['extended-warranty','lost-luggage','purchase-protection','rental-car','trip-cancellation','trip-delay']);
 assert.deepEqual(card('Venture Rewards Credit Card').coverageTypes.sort(),['extended-warranty','rental-car']);
 // Venture X's page names only cell phone cover, which needs #323, so nothing is recorded.
 assert.equal(card('Venture X Rewards Credit Card').status,'not_found');
 assert.ok(all.rules.every(r=>r.sources.length&&r.sources.every(s=>/^https:\/\/www\.(citi|capitalone)\.com\//.test(s.url))));
 const rental=runWalletTool(call('find_protections',{type:'rental-car'}),ctx);
 assert.equal(rental.rules.length,2);assert.ok(rental.rules.every(r=>r.basis==='not-stated'));
 // Double Cash says secondary; Custom Cash and Platinum Select pages name none.
 assert.equal(queryKnowledge({productId:'citi-us-citi-double-cash-card',category:'protection'}).rules[0].terms.coverage.basis,'secondary');
 for(const id of ['citi-us-citi-custom-cash-card','citi-us-citi-aadvantage-platinum-select-card','capital-one-us-venture-x-rewards-credit-card'])assert.equal(queryKnowledge({productId:id,category:'protection'}).count,0,id);
 assert.ok(queryKnowledge({kind:'benefit',category:'protection'}).rules.filter(r=>/capital-one|citi-us/.test(r.productIds[0])).every(r=>r.evidence.verification==='official-summary'&&r.evidence.checkedAt===(BATCH_15.includes(r.productIds[0])?'2026-11-24':'2026-11-16')));
});

// #343: OpenCC reads 列出租车 as 列 + 出租车 (taxi); zh-TW must say 租車, never 計程車, there.
test('zh-TW knowledge text keeps 租車 and does not turn it into 計程車 (#343)',()=>{
 const zhTW=JSON.parse(readFileSync(new URL('../src/i18n/knowledge.json',import.meta.url)))['zh-TW'];
 let checked=0;
 for(const [zh,tw] of Object.entries(zhTW)){
  if(/列出租车/.test(zh)){checked++;assert.ok(!tw.includes('計程車'),zh);assert.ok(tw.includes('列出租車'),zh);}
  if(tw.includes('計程車'))assert.match(zh,/(?<!列)出租车/,zh);
 }
 assert.ok(checked>=1);
});

// #344: Wells Fargo and Bilt pages that name protections; BofA, U.S. Bank and Discover pages name none.
test('a wallet holding Autograph Journey and Bilt Obsidian gets their recorded protections with sources; pages naming none stay not_found (#344)',()=>{
 const held=[{id:'wf',name:'Wells Fargo Autograph Journey Visa Card',bank:'Wells Fargo',region:'US',currency:'USD'},{id:'bo',name:'Bilt Obsidian Card',bank:'Bilt',region:'US',currency:'USD'},{id:'bb',name:'Bank of America Unlimited Cash Rewards',bank:'Bank of America',region:'US',currency:'USD'}];
 const ctx={cards:held,events:[],day:'2026-11-16',language:'en'};
 const all=runWalletTool(call('find_protections',{}),ctx);
 const card=name=>all.cards.find(c=>c.name===name);
 assert.deepEqual(card('Wells Fargo Autograph Journey Visa Card').coverageTypes.sort(),['lost-luggage','rental-car','roadside','trip-cancellation']);
 assert.deepEqual(card('Bilt Obsidian Card').coverageTypes.sort(),['extended-warranty','lost-luggage','purchase-protection','rental-car','trip-cancellation','trip-delay']);
 assert.equal(card('Bank of America Unlimited Cash Rewards').status,'not_found');
 assert.ok(all.rules.length>=10&&all.rules.every(r=>r.sources.length&&r.sources.every(s=>/^https:\/\/(www\.bilt\.com|creditcards\.wellsfargo\.com)\//.test(s.url))));
 const rental=runWalletTool(call('find_protections',{type:'rental-car'}),ctx);
 assert.deepEqual(rental.rules.map(r=>r.basis).sort(),['not-stated','secondary']);
 const n=id=>queryKnowledge({productId:id,category:'protection'}).count;
 assert.equal(n('bilt-us-bilt-blue-card'),2);assert.equal(n('bilt-us-bilt-palladium-card'),7);
 for(const id of ['boa-us-atmos-rewards-summit-visa-infinite','boa-us-atmos-rewards-ascent-visa-signature','boa-us-bank-of-america-unlimited-cash-rewards','boa-us-customized-cash-rewards-visa-signature','us-bank-us-altitude-go-visa-signature-card','us-bank-us-cash-plus-visa-signature-card','discover-us-discover-it-cash-back-credit-card'])assert.equal(n(id),0,id);
 assert.ok(queryKnowledge({kind:'benefit',category:'protection'}).rules.filter(r=>/wells-fargo|bilt/.test(r.productIds[0])).every(r=>r.evidence.verification==='official-summary'&&r.evidence.checkedAt===(BATCH_15.includes(r.productIds[0])?'2026-11-24':'2026-11-16')));
});

// #326: Schwab and Morgan Stanley Platinum public terms pages name seven protections each; cards whose pages show no text stay unknown.
test('a wallet holding Schwab and Morgan Stanley Platinum gets their recorded protections with sources; unread cards stay not_found (#326)',()=>{
 const held=[{id:'sc',name:'Platinum Card from American Express Exclusively for Charles Schwab',bank:'Amex US',region:'US',currency:'USD'},{id:'ms',name:'Morgan Stanley Platinum Card',bank:'Amex US',region:'US',currency:'USD'},{id:'dl',name:'Delta SkyMiles Blue American Express Card',bank:'Amex US',region:'US',currency:'USD'}];
 const ctx={cards:held,events:[],day:'2026-11-17',language:'en'};
 const all=runWalletTool(call('find_protections',{}),ctx);
 const card=n=>all.cards.find(c=>c.name===n);
 const types=['extended-warranty','lost-luggage','purchase-protection','rental-car','return-protection','trip-cancellation','trip-delay'];
 assert.deepEqual(card('Platinum Card from American Express Exclusively for Charles Schwab').coverageTypes.sort(),types);
 assert.deepEqual(card('Morgan Stanley Platinum Card').coverageTypes.sort(),types);
 assert.equal(card('Delta SkyMiles Blue American Express Card').status,'found');
 assert.ok(all.rules.every(r=>r.sources.length&&r.sources.every(s=>/^https:\/\/www\.americanexpress\.com\/us\/credit-cards\/card-application\//.test(s.url))));
 const trip=runWalletTool(call('find_protections',{type:'trip-delay'}),ctx);
 assert.equal(trip.rules.length,2);assert.ok(trip.rules.every(r=>r.basis==='secondary'));
 const rental=runWalletTool(call('find_protections',{type:'rental-car'}),ctx);
 assert.ok(rental.rules.every(r=>r.basis==='not-stated'));
 for(const id of ['amex-us-us-schwab-platinum-card','amex-us-us-morgan-stanley-platinum-card'])assert.ok(queryKnowledge({productId:id,category:'protection'}).rules.every(r=>r.evidence.checkedAt==='2026-11-17'&&r.evidence.fullTermsReviewed===false&&r.terms.amount===null));
 assert.equal(queryKnowledge({productId:'amex-us-us-delta-skymiles-blue-card',category:'protection'}).count,3);
});

// #439: more Amex US cards whose public terms pages were readable; the business cards stay unknown.
test('a wallet holding Platinum and a Delta card gets only the protections their terms pages name (#439)',()=>{
 const held=[{id:'pl',name:'The Platinum Card from American Express',bank:'Amex US',region:'US',currency:'USD'},{id:'dr',name:'Delta SkyMiles Reserve American Express Card',bank:'Amex US',region:'US',currency:'USD'},{id:'dg',name:'Delta SkyMiles Gold American Express Card',bank:'Amex US',region:'US',currency:'USD'},{id:'db',name:'Delta SkyMiles Blue American Express Card',bank:'Amex US',region:'US',currency:'USD'}];
 const ctx={cards:held,events:[],day:'2026-11-17',language:'en'};
 const all=runWalletTool(call('find_protections',{}),ctx);
 const types=n=>all.cards.find(c=>c.name===n).coverageTypes.sort();
 assert.deepEqual(types('The Platinum Card from American Express'),['extended-warranty','lost-luggage','purchase-protection','rental-car','return-protection','trip-cancellation','trip-delay']);
 assert.deepEqual(types('Delta SkyMiles Reserve American Express Card'),['extended-warranty','lost-luggage','purchase-protection','rental-car','return-protection','trip-cancellation','trip-delay']);
 assert.deepEqual(types('Delta SkyMiles Gold American Express Card'),['extended-warranty','lost-luggage','purchase-protection','rental-car']);
 assert.deepEqual(types('Delta SkyMiles Blue American Express Card'),['extended-warranty','purchase-protection','rental-car']);
 assert.ok(all.rules.every(r=>r.sources.length&&r.sources.every(s=>/^https:\/\/www\.americanexpress\.com\//.test(s.url))));
 const trip=runWalletTool(call('find_protections',{type:'trip-delay',cardName:'Delta SkyMiles Reserve American Express Card'}),ctx);
 assert.ok(trip.rules.length>=1&&trip.rules.every(r=>r.basis==='secondary'));
 for(const id of ['amex-us-us-delta-skymiles-reserve-card','amex-us-us-delta-skymiles-gold-card','amex-us-us-marriott-bonvoy-brilliant-card','amex-us-us-hilton-honors-aspire-card'])assert.ok(queryKnowledge({productId:id,category:'protection'}).rules.every(r=>r.evidence.checkedAt==='2026-11-17'&&r.evidence.fullTermsReviewed===false&&r.terms.amount===null));
 for(const id of ['amex-us-us-business-gold-card','amex-us-us-blue-business-plus-credit-card','amex-us-us-business-green-rewards-card','amex-us-us-graphite-business-cash-unlimited-card'])assert.equal(queryKnowledge({productId:id,category:'protection'}).count,0,id);
});

// #306: Blue Cash Preferred and Delta Blue terms pages were readable; the business cards' pages were not, so they stay unknown.
test('Blue Cash Preferred and Delta Blue record only what their terms pages name (#306)',()=>{
 const types=id=>queryKnowledge({productId:id,category:'protection'}).rules.map(r=>r.terms.coverage.type).sort();
 assert.deepEqual(types('amex-us-us-blue-cash-preferred-card'),['extended-warranty','purchase-protection','rental-car','return-protection']);
 assert.deepEqual(types('amex-us-us-delta-skymiles-blue-card'),['extended-warranty','purchase-protection','rental-car']);
 for(const id of ['amex-us-us-blue-cash-preferred-card','amex-us-us-delta-skymiles-blue-card'])assert.ok(queryKnowledge({productId:id,category:'protection'}).rules.every(r=>r.evidence.checkedAt==='2026-11-17'&&r.evidence.fullTermsReviewed===false&&r.terms.amount===null));
});
