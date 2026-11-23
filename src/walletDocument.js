import {WALLET_CARDS_KEY,WALLET_REMOVED_KEY,mergeWalletCards,liftRemoval} from './walletRegistry.js';
import {CARD_EDITS_KEY,readCardEdits,mergeCardEdits} from './cardEdits.js';
import {CARD_PRODUCT_KEY,readCardProductChoices,mergeCardProductChoices} from './cardProductChoice.js';
import {PAYMENT_MARKS_KEY,readPaymentMarks,mergePaymentMarks} from './paymentStates.js';
import {POINT_VALUES_KEY,readPointValueOverrides,storedPointValues,mergePointValues} from './pointValues.js';
import {REMINDER_SETTINGS_KEY,readSettings,normalizeSettings} from './reminders.js';
import {MERGE_DECLINED_KEY,MERGE_STATE_KEY,readDeclined,mergeDeclinedPairs} from './cardMergeFlow.js';
import {validateCostBackup} from './costStore.js';
import {LIVE_KEY} from './live.js';
import {readBankReadings,storeBankReadings,mergeBankReadings,cleanReadings,emptyReadings} from './bankReadings.js';

// The whole wallet as one versioned document: what a backup exports and an import restores.
// The bank snapshot rows (cards, rewards, transactions ...) stay at the top level, as older backups have them, so an
// older build can still read a file written here. Every other section is `{schema:1,...}` and is merged and
// validated by the module that owns it; nothing here copies their rules.
export const WALLET_FORMAT_VERSION=1;
export const FAVORITES_KEY='cardybara-favorites',IMPORT_KEY='cardybara-import';
/** Storage key (localStorage) or database (IndexedDB) -> the document section that carries it. */
export const DOCUMENT_STORAGE={
 [WALLET_CARDS_KEY]:'walletCards',[WALLET_REMOVED_KEY]:'walletCards',
 [MERGE_DECLINED_KEY]:'cardMerges',[CARD_EDITS_KEY]:'cardEdits',[CARD_PRODUCT_KEY]:'cardProducts',[PAYMENT_MARKS_KEY]:'paymentMarks',
 [POINT_VALUES_KEY]:'pointValues',[REMINDER_SETTINGS_KEY]:'reminderSettings',[FAVORITES_KEY]:'favorites',
 [IMPORT_KEY]:'snapshot rows (top level)',
 [LIVE_KEY]:'bankReadings (numeric fields and read times only, bankReadings.js)',
 'cardybara-personal':'personalBenefits (IndexedDB)','cardybara-account-ledger':'costLedger (IndexedDB)',
};
/**
 * Left out on purpose. Each is this device's own state, a cache, a secret or a pointer, and restoring it on another
 * device would be wrong or unsafe. The model key stores are not named here on purpose (only model-client.js may name them) and are never exported. A `cardybara-*` key that is in neither list fails tests/wallet-document.test.mjs.
 */
