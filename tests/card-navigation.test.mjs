import test from 'node:test';
import assert from 'node:assert/strict';
import {amexCards} from '../extension-next/card-navigation.js';
function fixture(){
 let expanded=false,selected=null,financialClicks=0;
 const node=(text,attrs,click)=>({innerText:text,getAttribute:k=>attrs[k]??null,getClientRects:()=>[{}],click});
 const toggle=node('Gold ••••12345',{role:'combobox'},()=>{expanded=!expanded;});
 toggle.getAttribute=k=>k==='aria-expanded'?String(expanded):k==='role'?'combobox':null;
 const rows=[node('Overview',{},()=>{selected='overview';}),node('Gold ••••12345',{},()=>{selected='12345';expanded=false;}),node('Platinum ••••67890',{},()=>{selected='67890';expanded=false;})];
 const payment=node('Make Payment',{},()=>{financialClicks++;});
 globalThis.location={hostname:'global.americanexpress.com',pathname:'/dashboard'};
 globalThis.getComputedStyle=()=>({visibility:'visible'});
 globalThis.document={querySelectorAll:selector=>selector.includes('[role="combobox"]')?[toggle]:selector.includes('#simple-switcher-listbox')?(expanded?rows:[]):selector==='button'?[payment]:[]};
 return {state:()=>({expanded,selected,financialClicks})};
}
test('US semantic card selector lists masked tails and closes without choosing an account',async()=>{
 const f=fixture();assert.deepEqual(await amexCards('list'),['12345','67890']);assert.deepEqual(f.state(),{expanded:false,selected:null,financialClicks:0});
});
test('US selector selects only an exact known masked tail, never financial actions',async()=>{
 const f=fixture();assert.deepEqual(await amexCards('select','67890'),['67890']);assert.deepEqual(f.state(),{expanded:false,selected:'67890',financialClicks:0});
 assert.deepEqual(await amexCards('select','99999'),[]);assert.equal(f.state().expanded,false);assert.equal(f.state().financialClicks,0);
});
test('selector does nothing outside account overview or dashboard',async()=>{
 const f=fixture();location.pathname='/payments/pay';assert.deepEqual(await amexCards('list'),[]);assert.deepEqual(f.state(),{expanded:false,selected:null,financialClicks:0});
});

