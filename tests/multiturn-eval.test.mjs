// The multi-turn reference eval is only as good as its matcher: these pin what counts as the referent being present.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvable,strictTarget,cardMentioned,checkLabels,replay,contextSources} from '../evals/multiturn/harness.mjs';
import {dialogues} from '../evals/multiturn/dialogues.mjs';

const HK='amex-hk-hk-the-platinum-card',US='amex-us-us-the-platinum-card',CA='amex-ca-ca-platinum-card',GOLD='amex-us-us-american-express-gold-card',MS='amex-us-us-morgan-stanley-platinum-card';

test('a name shared across regions identifies a card only next to its region',()=>{
 assert.equal(cardMentioned('香港 The Platinum Card 的酒店礼遇',HK),true);
 assert.equal(cardMentioned('香港 The Platinum Card 的酒店礼遇',US),false);
 assert.equal(cardMentioned('The Platinum Card 的酒店礼遇',HK),false);
 assert.equal(cardMentioned('The Platinum Card 的酒店礼遇',HK,true),true,'the question can give the region');
 assert.equal(cardMentioned('{"card":"The Platinum Card","region":"HK"}',HK),true);
});

test('a shorter name inside a longer held name is not a mention of another card',()=>{
 assert.equal(cardMentioned('香港 The Platinum Card',CA),false,'"Platinum Card" inside "The Platinum Card"');
 assert.equal(cardMentioned('加拿大 Platinum Card',CA),true);
 assert.equal(cardMentioned('Morgan Stanley 白金卡，香港',HK),false);
 assert.equal(cardMentioned('香港白金卡的 Platinum Vacation Credits',HK),true);
 assert.equal(cardMentioned('Platinum Vacation Credits，香港',HK),false);
});

test('美国运通 is the issuer, not the US region; 加拿大航空 is an airline',()=>{
 assert.equal(cardMentioned('美国运通白金卡',US),false);
 assert.equal(cardMentioned('加拿大航空休息室，白金卡',CA),false);
 assert.equal(cardMentioned('加拿大美国运通白金卡',CA),true);
});

test('look-alike words are not cards or regions',()=>{
 assert.equal(cardMentioned('Amex Platinum, plus Air Canada lounges',CA),false,'Air Canada is an airline');
 assert.equal(cardMentioned('ca. Platinum',CA),false);
 for(const ms of ['Morgan Stanley白金卡','Morgan Stanley  白金卡','大摩白金卡','MS Platinum'])assert.equal(cardMentioned(ms,HK,true),false,ms);
 assert.equal(cardMentioned('Marriott Gold card status',GOLD),false);
 assert.equal(cardMentioned('Hilton Gold 卡级会籍',GOLD),false);
 assert.equal(cardMentioned('{"card":"Gold Card","region":"US"},{"card":"Platinum Card","region":"CA"}',CA),true,'a region across a brace belongs to another record');
});

test('tool-ready accepts a wording the tool finds the record by, not one it misses',()=>{
 const byId=id=>dialogues.find(d=>d.id===id);
 assert.ok(strictTarget(byId('ord-sr-lounge-1-en')).ordinal.list[0].includes('Air Canada'));
 // The benefit search finds 年度免房晚 by "annual free night", but not 消费解锁免房晚 by "unlocked by spending".
 assert.ok(strictTarget(byId('ord-aspire-2-en')).ordinal.list[1].includes('annual free night'));
 assert.ok(!strictTarget(byId('ord-aspire-2-en')).ordinal.list[0].includes('unlocked by spending'));
});

test('tool-ready needs the form a tool argument can use as it stands',()=>{
 const target={card:GOLD,ordinal:{index:2,list:[['每月餐饮抵扣','Monthly dining'],['Resy 餐饮抵扣','Resy']]}};
 assert.deepEqual(resolvable(target,['Amex Gold: 1. Monthly dining credit 2. Resy credit']),{resolvable:true,missing:[]});
 assert.deepEqual(resolvable(target,['Amex Gold: 1. Monthly dining credit 2. Resy credit'],{strict:true}),{resolvable:false,missing:['card','order']});
 assert.equal(resolvable(target,['American Express Gold Card：1. 每月餐饮抵扣 2. Resy 餐饮抵扣'],{strict:true}).resolvable,true);
 assert.equal(resolvable({card:MS},['摩根士丹利白金卡'],{strict:true}).resolvable,false);
 assert.equal(resolvable({card:MS},['Morgan Stanley 白金卡'],{strict:true}).resolvable,true);
});

test('order is read from one source, in the listed order',()=>{
 const ordinal={index:2,list:[['A item'],['B item']]};
 assert.equal(resolvable({ordinal},['A item then B item']).resolvable,true);
 assert.equal(resolvable({ordinal},['B item then A item']).resolvable,false);
 assert.equal(resolvable({ordinal},['A item','B item']).resolvable,false);
});

test('every dialogue is labelled consistently with the tools',()=>{
 assert.ok(dialogues.length>=40&&dialogues.length<=80);
 assert.equal(new Set(dialogues.map(d=>d.id)).size,dialogues.length);
 for(const lang of ['zh-Hans','zh-Hant','en'])assert.ok(dialogues.some(d=>d.lang===lang));
 for(const kind of ['pronoun','ordinal','ellipsis','topic-return','long-range','same-name'])assert.ok(dialogues.filter(d=>d.kind===kind).length>=5,kind);
 for(const d of dialogues)assert.deepEqual(checkLabels(d),[],d.id);
 for(const d of dialogues.filter(d=>d.kind==='long-range'))assert.ok(d.turns.length>6,d.id);
});

test('the replay captures exactly what the model would receive, without the last answer',async()=>{
 const d=dialogues.find(x=>x.id==='ord-sr-lounge-2-hans'),{sent,fixtureIssues}=await replay(d);
 assert.deepEqual(fixtureIssues,[]);
 assert.equal(sent.messages.at(-1).role,'user');assert.equal(sent.messages.at(-1).content,d.question);
 assert.ok(!sent.messages.some(m=>m.role==='tool'),'old tool results are not replayed');
 assert.ok(contextSources(sent).some(s=>s.includes('Priority Pass')));
});
