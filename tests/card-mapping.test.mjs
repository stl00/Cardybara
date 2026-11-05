import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cleanPageName,presentCard,productDisplayName} from '../src/cardName.js';
import {cardProducts,matchCardProduct} from '../src/productCatalog.js';
import {mergeWalletCards} from '../src/walletRegistry.js';
import {ACTIVE_BANKS} from '../extension-next/providers.js';
const json=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
const names=json('../src/data/card-product-names.json');
const card=(bank,name,extra={})=>({id:'x',bank,region:cardProducts.find(p=>p.bank===bank)?.region,name,...extra});
const matched=(bank,name)=>{const m=matchCardProduct(card(bank,name));return m.status==='matched'?m.product.id:null;};

test('page names lose the last digits, currency side and trademark signs, and keep product words',()=>{
 const cases=[
  ['American Express Explorer(TM) Credit Card••••12345','American Express Explorer Credit Card'],
  ['滙豐Pulse銀聯雙幣鑽石卡-港幣','滙豐Pulse銀聯雙幣鑽石卡'],['滙豐Pulse銀聯雙幣鑽石卡-人民幣','滙豐Pulse銀聯雙幣鑽石卡'],['Red Credit Card (HKD)','Red Credit Card'],
  ['Sapphire Reserve (...1234)','Sapphire Reserve'],['Freedom Unlimited -1234','Freedom Unlimited'],['Gold Card ending in 1234','Gold Card'],['渣打國泰Mastercard 尾號 1234','渣打國泰Mastercard'],
  ['Platinum Card®','Platinum Card'],['Delta SkyMiles® Gold Card ••••1234','Delta SkyMiles Gold Card'],['','']];
 for(const [raw,want] of cases)assert.equal(cleanPageName(raw),want,raw);
 for(const [raw] of cases)assert.doesNotMatch(cleanPageName(raw),/\d{4}/,raw);
});
test('the two reported page names map to their catalogue products',()=>{
 assert.equal(matched('Amex HK','American Express Explorer(TM) Credit Card••••12345'),'amex-hk-hk-american-express-explorer-credit-card');
 for(const side of ['港幣','人民幣','HKD','CNY'])assert.equal(matched('HSBC HK',`滙豐Pulse銀聯雙幣鑽石卡-${side}`),'hsbc-hk-hk-pulse-dual-currency-diamond',side);
});
// Out of sample: page-style forms of every active bank's public product names. Each must reach its own product
// or stay unrecognised; none may reach a different product.
test('page-style names for every active bank reach their own product or none',()=>{
 const wrong=[],reached={};
 for(const p of cardProducts.filter(p=>ACTIVE_BANKS.includes(p.bank))){
  const entry=names.names[p.id]||{};
  const forms=[`${p.name}®`,`${p.name} ••••1234`,`${p.name} (...1234)`,`${p.name} -1234`,`${p.name}(TM)`,...Object.values(entry),...Object.values(entry).map(n=>`${n}-港幣`),...(p.bank==='HSBC HK'||p.bank==='SC HK'?Object.values(entry).map(n=>`${n} ••••1234`):[])];
  for(const form of forms){const m=matchCardProduct(card(p.bank,form));if(m.status==='matched'){if(m.product.id!==p.id)wrong.push(`${form} -> ${m.product.id}`);else reached[p.bank]=(reached[p.bank]||0)+1;}}
 }
 assert.deepEqual(wrong,[]);
 for(const bank of ACTIVE_BANKS)if(cardProducts.some(p=>p.bank===bank))assert.ok(reached[bank]>0,bank);
});
test('hand-written page names from each active bank',()=>{
 const cases=[
  ['Amex US','American Express® Gold Card ••••12345','amex-us-us-american-express-gold-card'],['Amex US','Blue Cash Everyday® Card','amex-us-us-blue-cash-everyday'],
  ['Amex HK','美國運通Explorer® 信用卡••••12345','amex-hk-hk-american-express-explorer-credit-card'],['Amex HK','美國運通白金卡','amex-hk-hk-the-platinum-card'],
  ['Chase','Sapphire Reserve (...1234)','chase-us-sapphire-reserve'],['HSBC HK','滙豐Red信用卡','hsbc-hk-hk-red-credit-card'],['HSBC HK','HSBC Red Credit Card','hsbc-hk-hk-red-credit-card'],
  ['HSBC HK','滙豐EveryMile信用卡 ••••1234','hsbc-hk-hk-hsbc-everymile-card'],['SC HK','渣打國泰Mastercard','sc-hk-hk-cathay-mastercard'],['SC HK','Standard Chartered Cathay Mastercard® -1234','sc-hk-hk-cathay-mastercard']];
 for(const [bank,name,id] of cases)assert.equal(matched(bank,name),id,`${bank}: ${name}`);
 for(const bank of ['BOA','Citi US']){const p=cardProducts.find(x=>x.bank===bank);assert.equal(matched(bank,`${p.name} - 1234`),p.id,bank);}
 for(const [bank,name] of [['Amex US','Platinum Card®'],['HSBC HK','滙豐 •••• 1234'],['Chase','Chase •••• 1234']])assert.equal(matched(bank,name),null,name);
});
test('a matched card shows its catalogue name in the wallet language; an unmatched one keeps its cleaned name',()=>{
 const pulse=card('HSBC HK','滙豐Pulse銀聯雙幣鑽石卡-港幣'),unknown=card('HSBC HK','Mystery Card ••••1234');
 assert.equal(presentCard(pulse,'zh-TW').name,'滙豐Pulse銀聯雙幣鑽石信用卡');assert.equal(presentCard(pulse,'zh-CN').name,'汇丰Pulse银联双币钻石信用卡');assert.equal(presentCard(pulse,'en-US').name,'HSBC Pulse Dual Currency Card');
 assert.equal(presentCard(pulse,'en-US').pageName,'滙豐Pulse銀聯雙幣鑽石卡','the page name is kept, cleaned');
 for(const l of ['zh-CN','zh-TW','en-US'])assert.equal(presentCard(unknown,l).name,'Mystery Card',l);
 const shown=presentCard(pulse,'en-US');assert.equal(presentCard(shown,'zh-TW').name,'滙豐Pulse銀聯雙幣鑽石信用卡','presenting twice keeps matching from the page name');
 assert.equal(productDisplayName('chase-us-sapphire-reserve','zh-CN'),'Sapphire Reserve','an English-only product falls back to its catalogue name');
 assert.equal(productDisplayName('nope','en-US'),null);
});
test('display names cover every HK product and name real products',()=>{
 const ids=new Set(cardProducts.map(p=>p.id));for(const id of Object.keys(names.names)){assert.ok(ids.has(id),id);for(const l of ['zh-CN','zh-TW','en-US'])assert.ok(names.names[id][l],`${id} ${l}`);}
 const hk=cardProducts.filter(p=>['Amex HK','HSBC HK','SC HK'].includes(p.bank)&&!/classic-corporate|elite-corporate/.test(p.id));
 for(const p of hk)assert.ok(names.names[p.id],p.id);
});
test('stored bank-page names are cleaned, including cards already in the wallet',()=>{
 const merged=mergeWalletCards({cards:[{id:'old',bank:'HSBC HK',region:'HK',currency:'HKD',tail:'1111',name:'滙豐Red信用卡••••1111',identitySource:'bank-page'},{id:'mine',bank:'HSBC HK',region:'HK',currency:'HKD',tail:'2222',name:'My card -2222',identitySource:'manual'}],connections:[]},[{id:'new',bank:'Amex HK',region:'HK',currency:'HKD',tail:'12345',name:'American Express Explorer(TM) Credit Card••••12345',identitySource:'bank-page'}]).cards;
 assert.deepEqual(merged.map(c=>c.name),['滙豐Red信用卡','My card -2222','American Express Explorer Credit Card'],'a name the user typed is left alone');
});
