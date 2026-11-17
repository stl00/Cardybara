// #485: the points page names the best known option for the trial points, across transfers and issuer redemptions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {bestPointsOption} from '../src/bestPointsOption.js';
import {transferRoutes,routesForCard} from '../src/transferRoutes.js';
import {valuationTable,POINT_VALUES_KEY} from '../src/pointValues.js';
const root=new URL('..',import.meta.url).pathname;
const MR='programme.amex-membership-rewards-us',HK='programme.amex-membership-rewards-hk';
let mod;
async function load(){
 if(mod)return mod;
 const {outputFiles:[bundle]}=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {ProgrammePanel} from './src/RewardsView.jsx';import {transferProgrammes} from './src/transferRoutes';import {activateLanguage} from './src/i18n-core.js';
export const panel=({programme,accounts,cards,hidden,lang})=>{activateLanguage(lang||'en-US');return renderToStaticMarkup(React.createElement(ProgrammePanel,{programme:transferProgrammes.find(p=>p.id===programme),accounts,cards,count:n=>String(n),hidden:!!hidden}));};`,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',loader:{'.css':'empty','.png':'empty','.svg':'empty'},logLevel:'silent',external:['react','react-dom','react-dom/server']});
 const module={exports:{}};new Function('module','exports','require',bundle.text)(module,module.exports,createRequire(new URL('../package.json',import.meta.url)));
 return mod=module.exports;
}
// The page reads the user's own valuations from localStorage; the test sets them to steer which option wins.
let store={};
globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}};
const setValues=map=>{store={};store[POINT_VALUES_KEY]=JSON.stringify({schema:1,values:Object.entries(map).map(([id,cents])=>({id,cents,at:'2026-01-01T00:00:00Z'}))});};
// Every partner valued at the lowest allowed value, except the ones named: the named ones decide the winner.
const partnerIds=valuationTable.programmes.filter(p=>p.knowledgeProgrammeId&&!['amex-mr-us','chase-ur'].includes(p.id)).map(p=>p.id);
const lowExcept=(keep={})=>Object.fromEntries(partnerIds.map(id=>[id,keep[id]??0.01]));
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#x27;/g,"'").replace(/\s+/g,' ');
const summary=html=>text(html).match(/Highest known value[^.]*?(?= (?:Membership|Airline|Hotel|Other|Redeem|Sources)|$)/)?.[0]||null;
const card=(id,bank,name,region='US',currency='USD')=>({id,bank,region,name,currency});
const biz=card('b','Amex US','Business Platinum Card'),gold=card('g','Amex US','American Express Gold Card'),hk=card('h','Amex HK','Platinum Card','HK','HKD');
const wallet=(programme,c,amount,region='US')=>({programme,cards:[c],accounts:{current:[{id:'r-'+c.id,card:c.id,bank:c.bank,region,label:'Membership Rewards',amount,unit:'points',date:'2026-11-10',capturedAt:'2026-11-10T10:00:00Z',cardReading:true}],historical:[]}});
const rowsOf=id=>routesForCard(transferRoutes(id),{});

test('best is an issuer redemption: it beats every transfer and the line names it with its value',async()=>{
 const {panel}=await load();setValues(lowExcept());
 const s=summary(panel(wallet(MR,biz,12345)));
 assert.match(s,/Highest known value: Deposit, about \$120\b/);assert.doesNotMatch(s,/tie/);
 assert.match(s,/At the issuer's published rate/);assert.match(s,/\d+ options not ranked: value unknown or varies/);
});
test('best is a transfer: the partner is named, at the default valuation',async()=>{
 const {panel}=await load();setValues({});
 const s=summary(panel(wallet(MR,biz,12345)));
 assert.match(s,/Highest known value: Air Canada Aeroplan, about \$168\b/);assert.match(s,/default market valuation/);
});
test('best is a transfer at the user\'s own valuation, and the line says so',async()=>{
 const {panel}=await load();setValues(lowExcept({aadvantage:5}));
 const s=summary(panel(wallet(MR,biz,12345)));
 assert.doesNotMatch(s,/Highest known value: [^,]*AAdvantage/);// not a partner of this programme: an unrelated override changes nothing
 setValues(lowExcept({'delta-skymiles':5}));
 const d=summary(panel(wallet(MR,biz,12345)));
 assert.match(d,/Highest known value: Delta SkyMiles, about \$600\b/);assert.match(d,/At your own valuation/);
});
test('a tie names every option that shares the top value',async()=>{
 const {panel}=await load();setValues(lowExcept({aeroplan:1}));
 const s=summary(panel(wallet(MR,biz,12345)));
 assert.match(s,/^Highest known value \(tie\): (Air Canada Aeroplan \/ Deposit|Deposit \/ Air Canada Aeroplan), about \$120 each/);
});
test('options with a null or varying value are counted as not ranked and never named',()=>{
 setValues({});
 const rows=rowsOf(MR);
 const r=bestPointsOption({programmeId:MR,points:12345,heldProductIds:['amex-us-us-business-platinum-card'],rows});
 const total=rows.length+6;
 assert.equal(r.known+r.notRanked,total,'every option is either ranked or counted');
 assert.ok(r.notRanked>0);
 // a partner with no valuation (for example Aer Lingus AerClub) or a ratio the issuer has not stated is never the best
 assert.ok(r.best.every(b=>b.cents>0&&(b.type==='issuer'||b.partner)));
 // a card-bound option the wallet does not hold is not ranked
 const without=bestPointsOption({programmeId:MR,points:12345,heldProductIds:[],rows});
 assert.equal(without.notRanked,r.notRanked+1);
});
test('fewer than two known options gives no summary',async()=>{
 const {panel}=await load();setValues({});
 // Hong Kong Membership Rewards: US-cent values are never applied to Hong Kong points
 assert.equal(bestPointsOption({programmeId:HK,region:'HK',points:12345,rows:rowsOf(HK)}),null);
 assert.equal(summary(panel(wallet(HK,hk,12345,'HK'))),null);
 // no stated points: nothing to compare
 assert.equal(bestPointsOption({programmeId:MR,points:null,rows:rowsOf(MR)}),null);
 assert.equal(bestPointsOption({programmeId:MR,points:0,rows:rowsOf(MR)}),null);
 // one known option is not a comparison
 assert.equal(bestPointsOption({programmeId:MR,points:12345,heldProductIds:[],rows:[]}),null);
});
test('hidden-balance mode masks the value but still ranks',async()=>{
 const {panel}=await load();setValues(lowExcept());
 const s=summary(panel({...wallet(MR,biz,12345),hidden:true}));
 assert.match(s,/Highest known value: Deposit, about ••••/);assert.doesNotMatch(s,/\$\d/);
});
test('the summary reads in zh-CN and zh-TW with official programme names untranslated',async()=>{
 const {panel}=await load();setValues({});
 const cn=text(panel({...wallet(MR,biz,12345),lang:'zh-CN'})),tw=text(panel({...wallet(MR,biz,12345),lang:'zh-TW'}));
 assert.match(cn,/已知价值最高：Air Canada Aeroplan，约 \$168/);assert.match(cn,/个选项未排名：价值未知或不固定/);
 assert.match(tw,/已知價值最高：Air Canada Aeroplan，約 \$168/);assert.match(tw,/個選項未排名：價值未知或不固定/);
});
