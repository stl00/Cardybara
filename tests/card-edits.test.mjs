// Manual cards and user corrections (stl00/Cardybara#176). All cards, tails and dates here are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cleanFeeDate,anniversaryPeriod,nextFeeDay,feeDayIn,feeDateText} from '../src/feeDate.js';
import {CARD_EDITS_KEY,readCardEdits,withCardEdit,withoutCardEdits,applyCardEdits,mergeCardEdits,regionBanks} from '../src/cardEdits.js';
import {benefitPeriod,benefitProfiles} from '../src/benefitRules.js';
import {creditTasks} from '../src/personalBenefits.js';
import {queryCredits} from '../src/creditQuery.js';
import {feeReminders,buildSchedule,normalizeSettings,pendingNotifications} from '../src/reminders.js';
import {mergeWalletCards,newWalletCard,editManualCard} from '../src/walletRegistry.js';
import {presentCard} from '../src/cardName.js';
import {applyCardProductChoices,withCardProductChoice} from '../src/cardProductChoice.js';
import {cardProducts} from '../src/productCatalog.js';
import {ACTIVE_BANKS} from '../extension-next/providers.js';
import {translations as i18nCatalog} from '../src/i18n/index.js';

const storage=value=>({getItem:k=>k===CARD_EDITS_KEY?value:null});
// A catalogue product with an anniversary credit at an active bank, found from the data so no product is named here.
const anniversary=(()=>{
 for(const p of benefitProfiles){
  const product=cardProducts.find(x=>x.id===p.productId);
  const b=p.benefits.find(b=>b.period==='account-anniversary'&&['credit','promo'].includes(b.category)&&Number.isFinite(b.amount)&&b.amount>0&&!b.applicability&&!b.validThrough&&!b.validFrom);
  if(product&&b&&ACTIVE_BANKS.includes(product.bank)&&p.coverage!=='variant-unconfirmed')return {product,benefit:b};
 }
 throw Error('no catalogue product with an anniversary credit');
})();
const manualCard=(extra={})=>({...newWalletCard({bank:anniversary.product.bank,name:'Synthetic Card',tail:'4321'},'manual-1'),productId:anniversary.product.id,...extra});

test('a fee date needs a real month and day; the year is optional and never filled in',()=>{
 assert.deepEqual(cleanFeeDate({month:3,day:15}),{month:3,day:15});
 assert.deepEqual(cleanFeeDate({month:3,day:15,year:2024}),{month:3,day:15,year:2024});
 assert.deepEqual(cleanFeeDate({month:2,day:29}),{month:2,day:29});
 assert.deepEqual(cleanFeeDate({month:2,day:29,year:2028}),{month:2,day:29,year:2028});
 for(const bad of [null,{},{month:3},{day:15},{month:2,day:29,year:2027},{month:4,day:31},{month:13,day:1},{month:0,day:1},{month:1,day:0},{month:1.5,day:2},{month:'3',day:'15'},{month:3,day:15,year:20}])assert.equal(cleanFeeDate(bad),null,JSON.stringify(bad));
 assert.equal(feeDateText({month:3,day:5}),'03-05');assert.equal(feeDateText({month:3,day:5,year:2024}),'2024-03-05');
});

test('the card year runs from the fee date to the day before the next one',()=>{
 assert.deepEqual(anniversaryPeriod({month:3,day:15},'2026-11-10'),{start:'2026-03-15',end:'2027-03-14'});
 assert.deepEqual(anniversaryPeriod({month:3,day:15},'2026-03-14'),{start:'2025-03-15',end:'2026-03-14'});
 assert.deepEqual(anniversaryPeriod({month:3,day:15},'2026-03-15'),{start:'2026-03-15',end:'2027-03-14'});
 assert.equal(anniversaryPeriod(null,'2026-11-10'),null);
 assert.equal(anniversaryPeriod({month:3,day:15},'2026-02-30'),null);
});

test('Feb 29 falls on Feb 28 in a common year and comes back in a leap year',()=>{
 const leapDay={month:2,day:29};
 assert.equal(feeDayIn(leapDay,2027),'2027-02-28');assert.equal(feeDayIn(leapDay,2028),'2028-02-29');
 assert.deepEqual(anniversaryPeriod(leapDay,'2026-11-10'),{start:'2026-02-28',end:'2027-02-27'});
 assert.deepEqual(anniversaryPeriod(leapDay,'2027-03-01'),{start:'2027-02-28',end:'2028-02-28'});
 assert.deepEqual(anniversaryPeriod(leapDay,'2028-02-28'),{start:'2027-02-28',end:'2028-02-28'});
 assert.deepEqual(anniversaryPeriod(leapDay,'2028-02-29'),{start:'2028-02-29',end:'2029-02-27'});
 assert.equal(nextFeeDay(leapDay,'2027-03-01'),'2028-02-29');
});

