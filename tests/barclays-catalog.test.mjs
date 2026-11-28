import test from 'node:test';
import assert from 'node:assert/strict';
import {cardProducts,matchCardProduct} from '../src/productCatalog.js';
import {queryKnowledge} from '../src/knowledge.js';

const barclays=cardProducts.filter(p=>p.bank==='Barclays');
const match=name=>matchCardProduct({bank:'Barclays',region:'US',name});
const rules=productId=>queryKnowledge({productId,asOf:'2026-11-27'}).rules;
const find=(slug,key)=>rules(`barclays-us-${slug}`).find(r=>r.id===`rule.barclays-us-${slug}.${key}`);

test('every Barclays name and alias matches only its own product',()=>{
 assert.equal(barclays.length,37);
 for(const p of barclays)for(const name of [p.name,...p.aliases]){const m=match(name);assert.equal(m.status,'matched',name);assert.equal(m.product.id,p.id,name);}
});

// Synthetic names in the shapes Plaid uses: issuer prefix, registered marks, network words dropped.
test('synthetic Plaid names match the Barclays product',()=>{
 for(const [name,slug] of [
  ['Barclays JetBlue Plus Card','jetblue-plus-card'],['JetBlue Plus Mastercard','jetblue-plus-card'],['JETBLUE CARD','jetblue-card'],['Barclays JetBlue Business Card','jetblue-business-card'],
  ['Wyndham Rewards Earner® Plus Card','wyndham-rewards-earner-plus-card'],['Barclaycard Wyndham Rewards Earner','wyndham-rewards-earner-card'],
  ['AAdvantage® Aviator® Red World Elite Mastercard®','aadvantage-aviator-red-world-elite-mastercard'],['Barclays View','view-mastercard'],['Hawaiian Airlines® World Elite Mastercard','hawaiian-airlines-world-elite-mastercard'],
  ['Barclays GM Business Mastercard','gm-business-mastercard'],['Old Navy Encore Mastercard','old-navy-encore-mastercard'],
 ])assert.equal(match(name).product?.id,`barclays-us-${slug==='view-mastercard'?'barclays-view-mastercard':slug}`,name);
});

test('a name that fits several Barclays cards or none is not picked',()=>{
 for(const name of ['AAdvantage Aviator Mastercard','Emirates Skywards World Elite Mastercard','Visa Signature'])assert.notEqual(match(name).status,'matched',name);
 assert.notEqual(matchCardProduct({bank:'Chase',region:'US',name:'JetBlue Plus Card'}).status,'matched');
});

test('published fees and rates are kept; what the pages did not state stays unknown',()=>{
 assert.equal(find('jetblue-premier-card','fee-primary').terms.amount,499);assert.equal(find('jetblue-premier-card','fee-additional').terms.amount,150);
 assert.equal(find('jetblue-premier-card','travel-credit').terms.amount,300);assert.equal(find('wyndham-rewards-earner-plus-card','fee-primary').terms.amount,95,'the standard fee, not the intro year');
 assert.equal(find('rci-elite-rewards-world-mastercard','vacation-credit').terms.spendThreshold,10000);
 assert.equal(find('barclays-view-mastercard','fee-primary'),undefined);
 const earner=rules('barclays-us-wyndham-rewards-earner-card').filter(r=>r.kind==='earning-rate').map(r=>r.terms.multiplier).sort();
 assert.deepEqual(earner,[1,5],'the page contradicts itself on dining and grocery stores');
 assert.equal(find('gm-rewards-mastercard','foreign-transaction-fee').terms.rate,3);
 assert.equal(find('gap-encore-mastercard','foreign-transaction-fee'),undefined,'not stated is not zero');
 for(const p of barclays.filter(p=>!rules(p.id).length))assert.equal(p.verification,'issuer-listed',p.id);
 assert.equal(barclays.filter(p=>!rules(p.id).length).length,9,'cards known by name only carry no facts');
});
