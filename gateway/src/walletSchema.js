// The shape of the wallet document the server accepts (stl00/Cardybara#413, epic #410). The server keeps a readable
// copy of the wallet, so it stores only the wallet and refuses anything else: page evidence, raw bank text, markup.
// The sections follow #411's document (formatVersion 1; #449 aligned the names); each section is checked for its
// container type and every value for JSON-safety, size and forbidden key names. Tighten the items here when #411 lands.
// This file imports nothing, so the Worker bundle and the tests share it.

// Top-level sections of the #411 wallet document (src/walletDocument.js, formatVersion 1): name -> container type.
export const WALLET_SECTIONS={
 walletCards:'object',cardEdits:'object',cardProducts:'object',paymentMarks:'object',pointValues:'object',
 reminderSettings:'object',favorites:'array',personalBenefits:'object',costLedger:'object',
};
// The bank snapshot rows readWalletDocument keeps at the top level (#411). These six are arrays; any other
// snapshot key must be an array or object with a plain name. Scalars at the top level are refused.
export const SNAPSHOT_ARRAYS=['cards','rewards','transactions','offers','benefits','connections'];
const SNAPSHOT_KEY=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
// Key names that carry collected page content rather than wallet data, refused at any depth (case-insensitive).
export const FORBIDDEN_KEYS=['evidence','pageevidence','rawtext','rawbanktext','pagetext','html','dom','screenshot','snippet','banktext','responsebody','cookie','cookies','password','token','accountnumber'];
export const MAX_STRING=4000,MAX_DEPTH=8,MAX_NODES=20000;

const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;

/** Returns true if `doc` fits the schema; otherwise false. Never throws, never echoes the document. */
export function validWalletDocument(doc){
 if(!plain(doc))return false;
 for(const k of Object.keys(doc)){
  const v=doc[k];
  if(k==='formatVersion'){if(!Number.isInteger(v)||v<0)return false;continue;}
  if(Object.hasOwn(WALLET_SECTIONS,k)){
   if(WALLET_SECTIONS[k]==='array'?!Array.isArray(v):!plain(v))return false;
  }else if(SNAPSHOT_ARRAYS.includes(k)){
   if(!Array.isArray(v))return false;
  }else if(!SNAPSHOT_KEY.test(k)||!(Array.isArray(v)||plain(v)))return false;
 }
 let nodes=0;
 const ok=(v,depth)=>{
  if(++nodes>MAX_NODES||depth>MAX_DEPTH)return false;
  if(v===null||typeof v==='boolean')return true;
  if(typeof v==='number')return Number.isFinite(v);
  if(typeof v==='string')return v.length<=MAX_STRING;
  if(Array.isArray(v))return v.every(x=>ok(x,depth+1));
  if(plain(v))return Object.keys(v).every(k=>!FORBIDDEN_KEYS.includes(k.toLowerCase())&&ok(v[k],depth+1));
  return false;
 };
 return ok(doc,0);
}