export const DEVICE_ONLY={
 'cardybara-language':'display language',
 'cardybara-plaid-cards-v1':'cache of the Plaid-linked cards; the gateway holds them for the account and the wallet reads them again',
 'cardybara-plaid-links-v1':'manual Plaid card to wallet card links made on this device; "Add to wallet" makes a synced manual card that matches by issuer and last four everywhere',
 'cardybara-plaid-dismissed-v1':'Plaid cards whose auto-added wallet card was removed on this device; other devices learn of the removal from the synced removal list',
 'cardybara-pet-v1':'pet state',
 'cardybara-home-screen-banner-v1':'whether this Home Screen app already showed its sign-in banner; each browser is its own app',
 'cardybara-auto-sync':'auto-sync switch of this browser',
 'cardybara-reminders-sent-v1':'which reminders this device already showed',
 'cardybara-fee-date-migration-v1':'marker that a one-time migration ran here',
 'cardybara-product-suggestions-v1':'model suggestion cache, asked again when needed',
 'cardybara-product-suggest-auto-v1':'suggestion switch of this browser',
 'cardybara-agent-bank':'assistant tab choice (session only)',
 'cardybara-agent-v1':'assistant conversation of this device',
 'cardybara-agent-session':'assistant session of this device',
 'cardybara-parser-settings':'parser settings of this device',
 'cardybara-state-v2':'collector state of this device',
 'cardybara.webGuideSeen':'first-launch guide seen',
 'cardybara-push-mirror':'reminder plan for this browser\'s service worker (IndexedDB)',
 'cardybara-web-push-v1':'push subscription state of this browser',
 'cardybara-sync-v1':'sync switch, server revision and last synced copy of this device (walletSync.js)',
 'cardybara-card-merge-state-v1':'undo records and sync-cycle counter of card merges (cardMergeFlow.js); an undo lasts one sync cycle on this device',
 'cardybara-account-session-v1':'account session token of this device, never exported',
};
const SECTIONS=['walletCards','cardEdits','cardProducts','paymentMarks','pointValues','reminderSettings','favorites','personalBenefits','costLedger','bankReadings','cardMerges'];
const MAX_FAVORITES=200,MAX_REMOVED=200,MAX_CARDS=40;

// formatVersion 0 is a backup from before the field existed: bank snapshot rows plus some of the sections.
// Add one function per version here (key = the version it upgrades from) and a test with an old fixture.
const MIGRATIONS={0:doc=>({...doc,formatVersion:1})};
const EMPTY={
 walletCards:()=>({cards:[],removed:[]}),cardEdits:()=>({schema:1,edits:[]}),cardProducts:()=>({schema:1,choices:[]}),
 paymentMarks:()=>({schema:1,marks:[]}),pointValues:()=>storedPointValues([]),reminderSettings:()=>normalizeSettings(null),
 favorites:()=>[],personalBenefits:()=>({schema:1,events:[]}),costLedger:()=>({schema:1,events:[]}),bankReadings:emptyReadings,cardMerges:()=>({schema:1,declined:[]}),
};
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);

/** Brings any backup up to the current version, with every section present. Throws `wallet_format_newer` (with `.version`) for a newer file. */
export function migrateWalletDocument(raw){
 if(!plain(raw))throw Error('invalid_wallet_document');
 let doc=raw;const from=raw.formatVersion===undefined?0:raw.formatVersion;
 if(!Number.isInteger(from)||from<0)throw Error('invalid_wallet_document');
 if(from>WALLET_FORMAT_VERSION){const e=Error('wallet_format_newer');e.version=from;throw e;}
 for(let v=from;v<WALLET_FORMAT_VERSION;v++)doc=MIGRATIONS[v](doc);
 const out={...doc};for(const k of SECTIONS)if(out[k]===undefined)out[k]=EMPTY[k]();
 return out;
}
/** True when the file comes from a newer build: the page must not write and should ask for a reload. */
export const isNewerWalletDocument=raw=>plain(raw)&&Number.isInteger(raw.formatVersion)&&raw.formatVersion>WALLET_FORMAT_VERSION;

const sectionKeys=new Set([...SECTIONS,'formatVersion']);
const snapshotOf=doc=>Object.fromEntries(Object.entries(doc).filter(([k])=>!sectionKeys.has(k)));
const hasSnapshot=doc=>Array.isArray(doc.cards);
/** Structure only; the caller may pass `knownCard` to apply the app's own bank and region lists. */
export function validateSnapshot(snap,{knownCard=()=>true}={}){
 for(const k of ['cards','rewards','transactions','offers','benefits','connections'])if(!Array.isArray(snap[k]))throw Error('invalid_snapshot');
 if(snap.cards.some(c=>!c||!c.id||!c.name||!knownCard(c)||(c.art&&!/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|svg)$/.test(c.art))))throw Error('invalid_snapshot_card');
 if(new Set(snap.cards.map(c=>c.id)).size!==snap.cards.length)throw Error('duplicate_card_id');
}
const stringList=(v,max)=>Array.isArray(v)&&v.length<=max&&v.every(x=>typeof x==='string'&&x.length>0&&x.length<=100);
function validateRegistry(w){
 if(!plain(w)||!Array.isArray(w.cards)||!Array.isArray(w.removed)||w.removed.length>MAX_REMOVED||w.cards.length>MAX_CARDS)throw Error('invalid_wallet_cards');
 if(!w.removed.every(r=>plain(r)&&['id','bank','tail'].every(k=>typeof r[k]==='string'&&r[k].length<=100)))throw Error('invalid_wallet_cards');
}
const parse=(storage,key,fallback)=>{try{const v=JSON.parse(storage.getItem(key));return v??fallback}catch{return fallback}};

