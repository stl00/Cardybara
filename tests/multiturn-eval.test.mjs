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
 // The benefit search finds 年度免房晚 by "annual free night", and, since the rule has its English original
 // ("Free Night Reward from spending", #148), 消费解锁免房晚 by "unlocked by spending" too.
 assert.ok(strictTarget(byId('ord-aspire-2-en')).ordinal.list[1].includes('annual free night'));
 assert.ok(strictTarget(byId('ord-aspire-2-en')).ordinal.list[0].includes('unlocked by spending'));
 // A wording the search can never find is dropped.
 const d=structuredClone(byId('ord-aspire-2-en'));d.target.ordinal.list[0]=['消费解锁免房晚','zqxv blorf wug'];
 assert.deepEqual(strictTarget(d).ordinal.list[0],['消费解锁免房晚']);
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

// ---- live scoring and spend control (evals/multiturn/live.mjs); no network ----
import {interleaved,argumentsMatch,targetProgramme,resolvesCard,meter,priceFor,PRICES} from '../evals/multiturn/live.mjs';

test('live order covers every kind in the first few dialogues',()=>{
 const kinds=[...new Set(dialogues.map(d=>d.kind))];
 assert.deepEqual(interleaved(dialogues).slice(0,kinds.length).map(d=>d.kind),kinds);
 assert.equal(interleaved(dialogues).length,dialogues.length);
});

test('a programme argument passes only if it reaches the expected programme',()=>{
 const expect={tool:'get_card_rules',args:{kind:'transfer-relationship',cardName:'Gold Card',programme:'ANA'}};
 const call=programme=>({name:'get_card_rules',args:{kind:'transfer-relationship',cardName:'Gold Card',programme}});
 assert.equal(targetProgramme('ANA'),'ANA Mileage Club');
 assert.equal(argumentsMatch(expect,call('ANA')),true);
 assert.equal(argumentsMatch(expect,call('Aeroplan')),false,'Air Canada Aeroplan contains "ana" but is not ANA');
 assert.equal(argumentsMatch({tool:'get_card_rules',args:{kind:'transfer-relationship',programme:'Asia Miles'}},{name:'get_card_rules',args:{kind:'transfer-relationship',programme:'Cathay'}}),true);
 assert.equal(argumentsMatch(expect,call('')),false);
});

test('the referent check is n/a when the referent is not a card',()=>{
 const noCard=dialogues.find(d=>!d.target.card),card=dialogues.find(d=>d.target.card);
 assert.equal(resolvesCard(noCard,[]),null);
 assert.equal(resolvesCard(card,[]),false);
 assert.equal(resolvesCard(card,[{name:card.expect.tool,args:card.expect.args}]),true);
});

test('spend: unknown models have no price, and calls without usage are charged their worst case',()=>{
 assert.throws(()=>priceFor('some-new-model'),/no price/);
 assert.equal(priceFor('deepseek-v4-flash'),PRICES['deepseek-flash']);
 const m=meter({price:PRICES['deepseek-flash'],budget:0.1});
 assert.ok(m.canStartDialogue());
 // A run whose calls never report usage still stops.
 let dialoguesRun=0;while(m.canStartDialogue()&&dialoguesRun<1000){for(let i=0;i<3;i++)m.unmetered();dialoguesRun++;}
 assert.ok(dialoguesRun<1000&&m.spent()<=0.1,'stopped within budget');
 // Metered calls are charged what they report.
 const n=meter({price:PRICES['deepseek-flash'],budget:1});
 n.record({prompt_tokens:10000,prompt_cache_hit_tokens:8000,prompt_cache_miss_tokens:2000,completion_tokens:500});
 assert.equal(+n.spent().toFixed(6),+((8000*0.006+2000*0.3+500*1.2)/1e6).toFixed(6));
});