test('month-end fee dates and the year boundary',()=>{
 assert.deepEqual(anniversaryPeriod({month:1,day:31},'2026-02-15'),{start:'2026-01-31',end:'2027-01-30'});
 assert.deepEqual(anniversaryPeriod({month:12,day:31},'2026-12-31'),{start:'2026-12-31',end:'2027-12-30'});
 assert.deepEqual(anniversaryPeriod({month:12,day:31},'2026-12-30'),{start:'2025-12-31',end:'2026-12-30'});
 assert.deepEqual(anniversaryPeriod({month:4,day:30},'2026-04-30'),{start:'2026-04-30',end:'2027-04-29'});
 assert.equal(nextFeeDay({month:12,day:31},'2026-12-31'),'2026-12-31');
 assert.equal(nextFeeDay({month:1,day:1},'2026-12-31'),'2027-01-01');
});

test('a known opening year means no card year before it',()=>{
 assert.equal(anniversaryPeriod({month:6,day:1,year:2027},'2026-11-10'),null);
 assert.deepEqual(anniversaryPeriod({month:6,day:1,year:2027},'2027-06-01'),{start:'2027-06-01',end:'2028-05-31'});
 assert.equal(nextFeeDay({month:6,day:1,year:2027},'2026-11-10'),'2027-06-01');
});

test('an anniversary rule has no cycle until the user sets a fee date, and never defaults to the 1st',()=>{
 const rule={period:'account-anniversary'};
 assert.equal(benefitPeriod(rule,'2026-11-10'),null);
 assert.equal(benefitPeriod(rule,'2026-11-10',{}),null);
 assert.equal(benefitPeriod(rule,'2026-11-10',{feeDate:{month:5}}),null);
 assert.deepEqual(benefitPeriod(rule,'2026-11-10',{feeDate:{month:5,day:20}}),{start:'2026-05-20',end:'2027-05-19'});
 // Calendar periods ignore the fee date.
 assert.deepEqual(benefitPeriod({period:'calendar-year'},'2026-11-10',{feeDate:{month:5,day:20}}),{start:'2026-01-01',end:'2026-12-31'});
});

test('stored edits: missing, damaged and partly damaged values read safely',()=>{
 assert.deepEqual(readCardEdits(storage(null)),[]);
 assert.deepEqual(readCardEdits(storage('not json')),[]);
 assert.deepEqual(readCardEdits(storage('{"schema":1}')),[]);
 assert.deepEqual(readCardEdits({getItem(){throw Error('blocked')}}),[]);
 const rows=[{cardId:'a',feeDate:{month:2,day:29}},{cardId:'b',tail:'12'},{cardId:'c',name:'Synthetic',tail:'98765',feeDate:{month:2,day:30}},{cardId:'d',bank:'Nowhere'},{cardId:7,name:'x'},{cardId:'e',name:'4111 1111 1111 1111'}];
 assert.deepEqual(readCardEdits(storage(JSON.stringify(rows))),[{cardId:'a',feeDate:{month:2,day:29}},{cardId:'c',name:'Synthetic',tail:'98765'}]);
});

test('setting, clearing and rejecting edits',()=>{
 const card={id:'x',bank:'Chase',region:'US',identitySource:'bank-page',name:'Synthetic Bank Name',tail:'1111'};
 let edits=withCardEdit([],card,{name:' My card ',feeDate:{month:7,day:4}});
 assert.deepEqual(edits,[{cardId:'x',name:'My card',feeDate:{month:7,day:4}}]);
 edits=withCardEdit(edits,card,{name:null});
 assert.deepEqual(edits,[{cardId:'x',feeDate:{month:7,day:4}}]);
 assert.deepEqual(withCardEdit(edits,card,{feeDate:null}),[]);
 for(const patch of [{tail:'123'},{tail:'4111111111111111'},{name:'<b>'},{feeDate:{month:2,day:31}},{bank:'Amex US'},{color:'red'}])assert.throws(()=>withCardEdit(edits,card,patch),JSON.stringify(patch));
 assert.deepEqual(withoutCardEdits([{cardId:'x',tail:'2222'},{cardId:'y',tail:'3333'}],'x'),[{cardId:'y',tail:'3333'}]);
});

