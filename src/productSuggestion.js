import {cardProducts,matchCardProduct,normalizeProductName,productCore} from './productCatalog.js';
// Model suggestions for cards the catalogue rules could not recognise. A suggestion is never a match: it
// only pre-selects a card type that the user confirms. Each name is asked about once, and the answer,
// including "none", is cached by bank, region and name.
export const SUGGESTION_KEY='cardybara-product-suggestions-v1';
const MAX=300;
export const AUTO_SUGGEST_KEY='cardybara-product-suggest-auto-v1';
/** Masked numbers and any run of digits long enough to be part of a card number never leave the device. */
export function cleanCardName(name){return String(name||'').replace(/[•●*xX]{2,}\s*\d{2,5}/g,' ').replace(/\d{4,}/g,' ').replace(/\s+/g,' ').trim();}
export const suggestionKey=card=>JSON.stringify([card.bank,card.region,normalizeProductName(cleanCardName(card.pageName??card.name))]);
const inScope=(card,id,products=cardProducts)=>products.some(p=>p.id===id&&p.bank===card.bank&&p.region===card.region);
const clean=rows=>Array.isArray(rows)?rows.filter(r=>r&&typeof r.key==='string'&&r.key.length<=400&&(r.productId===null||typeof r.productId==='string')&&typeof r.at==='string').slice(-MAX).map(({key,productId,at})=>({key,productId,at})):[];
export function readSuggestions(storage){try{return clean(JSON.parse(storage.getItem(SUGGESTION_KEY)));}catch{return []}}
export function withSuggestion(rows,card,productId,at=new Date().toISOString()){
 if(productId!==null&&!inScope(card,productId))productId=null;
 const key=suggestionKey(card);return [...rows.filter(r=>r.key!==key),{key,productId,at}].slice(-MAX);
}
/** The suggested product for this card, if one was given and still fits its bank and region. */
export function suggestionFor(card,rows,products=cardProducts){
 const row=rows.find(r=>r.key===suggestionKey(card));
 return row?.productId&&inScope(card,row.productId,products)?products.find(p=>p.id===row.productId):null;
}
/** Only an unrecognised card the user has not set, with a real name that has not been asked about yet. */
export function needsSuggestion(card,rows){
 // Matching and asking both start from what the bank page showed, not the name the wallet displays.
 if(card.productChosen||matchCardProduct({...card,name:card.pageName??card.name,productId:undefined}).status==='matched')return false;
 const words=cleanCardName(card.pageName??card.name);
 // An issuer name alone, such as the fallback "Issuer •••• tail", says nothing about the product.
 if(!productCore(words)||!cardProducts.some(p=>p.bank===card.bank&&p.region===card.region))return false;
 return !rows.some(r=>r.key===suggestionKey(card));
}
export async function requestSuggestion(base,card,fetcher=fetch){
 const r=await fetcher(base+'/api/catalog/suggest-product',{method:'POST',headers:{'Content-Type':'application/json','X-Cardybara-Client':'extension'},body:JSON.stringify({bank:card.bank,region:card.region,name:cleanCardName(card.pageName??card.name)}),signal:AbortSignal.timeout(30000)});
 // A request the server rejects as invalid will be rejected again: answer "none" so it is not sent again.
 if(r.status===400)return null;
 if(!r.ok)throw Error('suggestion_failed');
 const {productId}=await r.json();return typeof productId==='string'&&inScope(card,productId)?productId:null;
}
