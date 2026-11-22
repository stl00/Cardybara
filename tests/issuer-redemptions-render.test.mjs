// #308/#465: the points-page section renders from the #307 records (no fixture swap), in each language, with hidden amounts masked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {runWalletTool} from '../src/walletAgent.js';
const root=new URL('..',import.meta.url).pathname;
const MR='programme.amex-membership-rewards-us',UR='programme.chase-ultimate-rewards';
let mod;
async function load(){
 if(mod)return mod;
 const {outputFiles:[bundle]}=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {ProgrammePanel} from './src/RewardsView.jsx';import {transferProgrammes} from './src/transferRoutes';import {activateLanguage} from './src/i18n-core.js';
export const panel=({programme,accounts,cards,hidden,lang})=>{activateLanguage(lang||'zh-CN');return renderToStaticMarkup(React.createElement(ProgrammePanel,{programme:transferProgrammes.find(p=>p.id===programme),accounts,cards,count:n=>String(n),hidden:!!hidden}));};`,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',loader:{'.css':'empty','.png':'empty','.svg':'empty'},logLevel:'silent',external:['react','react-dom','react-dom/server']});
 const module={exports:{}};new Function('module','exports','require',bundle.text)(module,module.exports,createRequire(new URL('../package.json',import.meta.url)));
 return mod=module.exports;
}
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ');
const card=(id,bank,name)=>({id,bank,region:'US',name,currency:'USD'});
const reading=(c,amount,label)=>({id:'r-'+c.id,card:c.id,bank:c.bank,region:'US',label,amount,unit:'points',date:'2026-11-10',capturedAt:'2026-11-10T10:00:00Z',cardReading:true});
const gold=card('g','Amex US','American Express Gold Card'),biz=card('b','Amex US','Business Platinum Card'),csr=card('c','Chase','Sapphire Reserve'),csp=card('s','Chase','Chase Sapphire Preferred Credit Card');
const wallet=(programme,c,amount,label)=>({programme,cards:[c],accounts:{current:[reading(c,amount,label)],historical:[]}});
const wallets={
 mrQualifying:wallet(MR,biz,12345,'Membership Rewards'),
 mrWithout:wallet(MR,gold,12345,'Membership Rewards'),
 mrAboveCap:wallet(MR,biz,1500000,'Membership Rewards'),
 urCsr:wallet(UR,csr,20000,'Ultimate Rewards'),
 urCsp:wallet(UR,csp,20000,'Ultimate Rewards')
};
export {wallets};
const TITLES=['通过发卡行兑换','透過發卡行兌換','Redeem with the issuer'];
const section=html=>{const i=Math.min(...TITLES.map(t=>html.indexOf(t)).filter(i=>i>=0));return text(html.slice(i).split(/来源（|來源（|Sources \(|Source/)[0]);};


const usd=c=>'$'+(c/100).toLocaleString('en-US',{minimumFractionDigits:c%100?2:0,maximumFractionDigits:2});
const rows=w=>runWalletTool({id:'c',type:'function',function:{name:'points_accounts',arguments:JSON.stringify({programme:w.programme===MR?'Membership Rewards':'Ultimate Rewards',region:'US',points:w.accounts.current[0].amount})}},{cards:w.cards,events:[],day:'2026-11-16'}).programmes[0].redemptions.options;

test('the points page lists the #307 records for an MR and a UR wallet, not an empty state',async()=>{
 const {panel}=await load();
 for(const [w,n] of [[wallets.mrQualifying,6],[wallets.urCsr,8]]){
  const s=section(panel(w));assert.doesNotMatch(s,/暂无发卡行兑换记录/);
  assert.equal(rows(w).length,n);
 }
 const s=section(panel(wallets.mrQualifying));
 assert.match(s,/存款/);assert.match(s,/账单抵扣/);assert.match(s,/礼品卡/);
});
test('page and points_accounts give the same status and cents for the same programme, balance and held cards',async()=>{
 const {panel}=await load();
 for(const w of Object.values(wallets)){
  const html=panel(w),s=section(html),opts=rows(w);
  const amounts=(s.match(/\$[\d,]+(?:\.\d\d)?/g)||[]).sort();
  const expected=opts.filter(o=>o.value.status==='computed').map(o=>usd(o.value.cents)).sort();
  assert.deepEqual(amounts,expected,'computed amounts');
  const count=re=>(s.match(re)||[]).length;
  assert.equal(count(/需要持有指定的卡/g),opts.filter(o=>o.value.status==='needs-card').length,'needs-card');
  assert.equal(count(/不固定/g),opts.filter(o=>o.value.status==='varies').length,'varies');
  assert.equal(count(/超过年度上限/g),opts.filter(o=>o.value.status==='above-annual-cap').length,'cap');
  assert.equal(count(/未知/g),opts.filter(o=>o.value.status==='unknown').length,'unknown');
 }
});
test('MR: deposit in 1,000-point blocks (12,345 points) and the Business Platinum option',async()=>{
 const {panel}=await load(),q=section(panel(wallets.mrQualifying)),n=section(panel(wallets.mrWithout));
 assert.match(q,/\$96(?!\.\d)/,'12,000 usable points at 0.8 cents');assert.match(q,/\$120(?!\.\d)/,'12,000 at 1 cent');
 assert.match(n,/\$96(?!\.\d)/);assert.doesNotMatch(n,/\$120/);assert.match(n,/需要持有指定的卡/);
});
test('MR above the deposit annual cap gives a word, not a total',async()=>{
 const {panel}=await load(),s=section(panel(wallets.mrAboveCap));
 assert.match(s,/超过年度上限/);assert.doesNotMatch(s,/\$10,000(?!\.\d)/);
});
test('UR cash back and gift cards are computed; varies and unknown stay words',async()=>{
 const {panel}=await load(),s=section(panel(wallets.urCsr));
 assert.match(s,/\$200(?!\.\d)/);assert.match(s,/不固定/);assert.match(s,/未知/);
 assert.equal(section(panel(wallets.urCsp)).match(/\$200(?!\.\d)/g).length,2);
});
test('hidden-amount mode masks every computed value',async()=>{
 const {panel}=await load();
 for(const w of [wallets.mrQualifying,wallets.urCsr]){const s=section(panel({...w,hidden:true}));assert.doesNotMatch(s,/\$\d/);assert.match(s,/••••/);}
});
test('each option shows its condition and source link, in en-US and zh-TW',async()=>{
 const {panel}=await load(),en=panel({...wallets.mrQualifying,lang:'en-US'}),tw=panel({...wallets.mrQualifying,lang:'zh-TW'});
 assert.match(section(en),/Redeem with the issuer/);assert.match(section(en),/Statement credit/);assert.match(section(en),/Unknown/);
 assert.match(section(en),/\$120(?!\.\d)/);assert.match(section(en),/\$96(?!\.\d)/);
 const enNo=section(panel({...wallets.mrWithout,lang:'en-US'}));assert.match(enNo,/Needs a qualifying card/);assert.doesNotMatch(enNo,/\$120/);
 assert.match(section(tw),/透過發卡行兌換/);assert.match(section(tw),/帳單抵扣/);
 const links=h=>(h.slice(h.indexOf('Redeem with the issuer')>=0?h.indexOf('Redeem with the issuer'):h.indexOf('透過發卡行兌換')).match(/<a [^>]*href="https:/g)||[]).length;
 assert.ok(links(en)>=6&&links(tw)>=6,'one source link per option');
 assert.match(section(en),/Membership Rewards/,'the English record text of the issuer page');
});
// #533: Points Boost "up to" limits of held cards beside Chase Travel (data from #532; the render checks wait for it).
import {fixedRedemptions} from '../src/fixedRedemptions.js';
import {heldPointsBoostLimits} from '../src/pointsBoostLimits.js';
const boost=fixedRedemptions.find(r=>r.id==='ur-travel-chase-travel')?.upToByProduct||[];
const noData={skip:boost.length?false:'needs the #532 upToByProduct data'};
test('heldPointsBoostLimits lists only held cards that have an entry, with the source',()=>{
 const record={upToByProduct:[{productId:'p1',upToCentsPerPoint:2,textEn:'a',textZh:'b',sourceId:'s1'},{productId:'p2',upToCentsPerPoint:1.5,textEn:'c',textZh:'d',sourceId:'s1'}]};
 const sources=[{id:'s1',url:'https://example.test/s',title:'S'}],products=[{id:'p1',name:'Card One'},{id:'p2',name:'Card Two'}];
 const got=heldPointsBoostLimits(record,['p2','p2','p9'],{sources,products});
 assert.deepEqual(got.map(g=>[g.productId,g.name,g.upToCentsPerPoint,g.source.url]),[['p2','Card Two',1.5,'https://example.test/s']]);
 assert.deepEqual(heldPointsBoostLimits(record,[],{sources,products}),[]);
 assert.deepEqual(heldPointsBoostLimits({},['p1'],{sources,products}),[]);
});
test('Chase Travel lists the limit and source of a held eligible card, in each language',noData,async()=>{
 const {panel}=await load();
 const zh=section(panel(wallets.urCsr)),en=section(panel({...wallets.urCsr,lang:'en-US'})),tw=section(panel({...wallets.urCsr,lang:'zh-TW'}));
 assert.match(zh,/Sapphire Reserve：最高每点 2 美分/);assert.match(en,/Sapphire Reserve: up to 2 cents per point with this card.*depends on the booking/);assert.match(tw,/最高每點 2 美分/);
 assert.doesNotMatch(en,/Sapphire Preferred: up to/,'a card that is not held is not listed');
 const html=panel({...wallets.urCsr,lang:'en-US'});assert.match(html.slice(html.indexOf('Redeem with the issuer')),/href="https:\/\/creditcards\.chase\.com\/rewards-credit-cards\/sapphire\/reserve"/);
 for(const u of boost.filter(u=>u.productId==='chase-us-chase-sapphire-preferred-credit-card'))assert.match(section(panel(wallets.urCsp)),/Sapphire Preferred.*最高每点 1.5 美分/);
});
test('Chase Travel row is unchanged without a held card that has an entry',noData,async()=>{
 const {panel}=await load(),other={programme:UR,cards:[card('x','Chase','Freedom Unlimited')],accounts:{current:[reading(card('x','Chase','Freedom Unlimited'),20000,'Ultimate Rewards')],historical:[]}};
 assert.doesNotMatch(section(panel(other)),/最高每点/);
});
test('hidden mode keeps the public limit but still masks computed amounts',noData,async()=>{
 const {panel}=await load(),s=section(panel({...wallets.urCsr,hidden:true}));
 assert.match(s,/最高每点 2 美分/);assert.doesNotMatch(s,/\$\d/);assert.match(s,/••••/);
});
