// Search and grouping for the card-product picker. Pure, so the order and matching are tested without a browser.
import entities from './data/knowledge/entities.json' with {type:'json'};
import {ACTIVE_BANKS} from '../extension-next/providers.js';
import {toSimplified} from './benefitVocabulary.js';
import {MANUAL_BANK_NAMES,bankProfile} from './manualBanks.js';

// The friends beta starts with Chase and Amex US; the other MVP banks follow, US before Hong Kong.
const FIRST=['Chase','Amex US'];
// Manual-only issuers (Bilt) sit with the US banks; they are added by hand and never read.
export const PICKER_BANKS=[...FIRST,...[...ACTIVE_BANKS,...MANUAL_BANK_NAMES].filter(b=>!FIRST.includes(b)).sort((a,b)=>Number(bankProfile(a).region!=='US')-Number(bankProfile(b).region!=='US'))].filter(b=>ACTIVE_BANKS.includes(b)||MANUAL_BANK_NAMES.includes(b));
const bankRank=bank=>{const i=PICKER_BANKS.indexOf(bank);return i<0?PICKER_BANKS.length:i;};

// Names a user may type for an issuer or a region, in the three wallet languages.
const ISSUER_NAMES={Amex:['American Express','Amex','美国运通','美國運通','运通','運通'],Chase:['Chase','大通'],'Bank of America':['Bank of America','BofA','美国银行','美國銀行','美银','美銀'],HSBC:['HSBC','汇丰','滙豐','匯豐'],Citi:['Citi','Citibank','花旗'],'Standard Chartered':['Standard Chartered','SC','渣打'],Bilt:['Bilt']};
const REGION_NAMES={US:['US','USA','United States','美国','美國'],HK:['HK','Hong Kong','香港'],CA:['CA','Canada','加拿大']};
export function bankTerms(bank){
 const p=bankProfile(bank);
 return [...new Set([bank,...(ISSUER_NAMES[p?.issuer]||[p?.issuer].filter(Boolean))])];
}
export const regionTerms=region=>REGION_NAMES[region]||[region];

/** Lower case, full-width folded, traditional Chinese read as simplified, and nothing but letters and digits. */
export const normalizeSearch=value=>toSimplified(String(value||'').replace(/[®™℠]/g,'').normalize('NFKC').toLowerCase()).replace(/[^\p{L}\p{N}]+/gu,'');

const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// A programme whose English name or alias (three letters or more) is a whole word of the product's name is the
// card's co-brand, so its other names, Chinese ones included, find the card: "万豪" finds Marriott Bonvoy cards.
const programmes=entities.programmes.map(g=>{
 const names=[g.name,...(g.aliases||[])];
 return {names,patterns:names.filter(n=>/^[\x20-\x7e]+$/.test(n)&&n.replace(/[^A-Za-z0-9]/g,'').length>=3).map(n=>new RegExp(`(?<![A-Za-z0-9])${escape(n)}(?![A-Za-z0-9])`,'i'))};
});
export function brandTerms(product){
 const text=[product.name,...(product.aliases||[])].join(' | ');
 return [...new Set(programmes.filter(g=>g.patterns.some(re=>re.test(text))).flatMap(g=>g.names))];
}
export const isBusinessProduct=product=>/\b(?:business|corporate)\b/i.test(product.name);

/** One searchable row per product. `label` is the name shown in the wallet's language. */
export function pickerEntries(products,label=p=>p.name){
 return products.map(product=>({
  product,id:product.id,bank:product.bank,region:product.region,label:label(product),business:isBusinessProduct(product),
  fields:[
   ...[label(product),product.name].map(text=>({text,kind:'name'})),
   ...(product.aliases||[]).map(text=>({text,kind:'alias'})),
   ...brandTerms(product).map(text=>({text,kind:'brand'})),
   ...bankTerms(product.bank).map(text=>({text,kind:'bank'})),
   ...regionTerms(product.region).map(text=>({text,kind:'region'})),
  ].map(f=>({...f,key:normalizeSearch(f.text),words:String(f.text).replace(/[®™℠]/g,'').normalize('NFKC').split(/[^\p{L}\p{N}]+/u).map(normalizeSearch).filter(Boolean)})).filter(f=>f.key),
 }));
}

