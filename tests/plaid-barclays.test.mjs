// #694: Plaid's Barclays institution is the catalogue's Barclays bank, and cards stored as a generic issuer move to it.
// Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {issuerOf,plaidWalletCard,plaidCardsToAdd,matchPlaidCards} from '../src/plaidCards.js';
import {newWalletCard,mergeWalletCards,WALLET_CARDS_KEY,WALLET_REMOVED_KEY} from '../src/walletRegistry.js';
import {matchCardProduct} from '../src/productCatalog.js';
import {migrateWalletDocument} from '../src/walletDocument.js';
import {migrateLegacyWalletStorage} from '../src/legacyStorage.js';

const plaid=(extra={})=>({itemId:'item_b',accountId:'acc_b',persistentAccountId:'pers_b',institution:'Barclays - Cards',name:'Synthetic Card',officialName:'Barclays JetBlue Plus Card',mask:'4321',currency:'USD',...extra});
const generic=(extra={})=>({id:'g1',bank:'Barclays - Cards',name:'Barclays JetBlue Plus Card',tail:'4321',region:'US',currency:'USD',identitySource:'manual',genericBank:true,...extra});
const moved={id:'g1',bank:'Barclays',name:'Barclays JetBlue Plus Card',tail:'4321',region:'US',currency:'USD',identitySource:'manual'};

test('a synthetic Barclays credit account is added under Barclays and matches a catalogue product',()=>{
 for(const institution of ['Barclays','Barclays - Cards','Barclays (US)','Barclaycard US'])assert.equal(issuerOf(institution),'Barclays',institution);
 for(const institution of ['Barclays (UK)','Barclaycard UK','Barclayville Credit Union','First Barclays Bank'])assert.equal(issuerOf(institution),null,institution);
 const [add]=plaidCardsToAdd({plaidCards:[plaid()]});
 assert.deepEqual(add.spec,{bank:'Barclays',tail:'4321',name:'Barclays JetBlue Plus Card'});
 const card=newWalletCard(add.spec,'n1');
 assert.deepEqual([card.bank,card.region,card.currency,card.genericBank],['Barclays','US','USD',undefined]);
 assert.equal(matchCardProduct(card).product?.id,'barclays-us-jetblue-plus-card');
 assert.deepEqual(matchPlaidCards([card],[plaid()]).map(([id])=>id),['n1']);
});

test('a stored generic Barclays row reads as a Barclays card; other generic cards stay',()=>{
 const other=generic({id:'g2',bank:'Synthetic Platypus Bank',tail:'1111'});
 const wallet=mergeWalletCards({cards:[],connections:[]},[generic(),other]);
 assert.deepEqual(wallet.cards,[moved,other]);
 assert.deepEqual(mergeWalletCards({cards:[generic()],connections:[]},[generic()]).cards,[moved],'a snapshot row moves too, once');
 assert.equal(matchCardProduct(wallet.cards[0]).status,'matched');
 assert.deepEqual(plaidCardsToAdd({walletCards:wallet.cards,plaidCards:[plaid()],pairs:matchPlaidCards(wallet.cards,[plaid()])}),[]);
});

test('a version 2 document migrates its generic Barclays cards, removals and snapshot rows',()=>{
 const removed={id:'g3',bank:'Barclays - Cards',tail:'9999'};
 const old={formatVersion:2,cards:[generic()],walletCards:{cards:[generic()],removed:[removed]}};
 const doc=migrateWalletDocument(old);
 assert.equal(doc.formatVersion,3);
 assert.deepEqual(doc.cards,[moved]);assert.deepEqual(doc.walletCards.cards,[moved]);
 assert.deepEqual(doc.walletCards.removed,[{...removed,bank:'Barclays'}]);
 assert.equal(old.walletCards.cards[0].genericBank,true,'the input is not changed');
 // A removed card stays removed after the move.
 assert.deepEqual(plaidCardsToAdd({plaidCards:[plaid({mask:'9999'})],removed:doc.walletCards.removed}),[]);
});

test('this device\'s own stores move on load, once, and damaged ones are left alone',()=>{
 const m=new Map();let writes=0;
 const storage={getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>{writes++;m.set(k,String(v));}};
 m.set(WALLET_CARDS_KEY,JSON.stringify([generic()]));
 m.set(WALLET_REMOVED_KEY,JSON.stringify([{id:'g3',bank:'Barclays - Cards',tail:'9999'}]));
 m.set('cardybara-import','{bad');
 migrateLegacyWalletStorage(storage);
 assert.deepEqual(JSON.parse(m.get(WALLET_CARDS_KEY)),[moved]);
 assert.equal(JSON.parse(m.get(WALLET_REMOVED_KEY))[0].bank,'Barclays');
 assert.equal(m.get('cardybara-import'),'{bad');
 const before=writes;migrateLegacyWalletStorage(storage);assert.equal(writes,before);
 assert.equal(plaidWalletCard(plaid()).genericBank,undefined);
});