test('long-range "the second one from the first list" keeps the first list once its turns are trimmed (#267)',async()=>{
 for(const lang of ['zh-Hans','zh-Hant','en']){
  const d=dialogues.find(x=>x.id==='long-sr-ord-'+lang),{sent,memory}=await replay(d);
  assert.ok(sent.messages.filter(m=>m.role==='user').length-1<d.turns.length,'the opening turn is trimmed from the chat');
  assert.equal(memory.topics.earlier[0].turn,0,'the list from the first turn is kept in state');
  const r=resolvable(d.target,contextSources(sent));
  assert.deepEqual(r.missing,[],lang);
  assert.match(contextSources(sent)[0],/earlierLists/);
 }
});

// ---- live run 2026-11-16 failures (#357) ----
import {runWalletTool} from '../src/walletAgent.js';
import {answerGrounding,separateLinks,statedOrdinals} from '../src/answerGrounding.js';
import {SYSTEM} from '../src/chatProtocol.js';
import {evalContext} from '../evals/multiturn/harness.mjs';
const tool=(name,args)=>runWalletTool({id:'t',type:'function',function:{name,arguments:JSON.stringify(args)}},evalContext);
const byId=id=>dialogues.find(d=>d.id===id);
// A scripted model: the expected call, then the given answer. Replays the real loop, tools and answer checks.
const scripted=(d,answer,calls=[[d.expect.tool,d.expect.args]])=>{let step=0;return async()=>{const c=calls[step++];return {message:c?{role:'assistant',content:'',tool_calls:[{id:'s'+step,type:'function',function:{name:c[0],arguments:JSON.stringify(c[1])}}]}:{role:'assistant',content:answer}};};};
const HK_PAGE='https://www.americanexpress.com/hk/en/credit-cards/platinum-card/';

test('transfer questions on US and HK cards expect convert_points, the tool the assistant is told to use (#170, #357)',()=>{
 for(const id of ['pron-gold-transfer-en','ell-amex-transfer-en','long-gold-hant','same-asia-miles-hk-hans'])assert.equal(byId(id).expect.tool,'convert_points',id);
 assert.match(SYSTEM,/convert_points for where points can transfer/);
 const expect=byId('pron-gold-transfer-en').expect,call=partner=>({name:'convert_points',args:{cardName:'Amex Gold',partner}});
 assert.equal(argumentsMatch(expect,{name:'convert_points',args:{cardName:'Gold Card',partner:'Asia Miles'}}),true);
 assert.equal(argumentsMatch(expect,{name:'convert_points',args:{cardName:'Gold Card',partner:'Cathay'}}),true,'an alias that reaches Cathay Asia Miles');
 assert.equal(argumentsMatch(expect,{name:'convert_points',args:{cardName:'Gold Card',partner:'Aeroplan'}}),false);
 assert.equal(argumentsMatch(expect,{name:'convert_points',args:{cardName:'Gold Card'}}),false,'the named partner is required');
 assert.equal(argumentsMatch(expect,call('Asia Miles')),false,'"Amex Gold" is not a cardName the tool can select');
 assert.equal(argumentsMatch(byId('long-gold-hant').expect,{name:'convert_points',args:{cardName:'Gold Card',partner:'Aeroplan'}}),false,'Air Canada Aeroplan is not ANA');
 assert.equal(argumentsMatch(expect,{name:'get_card_rules',args:{kind:'transfer-relationship',cardName:'Gold Card',programme:'Asia Miles'}}),false);
});

test('Amex CA transfers: convert_points has no rate rule, so it points to the recorded relationships (#357)',()=>{
 const ca=tool('convert_points',{cardName:'Platinum Card',region:'CA',partner:'Hilton'});
 assert.deepEqual(ca.transferRelationshipHint.cards,[{name:'Platinum Card',region:'CA'}]);
 assert.match(ca.transferRelationshipHint.note,/get_card_rules with kind transfer-relationship/);
 assert.equal(ca.withoutRecordNote,undefined,'"no transfer record" would be wrong for this card');
 assert.equal(ca.partnerNote,undefined);
 // Only a relationship to the partner asked about counts.
 const mars=tool('convert_points',{cardName:'Platinum Card',region:'CA',partner:'Mars Miles'});
 assert.equal(mars.transferRelationshipHint,undefined);assert.ok(mars.partnerNote);
 assert.ok(tool('get_card_rules',{kind:'transfer-relationship',cardName:'Platinum Card',region:'CA',programme:'Hilton'}).totalMatches>0);
 // Cards with no relationship either keep the plain note; cards with rate rules get no hint.
 const all=tool('convert_points',{});
 assert.deepEqual(all.transferRelationshipHint.cards,[{name:'Platinum Card',region:'CA'}]);
 assert.match(all.withoutRecordNote,/No transfer rule lists these cards/);
 assert.equal(tool('convert_points',{cardName:'Gold Card',partner:'Asia Miles'}).transferRelationshipHint,undefined);
 for(const id of ['pron-caplat-hilton-hans','long-caplat-hans','ell-transfer-ca-hans','ord-caplat-6-hans'])assert.equal(byId(id).expect.tool,'get_card_rules',id);
 assert.match(SYSTEM,/if it returns transferRelationshipHint, call get_card_rules/);
});

