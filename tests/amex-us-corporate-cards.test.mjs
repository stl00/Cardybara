import test from 'node:test';
import assert from 'node:assert/strict';
import {matchCardProduct} from '../src/productCatalog.js';
// Names from the public Amex US business sitemap (read 2026-11-17, signed out).
const own={'American Express Corporate Green Card':'green','American Express Corporate Gold Card':'gold','American Express Corporate Platinum Card':'platinum','Corporate Cashback Card':'cashback','American Express Corporate Purchasing Card':'purchasing','American Express Corporate Meeting Card':'meeting'};
test('each Amex US corporate card name matches its own product',()=>{
 const ids=new Set();
 for(const [name,slug] of Object.entries(own)){const m=matchCardProduct({bank:'Amex US',region:'US',name});assert.equal(m.status,'matched',name);assert.equal(m.product.id,`amex-us-us-corporate-${slug}-card`,name);ids.add(m.product.id);}
 assert.equal(ids.size,6);
});
test('industry corporate credit cards map to the generic Corporate Card entry',()=>{
 for(const i of ['Healthcare','Construction','Professional Services','Green Tech','Wholesale Trade']){const m=matchCardProduct({bank:'Amex US',region:'US',name:`${i} Corporate Credit Card`});assert.equal(m.product?.id,'amex-us-us-corporate-card',i);}
 assert.equal(matchCardProduct({bank:'Amex US',region:'US',name:'Corporate Card'}).product.id,'amex-us-us-corporate-card');
});
