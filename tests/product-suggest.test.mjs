import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {suggestProduct,validateSuggestRequest,suggestionMessages,cleanCardName} from '../scripts/product-suggest.mjs';
import {needsSuggestion,suggestionFor,withSuggestion,readSuggestions,requestSuggestion,suggestionKey,SUGGESTION_KEY} from '../src/productSuggestion.js';
import {matchCardProduct} from '../src/productCatalog.js';
import {choicesFromBackup} from '../src/cardProductChoice.js';
const env={DEEPSEEK_API_KEY:'test-key'};
// A scripted model: records what it was sent and answers with fixed content.
const model=content=>{const calls=[];const fetcher=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({choices:[{message:{content}}]})};};return {calls,fetcher};};
const hsbc=name=>({id:'c1',bank:'HSBC HK',region:'HK',currency:'HKD',tail:'4321',name});

test('the model is sent only bank, region, the cleaned card name and that bank\'s catalogue',async()=>{
 const m=model('{"productId":"hsbc-hk-hk-red-credit-card"}');
 const r=await suggestProduct(env,{bank:'HSBC HK',region:'HK',name:'Synthetic Red Plus •••• 4321'},m.fetcher);
 assert.equal(r.productId,'hsbc-hk-hk-red-credit-card');assert.equal(m.calls.length,1);
 const sent=JSON.parse(m.calls[0].body.messages[1].content);
 assert.deepEqual(Object.keys(sent).sort(),['bank','cardName','catalogue','region']);assert.equal(sent.cardName,'Synthetic Red Plus');
 assert.ok(!JSON.stringify(m.calls[0].body).includes('4321'),'no tail');assert.ok(sent.catalogue.every(p=>p.id.startsWith('hsbc-hk-')),'only that bank and region');
 assert.equal(m.calls[0].body.temperature,0);
});
test('an answer outside that bank and region, malformed output or "none" all become null',async()=>{
 for(const content of ['{"productId":"chase-us-sapphire-reserve"}','{"productId":"made-up"}','not json','{"productId":null}','{"productId":42}','{"other":"x"}']){
  assert.equal((await suggestProduct(env,{bank:'HSBC HK',region:'HK',name:'Synthetic Card'},model(content).fetcher)).productId,null,content);
 }
});
test('requests are strict, and nothing is sent without a configured model',async()=>{
 for(const bad of [{bank:'HSBC HK',region:'HK'},{bank:'HSBC HK',region:'HK',name:'x',tail:'1234'},{bank:'Nope',region:'HK',name:'Card'},{bank:'HSBC HK',region:'US',name:'Card'},{bank:'HSBC HK',region:'HK',name:'<b>x</b>'},{bank:'HSBC HK',region:'HK',name:'4000 1234'}])assert.throws(()=>validateSuggestRequest(bad),undefined,JSON.stringify(bad));
 const m=model('{"productId":null}');await assert.rejects(()=>suggestProduct({},{bank:'HSBC HK',region:'HK',name:'Card'},m.fetcher),/model_not_configured/);assert.equal(m.calls.length,0);
 await assert.rejects(()=>suggestProduct({...env,DEEPSEEK_BASE_URL:'https://example.com'},{bank:'HSBC HK',region:'HK',name:'Card'},m.fetcher),/unexpected_model_destination/);
 assert.equal(cleanCardName('Gold 4000123412341234 ••1234'),'Gold');
 assert.match(suggestionMessages({bank:'HSBC HK',region:'HK',name:'x'})[0].content,/untrusted/);
});
test('only unrecognised cards with a real name are asked about, and each name only once',()=>{
 assert.equal(needsSuggestion(hsbc('滙豐Red信用卡'),[]),false,'a recognised card is not sent');
 assert.equal(needsSuggestion(hsbc('HSBC •••• 4321'),[]),false,'a fallback name has nothing to send');
 assert.equal(needsSuggestion({...hsbc('Synthetic Card'),productChosen:true,productId:'hsbc-hk-hk-red-credit-card'},[]),false,'a user choice wins');
 assert.equal(needsSuggestion({...hsbc('Synthetic Card'),bank:'Nope'},[]),false);
 const card=hsbc('Synthetic Card');assert.equal(needsSuggestion(card,[]),true);
 const cached=withSuggestion([],card,null);assert.equal(needsSuggestion(card,cached),false,'"none" is cached too');
 assert.equal(needsSuggestion({...card,id:'c2',tail:'9999'},cached),false,'the same name on another card is not sent again');
 assert.equal(suggestionKey(card),suggestionKey({...card,name:'Synthetic Card®'}));
});
test('a suggestion is never a match until the user confirms it',()=>{
 const card=hsbc('Synthetic Card'),rows=withSuggestion([],card,'hsbc-hk-hk-red-credit-card');
 assert.equal(suggestionFor(card,rows).id,'hsbc-hk-hk-red-credit-card');
 assert.equal(matchCardProduct(card).status,'unknown');assert.equal(card.productId,undefined);
 assert.equal(suggestionFor(card,withSuggestion([],card,'chase-us-sapphire-reserve')),null,'stored out of scope is dropped');
 assert.equal(suggestionFor({...card,region:'US'},rows),null);
});
test('the cache tolerates damage and stays bounded',()=>{
 assert.deepEqual(readSuggestions({getItem:()=>'x'}),[]);assert.deepEqual(readSuggestions({getItem(){throw Error()}}),[]);
 assert.equal(readSuggestions({getItem:k=>k===SUGGESTION_KEY?'[{"key":"a","productId":null,"at":"t"},{"key":1}]':null}).length,1);
 let rows=[];for(let i=0;i<350;i++)rows=withSuggestion(rows,hsbc('Name '+'abcdefghij'[i%10]+i),null);assert.equal(rows.length,300);
});
test('the client sends only bank, region and name, and drops an out-of-scope answer',async()=>{
 const sent=[];const fetcher=async(url,o)=>{sent.push(JSON.parse(o.body));return {ok:true,json:async()=>({productId:'chase-us-sapphire-reserve'})};};
 assert.equal(await requestSuggestion('',hsbc('Synthetic Card'),fetcher),null);assert.deepEqual(Object.keys(sent[0]).sort(),['bank','name','region']);
 await assert.rejects(()=>requestSuggestion('',hsbc('x'),async()=>({ok:false})),/suggestion_failed/);
});
test('suggestion strings exist in three languages',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../src/translations.json',import.meta.url),'utf8'));
 for(const file of ['../src/CardProductPicker.jsx','../src/CardArt.jsx'])for(const [,key] of readFileSync(new URL(file,import.meta.url),'utf8').matchAll(/t\('([^']+)'/g))for(const l of ['en-US','zh-TW'])assert.ok(catalog[l][key],`${l}: ${key}`);
 assert.ok(catalog['en-US']['有 AI 建议的卡种，打开卡片确认']);
});
test('an old backup carries card types over by bank and last digits only',()=>{
 const now=[hsbc('Synthetic Card'),{...hsbc('滙豐Red信用卡'),id:'c2',tail:'1111'},{...hsbc('Other Card'),id:'c3',tail:'2222'},{...hsbc('Third Card'),id:'c4',tail:'3333'}];
 const backup={cards:[{id:'old1',bank:'HSBC HK',region:'HK',tail:'4321',name:'Premier Credit Card',art:'x.png'},{id:'old2',bank:'HSBC HK',region:'HK',tail:'1111',name:'easy Credit Card'},{id:'old3',bank:'HSBC HK',region:'HK',tail:'2222',name:'Some old label',art:'y.png'},{id:'old4',bank:'Amex US',region:'US',tail:'3333',name:'American Express Gold Card'}],balances:'ignored'};
 const {choices,added}=choicesFromBackup([],now,backup);
 assert.deepEqual(added,[{cardId:'c1',productId:'hsbc-hk-hk-premier-credit-card'}],'only an unrecognised card with a recognised backup twin on the same bank');
 assert.deepEqual(choicesFromBackup(choices,now,backup).added,[],'an existing choice is kept');
 assert.throws(()=>choicesFromBackup([],now,{nope:1}),/invalid_backup/);
});
