import test from 'node:test';
import assert from 'node:assert/strict';
import rules from '../src/data/knowledge/rules.json' with {type:'json'};
import backlog from './fixtures/original-language-backlog.json' with {type:'json'};
import {validateKnowledge,ruleText,sameLanguage} from '../src/knowledge.js';
import {ruleField} from '../src/i18n-core.js';
import {searchBenefitKnowledge} from '../src/benefitSearch.js';
import {runWalletTool} from '../src/walletAgent.js';
import {cardProducts} from '../src/productCatalog.js';

// The newest revision of each published benefit: the one a new or edited rule lands in.
const latest=[...rules.filter(r=>r.kind==='benefit'&&r.status==='published').reduce((m,r)=>(m.get(r.id)?.revision||0)<r.revision?m.set(r.id,r):m,new Map()).values()];
const waiting=new Set(backlog.ruleIds);

test('a benefit rule has its official-language text, unless it is in the shrinking backlog', () => {
 const missing=latest.filter(r=>!r.original&&!waiting.has(r.id)).map(r=>r.id);
 assert.deepEqual(missing,[],'new benefit rules need original text and a quote from the source (#148)');
 // The backlog only shrinks: an ID leaves it when its rule gets an original, and an unknown ID is a typo.
 const ids=new Set(latest.map(r=>r.id));
 assert.deepEqual(backlog.ruleIds.filter(id=>!ids.has(id)),[]);
 assert.deepEqual(latest.filter(r=>r.original&&waiting.has(r.id)).map(r=>r.id),[],'remove migrated rules from the backlog');
 assert.equal(new Set(backlog.ruleIds).size,backlog.ruleIds.length);
});

test('every original has quotes from the sources the rule cites, and the zh-CN text is marked as its translation', () => {
 for(const r of latest.filter(r=>r.original)){
  assert.equal(r.content.translatedFrom,r.original.lang,r.id);
  assert.ok(r.original.quotes.length,r.id);
  for(const q of r.original.quotes)assert.ok(r.evidence.sourceIds.includes(q.sourceId),`${r.id}: ${q.sourceId}`);
  // US cards keep English.
  if(r.market.country==='US')assert.equal(r.original.lang,'en-US',r.id);
 }
 assert.equal(validateKnowledge().valid,true,validateKnowledge().errors.slice(0,5).join('\n'));
});

const base=rules.find(r=>r.id==='rule.chase-us-sapphire-reserve.travel'&&r.original)||rules.find(r=>r.id==='rule.chase-us-sapphire-reserve.travel');
const synthetic=(patch)=>({...structuredClone(base),revisionId:'rule.synthetic.x@2026-11-09.1',id:'rule.synthetic.x',...patch});
const original={lang:'en-US',title:'Synthetic credit',summary:'Synthetic summary.',howToUse:['Synthetic step.'],quotes:[{sourceId:base.evidence.sourceIds[0],text:'A synthetic quote.'}]};
const errorsOf=r=>validateKnowledge([r]).errors.filter(e=>e.includes('original')||e.includes('translat'));

test('validation rejects an original without quotes, a quote from an uncited source, an unmarked translation or a long quote', () => {
 const content={...base.content,translatedFrom:'en-US'};
 assert.deepEqual(errorsOf(synthetic({content,original})),[]);
 assert.ok(errorsOf(synthetic({content,original:{...original,quotes:[]}})).length);
 assert.ok(errorsOf(synthetic({content,original:{...original,quotes:[{sourceId:'not-cited',text:'x'}]}})).length);
 assert.ok(errorsOf(synthetic({content,original:{...original,quotes:[{sourceId:base.evidence.sourceIds[0],text:'x'.repeat(400)}]}})).length);
 assert.ok(errorsOf(synthetic({content:{...base.content,translatedFrom:undefined},original})).length);
 assert.ok(errorsOf(synthetic({content:{...base.content,translatedFrom:'en-US'},original:undefined})).length);
});

test('text is picked in the reader language: same language, then the original, then zh-CN', () => {
 const content={...base.content,translatedFrom:'en-US'};
 const r=synthetic({content,original});
 assert.equal(ruleText(r,'en-US').title,'Synthetic credit');
 assert.equal(ruleText(r,'zh-CN').title,base.content.title);
 assert.equal(ruleText(r,'zh-CN').translated,true);
 assert.equal(ruleText(r,'zh-TW').title,'Synthetic credit','no Traditional text: the original');
 assert.equal(ruleText({...r,translations:{'zh-TW':{title:'繁體',summary:'摘要',howToUse:['步驟']}}},'zh-TW').title,'繁體');
 const hk=synthetic({content:{...base.content,translatedFrom:'zh-HK'},original:{...original,lang:'zh-HK',title:'香港原文'}});
 assert.equal(ruleText(hk,'zh-TW').title,'香港原文','zh-HK serves a zh-TW reader');
 const {translatedFrom,...plain}=base.content;
 assert.equal(ruleText(synthetic({content:plain,original:undefined}),'en-US').title,base.content.title,'no original: zh-CN');
 assert.ok(sameLanguage('zh-HK','zh-TW')&&!sameLanguage('zh-HK','zh-CN')&&sameLanguage('en-US','en'));
 // The wallet: the dictionary is a same-language version, then the original, then zh-CN.
 const item={original:{lang:'en-US',title:'Original title',summary:'Original summary'}};
 assert.equal(ruleField('旅行消费抵扣',item,'title','en-US'),'Original title');
 assert.equal(ruleField('旅行消费抵扣',item,'title','zh-CN'),'旅行消费抵扣');
 assert.equal(ruleField('一段没有译文的说明',item,'summary','zh-TW'),'Original summary');
 assert.equal(ruleField('一段没有译文的说明',{},'summary','en-US'),'一段没有译文的说明');
});

const card=id=>{const p=cardProducts.find(x=>x.id===id);return {id:'t-'+id,productId:id,name:p.name,bank:p.bank,region:p.region,currency:'USD'};};
const migrated=latest.find(r=>r.original&&r.productIds.includes('chase-us-sapphire-reserve'));

test('search reads the original, and the agent gets text in the reader language with the quotes', {skip:!migrated&&'no migrated rule yet'}, () => {
 const cards=[card('chase-us-sapphire-reserve')];
 const found=searchBenefitKnowledge(migrated.original.title,cards,'2026-11-09').rules.map(r=>r.id);
 assert.ok(found.slice(0,3).includes(migrated.id),`${migrated.original.title}: ${found.slice(0,5)}`);
 const call=language=>runWalletTool({id:'c',function:{name:'find_benefits',arguments:JSON.stringify({query:migrated.original.title,cardName:'Sapphire Reserve'})}},{cards,events:[],day:'2026-11-09',language}).rules.find(r=>r.revision===migrated.revisionId);
 const en=call('en-US'),zh=call(undefined);
 assert.equal(en.title,migrated.original.title);assert.equal(en.textLanguage,'en-US');
 assert.deepEqual(en.original.quotes,migrated.original.quotes.map(q=>q.text));
 assert.equal(en.original.title,undefined,'not repeated when the text is the original');
 assert.equal(zh.title,migrated.content.title);assert.equal(zh.textIsTranslation,true);
 assert.equal(zh.original.title,migrated.original.title);
});
