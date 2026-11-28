// The Plaid panel (src/PlaidCards.jsx, PLAID_PLAN.md) on an extension page shows each linked card's due date, statement
// balance, minimum, balance, limit and purchase APR from the cached card list; a broken login offers Reconnect; signed
// out it explains, with no Add button. The PWA (no chrome global) shows the same panel to any signed-in account (owner
// 2026-11-17), and its platform goes to the Link page in the same window. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const root=new URL('..',import.meta.url).pathname;

async function renderPanel(globals,props={}){
 const before=Object.fromEntries(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const [k,v] of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});
 try{
  const {outputFiles:[out]}=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {App} from 'antd';import {I18nProvider} from './src/i18n.jsx';import PlaidCards from './src/PlaidCards.jsx';
   export const html=renderToStaticMarkup(React.createElement(I18nProvider,null,React.createElement(App,null,React.createElement(PlaidCards,{gateway:'https://gateway.test',...${JSON.stringify(props)},onAddCard:${props.walletCards?'()=>{}':'undefined'}}))));`,resolveDir:root,loader:'jsx'},
   bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',logLevel:'silent',loader:{'.css':'empty','.svg':'dataurl','.png':'dataurl','.jpg':'dataurl','.webp':'dataurl'}});
  const module={exports:{}};new Function('module','exports','require',out.text)(module,module.exports,createRequire(new URL('../package.json',import.meta.url)));
  return module.exports.html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
 }finally{for(const [k,d] of Object.entries(before))d?Object.defineProperty(globalThis,k,d):delete globalThis[k];}
}
const storage=entries=>{const m=new Map(Object.entries(entries));return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
const chrome={runtime:{id:'x',getURL:p=>'chrome-extension://x/'+p,sendMessage:async()=>({}),onMessage:{addListener(){}}},permissions:{request:async()=>true,contains:async()=>true,remove:async()=>{}},storage:{local:{}},tabs:{create:async()=>({})}};
const CACHE={fetchedAt:1,items:[{itemId:'item_1',institution:'Synthetic Platypus Bank',status:'ok',historicalComplete:true},{itemId:'item_2',institution:'Synthetic Second Bank',status:'login_required',historicalComplete:true}],
 cards:[{itemId:'item_1',accountId:'acc_1',institution:'Synthetic Platypus Bank',name:'Synthetic Credit Card',mask:'3333',currency:'USD',balance:410.5,available:1589.5,limit:2000,
  statementBalance:390.25,statementDate:'2026-11-01',minimumPayment:35,dueDate:'2026-11-26',isOverdue:false,aprs:[{type:'purchase_apr',percentage:24.99}],readAt:1795262400}]};
const SESSION=JSON.stringify({token:'cbs_synthetic',expiresAt:9e9,email:'synthetic.user@example.test'});

test('extension, signed in: due date, statement balance and the other billing fields are shown; a broken login offers Reconnect',async()=>{
 const text=await renderPanel({chrome,location:{protocol:'chrome-extension:',hash:''},localStorage:storage({'cardybara-account-session-v1':SESSION,'cardybara-plaid-cards-v1':JSON.stringify(CACHE)})});
 for(const s of ['已连接的卡','添加信用卡','Synthetic Credit Card ••3333','到期还款日','2026-11-26','账单金额','$390.25','最低还款','$35.00','$410.50','$2,000.00','24.99%','账单日','2026-11-01','重新连接','Synthetic Second Bank 需要重新登录才能继续同步。'])
  assert.ok(text.includes(s),'missing: '+s);
});
test('extension, signed out: an explanation and no Add button',async()=>{
 const text=await renderPanel({chrome,location:{protocol:'chrome-extension:',hash:''},localStorage:storage({})});
 assert.match(text,/在设置里登录卡疲扒拉账号后/);assert.ok(!text.includes('添加信用卡 '));
});
test('web (PWA), signed in: the same panel with due date and statement balance, and the Add button',async()=>{
 const text=await renderPanel({location:{protocol:'https:',hash:'',origin:'https://wallet.example'},localStorage:storage({'cardybara-account-session-v1':SESSION,'cardybara-plaid-cards-v1':JSON.stringify(CACHE)})});
 for(const s of ['已连接的卡','添加信用卡','Synthetic Credit Card ••3333','到期还款日','2026-11-26','账单金额','$390.25'])
  assert.ok(text.includes(s),'missing: '+s);
});
test('web (PWA), signed out: an explanation and no Add button',async()=>{
 const text=await renderPanel({location:{protocol:'https:',hash:'',origin:'https://wallet.example'},localStorage:storage({})});
 assert.match(text,/在设置里登录卡疲扒拉账号后/);assert.ok(!text.includes('添加信用卡 '));
});
test('web platform: Link opens in this same window (a home-screen PWA has no tabs)',async()=>{
 const {web}=await import('../src/platform/web.js');
 const went=[];const before=Object.getOwnPropertyDescriptor(globalThis,'location');
 Object.defineProperty(globalThis,'location',{value:{assign:u=>went.push(u)},configurable:true,writable:true});
 try{web.plaid.open('https://gateway.test/v2/plaid/link#s=x');}finally{before?Object.defineProperty(globalThis,'location',before):delete globalThis.location;}
 assert.deepEqual(went,['https://gateway.test/v2/plaid/link#s=x']);
});

test('PWA: each Plaid card says which wallet card it fills; an unmatched one offers a manual link and Add to wallet',async()=>{
 const cache={...CACHE,items:[{itemId:'item_9',institution:'Chase',status:'ok',historicalComplete:true}],cards:[
  {...CACHE.cards[0],itemId:'item_9',accountId:'acc_a',institution:'Chase',name:'Synthetic Freedom',mask:'1111'},
  {...CACHE.cards[0],itemId:'item_9',accountId:'acc_b',institution:'Chase',name:'Synthetic Sapphire',mask:'2222'}]};
 const walletCards=[{id:'w1',bank:'Chase',currency:'USD',name:'Freedom Unlimited',tail:'1111'},{id:'w2',bank:'Amex US',currency:'USD',name:'Synthetic Gold',tail:'3005'}];
 const text=await renderPanel({location:{protocol:'https:',hash:'',origin:'https://wallet.example'},localStorage:storage({'cardybara-account-session-v1':SESSION,'cardybara-plaid-cards-v1':JSON.stringify(cache)})},
  {walletCards,pairs:[['w1',cache.cards[0]]]});
 assert.ok(text.includes('对应钱包里的卡：Freedom Unlimited ••1111'),text);
 assert.ok(text.includes('还没有对应到钱包里的卡'));assert.ok(text.includes('添加到钱包'));assert.ok(text.includes('对应到钱包里的卡'));
 assert.ok(!text.includes('仅在此处显示'));
});