test('HSBC: a locale-prefixed dashboard lists div rows, and only the card number identifies a row',async()=>{
 const {hsbcCards,hsbcMoreDetails}=await import('../extension-next/hsbc-navigation.js');let clicked=null;
 const row=(id,text)=>({innerText:text,getClientRects:()=>[{}],click:()=>{clicked=id;}});
 const rows=[row('a','Deposit\n111-222222-333\n1234.56\nHKD'),row('b','Card one\n4000-0000-0000-1234\n4000-0000-0000-1234\n5678.00\nHKD'),row('c','Card two\n4000-0000-0000-5678\n4000-0000-0000-5678\n1234.00\nHKD')];
 globalThis.location={hostname:'www.hsbc.com.hk',pathname:'/zh-hk/online/dashboard/'};globalThis.getComputedStyle=()=>({visibility:'visible'});
 let asked=null;globalThis.document={getElementById:()=>null,querySelectorAll:s=>{asked=s;return rows;}};
 const cards=[{bank:'HSBC HK',tail:'1234'},{bank:'HSBC HK',tail:'5678'}];
 assert.deepEqual(await hsbcCards('list',null,cards),['1234','5678']);assert.equal(asked,'[id^="account-container-"]');
 assert.deepEqual(await hsbcCards('select','5678',cards),['5678']);assert.equal(clicked,'c','not the row whose amount looks like that tail');
 globalThis.location.pathname='/zh-hk/online/payments/';assert.deepEqual(await hsbcCards('list',null,cards),[]);assert.equal(hsbcMoreDetails(),false);
});
test('HSBC selector stays inside observed account controls and registered tails',async()=>{
 const {hsbcCards,hsbcMoreDetails}=await import('../extension-next/hsbc-navigation.js');let expanded=false,selected=null,overlay=false,payment=0;
 const node=(text,click)=>({innerText:text,getClientRects:()=>[{}],click});
 const toggle={getClientRects:()=>[{}],getAttribute:()=>String(expanded),click:()=>{expanded=!expanded;}};
 const rows=[node('Red Credit Card ••••1234',()=>{selected='1234';expanded=false;}),node('Gold Card ••••5678',()=>{selected='5678';expanded=false;}),node('Other account ••••9999',()=>{payment++;})];
 globalThis.location={hostname:'www.hsbc.com.hk',pathname:'/online/dashboard/'};globalThis.getComputedStyle=()=>({visibility:'visible'});
 globalThis.document={getElementById:id=>id==='change-account-button'?toggle:id==='show-account-details-overlay'?node('View more details',()=>{overlay=true;}):null,querySelectorAll:selector=>selector==='button[id^="dropdown-item-"]'&&expanded?rows:[]};
 const cards=[{bank:'HSBC HK',tail:'1234'},{bank:'HSBC HK',tail:'5678'}];assert.deepEqual(await hsbcCards('list',null,cards),['1234','5678']);assert.equal(expanded,false);
 assert.deepEqual(await hsbcCards('select','5678',cards),['5678']);assert.equal(selected,'5678');assert.deepEqual(await hsbcCards('select','9999',cards),[]);assert.equal(payment,0);
 assert.equal(hsbcMoreDetails(),true);assert.equal(overlay,true);
});
test('observed Amex account selector also works on rewards and offers, but excludes redemption',async()=>{
 for(const path of ['/rewards','/offers/eligible','/offers/enrolled']){const f=fixture();location.pathname=path;assert.deepEqual(await amexCards('select','67890'),['67890']);assert.equal(f.state().financialClicks,0);}
 const f=fixture();location.pathname='/rewards/points-for-charges';assert.deepEqual(await amexCards('list'),[]);assert.equal(f.state().financialClicks,0);
});
test('HK menu discovers only observed rewards/activity viewing links and restores its state',async()=>{
 const {amexReadMenu}=await import('../extension-next/card-navigation.js');let expanded=false,financialClicks=0;
 const toggle={innerText:'賬戶概況',getClientRects:()=>[{}],getAttribute:()=>String(expanded),click:()=>{expanded=!expanded;}};
 const links=[{innerText:'禮品換領',href:'https://global.americanexpress.com/rewards?inav=hk_ch_view'},{innerText:'賬項',href:'https://global.americanexpress.com/activity?inav=hk_ch_activity'},{innerText:'禮品換領',href:'https://global.americanexpress.com/rewards/points-for-charges'},{innerText:'選擇付款',href:'https://global.americanexpress.com/payments/pay'}].map(l=>({...l,getClientRects:()=>expanded?[{}]:[],click:()=>{financialClicks++;}}));
 globalThis.location={hostname:'global.americanexpress.com',origin:'https://global.americanexpress.com',href:'https://global.americanexpress.com/dashboard',pathname:'/dashboard'};
 globalThis.document={querySelectorAll:s=>s==='button'?[toggle]:s==='main a[href]'?links:[]};globalThis.getComputedStyle=()=>({visibility:'visible'});
 const result=amexReadMenu();assert.deepEqual(result.map(l=>l.label),['禮品換領','賬項']);assert.equal(expanded,false);assert.equal(financialClicks,0);
});
test('HK switch base is taken from the observed home link, never payment or external URLs',async()=>{
 const {amexAccountHome}=await import('../extension-next/card-navigation.js');
 globalThis.location={hostname:'global.americanexpress.com',origin:'https://global.americanexpress.com'};
 const a={innerText:'首頁',href:'https://global.americanexpress.com/dashboard?inav=hk_ch_home',getClientRects:()=>[{}]};globalThis.document={querySelectorAll:()=>[a]};
 assert.equal(amexAccountHome(),a.href);a.href='https://global.americanexpress.com/payments/pay';assert.equal(amexAccountHome(),null);a.href='https://evil.test/dashboard';assert.equal(amexAccountHome(),null);
});

