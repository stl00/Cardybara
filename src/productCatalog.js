import catalog from './data/card-products.json' with {type:'json'};
import extra from './data/card-product-aliases.json' with {type:'json'};
export const cardProducts=catalog.products.map(p=>extra.aliases[p.id]?{...p,aliases:[...p.aliases,...extra.aliases[p.id]]}:p);
export const normalizeProductName=value=>String(value||'').replace(/[®™℠]/g,'').normalize('NFKC').replace(/\(\s*\.{3}\s*\d{4,5}\s*\)/g,'').replace(/[•*]{2,}\s*\d{4,5}/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
// Words a bank page adds around a product name: the issuer, "the", "card" and "credit card", and Chinese equivalents.
// Product words, networks and tiers stay, so "Gold" never meets "Platinum" and a business card never meets a personal one.
const ISSUER=/\b(?:from\s+)?(?:american\s+express|amex|hsbc)\b|滙豐|匯豐|汇丰/giu,FILLER=/\b(?:the|credit\s+card|card)\b|信用卡|卡$/giu;
export function productCore(value){
 const text=String(value||'').replace(/[®™℠]/g,' ').normalize('NFKC').replace(/\(\s*\.{3}\s*\d{4,5}\s*\)/g,' ').replace(/[•*]{2,}\s*\d{4,5}/g,' ').toLowerCase();
 const core=text.replace(ISSUER,' ').replace(/\s+/g,' ').trim().replace(FILLER,' ').replace(/[^\p{L}\p{N}]+/gu,'');
 return core.length>=3?core:'';
}
export function matchCardProduct(card,products=cardProducts){
 if(!card?.bank||!card?.region)return {status:'unknown',candidates:[]};
 const scoped=products.filter(p=>p.bank===card.bank&&p.region===card.region);
 const explicit=scoped.find(p=>p.id===card.productId);if(explicit)return {status:'matched',product:explicit,candidates:[explicit.id]};
 const key=normalizeProductName(card.name);if(!key)return {status:'unknown',candidates:[]};
 let loose=false,matches=scoped.filter(p=>[p.name,...p.aliases].some(a=>normalizeProductName(a)===key));
 // Only when nothing matches exactly: the same product words once issuer and "card" are set aside. A tie stays unresolved,
 // and so does a bare word that other products also contain: "Platinum" could be several Platinum cards.
 const core=productCore(card.name);
 if(!matches.length&&core){
  const cores=p=>[p.name,...p.aliases].map(productCore).filter(Boolean);
  loose=true;matches=scoped.filter(p=>cores(p).includes(core));
  if(matches.length)matches=[...matches,...scoped.filter(p=>!matches.includes(p)&&cores(p).some(c=>c.includes(core)))];
 }
 // A loose tie is still "not recognised"; its candidates only help the user choose.
 return {status:matches.length===1?'matched':matches.length&&!loose?'ambiguous':'unknown',...(matches.length===1?{product:matches[0]}:{}),candidates:matches.map(p=>p.id)};
}
export function cardPresentation(card){const m=matchCardProduct(card);return {match:m,art:m.product?.art|| (card.art?{file:card.art,verification:'legacy-asset'}:null)};}
