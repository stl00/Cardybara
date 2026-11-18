// The extension side of Plaid-linked cards (PLAID_PLAN.md): the client sends only the bearer session and an Item id,
// keeps an allow-listed card cache; a Plaid card fills the one wallet card with the same issuer and last four, only with
// non-null fields newer than the card's own; applyPlaid never invents a wallet card, the auto-add (#535) adds placeable ones. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaidClient,readPlaidCache,cleanCards,PLAID_CACHE_KEY} from '../src/plaidClient.js';
import {applyPlaid,matchPlaidCards,issuerOf,purchaseApr,canTakePlaid,plaidCardKey,withPlaidLink,readPlaidLinks,savePlaidLinks,isManualLink,plaidWalletCard,PLAID_LINKS_KEY} from '../src/plaidCards.js';
import {ACCOUNT_SESSION_KEY} from '../src/walletSync.js';

const GW='https://gateway.test';
const memory=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};};
const READ=Date.parse('2026-11-16T12:00:00Z')/1000;
const plaidCard=(extra={})=>({itemId:'item_1',accountId:'acc_1',institution:'Chase',name:'Synthetic Sapphire',mask:'1234',currency:'USD',balance:410.5,available:1589.5,limit:2000,
 statementBalance:390.25,statementDate:'2026-11-01',minimumPayment:35,dueDate:'2026-11-26',isOverdue:false,aprs:[{type:'cash_apr',percentage:29.99},{type:'purchase_apr',percentage:24.99}],readAt:READ,...extra});

