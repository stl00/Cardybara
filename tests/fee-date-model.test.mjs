// One annual fee date per card drives every card-year cycle (stl00/Cardybara#205). Dates and ids are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cardYears,feeDateFromCycles,anniversaryPeriod} from '../src/feeDate.js';
import {readCardEdits,withCardEdit,withMigratedFeeDates,migrateFeeDatesOnce,applyCardEdits,mergeCardEdits,CARD_EDITS_KEY} from '../src/cardEdits.js';
const src=file=>readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
const card=(id,extra={})=>({id,name:'Synthetic '+id,bank:'Chase',region:'US',currency:'USD',identitySource:'manual',...extra});

test('card years for cost tracking come from the fee date, newest first, and stop at a known opening year',()=>{
 assert.deepEqual(cardYears({month:3,day:15},'2026-11-11'),[
  {start:'2026-03-15',end:'2027-03-14'},{start:'2025-03-15',end:'2026-03-14'},{start:'2024-03-15',end:'2025-03-14'}]);
 assert.deepEqual(cardYears({month:2,day:29},'2025-03-01',2),[{start:'2025-02-28',end:'2026-02-27'},{start:'2024-02-29',end:'2025-02-27'}]);
 assert.deepEqual(cardYears({month:3,day:15,year:2025},'2026-11-11').map(y=>y.start),['2026-03-15','2025-03-15']);
 assert.deepEqual(cardYears(null,'2026-11-11'),[]);
 assert.equal(cardYears({month:3,day:15},'2026-11-11')[0].start,anniversaryPeriod({month:3,day:15},'2026-11-11').start);
});

test('a fee date from older card-year records: the latest start wins and a disagreement is listed',()=>{
 assert.deepEqual(feeDateFromCycles(['2025-03-15','2024-03-15']),{feeDate:{month:3,day:15}});
 assert.deepEqual(feeDateFromCycles(['2024-01-01','2026-04-02','2025-03-15']),{feeDate:{month:4,day:2},conflict:['04-02','03-15','01-01']});
 assert.deepEqual(feeDateFromCycles(['2024-02-29']),{feeDate:{month:2,day:29}});
 assert.equal(feeDateFromCycles([]),null);
 assert.equal(feeDateFromCycles(['not-a-day','2026-02-30']),null);
});

test('migration fills only cards without a fee date and keeps a note when records conflicted',()=>{
 const edits=withCardEdit([],card('kept'),{feeDate:{month:9,day:9}});
 const cycles=[{cardId:'kept',start:'2026-01-01'},{cardId:'one',start:'2025-06-10'},{cardId:'one',start:'2026-06-10'},{cardId:'two',start:'2024-05-01'},{cardId:'two',start:'2025-05-03'}];
 const next=withMigratedFeeDates(edits,cycles);
 const row=id=>next.find(e=>e.cardId===id);
 assert.deepEqual(row('kept'),{cardId:'kept',feeDate:{month:9,day:9}});
 assert.deepEqual(row('one'),{cardId:'one',feeDate:{month:6,day:10}});
 assert.deepEqual(row('two'),{cardId:'two',feeDate:{month:5,day:3},feeDateConflict:['05-03','05-01']});
 // Running it again changes nothing, and no records means the same edits back.
 assert.deepEqual(withMigratedFeeDates(next,cycles),next);
 assert.equal(withMigratedFeeDates(edits,[]),edits);
 // The note survives storage and backups, shows on the card, and goes once the user sets or clears the date.
 const storage={getItem:k=>k===CARD_EDITS_KEY?JSON.stringify(next):null};
 assert.deepEqual(readCardEdits(storage),next);
 assert.deepEqual(mergeCardEdits([],{schema:1,edits:next}).find(e=>e.cardId==='two'),row('two'));
 const [shown]=applyCardEdits([card('two')],next);
 assert.deepEqual(shown.feeDateConflict,['05-03','05-01']);assert.deepEqual(shown.feeDate,{month:5,day:3});
 assert.equal(withCardEdit(next,card('two'),{feeDate:{month:5,day:1}}).find(e=>e.cardId==='two').feeDateConflict,undefined);
 assert.equal(withCardEdit(next,card('two'),{feeDate:null}).find(e=>e.cardId==='two'),undefined);
 // A damaged note is dropped without losing the date.
 const damaged={getItem:()=>JSON.stringify([{cardId:'x',feeDate:{month:1,day:2},feeDateConflict:['1-2',5]},{cardId:'y',feeDateConflict:['01-02','03-04']}])};
 assert.deepEqual(readCardEdits(damaged),[{cardId:'x',feeDate:{month:1,day:2}}]);
});

test('each card migrates once: a cleared date stays cleared, records restored later still migrate',()=>{
 const first=migrateFeeDatesOnce([],[{cardId:'a',start:'2025-03-15'}],null);
 assert.deepEqual(first.edits,[{cardId:'a',feeDate:{month:3,day:15}}]);assert.deepEqual(first.done,['a']);assert.equal(first.changed,true);
 // The user clears the date; the same records on the next load do not bring it back.
 const cleared=withCardEdit(first.edits,card('a'),{feeDate:null});
 const again=migrateFeeDatesOnce(cleared,[{cardId:'a',start:'2025-03-15'}],first.done);
 assert.deepEqual(again.edits,[]);assert.equal(again.changed,false);
 // A new browser with an empty ledger, then an older backup's records arrive: the card still gets its date.
 const empty=migrateFeeDatesOnce([],[],null);assert.equal(empty.changed,false);assert.deepEqual(empty.done,[]);
 const restored=migrateFeeDatesOnce(empty.edits,[{cardId:'b',start:'2024-07-04'},{cardId:'b',start:'2025-07-04'}],empty.done);
 assert.deepEqual(restored.edits,[{cardId:'b',feeDate:{month:7,day:4}}]);assert.deepEqual(restored.done,['b']);
 // A damaged done list reads as nothing handled.
 assert.deepEqual(migrateFeeDatesOnce([],[{cardId:'c',start:'2025-01-31'}],'oops').edits,[{cardId:'c',feeDate:{month:1,day:31}}]);
});

test('no per-cycle date inputs remain: cost tracking derives its card year from the card fee date',()=>{
 const ui=src('CostTrackingUI.jsx');
 assert.doesNotMatch(ui,/<Input type="date"[^>]*name="(start|end)"|name="start"[^>]*>\s*<Input type="date"/);
 assert.doesNotMatch(ui,/annualEnd/);
 assert.match(ui,/cardYears\(card\.feeDate/);
 assert.match(ui,/migrateFeeDatesOnce/);
 // A card year that overlaps any record is not offered, since the ledger would refuse it.
 assert.match(ui,/r\.value\.start<=y\.end&&r\.value\.end>=y\.start/);
 // Saving the editor with the same date confirms it and clears a migration conflict note.
 assert.match(src('CardEditor.jsx'),/fee&&card\.feeDateConflict\)patch\.feeDate=fee/);
});

test('every card shows the same fee date row; card-year credits get one compact prompt',()=>{
 const editor=src('CardEditor.jsx');
 assert.match(editor,/\{key:'fee',label:t\('年费日'\)/);
 assert.match(editor,/className="fee-date-set"/);
 assert.equal(editor.match(/className="fee-date-prompt"/g).length,1);
 assert.match(editor,/t\('填年费日，周年福利才能算周期'\)/);
 assert.doesNotMatch(editor,/请设置年费日/);
});