const WEIGHT={name:30,alias:20,brand:10,bank:4,region:4};
// Typing a bank or a region by its exact name ("SC", "美国") ranks its cards above names that merely contain it.
const EXACT_PLACE=90;
// A region matches only as a whole word, so "united" never means "United States". A short Latin query matches the
// start of a name or a word only, so "sc" never matches across "Reward[s C]ard" or "aa" inside "Air Canada Aeroplan".
const short=q=>q.length<=3&&/^[a-z0-9]+$/.test(q);
function fieldScore(f,q){
 if(f.key===q)return f.kind==='bank'||f.kind==='region'?EXACT_PLACE:3*WEIGHT[f.kind];
 if(f.kind==='region')return 0;
 if(f.key.startsWith(q))return 2*WEIGHT[f.kind];
 if(f.words.some(w=>w.startsWith(q)))return 1.5*WEIGHT[f.kind];
 return !short(q)&&f.key.includes(q)?WEIGHT[f.kind]:0;
}
/**
 * How well an entry matches, or 0. The whole query without spaces is tried first ("sapphirereserve" and
 * "Sapphire  Reserve" both find Sapphire Reserve); otherwise every word must appear in some field.
 */
export function scoreEntry(entry,query){
 const q=normalizeSearch(query);if(!q)return 1;
 let best=0;for(const f of entry.fields)best=Math.max(best,fieldScore(f,q));
 if(best)return best;
 const words=String(query).split(/\s+/).map(normalizeSearch).filter(Boolean);
 if(words.length<2)return 0;
 let total=0;
 for(const w of words){let s=0;for(const f of entry.fields)s=Math.max(s,fieldScore(f,w));if(!s)return 0;total+=s;}
 return total/words.length/2;
}
/** The catalogue name, alias or brand that matched when the shown name does not, so the tile can say why it is there. */
export function matchedVia(entry,query){
 const q=normalizeSearch(query);if(!q||normalizeSearch(entry.label).includes(q))return null;
 return entry.fields.find(f=>['name','alias','brand'].includes(f.kind)&&f.text!==entry.label&&fieldScore(f,q)>0)?.text||null;
}

const byName=(a,b)=>Number(a.business)-Number(b.business)||a.label.localeCompare(b.label);
/**
 * Groups by bank. Without a query the groups keep the picker's bank order and each lists personal cards
 * before business ones, by name. With a query only matches remain, best first, and the group holding the
 * best match comes first, so the first tile is always the best match.
 */
export function groupEntries(entries,{query='',bank=null,type='all',pinned=[]}={}){
 const searching=!!normalizeSearch(query),pin=new Set(pinned);
 const rows=entries.filter(e=>(!bank||e.bank===bank)&&(type==='all'||(type==='business')===e.business)).map(e=>({entry:e,score:scoreEntry(e,query)})).filter(r=>r.score>0);
 const groups=new Map();
 for(const r of rows){if(!groups.has(r.entry.bank))groups.set(r.entry.bank,[]);groups.get(r.entry.bank).push(r);}
 const order=(a,b)=>Number(pin.has(b.entry.id))-Number(pin.has(a.entry.id))||(searching?b.score-a.score:0)||byName(a.entry,b.entry);
 return [...groups].map(([bank,items])=>({bank,items:items.sort(order),best:Math.max(...items.map(r=>r.score+(pin.has(r.entry.id)?1000:0)))}))
  .sort((a,b)=>(searching?b.best-a.best:0)||bankRank(a.bank)-bankRank(b.bank)||a.bank.localeCompare(b.bank))
  .map(({bank,items})=>({bank,items:items.map(r=>r.entry)}));
}

/** Character ranges of `text` to highlight for `query`, compared the same way the search compares. */
export function highlightRanges(text,query){
 const source=String(text||''),chars=[],from=[];
 Array.from(source).reduce((at,c)=>{for(const n of normalizeSearch(c)){chars.push(n);from.push([at,at+c.length]);}return at+c.length;},0);
 const flat=chars.join(''),found=[];
 const words=[normalizeSearch(query),...String(query||'').split(/\s+/).map(normalizeSearch)].filter(Boolean);
 for(const w of words){let i=flat.indexOf(w);while(i>=0){found.push([from[i][0],from[i+w.length-1][1]]);i=flat.indexOf(w,i+w.length);}}
 found.sort((a,b)=>a[0]-b[0]);
 return found.reduce((out,r)=>{const last=out.at(-1);if(last&&r[0]<=last[1])last[1]=Math.max(last[1],r[1]);else out.push([...r]);return out;},[]);
}