test('Chase selection waits for overview and selected shadow heading instead of returning on hash alone',async()=>{
 const {chaseCards}=await import('../extension-next/chase-navigation.js');let clicked=0,title='Other Card (...9999)';globalThis.location={hostname:'secure.chase.com',pathname:'/web/auth/dashboard',hash:'#/dashboard/benefits/hub'};
 const heading={get innerText(){return title;},getClientRects:()=>[{}]};
 const button={innerText:'Test Card (...1234)',getClientRects:()=>[{}],click:()=>{clicked++;location.hash='#/dashboard/summary/account/CARD/BAC';setTimeout(()=>{title='Test Card (...1234)';},30);}};
 const shadow={querySelectorAll:s=>s.startsWith('h1')?[heading]:[]},host={shadowRoot:shadow};
 globalThis.document={querySelectorAll:s=>s==='*'?[host]:s.startsWith('[id^=')&&location.hash.endsWith('/overview')?[button]:[]};
 setTimeout(()=>{location.hash='#/dashboard/overview';},20);assert.deepEqual(await chaseCards('select','1234',[{bank:'Chase',tail:'1234'}]),['1234']);assert.equal(clicked,1);assert.equal(title,'Test Card (...1234)');
 assert.deepEqual(await chaseCards('select','5555',[{bank:'Chase',tail:'1234'}]),[]);assert.equal(clicked,1);
});

import {amexClickReadLink} from '../extension-next/card-navigation.js';
test('HK navigation uses only a visible same-origin read link, preserving SPA routing',()=>{
 let clicks=0;globalThis.location={hostname:'global.americanexpress.com',origin:'https://global.americanexpress.com',href:'https://global.americanexpress.com/dashboard'};globalThis.getComputedStyle=()=>({visibility:'visible'});
 const link={href:'https://global.americanexpress.com/activity/statements?inav=hk_statement',getClientRects:()=>[{}],click:()=>clicks++};globalThis.document={querySelectorAll:()=>[link]};
 assert.equal(amexClickReadLink('https://global.americanexpress.com/activity/statements'),true);assert.equal(clicks,1);
 for(const href of ['https://global.americanexpress.com/payments/pay','https://example.com/activity/statements','https://global.americanexpress.com/rewards/redeem'])assert.equal(amexClickReadLink(href),false);assert.equal(clicks,1);
 link.getClientRects=()=>[];assert.equal(amexClickReadLink('https://global.americanexpress.com/activity/statements'),false);
});

test('Chase detail rendering has a fresh bounded budget after a slow overview and reports the failed stage',async()=>{
 const {chaseCards}=await import('../extension-next/chase-navigation.js');
 const previousDate=globalThis.Date,previousTimeout=globalThis.setTimeout,previousLocation=globalThis.location,previousDocument=globalThis.document;
 let time=0,clickedAt=null,renderTitle=true;
 globalThis.Date={now:()=>time};globalThis.setTimeout=fn=>{time+=1000;queueMicrotask(fn);};
 globalThis.location={hostname:'secure.chase.com',pathname:'/web/auth/dashboard',hash:'#/dashboard/overview'};
 const heading={get innerText(){return renderTitle&&clickedAt!==null&&time-clickedAt>=15000?'Synthetic (...1234)':'Other (...9999)'},getClientRects:()=>[{}]};
 const host={shadowRoot:{querySelectorAll:s=>s.startsWith('h1')?[heading]:[]}};
 const button={innerText:'Synthetic (...1234)',getClientRects:()=>[{}],click:()=>{clickedAt=time;location.hash='#/dashboard/summary/synthetic/CARD/BAC';}};
 globalThis.document={querySelectorAll:s=>s==='*'?[host]:s.startsWith('[id^=')&&time>=8000?[button]:[]};
 try{
  assert.deepEqual(await chaseCards('select','1234',[{bank:'Chase',tail:'1234'}]),['1234']);assert.equal(clickedAt,8000);assert.equal(time,23000);
  time=0;clickedAt=null;renderTitle=false;location.hash='#/dashboard/overview';
  assert.deepEqual(await chaseCards('select','1234',[{bank:'Chase',tail:'1234'}]),{error:'chase_detail_timeout'});assert.equal(time,33000);
  time=0;clickedAt=null;location.hash='#/dashboard/summary/other/CARD/BAC';
  assert.deepEqual(await chaseCards('select','1234',[{bank:'Chase',tail:'1234'}]),{error:'chase_account_button_timeout'});assert.equal(time,12000);
 }finally{globalThis.Date=previousDate;globalThis.setTimeout=previousTimeout;globalThis.location=previousLocation;globalThis.document=previousDocument;}
});