/**
 * The wallet as a document, built from this device's stores. `snapshot` is the bank snapshot the page shows;
 * without it the stored imported snapshot is used, and without either the document has no snapshot rows.
 */
export async function readWalletDocument({storage,readBenefitEvents,readCostEvents,snapshot}){
 const rows=snapshot??parse(storage,IMPORT_KEY,null);
 const stored=parse(storage,FAVORITES_KEY,[]);
 return {
  ...(plain(rows)?snapshotOf(rows):{}),
  formatVersion:WALLET_FORMAT_VERSION,
  walletCards:{cards:parse(storage,WALLET_CARDS_KEY,[]),removed:parse(storage,WALLET_REMOVED_KEY,[])},
  cardEdits:{schema:1,edits:readCardEdits(storage)},
  cardProducts:{schema:1,choices:readCardProductChoices(storage)},
  paymentMarks:{schema:1,marks:readPaymentMarks(storage)},
  pointValues:storedPointValues(readPointValueOverrides(storage)),
  reminderSettings:readSettings(storage),
  favorites:Array.isArray(stored)?stored.filter(x=>typeof x==='string'):[],
  personalBenefits:{schema:1,events:await readBenefitEvents()},
  costLedger:{schema:1,events:await readCostEvents()},
  bankReadings:readBankReadings(storage),
  cardMerges:{schema:1,declined:readDeclined(storage)},
 };
}

/**
 * Restores a document (any version) into this device's stores, merging with what is there as each module's own
 * merge does. Everything is validated before the first write; a newer file throws `wallet_format_newer` and writes nothing.
 * Returns the migrated document and the snapshot rows, if any.
 */
export async function writeWalletDocument(raw,{storage,importBenefitEvents,importCostEvents,knownCard}){
 const doc=migrateWalletDocument(raw);
 const snap=hasSnapshot(doc)?snapshotOf(doc):null;
 if(snap)validateSnapshot(snap,{knownCard});
 validateRegistry(doc.walletCards);
 if(!stringList(doc.favorites,MAX_FAVORITES))throw Error('invalid_favorites');
 validateCostBackup(doc.costLedger);
 const declined=mergeDeclinedPairs(readDeclined(storage),doc.cardMerges);
 const registry=mergeWalletCards({cards:parse(storage,WALLET_CARDS_KEY,[]),connections:[]},doc.walletCards.cards).cards;
 const edits=mergeCardEdits(readCardEdits(storage),doc.cardEdits);
 const choices=mergeCardProductChoices(readCardProductChoices(storage),doc.cardProducts);
 const marks=mergePaymentMarks(readPaymentMarks(storage),doc.paymentMarks);
 const values=mergePointValues(readPointValueOverrides(storage),doc.pointValues);
 // A backup without this section (an older export) must leave this device's reminders alone.
 const carriesSettings=plain(raw)&&raw.reminderSettings!==undefined;
 const settings=normalizeSettings(doc.reminderSettings);
 const favorites=[...new Set([...parse(storage,FAVORITES_KEY,[]).filter(x=>typeof x==='string'),...doc.favorites])];
 const hidden=parse(storage,WALLET_REMOVED_KEY,[]);
 // Importing a card is asking for it back: a removal of a card the document holds is lifted.
 const removed=liftRemoval([...hidden,...doc.walletCards.removed.filter(r=>!hidden.some(o=>o.id===r.id))],[...doc.walletCards.cards,...(snap?.cards||[])]);
 // The two IndexedDB ledgers validate and write in one transaction each; the small stores follow only if both succeeded.
 await importBenefitEvents(doc.personalBenefits);
 await importCostEvents(doc.costLedger);
 const set=(key,value)=>storage.setItem(key,JSON.stringify(value));
 if(snap)set(IMPORT_KEY,snap);
 set(WALLET_CARDS_KEY,registry);set(WALLET_REMOVED_KEY,removed);set(CARD_EDITS_KEY,edits);set(CARD_PRODUCT_KEY,choices);set(MERGE_DECLINED_KEY,{schema:1,declined});
 set(PAYMENT_MARKS_KEY,marks);set(POINT_VALUES_KEY,storedPointValues(values));if(carriesSettings)set(REMINDER_SETTINGS_KEY,settings);set(FAVORITES_KEY,favorites);
 // Readings a backup carries only add to or update this device's (the later reading of each field wins).
 storeBankReadings(storage,mergeBankReadings(readBankReadings(storage),doc.bankReadings));
 return {doc,snapshot:snap};
}

