import test from 'node:test';
import assert from 'node:assert/strict';
import {matchCardProduct} from '../src/productCatalog.js';
import {presentCard} from '../src/cardName.js';
import {discoverVisibleCards} from '../extension-next/discovery.js';
// Synthetic names only. Citi's page cuts a long product name to about ten characters and "...".
const citi=name=>matchCardProduct({bank:'Citi US',region:'US',name});
test('a cut-off name that fits one product is matched, with "...", the ellipsis sign and trademark marks',()=>{
 for(const n of ['Citi Doub...','Citi Doub…','Citi® Doub...','Citi Doub... - 2345']){const m=citi(n);assert.equal(m.status,'matched',n);assert.equal(m.product.id,'citi-us-citi-double-cash-card',n);}
 for(const n of ['Citi® / AAdvantage® Exec…','Citi AAdvantage Exec...'])assert.equal(citi(n).product?.id,'citi-us-citi-aadvantage-executive-card',n);
});
test('a cut-off name that fits several products is ambiguous and offers them, never picked',()=>{
 for(const n of ['Citi Strat...','Citi Strat…']){const m=citi(n);assert.equal(m.status,'ambiguous',n);assert.equal(m.product,undefined);assert.deepEqual([...m.candidates].sort(),['citi-us-citi-strata-elite-card','citi-us-citi-strata-premier-card'],n);}
 const m=citi('Citi / AAdv...');assert.equal(m.status,'ambiguous');assert.ok(m.candidates.includes('citi-us-citi-aadvantage-executive-card')&&m.candidates.includes('citi-us-citi-aadvantage-platinum-select-card'));
});
test('a cut-off name that fits nothing, is too short, or belongs to another bank stays unknown',()=>{
 for(const n of ['Zzyzx Qu...','Zzyzx Qu…','Ci...','...'])assert.deepEqual(citi(n),{status:'unknown',candidates:[]},n);
 assert.equal(matchCardProduct({bank:'Chase',region:'US',name:'Citi Doub...'}).status,'unknown','another bank keeps its own scope');
});
test('exact names still match exactly, and the card view shows the catalogue name for a cut-off match',()=>{
 assert.equal(citi('Citi Double Cash Card').product.id,'citi-us-citi-double-cash-card');
 const card=presentCard({bank:'Citi US',region:'US',identitySource:'bank-page',name:'Citi Doub...',tail:'2345'},'en-US');
 assert.equal(card.productId,'citi-us-citi-double-cash-card');assert.equal(card.pageName,'Citi Doub...');
 const tie=presentCard({bank:'Citi US',region:'US',identitySource:'bank-page',name:'Citi Strat...',tail:'3456'},'en-US');assert.equal(tie.productId,undefined);assert.equal(tie.name,'Citi Strat...');
});
test('Citi discovery uses a full name from title, aria-label or image alt when the link text is cut, and nothing else',()=>{
 const attrs=o=>({getAttribute:k=>o[k]??null});
 const link=(text,own={},kids=[])=>({href:'https://www.citi.com/accountdetails?accountId=1x',innerText:text,textContent:text,...attrs(own),querySelectorAll:()=>kids});
 const kid=(tagName,o)=>({tagName,...attrs(o)});
 const links=[link('Citi Doub...-2345',{title:'Citi Double Cash Card - 2345'}),link('Citi Stra...-3456',{},[kid('IMG',{alt:'Citi Strata Premier Card'})]),link('Citi Pref...-4567',{'aria-label':'Something else entirely'}),link('Wallaby Traveler Card-5678',{title:'Not used when nothing is cut'}),link('Citi Rewa...-6789',{title:'Citi Rewa...'})];
 globalThis.getComputedStyle=()=>({visibility:'visible'});
 globalThis.document={documentElement:{lang:'en-US'},querySelectorAll:s=>s==='input[type=password]'?[]:s==='a[href*="accountdetails"]'?links:[]};
 try{const r=discoverVisibleCards('Citi US',['en-US']);assert.equal(r.status,'found');
  assert.deepEqual(r.cards.map(c=>[c.tail,c.name]),[['2345','Citi Double Cash Card'],['3456','Citi Strata Premier Card'],['4567','Citi Pref...'],['5678','Wallaby Traveler Card'],['6789','Citi Rewa...']]);}
 finally{delete globalThis.document;delete globalThis.getComputedStyle;}
});
