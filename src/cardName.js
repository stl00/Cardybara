// What a bank page calls a card is evidence, not a display name. This file turns it into a clean name, and a
// recognised card into its catalogue name in the wallet's language.
import names from './data/card-product-names.json' with {type:'json'};
import {cardProducts} from './productCatalog.js';
const CURRENCY=/\s*[-–—(（]\s*(?:港幣|港币|人民幣|人民币|美元|HKD|CNY|RMB|USD)\s*[)）]?\s*$/iu;
/** Removes the last digits, a currency side, trademark signs and page clutter. Product words stay. */
export function cleanPageName(value){
 // Marks go before NFKC, which would turn ™ and ℠ into the letters "TM" and "SM" glued to the name.
 let s=String(value||'').replace(/[®™℠]/gu,' ').normalize('NFKC');
 s=s.replace(/\((?:tm|r|sm)\)/giu,' ');
 s=s.replace(/\(\s*\.{3}\s*\d{2,5}\s*\)/g,' ').replace(/[•●*·]{2,}\s*\d{2,5}/g,' ').replace(/(?<![\p{L}\p{N}])[xX]{2,}\s*\d{2,5}/gu,' ').replace(/\.{3}\s*\d{4,5}/g,' ');
 s=s.replace(/\b(?:ending(?:\s+in)?|account\s+ending)\s*\d{4,5}\b/giu,' ').replace(/尾[號号]\s*\d{4,5}/gu,' ');
 s=s.replace(/\s*[-–—]\s*\d{4,5}\s*$/u,' ').replace(/\d{9,}/g,' ');
 for(let i=0;i<2;i++)s=s.replace(CURRENCY,' ').replace(/\s+/g,' ').trim();
 return s.replace(/[\s\-–—·•,:;]+$/u,'').replace(/^[\s\-–—·•,:;]+/u,'').trim();
}
const CHINESE={'zh-CN':'zh-TW','zh-TW':'zh-CN'};
/** Catalogue name in the language, falling back as documented in card-product-names.json. */
export function productDisplayName(productId,language='zh-CN'){
 const entry=names.names[productId],product=cardProducts.find(p=>p.id===productId);
 if(!product)return null;
 return entry?.[language]||entry?.[CHINESE[language]]||entry?.['en-US']||product.name;
}
import {matchCardProduct} from './productCatalog.js';
/**
 * A recognised card shows its catalogue name in the wallet's language; anything else shows the cleaned page
 * name. The page name is kept as `pageName`, so matching and suggestions always start from what the bank showed.
 * A name the user typed is theirs: it is never cleaned or replaced.
 */
export function presentCard(card,language){
 if(card.identitySource!=='bank-page')return card;
 const pageName=cleanPageName(card.pageName??card.name)||String(card.pageName??card.name??'');
 const m=matchCardProduct({...card,name:pageName});
 // A name the user set on a bank-page card wins over both; the bank's words stay in pageName.
 const own=card.userSet?.includes('name')?card.name:null;
 return m.status==='matched'?{...card,pageName,productId:m.product.id,name:own??productDisplayName(m.product.id,language)}:{...card,pageName,name:own??pageName};
}