test('a user correction wins over later bank refreshes and resets to the bank value',()=>{
 const read=name=>mergeWalletCards({cards:[],connections:[]},[{id:'bank-1',bank:'Chase',name,tail:'1111',identitySource:'bank-page'}]).cards;
 const edits=withCardEdit([],{id:'bank-1',bank:'Chase',identitySource:'bank-page'},{name:'Travel card',tail:'2222'});
 for(const bankName of ['SYNTHETIC REWARDS CARD (...1111)','SYNTHETIC REWARDS CARD v2']){
  const [shown]=applyCardEdits(read(bankName),edits).map(c=>presentCard(c,'en-US'));
  assert.equal(shown.name,'Travel card');assert.equal(shown.tail,'2222');
  assert.deepEqual(shown.userSet.sort(),['name','tail']);
  assert.equal(shown.detected.tail,'1111');
  // The bank's own words stay available for recognition and for "bank shows".
  assert.ok(shown.pageName.startsWith('SYNTHETIC REWARDS CARD'));
 }
 const [reset]=applyCardEdits(read('SYNTHETIC REWARDS CARD'),withCardEdit(edits,{id:'bank-1',bank:'Chase',identitySource:'bank-page'},{name:null,tail:null}));
 assert.equal(reset.name,'SYNTHETIC REWARDS CARD');assert.equal(reset.tail,'1111');assert.equal(reset.userSet,undefined);
 // The shown name of a recognised bank-page card is the product's, so the bank's own words can still be the user's choice.
 assert.deepEqual(applyCardEdits(read('Same'),[{cardId:'bank-1',name:'Same'}])[0].userSet,['name']);
});

test('a user name survives product recognition on a bank-page card',()=>{
 const p=cardProducts.find(x=>x.bank==='Chase');
 const [card]=applyCardEdits([{id:'b2',bank:'Chase',region:'US',identitySource:'bank-page',name:p.name,tail:'1212'}],[{cardId:'b2',name:'Mine'}]);
 const shown=presentCard(card,'zh-CN');
 assert.equal(shown.name,'Mine');assert.equal(shown.productId,p.id);
});

test('a manual card can move to another region of its issuer; a bank-page card cannot',()=>{
 const [us]=['Amex US'].map(bank=>newWalletCard({bank,name:'Synthetic',tail:'5555'},'m-amex'));
 assert.ok(regionBanks('Amex US').includes('Amex HK'));assert.ok(!regionBanks('Amex US').includes('Chase'));
 const edits=withCardEdit([],us,{bank:'Amex HK'});
 const [moved]=applyCardEdits([us],edits);
 assert.equal(moved.bank,'Amex HK');assert.equal(moved.region,'HK');assert.equal(moved.currency,'HKD');assert.equal(moved.detected.bank,'Amex US');
 assert.throws(()=>withCardEdit([],us,{bank:'Chase'}));
 assert.throws(()=>withCardEdit([],{...us,identitySource:'bank-page'},{bank:'Amex HK'}));
 // A product picked after the move is checked against the new region.
 const hk=cardProducts.find(p=>p.bank==='Amex HK');
 assert.equal(applyCardProductChoices([moved],withCardProductChoice([],moved,hk.id))[0].productId,hk.id);
});

test('backups carry the edits; a damaged backup is refused and a backup without them changes nothing',()=>{
 const mine=[{cardId:'a',feeDate:{month:1,day:2}},{cardId:'b',name:'Mine'}];
 assert.deepEqual(mergeCardEdits(mine,{schema:1,edits:[{cardId:'b',name:'Theirs'},{cardId:'c',tail:'7777'}]}),[{cardId:'a',feeDate:{month:1,day:2}},{cardId:'b',name:'Theirs'},{cardId:'c',tail:'7777'}]);
 for(const bad of [null,{schema:2,edits:[]},{schema:1,edits:{}},{schema:1,edits:[{cardId:'x',tail:'1'}]}])assert.throws(()=>mergeCardEdits(mine,bad));
 // main.jsx only merges when the backup has the section.
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.match(main,/d\.cardEdits\?mergeCardEdits\(loadCardEdits\(\),d\.cardEdits\):null/);
 assert.match(main,/cardEdits:\{schema:1,edits:loadCardEdits\(\)\}/);
});

test('an anniversary credit gets a real cycle from the user date, and stays cycle-unknown without one',()=>{
 const day='2026-11-10',{benefit}=anniversary;
 const without=creditTasks([manualCard()],day).filter(t=>t.ruleId===benefit.knowledgeRuleId);
 assert.equal(without.length,0);
 const [task]=creditTasks([manualCard({feeDate:{month:2,day:29}})],day).filter(t=>t.ruleId===benefit.knowledgeRuleId);
 assert.deepEqual(task.period,{start:'2026-02-28',end:'2027-02-27'});
 const unknown=queryCredits({},{cards:[manualCard()],day}).groups.cycleUnknown.find(x=>x.periodType==='account-anniversary');
 assert.equal(unknown.reason,'anniversary-date-unknown');
 const known=queryCredits({},{cards:[manualCard({feeDate:{month:1,day:31}})],day});
 assert.ok(!known.groups.cycleUnknown.some(x=>x.periodType==='account-anniversary'));
 assert.ok(known.groups.unknownStatus.some(x=>x.periodType==='account-anniversary'&&x.cycle.start==='2026-01-31'&&x.cycle.end==='2027-01-30'));
});

