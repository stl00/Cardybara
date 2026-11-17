// The extension side of Plaid-linked cards (PLAID_PLAN.md): the client sends only the bearer session and an Item id,
// keeps an allow-listed card cache; a Plaid card fills the one wallet card with the same issuer and last four, only with
// non-null fields newer than the card's own; it never invents a wallet card. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaidClient,readPlaidCache,cleanCards,PLAID_CACHE_KEY} from '../src/plaidClient.js';
import {applyPlaid,matchPlaidCards,issuerOf,purchaseApr} from '../src/plaidCards.js';
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
 const wallet=[{id:'w1',bank:'Chase',tail:'1234'},{id:'w2',bank:'Chase',tail:'9999'},{id:'w3',bank:'Amex US',tail:'1234'}];
 assert.deepEqual(matchPlaidCards(wallet,[plaidCard()]).map(([id])=>id),['w1']);
 assert.deepEqual(matchPlaidCards([...wallet,{id:'w4',bank:'Chase',tail:'**1234'}],[plaidCard()]),[],'two Chase cards ending 1234: ambiguous');
 assert.deepEqual(matchPlaidCards(wallet,[plaidCard({institution:'First Platypus Bank'})]),[]);
 assert.equal(purchaseApr(plaidCard()),24.99,'by type, not by position');
 assert.equal(purchaseApr(plaidCard({aprs:[]})),null);
});

test('applyPlaid fills the billing-cycle fields when newer, skips nulls, keeps newer bank reads, adds no card',()=>{
 const wallet={cards:[
  {id:'w1',bank:'Chase',tail:'1234',balance:100,statement:80,minimum:25,due:'2026-10-26',updated:'2026-10-20',fieldDates:{balance:'2026-10-20T00:00:00Z'}},
  {id:'w2',bank:'Citi US',tail:'5555',balance:5,fieldDates:{balance:'2026-11-17T00:00:00Z'}},
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
