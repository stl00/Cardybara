// Hand-entered statement balance, minimum and due date (stl00/Cardybara#376). All cards and amounts are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CARD_EDITS_KEY,readCardEdits,withCardEdit,applyCardEdits,mergeCardEdits} from '../src/cardEdits.js';
import {paymentItem} from '../src/paymentStates.js';
import {buildSchedule,normalizeSettings} from '../src/reminders.js';
import {translations} from '../src/i18n/index.js';

const asOf='2026-11-10';
const blank={id:'c1',bank:'chase',name:'Synthetic Card',tail:'1234',currency:'USD'};
const bill={statement:250.5,minimum:35,due:'2026-11-25',at:'2026-11-08T12:00:00.000Z'};
const shown=(card,edits)=>applyCardEdits([card],edits)[0];

test('a manual bill is shown, marked with its entry time, and drives the payment state',()=>{
 const edits=withCardEdit([],blank,{bill});
 const card=shown(blank,edits);
 assert.deepEqual([card.statement,card.minimum,card.due],[250.5,35,'2026-11-25']);
 assert.deepEqual(Object.keys(card.manualBill).sort(),['due','minimum','statement']);
 assert.equal(card.manualBill.due,bill.at);
 const item=paymentItem(card,[],asOf);
 assert.equal(item.state,'due');assert.equal(item.days,15);assert.equal(item.cycle.date,'2026-11-25');
});

test('a bank read newer than the entry replaces the manual value; an older one does not',()=>{
 const edits=withCardEdit([],blank,{bill});
 const older={...blank,statement:100,minimum:20,due:'2026-11-20',updated:'2026-11-01',fieldDates:{statement:'2026-11-01',minimum:'2026-11-01',due:'2026-11-01'}};
 assert.equal(shown(older,edits).statement,250.5);
 const newer={...older,fieldDates:{statement:'2026-11-09T08:00:00.000Z',minimum:'2026-11-01',due:'2026-11-09T08:00:00.000Z'}};
 const card=shown(newer,edits);
 assert.equal(card.statement,100);assert.equal(card.due,'2026-11-20');
 assert.equal(card.minimum,35); // that field was not re-read, so the manual one stands
 assert.deepEqual(Object.keys(card.manualBill),['minimum']);
 const allNewer={...newer,fieldDates:{statement:'2026-11-09',minimum:'2026-11-09',due:'2026-11-09'}};
 assert.equal(shown(allNewer,edits).manualBill,undefined);
});

test('a manual due date replaces an older yearless bank label, a newer label wins',()=>{
 const edits=withCardEdit([],blank,{bill});
 const yearless={...blank,duePartial:'12/05',fieldDates:{duePartial:'2026-11-01'}};
 const card=shown(yearless,edits);
 assert.equal(card.due,'2026-11-25');assert.equal(card.duePartial,undefined);
 assert.equal(paymentItem(card,[],asOf).cycle.kind,'date');
 const fresh={...yearless,fieldDates:{duePartial:'2026-11-09'}};
 assert.equal(shown(fresh,edits).duePartial,'12/05');assert.equal(shown(fresh,edits).due,undefined);
});

test('clearing returns to unknown, with no zero fill; a partial entry keeps the rest unknown',()=>{
 let edits=withCardEdit([],blank,{bill});
 edits=withCardEdit(edits,blank,{bill:null});
 assert.deepEqual(edits,[]);
 const card=shown(blank,edits);
 assert.equal(card.statement,undefined);assert.equal(card.due,undefined);
 assert.equal(paymentItem(card,[],asOf).state,'unknown');
 const only=shown(blank,withCardEdit([],blank,{bill:{due:'2026-11-25',at:bill.at}}));
 assert.equal(only.statement,undefined);assert.equal(only.minimum,undefined);assert.equal(only.due,'2026-11-25');
 // Entering a new set without a field clears that field.
 const again=withCardEdit(withCardEdit([],blank,{bill}),blank,{bill:{statement:10,at:'2026-11-09T00:00:00.000Z'}});
 assert.deepEqual(again[0].bill,{at:'2026-11-09T00:00:00.000Z',statement:10});
});

test('invalid manual values throw and nothing half-saves',()=>{
 for(const bad of [{statement:-1},{statement:'12'},{minimum:NaN},{due:'2026-02-30'},{due:'11/25'}])
  assert.throws(()=>withCardEdit([],blank,{bill:{...bad,at:bill.at}}),/invalid_card_bill/);
 assert.throws(()=>withCardEdit([],blank,{bill:{statement:5}}),/invalid_card_bill/); // no entry time: never stored undated
});

test('reminders read the manual due date like a collected one',()=>{
 const card=shown(blank,withCardEdit([],blank,{bill}));
 const plan=cards=>buildSchedule({cards,marks:[],events:[],settings:normalizeSettings({enabled:true}),sent:[],asOf,phrases:{},days:20});
 const json=JSON.stringify(plan([card]));
 assert.ok(json.includes('bill:'),'a bill reminder is planned from the manual due date');
 assert.ok(!JSON.stringify(plan([blank])).includes('bill:'),'without it there is nothing to plan');
});

test('backup export and import round-trips the manual bill',()=>{
 const edits=withCardEdit([],blank,{bill});
 const wire=JSON.parse(JSON.stringify({schema:1,edits}));
 assert.deepEqual(mergeCardEdits([],wire),edits);
 assert.deepEqual(readCardEdits({getItem:k=>k===CARD_EDITS_KEY?JSON.stringify(edits):null}),edits);
 assert.throws(()=>mergeCardEdits([],{schema:1,edits:[{cardId:'c1',bill:{statement:-5,at:bill.at}}]}),/invalid_card_edits_backup/);
});

test('the manual bill strings exist in all three languages',()=>{
 const src=readFileSync(new URL('../src/CardEditor.jsx',import.meta.url),'utf8');
 const keys=[...src.matchAll(/t\('([^']*(?:账单|最低还款|到期还款|你填写)[^']*)'/g)].map(m=>m[1]);
 assert.ok(keys.length>=6,String(keys.length));
 for(const lang of ['en-US','zh-TW'])for(const k of keys)assert.ok(translations[lang][k],`${lang}: ${k}`);
});
