// #222: the chooser draws what the engine decided — the winner as the hero, at most two runner-ups, caveats folded.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {referenceCards} from '../evals/fixtures.mjs';
import {quickChoice,effectivePercent} from '../src/purchaseChoice.js';
const root=new URL('..',import.meta.url).pathname,DAY='2026-11-05';
// Synthetic public products only, billed in USD like the beta's Chase and Amex US wallets.
const cards=referenceCards.filter(c=>c.currency==='USD');
const wallet={cards,events:[],day:DAY,marketDefaults:true};
let mod;
async function load(){
 if(mod)return mod;
 const {outputFiles:[bundle]}=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import PurchaseChooser,{ChoiceResult} from './src/PurchaseChooser.jsx';import {activateLanguage} from './src/i18n-core.js';
export const result=(props,lang='zh-CN')=>{activateLanguage(lang);return renderToStaticMarkup(React.createElement(ChoiceResult,props));};
export const whole=(props)=>{activateLanguage('zh-CN');return renderToStaticMarkup(React.createElement(PurchaseChooser,props));};`,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',loader:{'.css':'empty','.png':'empty','.svg':'empty'},logLevel:'silent',external:['react','react-dom','react-dom/server']});
 const module={exports:{}};new Function('module','exports','require',bundle.text)(module,module.exports,createRequire(new URL('../package.json',import.meta.url)));
 return mod=module.exports;
}
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ');
const count=(html,cls)=>(html.match(new RegExp(`class="(?:[^"]* )?${cls}[ "]`,'g'))||[]).length;

test('the hero is the engine\'s choice with its return; runner-ups follow in the engine\'s order with the gap',async()=>{
 const {result}=await load(),r=quickChoice({category:'dining',amount:120,currency:'USD'},wallet);
 assert.equal(r.kind,'use-card');
 const html=result({r,cards,hidden:false}),hero=html.slice(html.indexOf('pc-hero'),html.indexOf('pc-others'));
 assert.equal(count(html,'pc-hero'),1);
 assert.ok(text(hero).includes(r.card),'the hero names the chosen card');
 assert.ok(text(hero).includes(`${r.percent}%`),'the hero shows the effective return');
 assert.ok(text(hero).includes('US$'+r.value.toFixed(2)),'with an amount, the money it comes to');
 assert.equal(count(html,'pc-other'),Math.min(2,r.others.length),'at most two runner-ups');
 const names=[...html.matchAll(/class="pc-other-name">([^<]+)</g)].map(m=>m[1]);
 assert.deepEqual(names,r.others.slice(0,2).map(o=>o.card),'in the engine\'s order');
 const gap=Math.round((r.value-r.others[0].value)*100)/100;
 assert.ok(text(html).includes('少 US$'+gap.toFixed(2)),'the first runner-up says what it gives up');
 // Caveats sit in one folded disclosure, not as alerts.
 assert.equal(count(html,'pc-why'),1);assert.doesNotMatch(html,/ant-alert/);
 assert.doesNotMatch(html,/ant-collapse-item-active/,'folded by default');
});

test('hidden mode masks every amount but keeps the rates',async()=>{
 const {result}=await load(),r=quickChoice({category:'dining',amount:120,currency:'USD'},wallet);
 const html=text(result({r,cards,hidden:true}));
 assert.doesNotMatch(html,/US\$\d/,'no money is shown');
 assert.ok(html.includes('••••'));assert.ok(html.includes(`${r.percent}%`),'a rate is not an amount');
});

test('without an amount the gap is in percentage points; cash shows no approximation sign',async()=>{
 const {result}=await load(),r=quickChoice({category:'other',currency:'USD'},wallet);
 assert.equal(r.basis,'cash-rate');assert.equal(r.percent,r.earn.rate);
 const hero=text(result({r,cards,hidden:false}).split('pc-others')[0]);
 assert.ok(hero.includes(`${r.percent}%`));assert.ok(!hero.includes('≈'),'cash back is not an estimate');
});

test('hidden cards never reach the chooser, and an empty answer says so',async()=>{
 const {result}=await load();
 const gold=cards.find(c=>c.name==='American Express Gold Card');
 const r=quickChoice({category:'dining',amount:120,currency:'USD'},{...wallet,cards:cards.filter(c=>c!==gold)});
 const html=result({r,cards:cards.filter(c=>c!==gold),hidden:false});
 assert.ok(!text(html).includes('American Express Gold Card'));
 const none=quickChoice({category:'dining'},{...wallet,cards:[{id:'x',name:'Mystery Card',bank:'Nobody',region:'US',currency:'USD'}]});
 assert.equal(none.kind,'none');
 const empty=result({r:none,cards:[],hidden:false});
 assert.match(empty,/pc-empty/);assert.ok(text(empty).includes('没有这类消费的规则'));
});

test('the input is a labelled radio group of category chips with the currency on the amount',async()=>{
 const {whole}=await load(),html=whole({cards,hidden:false});
 assert.match(html,/role="radiogroup" aria-label="消费类别"/);
 const radios=[...html.matchAll(/role="radio" aria-checked="(true|false)" tabindex="(-?\d)"/g)];
 assert.equal(radios.length,8,'the most-used categories before "more"');
 assert.equal(radios.filter(m=>m[1]==='true').length,1,'one chosen');
 assert.ok(radios.every(m=>(m[1]==='true')===(m[2]==='0')),'only the chosen chip is in the tab order');
 assert.match(html,/aria-expanded="false"/);assert.ok(text(html).includes('US$'));
});

test('effective return: cash at its rate, points at their value, unvalued points have none',()=>{
 assert.equal(effectivePercent({earn:{isCash:true,rate:3,unit:'cashback-percent'}}),3);
 assert.equal(effectivePercent({earn:{isCash:false,rate:4,unit:'points-per-USD'},centsPerPoint:1.5}),6);
 assert.equal(effectivePercent({earn:{isCash:false,rate:4,unit:'HKD-per-mile'},centsPerPoint:10}),2.5);
 assert.equal(effectivePercent({earn:{isCash:false,rate:4,unit:'points-per-USD'}}),null);
 // Past a cap, the blended rate on this amount.
 assert.equal(effectivePercent({earn:{isCash:true,rate:3,unit:'cashback-percent',capExceeded:true,reward:200}},8000),2.5);
});

test('flights and hotels have their own chips up front; the travel chip says it is other travel (#222 review)',async()=>{
 const {whole}=await load(),html=whole({cards,hidden:false});
 for(const c of ['flight','hotel','travel'])assert.match(html,new RegExp(`role="radio" aria-checked="(true|false)" tabindex="-?\\d" data-category="${c}"`),c);
 assert.ok(text(html).includes('其他旅行'));assert.ok(!/>旅行</.test(html),'never a bare "travel" that reads as flights too');
 // The reason: on the engine, a flight is not "travel".
 assert.notEqual(quickChoice({category:'flight',currency:'USD'},wallet).card,quickChoice({category:'travel',currency:'USD'},wallet).card);
});

test('a figure from a default valuation, or with a credit in it, says so beside it',async()=>{
 const {result}=await load();
 const r=quickChoice({category:'dining',amount:120,currency:'USD'},wallet);assert.equal(r.pointValue.basis,'default');
 assert.ok(text(result({r,cards,hidden:false})).includes('（默认估值）'));
 const bare=quickChoice({category:'dining',currency:'USD'},wallet);
 assert.ok(text(result({r:bare,cards,hidden:false})).includes('按默认估值折算'));
 const {creditMark,decisionIds:{GOLD,GOLD_DINING}}=await import('../evals/fixtures.mjs');
 const withCredit=quickChoice({category:'dining',amount:30,merchant:'Grubhub',currency:'USD'},{...wallet,events:[creditMark(GOLD,GOLD_DINING,'2026-11-01','2026-11-30','unused')]});
 assert.ok(withCredit.credit);assert.ok(text(result({r:withCredit,cards,hidden:false})).includes('（含抵扣）'));
});