test('annual fee reminders use only a date the user set',()=>{
 const settings=normalizeSettings({enabled:true});
 assert.equal(settings.fees,true);assert.equal(settings.feeDays,7);
 assert.deepEqual(feeReminders([manualCard()],settings,'2026-11-10'),[]);
 const soon=manualCard({feeDate:{month:11,day:15}}),later=manualCard({id:'manual-2',feeDate:{month:12,day:15}});
 const rows=feeReminders([soon,later],settings,'2026-11-10');
 assert.deepEqual(rows.map(r=>[r.kind,r.days]),[['fee',5]]);
 assert.deepEqual(feeReminders([soon],normalizeSettings({enabled:true,feeDays:3}),'2026-11-10'),[]);
 const plan=buildSchedule({cards:[soon],marks:[],events:[],settings:{...settings,credits:false,bills:false},sent:[],asOf:'2026-11-10',phrases:{},translate:k=>k==='年费日'?'Annual fee date':k});
 const fee=plan.entries.find(e=>e.id.startsWith('fee:'));
 assert.equal(fee.group,'bills');assert.equal(fee.targetDay,'2026-11-15');assert.equal(fee.label,'Annual fee date · Synthetic Card');
 assert.equal(fee.firstDay,'2026-11-10');
 const off=pendingNotifications({cards:[soon],marks:[],events:[],settings:{...settings,fees:false},sent:[],asOf:'2026-11-10'});
 assert.ok(!off.some(n=>n.type==='fee'));
});

test('every new string has zh-TW and English text',()=>{
 const catalog=i18nCatalog;
 for(const file of ['CardEditor.jsx','WalletOnboarding.jsx','ReminderSettings.jsx'])for(const [,zh] of readFileSync(new URL('../src/'+file,import.meta.url),'utf8').matchAll(/\bt\('([^']*[一-鿿][^']*)'/g)){
  assert.ok(catalog['en-US'][zh],`${file}: no English for ${zh}`);assert.ok(catalog['zh-TW'][zh],`${file}: no zh-TW for ${zh}`);
 }
});

test('a manual card is edited in the registry, so discovery, refresh and older snapshots see the new tail and region',()=>{
 const manual=newWalletCard({bank:'Chase',name:'Synthetic',tail:'1243'},'m-typo');
 const registry=editManualCard([manual],manual,{tail:'1234'});
 assert.equal(registry[0].tail,'1234');assert.equal(registry[0].id,'m-typo');
 // The bank page later shows the same card: it is not added a second time.
 const merged=mergeWalletCards({cards:[],connections:[]},[...registry,{id:'discovered-chase-1234',bank:'Chase',name:'SYNTHETIC',tail:'1234',identitySource:'bank-page'}]).cards;
 assert.deepEqual(merged.map(c=>[c.id,c.tail]),[['m-typo','1234']]);
 // An imported snapshot still holding the old row takes the registry's edit.
 const fromSnapshot=mergeWalletCards({cards:[{...manual}],connections:[]},registry).cards;
 assert.deepEqual(fromSnapshot.map(c=>[c.id,c.tail]),[['m-typo','1234']]);
 // A region move is a real bank change, so a refresh of that bank includes it.
 const amex=newWalletCard({bank:'Amex US',name:'Synthetic',tail:'5555'},'m-amex');
 const [moved]=editManualCard([amex],amex,{bank:'Amex HK'});
 assert.deepEqual([moved.bank,moved.region,moved.currency],['Amex HK','HK','HKD']);
 // Duplicates, bank-page cards and invalid values are refused.
 assert.throws(()=>editManualCard([manual],manual,{tail:'7777'},[{id:'other',bank:'Chase',tail:'7777'}]),/duplicate_card/);
 assert.throws(()=>editManualCard([manual],manual,{tail:'8888'},[{id:'other',bank:'Chase',tail:'9999',detected:{tail:'8888'}}]),/duplicate_card/);
 assert.throws(()=>editManualCard([],{...manual,identitySource:'bank-page'},{tail:'1111'}),/invalid_card/);
 assert.throws(()=>editManualCard([manual],manual,{tail:'12'}),/invalid_card/);
 // A bank-page card's row is never rewritten by a manual row with its id.
 const bankRow={id:'b',bank:'Chase',name:'BANK',tail:'2222',identitySource:'bank-page',region:'US',currency:'USD'};
 assert.equal(mergeWalletCards({cards:[bankRow],connections:[]},[{id:'b',bank:'Chase',name:'Other',tail:'2222'}]).cards[0].name,'BANK');
});