test('the client sends the bearer session, never a Plaid key, and caches only allow-listed card fields',async()=>{
 const storage=memory();storage.setItem(ACCOUNT_SESSION_KEY,JSON.stringify({token:'cbs_synthetic',expiresAt:9e9}));
 const seen=[];
 const fetchFn=async(url,init)=>{seen.push({url,init});
  if(url.endsWith('/v2/plaid/link'))return new Response(JSON.stringify({url:GW+'/v2/plaid/link#s=pls_'+'a'.repeat(43),mode:'new'}),{status:200});
  return new Response(JSON.stringify({items:[{itemId:'item_1',institution:'Chase',status:'ok',accessToken:'access-should-not-be-kept'}],cards:[{...plaidCard(),accessToken:'nope',extra:'dropped'}]}),{status:200});};
 const c=createPlaidClient({gateway:GW,storage,fetchFn,win:null});
 const link=await c.startLink();
 assert.equal(link.ok,true);assert.match(link.url,/^https:\/\/gateway\.test\/v2\/plaid\/link#s=pls_/);
 const r=await c.cards();
 assert.equal(r.ok,true);
 assert.equal(seen[1].init.headers.Authorization,'Bearer cbs_synthetic');
 assert.ok(!JSON.stringify(storage.m.get(PLAID_CACHE_KEY)).includes('access-should-not-be-kept'));
 assert.ok(!storage.m.get(PLAID_CACHE_KEY).includes('nope'));
 assert.equal(readPlaidCache(storage).cards[0].dueDate,'2026-11-26');
 // A link URL that is not the gateway's own Link page is refused.
 const bad=createPlaidClient({gateway:GW,storage,fetchFn:async()=>new Response(JSON.stringify({url:'https://evil.example/#s=x'}),{status:200}),win:null});
 assert.equal((await bad.startLink()).ok,false);
 // Signed out: nothing is sent.
 const out=createPlaidClient({gateway:GW,storage:memory(),fetchFn:()=>{throw Error('no call')},win:null});
 assert.deepEqual(await out.cards(),{ok:false,code:'unauthorized'});
});

test('cleanCards drops malformed dates and APRs without a type or number',()=>{
 const {cards}=cleanCards({cards:[plaidCard({dueDate:'26/11/2026',aprs:[{type:'purchase_apr',percentage:null},{percentage:3}]})]});
 assert.equal(cards[0].dueDate,null);assert.deepEqual(cards[0].aprs,[]);
});

test('issuer matching: known US issuers only; one wallet card per Plaid card; ambiguity fills nothing',()=>{
 assert.equal(issuerOf('Chase'),'Chase');assert.equal(issuerOf('American Express'),'Amex US');assert.equal(issuerOf('Bank of America'),'BOA');assert.equal(issuerOf('Citibank Online'),'Citi US');
 assert.equal(issuerOf('First Platypus Bank'),null);assert.equal(issuerOf(null),null);
 const wallet=[{id:'w1',bank:'Chase',currency:'USD',tail:'1234'},{id:'w2',bank:'Chase',currency:'USD',tail:'9999'},{id:'w3',bank:'Amex US',currency:'USD',tail:'1234'}];
 assert.deepEqual(matchPlaidCards(wallet,[plaidCard()]).map(([id])=>id),['w1']);
 assert.deepEqual(matchPlaidCards([...wallet,{id:'w4',bank:'Chase',currency:'USD',tail:'**1234'}],[plaidCard()]),[],'two Chase cards ending 1234: ambiguous');
 assert.deepEqual(matchPlaidCards(wallet,[plaidCard({institution:'First Platypus Bank'})]),[]);
 assert.equal(purchaseApr(plaidCard()),24.99,'by type, not by position');
 assert.equal(purchaseApr(plaidCard({aprs:[]})),null);
});

test('applyPlaid fills the billing-cycle fields when newer, skips nulls, keeps newer bank reads, adds no card',()=>{
 const wallet={cards:[
  {id:'w1',bank:'Chase',currency:'USD',tail:'1234',balance:100,statement:80,minimum:25,due:'2026-10-26',updated:'2026-10-20',fieldDates:{balance:'2026-10-20T00:00:00Z'}},
  {id:'w2',bank:'Citi US',currency:'USD',tail:'5555',balance:5,fieldDates:{balance:'2026-11-17T00:00:00Z'}},
 ]};
 const out=applyPlaid(wallet,[plaidCard({minimumPayment:null}),plaidCard({itemId:'item_2',accountId:'acc_2',institution:'Citibank',mask:'5555'}),plaidCard({accountId:'acc_3',institution:'First Platypus Bank',mask:'0000'})]);
 assert.equal(out.cards.length,2,'no wallet card is invented');
 const [a,b]=out.cards;
 assert.deepEqual([a.balance,a.statement,a.minimum,a.due,a.creditLimit],[410.5,390.25,25,'2026-11-26',2000],'null minimum keeps the old one');
 assert.deepEqual(a.fieldSources.due,{method:'plaid'});assert.equal(a.fieldDates.due,new Date(READ*1000).toISOString());
 assert.equal(a.plaid.aprs.length,2);
 assert.equal(b.balance,5,'a bank read newer than Plaid wins');assert.equal(b.statement,390.25);
 assert.equal(applyPlaid(wallet,[]),wallet);
});

test('a manual link wins over issuer and last four, survives a re-link (new account_id), and takes one wallet card',()=>{
 const wallet=[{id:'w1',bank:'Chase',currency:'USD',tail:'1234'},{id:'w2',bank:'Chase',currency:'USD',name:'No tail yet'}];
 const p=plaidCard({persistentAccountId:'pers_1'});
 let links=withPlaidLink([],p,'w2');
 assert.deepEqual(matchPlaidCards(wallet,[p],links).map(([id])=>id),['w2'],'the manual link, not the tail match');
 assert.deepEqual(matchPlaidCards(wallet,[{...p,accountId:'acc_new'}],links).map(([id])=>id),['w2'],'account_id changed, persistent id did not');
 assert.ok(isManualLink(links,p,'w2'));assert.ok(!isManualLink(links,p,'w1'));
 // Another Plaid card linked to the same wallet card replaces the first link; removing it falls back to auto matching.
 const other=plaidCard({accountId:'acc_9',mask:'9999',persistentAccountId:'pers_9'});
 links=withPlaidLink(links,other,'w2');
 assert.deepEqual(links.map(l=>l.key),['p:pers_9']);
 assert.deepEqual(matchPlaidCards(wallet,[p,other],links).map(([id,x])=>[id,x.accountId]),[['w2','acc_9'],['w1','acc_1']]);
 assert.deepEqual(withPlaidLink(links,other,null),[]);
 // A link to a card that left the wallet is ignored.
 assert.deepEqual(matchPlaidCards([{id:'w1',bank:'Chase',currency:'USD',tail:'1234'}],[p],withPlaidLink([],p,'gone')).map(([id])=>id),['w1']);
});

test('without a persistent id the key is institution, mask and subtype; a card with no mask cannot be linked',()=>{
 assert.equal(plaidCardKey(plaidCard({institutionId:'ins_x',subtype:'credit card'})),'m|ins_x|1234|credit card');
 assert.equal(plaidCardKey(plaidCard({mask:null})),null);
 assert.throws(()=>withPlaidLink([],plaidCard({mask:null}),'w1'));
});

test('links are stored allow-listed and announced',()=>{
 const storage=memory();let fired=0;const win={dispatchEvent:()=>{fired++;}};
 savePlaidLinks(storage,[{key:'p:a',cardId:'w1'},{key:'p:b',cardId:'bad id!'},{nope:1}],win);
 assert.deepEqual(readPlaidLinks(storage),[{key:'p:a',cardId:'w1'}]);assert.equal(fired,1);
 storage.setItem(PLAID_LINKS_KEY,'not json');assert.deepEqual(readPlaidLinks(storage),[]);
});

test('auto matching reads a bank-read tail too; applyPlaid takes precomputed pairs',()=>{
 const wallet={cards:[{id:'w1',bank:'Chase',currency:'USD',detected:{tail:'1234'},balance:1}]};
 assert.deepEqual(matchPlaidCards(wallet.cards,[plaidCard()]).map(([id])=>id),['w1']);
 const out=applyPlaid({cards:[{id:'w9',bank:'Citi US',currency:'USD',tail:'0000'}]},[plaidCard()],{pairs:[['w9',plaidCard()]]});
 assert.equal(out.cards[0].balance,410.5);assert.deepEqual(out.cards[0].fieldSources.balance,{method:'plaid'});
});

test('Add to wallet: a known issuer and four digits make a manual card spec; the name never carries a long number',()=>{
 assert.deepEqual(plaidWalletCard(plaidCard()),{bank:'Chase',tail:'1234',name:'Synthetic Sapphire'});
 assert.deepEqual(plaidWalletCard(plaidCard({name:'CREDIT CARD 4111 1111 1111 1234',officialName:null})),{bank:'Chase',tail:'1234',name:'CREDIT CARD'});
 assert.deepEqual(plaidWalletCard(plaidCard({name:null,officialName:null})),{bank:'Chase',tail:'1234',name:'Chase 1234'});
 assert.equal(plaidWalletCard(plaidCard({institution:'First Platypus Bank'})),null);
 assert.equal(plaidWalletCard(plaidCard({mask:'12'})),null);
});

test('cleanCards keeps the ids a manual link needs',()=>{
 const {cards}=cleanCards({cards:[plaidCard({persistentAccountId:'pers_1',institutionId:'ins_56',subtype:'credit card'})]});
 assert.equal(cards[0].persistentAccountId,'pers_1');assert.equal(cards[0].institutionId,'ins_56');assert.equal(cards[0].subtype,'credit card');
});

test('a USD Plaid card never fills a card in another currency, by hand or automatically',()=>{
 const p=plaidCard({persistentAccountId:'pers_1'});
 const wallet=[{id:'hk',bank:'HSBC HK',currency:'HKD',tail:'8888'},{id:'us',bank:'Chase',currency:'USD',tail:'0001'}];
 assert.deepEqual(matchPlaidCards(wallet,[p],withPlaidLink([],p,'hk')),[],'a stored link to an HKD card is ignored');
 assert.deepEqual(matchPlaidCards(wallet,[p],withPlaidLink([],p,'us')).map(([id])=>id),['us']);
 assert.equal(canTakePlaid({currency:'CAD'},p),false);assert.equal(canTakePlaid({region:'US'},p),true,'a US card without a currency counts as USD');
 assert.equal(canTakePlaid({},p),false);
 assert.deepEqual(matchPlaidCards([{id:'c',bank:'Chase',currency:'HKD',tail:'1234'}],[p]),[]);
});

test('Add to wallet keeps a five-digit mask, so the bank page reading of the same card merges with it',()=>{
 assert.deepEqual(plaidWalletCard(plaidCard({institution:'American Express',mask:'71001'})),{bank:'Amex US',tail:'71001',name:'Synthetic Sapphire'});
 // A five-digit wallet tail still matches a four-digit Plaid mask by the last four.
 assert.deepEqual(matchPlaidCards([{id:'a',bank:'Amex US',currency:'USD',tail:'71001'}],[plaidCard({institution:'American Express',mask:'1001'})]).map(([id])=>id),['a']);
 assert.equal(plaidWalletCard(plaidCard({currency:'CAD'})),null);
});

test('links keep the newest hundred',()=>{
 const storage=memory();
 savePlaidLinks(storage,Array.from({length:101},(_,i)=>({key:'p:'+i,cardId:'w'+i})),null);
 const kept=readPlaidLinks(storage);assert.equal(kept.length,100);assert.equal(kept.at(-1).key,'p:100');
});

// #535: Plaid cards land in the wallet on their own.
import {plaidCardsToAdd,readPlaidDismissed,setPlaidDismissed,PLAID_DISMISSED_KEY} from '../src/plaidCards.js';
import {newWalletCard,mergeWalletCards,removeWalletCard} from '../src/walletRegistry.js';
import {mergeWalletDocuments} from '../src/walletSync.js';

// One auto-add pass, as main.jsx runs it: match, pick what to add, store it in the registry.
const autoAdd=(registry,plaid,{dismissed=[],removed=[]}={})=>{
 const pairs=matchPlaidCards(registry,plaid);
 const adds=plaidCardsToAdd({walletCards:registry,plaidCards:plaid,pairs,dismissed,removed});
 return {adds,registry:mergeWalletCards({cards:registry},adds.map(a=>newWalletCard(a.spec))).cards};
};
const amex=plaidCard({itemId:'item_2',accountId:'acc_2',institution:'American Express',name:'Synthetic Gold',mask:'71001',persistentAccountId:'pers_2',balance:88});

test('auto-add: two Plaid cards into an empty wallet become two manual cards that applyPlaid fills',()=>{
 const {adds,registry}=autoAdd([],[plaidCard(),amex]);
 assert.deepEqual(adds.map(a=>a.spec),[{bank:'Chase',tail:'1234',name:'Synthetic Sapphire'},{bank:'Amex US',tail:'71001',name:'Synthetic Gold'}]);
 assert.deepEqual(registry.map(c=>[c.bank,c.tail,c.identitySource,c.currency]),[['Chase','1234','manual','USD'],['Amex US','71001','manual','USD']]);
 const out=applyPlaid({cards:registry},[plaidCard(),amex]);
 assert.deepEqual(out.cards.map(c=>c.balance),[410.5,88]);
 assert.deepEqual(out.cards[0].fieldSources.balance,{method:'plaid'});
});

test('auto-add is idempotent: a refresh adds nothing more',()=>{
 const first=autoAdd([],[plaidCard(),amex]);
 const again=autoAdd(first.registry,[plaidCard({balance:500}),{...amex,accountId:'acc_relinked'}]);
 assert.deepEqual(again.adds,[]);assert.equal(again.registry.length,2);
});

test('auto-add: no duplicate of a card with the same bank and last four, whatever its source',()=>{
 const bankRead=[{id:'b1',bank:'Chase',currency:'USD',detected:{tail:'1234'},identitySource:'bank-page'}];
 assert.deepEqual(plaidCardsToAdd({walletCards:bankRead,plaidCards:[plaidCard()],pairs:matchPlaidCards(bankRead,[plaidCard()])}),[]);
 // An other-currency card with those digits fills nothing, and is not duplicated either: the panel's picker is the way.
 const hkd=[{id:'h',bank:'Chase',currency:'HKD',tail:'1234'}];
 assert.deepEqual(plaidCardsToAdd({walletCards:hkd,plaidCards:[plaidCard()],pairs:[]}),[]);
 // Two Plaid cards with one bank and last four in one batch: one card.
 assert.equal(plaidCardsToAdd({plaidCards:[plaidCard(),plaidCard({accountId:'acc_x',persistentAccountId:'pers_x'})]}).length,1);
});

test('auto-add on two devices syncs to one card per bank and tail',()=>{
 const a=autoAdd([],[plaidCard()]).registry,b=autoAdd([],[plaidCard()]).registry;
 assert.notEqual(a[0].id,b[0].id);
 const doc=cards=>({formatVersion:1,walletCards:{cards,removed:[]}});
 const merged=mergeWalletDocuments({base:null,local:doc(a),remote:doc(b),localNewer:true});
 assert.equal(merged.walletCards.cards.length,1);
});

test('a removed auto-added card is not added again, here or on a synced device; adding it by hand forgets the dismissal',()=>{
 const storage=memory();
 const {registry}=autoAdd([],[plaidCard()]);
 // main.jsx records the Plaid card that filled the removed wallet card, and the registry keeps a removal row.
 setPlaidDismissed(storage,plaidCard(),true);
 const gone=removeWalletCard(registry,[],registry[0]);
 assert.deepEqual(readPlaidDismissed(storage),['m|Chase|1234|']);
 assert.deepEqual(autoAdd(gone.registry,[plaidCard()],{dismissed:readPlaidDismissed(storage),removed:gone.removed}).adds,[]);
 // Here: the dismissal alone is enough, even once the removal row is gone.
 assert.deepEqual(autoAdd([],[plaidCard()],{dismissed:readPlaidDismissed(storage)}).adds,[]);
 // Another device knows only the synced removal row.
 assert.deepEqual(autoAdd([],[plaidCard()],{removed:gone.removed}).adds,[]);
 setPlaidDismissed(storage,plaidCard(),false);
 assert.deepEqual(readPlaidDismissed(storage),[]);
 storage.setItem(PLAID_DISMISSED_KEY,'{bad');assert.deepEqual(readPlaidDismissed(storage),[]);
});

test('auto-add leaves out what plaidWalletCard cannot place',()=>{
 const odd=[plaidCard({institution:'First Platypus Bank'}),plaidCard({accountId:'a2',mask:'12'}),plaidCard({accountId:'a3',currency:'CAD'}),plaidCard({accountId:'a4',mask:null})];
 assert.deepEqual(plaidCardsToAdd({plaidCards:odd}),[]);
});
