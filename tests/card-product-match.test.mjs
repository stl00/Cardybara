import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {matchCardProduct,productCore,cardProducts} from '../src/productCatalog.js';
import {mergeWalletCards} from '../src/walletRegistry.js';
import {applyCardProductChoices,withCardProductChoice,readCardProductChoices,mergeCardProductChoices,CARD_PRODUCT_KEY} from '../src/cardProductChoice.js';
import {translations as i18nCatalog} from '../src/i18n/index.js';
const json=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
const id=(bank,region,name)=>{const m=matchCardProduct({bank,region,name});return m.status==='matched'?m.product.id:m.status;};
const us=n=>id('Amex US','US',n),hk=n=>id('HSBC HK','HK',n);

test('page-style Amex US names reach their product despite marks, issuer words and "Card"',()=>{
 for(const n of ['American Express® Gold Card','American Express Gold Card ••••12345','Blue Cash Everyday®','Blue Cash Everyday® Card','Hilton Honors American Express Aspire Card','The Platinum Card® from American Express'])assert.ok(us(n).startsWith('amex-us-'),n);
 assert.equal(us('American Express® Gold Card'),'amex-us-us-american-express-gold-card');
 assert.equal(us('Delta SkyMiles® Reserve Card'),'amex-us-us-delta-skymiles-reserve-card');
});
test('HSBC HK zh-HK page names match through public Chinese names, in either character form',()=>{
 assert.equal(hk('滙豐Red信用卡'),'hsbc-hk-hk-red-credit-card');assert.equal(hk('匯豐Red信用卡'),'hsbc-hk-hk-red-credit-card');
 assert.equal(hk('滙財金卡'),'hsbc-hk-hk-visa-gold-card');assert.equal(hk('滙財金卡 - 學生卡'),'hsbc-hk-hk-visa-gold-card-for-students');
 assert.equal(hk('卓越理財信用卡'),'hsbc-hk-hk-premier-credit-card');assert.equal(hk('滙豐 Visa Signature 卡'),'hsbc-hk-hk-hsbc-visa-signature-card');
 assert.equal(hk('滙豐EveryMile信用卡'),'hsbc-hk-hk-hsbc-everymile-card');
 assert.equal(hk('滙豐滙財金卡'),'hsbc-hk-hk-visa-gold-card');assert.equal(hk('銀聯雙幣信用卡'),'hsbc-hk-hk-unionpay-dual-currency-card','not the Pulse card, whose name also contains it');
 assert.equal(id('Chase','US','Sapphire Reserve® Card'),'chase-us-sapphire-reserve','several words are not a bare tier');
});
test('a fallback or generic name stays unknown, and tiers or business cards never cross',()=>{
 for(const n of ['American Express •••• 12345','Card','Synthetic Numbat Card',''])assert.equal(us(n),'unknown',n);
 for(const n of ['滙豐 •••• 1234','HSBC •••• 1234','信用卡','Pulse'])assert.equal(hk(n),'unknown',n);
 assert.equal(us('Business Platinum Card®'),'amex-us-us-business-platinum-card');
 for(const n of ['Platinum Card®','Platinum','Gold Card','Gold']){const m=matchCardProduct({bank:'Amex US',region:'US',name:n});assert.equal(m.status,'unknown',n);assert.ok(m.candidates.length>1,n);}
 assert.equal(us('Delta SkyMiles® Gold Business Card'),'amex-us-us-delta-skymiles-gold-business-card');
 assert.equal(id('Amex HK','HK','Gold Card'),id('Amex HK','HK','Gold Card'),'another bank keeps its own scope');
 assert.equal(productCore('Card'),'');
});
test('loose matching only applies when nothing matches exactly, and a tie stays unresolved',()=>{
 const products=[{id:'a',bank:'X',region:'US',name:'Alpha Card',aliases:[]},{id:'b',bank:'X',region:'US',name:'The Alpha',aliases:[]},{id:'c',bank:'X',region:'US',name:'Alpha Card Plus',aliases:['Alpha Card']}];
 const tie=matchCardProduct({bank:'X',region:'US',name:'Alpha'},products.slice(0,2));assert.equal(tie.status,'unknown','a loose tie is not recognised');assert.deepEqual(tie.candidates,['a','b'],'but its candidates are offered');
 assert.equal(matchCardProduct({bank:'X',region:'US',name:'Alpha Card'},products).status,'ambiguous','two exact matches are not settled by guessing');
 assert.equal(matchCardProduct({bank:'X',region:'US',name:'The Alpha'},products.slice(0,2)).product.id,'b','an exact match wins over a looser one');
});
test('every catalogue alias still reaches its own product',()=>{
 for(const p of cardProducts)for(const a of [p.name,...p.aliases]){const m=matchCardProduct({bank:p.bank,region:p.region,name:a});assert.ok(m.status!=='unknown',`${p.id}: ${a}`);if(m.status==='matched')assert.equal(m.product.id,p.id,`${p.id}: ${a}`);}
});
test('aliases added outside the catalogue name real products',()=>{
 const extra=json('../src/data/card-product-aliases.json'),ids=new Set(json('../src/data/card-products.json').products.map(p=>p.id));
 for(const k of Object.keys(extra.aliases))assert.ok(ids.has(k),k);
});
test('a chosen card type sets productId only, and only for its own bank and region',()=>{
 const card={id:'c1',bank:'Amex US',region:'US',name:'American Express •••• 12345',tail:'12345'};
 assert.throws(()=>withCardProductChoice([],card,'hsbc-hk-hk-red-credit-card'),/invalid_card_product/);
 const choices=withCardProductChoice([],card,'amex-us-us-american-express-gold-card'),[shown]=applyCardProductChoices([card],choices);
 assert.equal(shown.productId,'amex-us-us-american-express-gold-card');assert.equal(shown.name,card.name);assert.equal(matchCardProduct(shown).status,'matched');
 assert.deepEqual(applyCardProductChoices([{...card,bank:'Chase'}],choices)[0].productId,undefined,'a choice that no longer fits is ignored');
 assert.deepEqual(withCardProductChoice(choices,card,null),[]);
 assert.equal(withCardProductChoice(choices,card,'amex-us-us-the-platinum-card').length,1,'a new choice replaces the old');
});
test('stored choices tolerate damage, and a malformed backup is rejected whole',()=>{
 assert.deepEqual(readCardProductChoices({getItem:()=>'nope'}),[]);assert.deepEqual(readCardProductChoices({getItem(){throw Error()}}),[]);
 assert.deepEqual(readCardProductChoices({getItem:k=>k===CARD_PRODUCT_KEY?'[{"cardId":"a","productId":"p"},{"cardId":1}]':null}),[{cardId:'a',productId:'p'}]);
 assert.throws(()=>mergeCardProductChoices([],{schema:1,choices:[{cardId:'a'}]}),/invalid/);
 assert.deepEqual(mergeCardProductChoices([{cardId:'a',productId:'old'}],{schema:1,choices:[{cardId:'a',productId:'new'}]}),[{cardId:'a',productId:'new'}]);
});
test('picker strings exist in three languages',()=>{
 const catalog=i18nCatalog;
 for(const file of ['../src/CardProductPicker.jsx','../src/CardArt.jsx'])for(const [,key] of readFileSync(new URL(file,import.meta.url),'utf8').matchAll(/t\('([^']+)'/g))for(const l of ['en-US','zh-TW'])assert.ok(catalog[l][key],`${l}: ${key}`);
 for(const key of ['卡面待补全','未识别卡种，打开卡片可选择'])assert.ok(catalog['en-US'][key],key);
});
test('a card discovered on a bank page keeps bank and region through the wallet registry, so it can match',()=>{
 const found=[{id:'discovered-hsbc-hk-1234',bank:'HSBC HK',region:'HK',currency:'HKD',tail:'1234',name:'滙豐Red信用卡',identitySource:'bank-page'},{id:'discovered-amex-us-12345',bank:'Amex US',region:'US',currency:'USD',tail:'12345',name:'American Express® Gold Card',identitySource:'bank-page'}];
 const cards=mergeWalletCards({cards:[],connections:[]},found).cards;
 assert.deepEqual(cards.map(c=>[c.bank,c.region]),[['HSBC HK','HK'],['Amex US','US']]);
 assert.deepEqual(cards.map(c=>matchCardProduct(c).product?.id),['hsbc-hk-hk-red-credit-card','amex-us-us-american-express-gold-card']);
 assert.ok(cards.every(c=>matchCardProduct(c).product.art?.file),'and the matched products have art');
});
