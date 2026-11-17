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
test('every current Citi US card on the public card list matches its own product by full name',()=>{
 const want={'Citi Strata® Card':'citi-us-citi-strata-card','Citi Strata Card':'citi-us-citi-strata-card','Citi Rewards+':'citi-us-citi-strata-card','Citi Strata Premier® Card':'citi-us-citi-strata-premier-card','Citi Strata Elite® Card':'citi-us-citi-strata-elite-card',
 'Citi® / AAdvantage® Globe™ card':'citi-us-citi-aadvantage-globe-card','AAdvantage® MileUp® card':'citi-us-aadvantage-mileup-card','Citi® Diamond Preferred® Credit Card':'citi-us-citi-diamond-preferred-card','Citi Simplicity® Credit Card':'citi-us-citi-simplicity-card',
 'Costco Anywhere Visa® Card by Citi':'citi-us-costco-anywhere-visa-card-by-citi','Costco Anywhere Visa® Business Card by Citi':'citi-us-costco-anywhere-visa-business-card-by-citi','Citi® / AAdvantage Business™ card':'citi-us-citi-aadvantage-business-card','AT&T Points Plus® Card from Citi':'citi-us-at-t-points-plus-card-from-citi','Citi® Secured Mastercard®':'citi-us-citi-secured-mastercard',
 'Citi® / AAdvantage® Platinum Select® card':'citi-us-citi-aadvantage-platinum-select-card','Citi® / AAdvantage® Executive card':'citi-us-citi-aadvantage-executive-card','Citi Double Cash® Card':'citi-us-citi-double-cash-card','Citi Custom Cash® Card':'citi-us-citi-custom-cash-card'};
 for(const [n,p] of Object.entries(want))assert.equal(id('Citi US','US',n),p,n);
 for(const p of cardProducts.filter(p=>p.bank==='Citi US'))assert.ok(p.sourceUrl.startsWith('https://www.citi.com/credit-cards/')&&p.checkedAt,p.id);
});
test('the remaining Bank of America public cards match by full name and short name (#366)',()=>{
 const full=['Bank of America Travel Rewards credit card','Bank of America Premium Rewards credit card','Bank of America Premium Rewards Elite credit card','BankAmericard credit card','Susan G. Komen Customized Cash Rewards credit card','Air France KLM Visa Signature Credit Card','Norwegian Cruise Line World Mastercard','Business Advantage Unlimited Cash Rewards Mastercard','Business Advantage Customized Cash Rewards Mastercard','Business Advantage Travel Rewards World Mastercard'];
 const seen=new Set();
 for(const name of full){const m=matchCardProduct({bank:'BOA',region:'US',name});assert.equal(m.status,'matched',name);seen.add(m.product.id);}
 assert.equal(seen.size,full.length,'each card reaches its own product');
 for(const name of ['Bank of America® Premium Rewards® Elite credit card','Bank of America® Premium Rewards® credit card','BankAmericard®','Bank of America® Travel Rewards credit card'])assert.equal(matchCardProduct({bank:'BOA',region:'US',name}).status,'matched',name);
});
test('the remaining Capital One public cards match by full name and short name (#367)',()=>{
 const full=['Quicksilver Rewards Credit Card','QuicksilverOne Rewards Credit Card','Quicksilver Rewards for Good Credit','VentureOne Rewards Credit Card','VentureOne Rewards for Good Credit','SavorOne Rewards Credit Card','Savor Rewards for Good Credit','Platinum Credit Card','Savor Rewards for Students','Quicksilver Rewards for Students','Quicksilver Secured Rewards Credit Card','Platinum Secured Credit Card','Spark 2% Cash Credit Card','Spark 1.5% Cash Select Credit Card','Spark 1% Classic Credit Card','Venture Business Credit Card','VentureOne Business Credit Card','T-Mobile Visa Card','REI Co-op Mastercard','Kohl\'s Rewards Visa Card','Pottery Barn Key Rewards Visa Card','Williams Sonoma Key Rewards Visa Card','West Elm Key Rewards Visa Card','Key Rewards Visa Card','Cabela\'s CLUB Card','Bass Pro Shops CLUB Card','Bass Pro Shops and Cabela\'s CLUB Business Card'];
 const seen=new Set();
 for(const name of full){const m=matchCardProduct({bank:'Capital One',region:'US',name});assert.equal(m.status,'matched',name);seen.add(m.product.id);}
 assert.equal(seen.size,full.length,'each card reaches its own product');
 const short={'Quicksilver Rewards':'Quicksilver Rewards Credit Card','VentureOne Rewards':'VentureOne Rewards Credit Card','SavorOne Rewards':'SavorOne Rewards Credit Card','Platinum':'Platinum Credit Card','Spark 2% Cash':'Spark 2% Cash Credit Card','Spark 1.5% Cash Select':'Spark 1.5% Cash Select Credit Card','Spark 1% Classic':'Spark 1% Classic Credit Card','Venture Business':'Venture Business Credit Card','VentureOne Business':'VentureOne Business Credit Card','T-Mobile Visa®':'T-Mobile Visa Card','REI Co-op® Mastercard®':'REI Co-op Mastercard','Key Rewards® Visa':'Key Rewards Visa Card','Quicksilver Secured Rewards':'Quicksilver Secured Rewards Credit Card','Platinum Secured':'Platinum Secured Credit Card'};
 for(const [n,want] of Object.entries(short)){const m=matchCardProduct({bank:'Capital One',region:'US',name:n});assert.equal(m.status,'matched',n);assert.equal(m.product.name,want,n);}
 // "+" is kept in the name key as "plus", so "BJ's One" and "BJ's One+" are two different products.
 for(const n of ['BJ\'s One Mastercard','BJ\'s One+ Mastercard']){const m=matchCardProduct({bank:'Capital One',region:'US',name:n});assert.equal(m.status,'matched',n);assert.equal(m.candidates.length,1,n);}
 assert.notEqual(matchCardProduct({bank:'Capital One',region:'US',name:'BJ\'s One Mastercard'}).product.id,matchCardProduct({bank:'Capital One',region:'US',name:'BJ\'s One+ Mastercard'}).product.id);
 // Existing Capital One cards are not stolen by the new aliases.
 for(const [n,id] of [['Savor Rewards','capital-one-us-savor-credit-card'],['Venture Rewards','capital-one-us-venture-rewards-credit-card'],['Spark Cash Plus','capital-one-us-spark-cash-plus-card']])assert.equal(matchCardProduct({bank:'Capital One',region:'US',name:n}).product?.id,id,n);
});
test('the remaining U.S. Bank public cards match by full name and short name (#368)',()=>{
 const full=['U.S. Bank Smartly® Visa Signature® Card','U.S. Bank Altitude® Connect Visa Signature® Card','U.S. Bank Shield® Visa® Card','U.S. Bank Altitude® Go Secured Visa® Card','U.S. Bank Cash+® Secured Visa® Card','U.S. Bank Secured Visa® Card','U.S. Bank Triple Cash Rewards Visa® Business Card','U.S. Bank Business Altitude® Connect Visa Signature® Card','U.S. Bank Business Essentials™ Visa® Card','U.S. Bank Business Essentials™ Plus Visa Signature® Card','U.S. Bank Business Shield® Visa® Card'];
 const seen=new Set();
 for(const name of full){for(const n of [name,name.replace(/[®™]/g,'')]){const m=matchCardProduct({bank:'U.S. Bank',region:'US',name:n});assert.equal(m.status,'matched',n);assert.equal(m.product.name,name,n);seen.add(m.product.id);}}
 assert.equal(seen.size,full.length,'each card reaches its own product');
 for(const [n,want] of Object.entries({'Altitude Connect':'U.S. Bank Altitude® Connect Visa Signature® Card','Business Altitude Connect':'U.S. Bank Business Altitude® Connect Visa Signature® Card','Business Essentials Plus':'U.S. Bank Business Essentials™ Plus Visa Signature® Card','Business Essentials':'U.S. Bank Business Essentials™ Visa® Card','Shield Visa':'U.S. Bank Shield® Visa® Card','Business Shield':'U.S. Bank Business Shield® Visa® Card'})){const m=matchCardProduct({bank:'U.S. Bank',region:'US',name:n});assert.equal(m.status,'matched',n);assert.equal(m.product.name,want,n);}
 for(const [n,id] of [['Cash+ Visa Signature Card','us-bank-us-cash-plus-visa-signature-card'],['Altitude Go','us-bank-us-altitude-go-visa-signature-card']])assert.equal(matchCardProduct({bank:'U.S. Bank',region:'US',name:n}).product?.id,id,n);
});
test('the remaining Discover public cards match by full name and short name (#369)',()=>{
 const full=["Discover it Miles Credit Card", "Discover it Chrome Gas & Restaurants Credit Card", "Discover it Balance Transfer Credit Card", "NHL® Discover it Credit Card", "Discover it Cash Back for Good Credit", "Discover it Miles for Good Credit", "Discover it Chrome for Good Credit", "Discover it Student Cash Back Credit Card", "Discover it Student Chrome Credit Card", "Discover it Secured Cash Back Credit Card"];
 const seen=new Set();
 for(const name of full){for(const n of [name,name.replace(/[®™]/g,'')]){const m=matchCardProduct({bank:'Discover',region:'US',name:n});assert.equal(m.status,'matched',n);assert.equal(m.product.name,name,n);seen.add(m.product.id);}}
 assert.equal(seen.size,full.length,'each card reaches its own product');
 for(const [n,id] of [['Discover it Cash Back Credit Card','discover-us-discover-it-cash-back-credit-card'],['Discover it','discover-us-discover-it-cash-back-credit-card']])assert.equal(matchCardProduct({bank:'Discover',region:'US',name:n}).product?.id,id,n);
});
test('the remaining Wells Fargo public cards match by full name and short name (#370)',()=>{
 const full=['Wells Fargo Active Cash® Card','Wells Fargo Autograph® Card','Wells Fargo Reflect® Card','Wells Fargo One Key® Card','Wells Fargo Choice Privileges® Mastercard®','Wells Fargo Choice Privileges® Select Mastercard®','Wells Fargo Signify Business Cash® Card'];
 const seen=new Set();
 for(const name of full){for(const n of [name,name.replace(/[®™]/g,''),name.replace('Wells Fargo ','')]){const m=matchCardProduct({bank:'Wells Fargo',region:'US',name:n});assert.equal(m.status,'matched',n);assert.equal(m.product.name,name,n);seen.add(m.product.id);}}
 assert.equal(seen.size,full.length,'each card reaches its own product');
 assert.equal(matchCardProduct({bank:'Wells Fargo',region:'US',name:'Autograph Journey'}).product?.id,'wells-fargo-us-autograph-journey-visa-card','the existing card is not taken by Autograph');
});
