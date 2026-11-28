import test from 'node:test';
import assert from 'node:assert/strict';
import {runWalletTool,agentTools} from '../src/walletAgent.js';
import {cardProducts} from '../src/productCatalog.js';

const card=id=>{const p=cardProducts.find(x=>x.id===id);return {id:'t-'+id,productId:id,name:p.name,bank:p.bank,region:p.region,currency:'USD'};};
const wallet={cards:['amex-us-us-the-platinum-card','amex-us-us-blue-cash-everyday','chase-us-sapphire-reserve'].map(card),events:[],day:'2026-11-27'};
const find=args=>runWalletTool({id:'c1',function:{name:'find_benefits',arguments:JSON.stringify(args)}},wallet);

test('a foreign transaction fee question gets each held card\'s fee rule, not unrelated credits', () => {
 for(const query of ['外币手续费','Does my Amex charge a foreign transaction fee?','海外刷卡有手续费吗','Platinum 有没有外币交易费','外幣手續費']){
  const r=find({query});
  assert.ok(r.foreignTransactionFees,query);
  const by=Object.fromEntries(r.foreignTransactionFees.cards.map(c=>[c.name,c]));
  assert.equal(by['The Platinum Card'].status,'recorded',query);
  assert.equal(by['The Platinum Card'].rate,0,query);
  assert.equal(by['Blue Cash Everyday'].rate,2.7,query);
  assert.equal(r.rules.length,0,query+': no unrelated benefit rules');
 }
});

test('a card with no fee rule is no-record, never zero', () => {
 const w={...wallet,cards:[...wallet.cards,{id:'manual',name:'My Local Card',bank:'Nowhere',region:'US',currency:'USD'}]};
 const r=runWalletTool({id:'c2',function:{name:'find_benefits',arguments:JSON.stringify({query:'foreign transaction fee'})}},w);
 const local=r.foreignTransactionFees.cards.find(c=>c.name==='My Local Card');
 assert.equal(local.status,'no-record');
 assert.equal('rate' in local,false);
});

test('a question that also asks for other benefits keeps those benefits beside the fees', () => {
 const r=find({query:'出国旅行 lounge 外幣手續費'});
 assert.ok(r.foreignTransactionFees);
 assert.ok(r.rules.some(x=>/lounge|休息室/i.test(x.title+x.summary)));
});

test('other benefit questions are unchanged, and spending abroad is not a fee question', () => {
 assert.equal(find({query:'rental car insurance'}).foreignTransactionFees,undefined);
 assert.equal(find({query:'境外消费返现'}).foreignTransactionFees,undefined);
});

test('get_card_rules says it reads foreign transaction fees', () => {
 const d=agentTools.find(t=>t.function.name==='get_card_rules').function.description;
 assert.match(d,/foreign transaction fee/i);
});
