// What a point is worth for a comparison (#193). Each programme has a default from published market valuations,
// which the user can override in settings, like a price they set on an asset. A value the user states in the chat
// wins over both. Values are in cents of the programme's own currency (US cents, HK cents), and a value is only ever
// applied to a card billed in that currency: there is no exchange rate here.
import table from './data/point-valuations.json' with {type:'json'};

export const POINT_VALUES_KEY='cardybara-point-values-v1';
export const POINT_VALUE_BASES=['stated','user','default'];
export const MAX_CENTS=100;
export const valuationTable=table;
const norm=s=>String(s||'').normalize('NFKC').toLowerCase();
const byId=new Map(table.programmes.map(p=>[p.id,p]));
export const valuationProgramme=id=>byId.get(id)||null;

/**
 * The table entry a compared card earns into: by the programme the earning rule names, else by the card's name
 * (a co-brand with no recorded programme), and for a Hong Kong miles card with neither, Asia Miles.
 * The entry must be in the card's region and billing currency, or there is none.
 */
export function valuationFor({programme,card,region,currency,unit}={}){
 const fits=p=>p.region===region&&p.currency===currency;
 // A programme named for another region ("Amex Membership Rewards US" on a HK card) is never this region's.
 const name=norm(programme),cardName=norm(card),tag=name.match(/\s(us|hk|ca)$/)?.[1];
 if(tag&&tag!==String(region).toLowerCase())return null;
 return (name&&table.programmes.find(p=>fits(p)&&p.programmeNames.some(n=>name.includes(n))))
  ||table.programmes.find(p=>fits(p)&&p.cardNames.some(n=>cardName.includes(n)))
  ||(unit==='HKD-per-mile'&&!name&&table.programmes.find(p=>fits(p)&&p.mileCards))
  ||null;
}
const validCents=c=>typeof c==='number'&&Number.isFinite(c)&&c>0&&c<=MAX_CENTS;
const cleanRow=r=>r&&typeof r==='object'&&byId.has(r.id)&&validCents(r.cents)&&typeof r.at==='string'&&Number.isFinite(Date.parse(r.at))?{id:r.id,cents:Math.round(r.cents*10000)/10000,at:r.at}:null;
const clean=rows=>{const out=new Map();for(const r of Array.isArray(rows)?rows:[]){const c=cleanRow(r);if(c)out.set(c.id,c);}return [...out.values()];};
/** A missing or damaged store reads as no overrides; a damaged row or an unknown programme is dropped on its own. */
export function readPointValueOverrides(storage){try{const raw=JSON.parse(storage.getItem(POINT_VALUES_KEY));return clean(raw?.schema===1?raw.values:[]);}catch{return []}}
export const storedPointValues=values=>({schema:1,values});
/** Sets one programme's own value, or clears it with null so the default applies again. A bad value throws. */
export function withPointValue(values,id,cents,at=new Date().toISOString()){
 if(!byId.has(id))throw Error('unknown_programme');
 const rest=values.filter(v=>v.id!==id);
 if(cents==null||cents==='')return rest;
 if(!validCents(cents))throw Error('invalid_point_value');
 return [...rest,{id,cents:Math.round(cents*10000)/10000,at}];
}
/** Backup restore: a malformed file is rejected as a whole; on a conflict the later setting wins. */
export function mergePointValues(values,backup){
 if(backup?.schema!==1||!Array.isArray(backup.values)||backup.values.length>byId.size||backup.values.some(r=>!cleanRow(r)))throw Error('invalid_point_value_backup');
 const merged=new Map(values.map(v=>[v.id,v]));
 for(const r of clean(backup.values))if(!merged.has(r.id)||Date.parse(merged.get(r.id).at)<Date.parse(r.at))merged.set(r.id,r);
 return [...merged.values()];
}
const sourceOf=p=>p.source?{name:p.source.name,url:p.source.url,checkedAt:table.checkedAt}:null;
/**
 * The value used for one programme: the user's setting, else the default, else none (the comparison then stays
 * "depends on your valuation"). The basis always rides along so an answer can say whose number it is.
 */
export function resolvePointValue(entry,overrides=[],{marketDefaults=true}={}){
 if(!entry)return null;
 const own=overrides.find(v=>v.id===entry.id);
 if(own)return {programmeId:entry.id,programme:entry.name,cents:own.cents,currency:entry.currency,unit:entry.unit,basis:'user',...(entry.cents!=null?{defaultCents:entry.cents}:{})};
 if(entry.cents==null||!marketDefaults)return null;
 return {programmeId:entry.id,programme:entry.name,cents:entry.cents,currency:entry.currency,unit:entry.unit,basis:'default',source:sourceOf(entry)};
}
/** The programmes the held cards earn into, for the settings tab: default, source and the user's own value. */
export function walletValuations(cards,overrides=[],earnings=()=>[]){
 const ids=new Set();
 for(const c of cards){
  const named=earnings(c);
  for(const e of named.length?named:[{programme:null,unit:null}]){const p=valuationFor({programme:e.programme,card:c.name,region:c.region,currency:c.currency,unit:e.unit});if(p)ids.add(p.id);}
 }
 return table.programmes.filter(p=>ids.has(p.id)).map(p=>({...p,own:overrides.find(v=>v.id===p.id)?.cents??null}));
}
/**
 * What one rewards reading is worth at the value resolved for its programme. One reading at a time: readings of
 * several cards are never added together here, since pooling needs evidence.
 */
export function readingValue(reading,card,overrides=[],earnings=()=>[]){
 if(!reading||!card||!Number.isFinite(reading.amount)||reading.unit==='USD'||reading.unit==='HKD')return null;
 const named=[{programme:reading.label,unit:null},...earnings(card)];
 for(const e of named){
  const v=resolvePointValue(valuationFor({programme:e.programme,card:card.name,region:card.region,currency:card.currency,unit:e.unit}),overrides);
  if(v)return {value:Math.round(reading.amount*v.cents)/100,currency:v.currency,pointValue:v};
 }
 return null;
}
