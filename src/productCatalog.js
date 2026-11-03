import catalog from './data/card-products.json' with {type:'json'};
export const cardProducts=catalog.products;
export const normalizeProductName=value=>String(value||'').replace(/[®™℠]/g,'').normalize('NFKC').replace(/\(\s*\.{3}\s*\d{4,5}\s*\)/g,'').replace(/[•*]{2,}\s*\d{4,5}/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
export function matchCardProduct(card,products=cardProducts){
 if(!card?.bank||!card?.region)return {status:'unknown',candidates:[]};
 const scoped=products.filter(p=>p.bank===card.bank&&p.region===card.region);
 const explicit=scoped.find(p=>p.id===card.productId);if(explicit)return {status:'matched',product:explicit,candidates:[explicit.id]};
 const key=normalizeProductName(card.name);if(!key)return {status:'unknown',candidates:[]};
 const matches=scoped.filter(p=>[p.name,...p.aliases].some(a=>normalizeProductName(a)===key));
 return {status:matches.length===1?'matched':matches.length?'ambiguous':'unknown',...(matches.length===1?{product:matches[0]}:{}),candidates:matches.map(p=>p.id)};
}
export function cardPresentation(card){const m=matchCardProduct(card);return {match:m,art:m.product?.art|| (card.art?{file:card.art,verification:'legacy-asset'}:null)};}
