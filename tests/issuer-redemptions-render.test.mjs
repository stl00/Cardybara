// #308: the points-page section renders from records (synthetic fixture), in each language, with hidden amounts masked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {syntheticRedemptions,GOLD,CSR} from './fixtures/issuer-redemptions.synthetic.mjs';
const root=new URL('..',import.meta.url).pathname;
const MR='programme.amex-membership-rewards-us',UR='programme.chase-ultimate-rewards';
// The bundle swaps only the empty record list for the synthetic one; production src/ is untouched.
const withFixture={name:'synthetic-redemptions',setup(b){b.onLoad({filter:/issuerRedemptions\.js$/},a=>({contents:readFileSync(a.path,'utf8').replace('export const issuerRedemptions=[];','export const issuerRedemptions='+JSON.stringify(syntheticRedemptions)+';'),loader:'js',resolveDir:root+'src'}));}};
let mod;
async function load(){
 if(mod)return mod;
 const {outputFiles:[bundle]}=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {ProgrammePanel} from './src/RewardsView.jsx';import {transferProgrammes} from './src/transferRoutes';import {activateLanguage} from './src/i18n-core.js';
export const panel=({programme,accounts,cards,hidden,lang})=>{activateLanguage(lang||'zh-CN');return renderToStaticMarkup(React.createElement(ProgrammePanel,{programme:transferProgrammes.find(p=>p.id===programme),accounts,cards,count:n=>String(n),hidden:!!hidden}));};`,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',plugins:[withFixture],loader:{'.css':'empty','.png':'empty','.svg':'empty'},logLevel:'silent',external:['react','react-dom','react-dom/server']});
 const module={exports:{}};new Function('module','exports','require',bundle.text)(module,module.exports,createRequire(new URL('../package.json',import.meta.url)));
 return mod=module.exports;
}
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ');
const card=(id,bank,name)=>({id,bank,region:'US',name,currency:'USD'});
const reading=(c,amount,label)=>({id:'r-'+c.id,card:c.id,bank:c.bank,region:'US',label,amount,unit:'points',date:'2026-11-10',capturedAt:'2026-11-10T10:00:00Z',cardReading:true});
const gold=card('g','Amex US','American Express Gold Card'),plat=card('p','Amex US','The Platinum Card'),csr=card('c','Chase','Sapphire Reserve'),csp=card('s','Chase','Chase Sapphire Preferred Credit Card');
const wallets={
 mrQualifying:{programme:MR,cards:[gold],accounts:{current:[reading(gold,12345,'Membership Rewards')],historical:[]}},
 mrWithout:{programme:MR,cards:[plat],accounts:{current:[reading(plat,12345,'Membership Rewards')],historical:[]}},
 urQualifying:{programme:UR,cards:[csr],accounts:{current:[reading(csr,20000,'Ultimate Rewards')],historical:[]}},
 urWithout:{programme:UR,cards:[csp],accounts:{current:[reading(csp,20000,'Ultimate Rewards')],historical:[]}}
};
export {wallets};
const TITLES=['通过发卡行兑换','透過發卡行兌換','Redeem with the issuer'];
const section=html=>{const i=Math.min(...TITLES.map(t=>html.indexOf(t)).filter(i=>i>=0));return text(html.slice(i).split(/来源（|來源（|Sources \(|Source/)[0]);};

test('MR with a qualifying card: values in whole cents, the card-dependent option computed',async()=>{
 const {panel}=await load(),s=section(panel(wallets.mrQualifying));
 assert.match(s,/\$74\.07/,'12,345 at 0.6 cents');
 assert.match(s,/\$123\.45/,'12,345 at 1 cent, the Gold-only option');
 assert.match(s,/不固定/,'varies stays a word');
 assert.ok(GOLD);
});
test('MR without a qualifying card shows the condition, not a value, for the card-dependent option',async()=>{
 const {panel}=await load(),s=section(panel(wallets.mrWithout));
 assert.match(s,/\$74\.07/);assert.doesNotMatch(s,/\$123\.45/);assert.match(s,/需要持有指定的卡/);
});
test('UR with and without the qualifying card; unknown stays a word',async()=>{
 const {panel}=await load(),q=section(panel(wallets.urQualifying)),n=section(panel(wallets.urWithout));
 assert.match(q,/\$200(?!\.\d)/);assert.match(q,/\$300(?!\.\d)/);assert.match(q,/未知/);
 assert.match(n,/\$200(?!\.\d)/);assert.doesNotMatch(n,/\$300(?!\.\d)/);assert.match(n,/需要持有指定的卡/);assert.ok(CSR);
});
test('hidden-amount mode masks every computed value',async()=>{
 const {panel}=await load(),s=section(panel({...wallets.mrQualifying,hidden:true}));
 assert.doesNotMatch(s,/\$\d/);assert.match(s,/••••/);
});
test('the section renders in en-US and zh-TW, with source links',async()=>{
 const {panel}=await load(),en=panel({...wallets.mrQualifying,lang:'en-US'}),tw=panel({...wallets.mrQualifying,lang:'zh-TW'});
 assert.match(section(en),/Redeem with the issuer/);assert.match(section(en),/Statement credit/);assert.match(section(en),/Varies/);
 assert.match(section(tw),/透過發卡行兌換/);assert.match(section(tw),/帳單抵扣/);
 assert.match(en.slice(en.indexOf('Redeem with the issuer')),/<a [^>]*href="https?:/,'source links');
});
