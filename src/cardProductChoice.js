import {cardProducts} from './productCatalog.js';
// The card type a user picked for a card the wallet could not recognise. It sets productId only, so the
// product's own art and benefits apply; it never changes the card's name, bank or readings.
export const CARD_PRODUCT_KEY='cardybara-card-products-v1';
const MAX=200;
const validFor=(card,productId,products=cardProducts)=>products.some(p=>p.id===productId&&p.bank===card.bank&&p.region===card.region);
const clean=rows=>Array.isArray(rows)?rows.filter(r=>r&&typeof r.cardId==='string'&&r.cardId.length<=100&&typeof r.productId==='string'&&r.productId.length<=120).slice(-MAX).map(({cardId,productId})=>({cardId,productId})):[];
export function readCardProductChoices(storage){try{return clean(JSON.parse(storage.getItem(CARD_PRODUCT_KEY)));}catch{return []}}
/** productId null clears the choice and goes back to automatic recognition. */
export function withCardProductChoice(choices,card,productId){
 const rest=choices.filter(c=>c.cardId!==card.id);
 if(productId==null)return rest;
 if(!validFor(card,productId))throw Error('invalid_card_product');
 return [...rest,{cardId:card.id,productId}].slice(-MAX);
}
/** A choice that no longer fits its card's bank and region, or names a removed product, is ignored. */
export function applyCardProductChoices(cards,choices,products=cardProducts){
 const byCard=new Map(choices.map(c=>[c.cardId,c.productId]));
 return cards.map(card=>{const id=byCard.get(card.id);return id&&validFor(card,id,products)?{...card,productId:id,productChosen:true}:card;});
}
export function mergeCardProductChoices(choices,backup){
 if(backup?.schema!==1||!Array.isArray(backup.choices)||backup.choices.length>MAX||clean(backup.choices).length!==backup.choices.length)throw Error('invalid_card_product_backup');
 const merged=new Map(choices.map(c=>[c.cardId,c]));for(const c of clean(backup.choices))merged.set(c.cardId,c);return [...merged.values()];
}