test('"that card" after a recommendation is the recommended card (#202 changed the pick, #357)',()=>{
 const d=byId('pron-choice-card-fee-en'),[name,args]=d.turns[0].calls[0];
 assert.equal(tool(name,args).choice.card,'American Express Gold Card');
 assert.equal(d.expect.args.cardName,'Gold Card');
 assert.equal(d.target.card,GOLD);
});

test('"the card I asked about first" is the first recentCards entry even when its turns are trimmed (#357)',async()=>{
 const {sent}=await replay(byId('long-sr-fee-en'));
 assert.match(contextSources(sent)[0],/"recentCards":\[\{"card":"Sapphire Reserve","region":"US","firstTurn":1,"lastTurn":1,"onlyInDroppedTurns":true\}/);
 assert.match(SYSTEM+sent.messages[0].content,/"the card I asked about first" or "the one from the start" is the recentCards entry with the lowest firstTurn, even when it is onlyInDroppedTurns/);
});

test('a source link written straight before Chinese punctuation is the same grounded link (#357)',async()=>{
 assert.equal(separateLinks(`來源：${HK_PAGE}）`),`來源：${HK_PAGE} ）`);
 assert.equal(separateLinks(`[來源](${HK_PAGE})。`),`[來源](${HK_PAGE})。`,'a markdown link already ends at its bracket');
 assert.equal(separateLinks('see https://example.com/a?b=1 now'),'see https://example.com/a?b=1 now');
 for(const [id,answer] of [
  ['pron-hkplat-lounge-hant',`有，香港白金卡有 Global Lounge Collection，入場同攜客條件以條款為準（來源：${HK_PAGE}）`],
  ['same-marriott-hk-hant',`香港白金卡嘅 Marriott Gold 會籍要登記，詳情：${HK_PAGE}。以官方條款為準`],
 ]){
  const d=byId(id),{finalResult}=await replay(d,{finalRequest:scripted(d,answer)});
  assert.ok(!finalResult.trace.some(t=>t.type==='repair'),id+': grounded on the first answer');
  assert.match(finalResult.answer,new RegExp(HK_PAGE.replace(/[.?/]/g,'\\$&')+' [）。]'),id);
 }
 // A link no tool returned is still not grounded, however it is punctuated.
 const d=byId('pron-hkplat-lounge-hant');
 await assert.rejects(()=>replay(d,{finalRequest:scripted(d,'來源：https://invented.example/hk）')}),/answer_not_grounded/);
 assert.equal(answerGrounding('來源：https://www.americanexpress.com/hk/en/credit-cards/platinum-card/evil）',[tool(d.expect.tool,d.expect.args)]).passed,false);
});

test('an ordinal the user said in words may be echoed as a digit, and only that one (#357)',async()=>{
 assert.deepEqual(statedOrdinals('第四個點登記？'),[4]);
 assert.deepEqual(statedOrdinals('第十一个呢，第二十三个呢'),[11,23]);
 assert.deepEqual(statedOrdinals('How do I use the second one from the very first list?'),[2,1]);
 assert.deepEqual(statedOrdinals('三百美元够吗'),[]);
 const d=byId('ord-hkplat-4-hant'),{finalResult}=await replay(d,{finalRequest:scripted(d,'第4項係 Radisson Premium 會籍：要先登記並關聯 Radisson 賬戶，以條款為準。')});
 assert.ok(!finalResult.trace.some(t=>t.type==='repair'));
 await assert.rejects(()=>replay(d,{finalRequest:scripted(d,'第5項係 Radisson Premium 會籍，要先登記。')}),/answer_not_grounded/,'a position the user did not say is not grounded');
});

// ---- follow-ups of find_protections, plan_flight and points_accounts (#482) ----
test('coverage, trip and pooling follow-ups: two or three dialogues each, in at least two languages, ending in the tool they test',()=>{
 const tools={'coverage-followup':'find_protections','trip-followup':'plan_flight','pooling-followup':'points_accounts'};
 for(const [kind,toolName] of Object.entries(tools)){
  const group=dialogues.filter(d=>d.kind===kind);
  assert.ok(group.length>=2&&group.length<=3,kind);
  assert.ok(new Set(group.map(d=>d.lang)).size>=2,kind+' languages');
  for(const d of group){
   assert.equal(d.expect.tool,toolName,d.id);
   assert.ok(d.turns.at(-1).calls.some(([name])=>name===toolName),d.id+': the scripted first answer comes from the same tool');
  }
 }
 assert.ok(interleaved(dialogues).slice(0,[...new Set(dialogues.map(d=>d.kind))].length).some(d=>d.kind==='trip-followup'),'the weekly live run reaches the new kinds in its first dialogues');
});

test('the new follow-ups replay through the real agent loop with grounded scripted answers',async()=>{
 for(const d of dialogues.filter(d=>/followup$/.test(d.kind))){
  const {fixtureIssues,sent}=await replay(d);
  assert.deepEqual(fixtureIssues,[],d.id);
  assert.equal(sent.messages.at(-1).content,d.question,d.id);
 }
});

test('a wrong expected tool or argument in a new dialogue fails the label check (negative control)',()=>{
 const good=byId('trip-points-hant');
 assert.deepEqual(checkLabels(good),[]);
 const wrongTool=structuredClone(good);wrongTool.expect.tool='find_protections';
 assert.notDeepEqual(checkLabels(wrongTool),[],'a tool that does not fit the question');
 const badArgs=structuredClone(byId('cov-ordinal-en'));badArgs.expect.args={type:'rental-car',cardName:'No Such Card'};
 assert.notDeepEqual(checkLabels(badArgs),[],'a card name that selects nothing');
 const noPath=structuredClone(good);noPath.expect.args={airline:'Delta',route:'JFK',milesNeeded:75000,points:80000};
 assert.notDeepEqual(checkLabels(noPath),[],'an airline no held card reaches');
});

test('live scoring of plan_flight: the airline by name or alias, route and dates as the user said them, numbers as stated',()=>{
 const expect=byId('trip-points-hant').expect,call=args=>({name:'plan_flight',args});
 assert.equal(argumentsMatch(expect,call({airline:'ANA',route:'JFK to Tokyo',milesNeeded:75000,points:80000})),true);
 assert.equal(argumentsMatch(expect,call({airline:'全日空 ANA',route:'JFK 飛東京',milesNeeded:75000,points:80000})),false,'an alias the knowledge does not hold');
 assert.equal(argumentsMatch(expect,call({airline:'ANA',route:'JFK 飛東京',milesNeeded:75000,points:60000})),false,'the old points');
 assert.equal(argumentsMatch(expect,call({airline:'Air Canada',route:'JFK 飛東京',milesNeeded:75000,points:80000})),false,'another airline');
 assert.equal(argumentsMatch(expect,call({airline:'ANA',route:'',milesNeeded:75000,points:80000})),false,'no route');
 assert.equal(argumentsMatch(byId('trip-airline-en').expect,{name:'plan_flight',args:{airline:'Air Canada',route:'NYC to Tokyo',when:'Dec'}}),true);
 assert.equal(argumentsMatch(byId('trip-airline-en').expect,{name:'plan_flight',args:{airline:'Air Canada',route:'JFK to Tokyo'}}),false,'the dates are dropped');
});