/**
 * Sync (walletSync.js): makes this device's stores equal to a merged document, deletions included, where an import
 * only adds. Validated as an import is, before the first write. The two event ledgers are unions in a merged
 * document, so adding what is missing makes them equal. Stored snapshot rows are left alone when the document has none.
 */
export async function replaceWalletDocument(raw,{storage,importBenefitEvents,importCostEvents,knownCard}){
 const doc=migrateWalletDocument(raw);
 const snap=hasSnapshot(doc)?snapshotOf(doc):null;
 if(snap)validateSnapshot(snap,{knownCard});
 validateRegistry(doc.walletCards);
 mergeWalletCards({cards:[],connections:[]},doc.walletCards.cards);
 if(!stringList(doc.favorites,MAX_FAVORITES))throw Error('invalid_favorites');
 validateCostBackup(doc.costLedger);
 const edits=mergeCardEdits([],doc.cardEdits),choices=mergeCardProductChoices([],doc.cardProducts);
 const marks=mergePaymentMarks([],doc.paymentMarks),values=mergePointValues([],doc.pointValues);
 const declined=mergeDeclinedPairs([],doc.cardMerges);
 await importBenefitEvents(doc.personalBenefits);
 await importCostEvents(doc.costLedger);
 const set=(key,value)=>storage.setItem(key,JSON.stringify(value));
 if(snap)set(IMPORT_KEY,snap);
 set(WALLET_CARDS_KEY,doc.walletCards.cards);set(WALLET_REMOVED_KEY,doc.walletCards.removed);set(CARD_EDITS_KEY,edits);set(CARD_PRODUCT_KEY,choices);set(MERGE_DECLINED_KEY,{schema:1,declined});
 set(PAYMENT_MARKS_KEY,marks);set(POINT_VALUES_KEY,storedPointValues(values));set(REMINDER_SETTINGS_KEY,normalizeSettings(doc.reminderSettings));set(FAVORITES_KEY,doc.favorites);
 storeBankReadings(storage,cleanReadings(doc.bankReadings),{replace:true});
 return doc;
}

// Import error code -> zh-CN message key (translated by t() in the UI; keys live in src/i18n/app.json).
export const WALLET_IMPORT_ERRORS={
 invalid_snapshot:'请选择 Cardybara · 卡疲扒拉 导出的完整快照',
 invalid_snapshot_card:'卡片信息或图片路径格式不正确',
 duplicate_card_id:'卡片 ID 不能重复',
 invalid_wallet_cards:'备份里的钱包卡片记录格式不正确；这次没有写入任何数据。',
 invalid_favorites:'备份里的收藏列表格式不正确；这次没有写入任何数据。',
 invalid_wallet_document:'备份文件格式不正确；这次没有写入任何数据。',
};
export const walletImportErrorKey=code=>WALLET_IMPORT_ERRORS[code]||null;
