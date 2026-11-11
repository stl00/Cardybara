import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inferDueDate,parseMonthDay,readDayOf} from '../src/dueYear.js';
import {cardDue} from '../src/agentData.js';

test('the year is the one that puts the date nearest the day it was read (issue cases)',()=>{
 assert.equal(inferDueDate('January 15','2026-12-20'),'2027-01-15');
 assert.equal(inferDueDate('December 28','2026-01-03'),'2025-12-28');
 assert.equal(inferDueDate('November 22','2026-11-11'),'2026-11-22');
});
test('year boundaries and the tie rule',()=>{
 assert.equal(inferDueDate('Jan 1','2026-12-31'),'2027-01-01');
 assert.equal(inferDueDate('Dec 31','2027-01-01'),'2026-12-31');
 assert.equal(inferDueDate('Jun 30','2026-06-30'),'2026-06-30','the read day itself');
 // Half a year either way: the coming date wins a tie.
 assert.equal(inferDueDate('Jul 3','2026-01-02'),'2026-07-03','182 days ahead');
 assert.equal(inferDueDate('Jul 2','2026-01-01'),'2026-07-02','182 days ahead beats 183 back');
 assert.equal(inferDueDate('Jan 1','2026-07-02'),'2026-01-01','182 back beats 183 ahead');
 assert.equal(inferDueDate('Jan 1','2026-07-03'),'2027-01-01','182 ahead beats 183 back');
 assert.equal(inferDueDate('Mar 1','2027-08-31'),'2028-03-01','a tie (183 days each way, across Feb 29) goes forward');
});
test('Feb 29 is a candidate only in a leap year',()=>{
 assert.equal(inferDueDate('Feb 29','2028-02-10'),'2028-02-29');
 assert.equal(inferDueDate('2月29日','2027-12-20'),'2028-02-29','next year is the leap year');
 assert.equal(inferDueDate('Feb 29','2029-01-15'),'2028-02-29','last year is the leap year');
 assert.equal(inferDueDate('Feb 29','2026-02-10'),null,'no leap year among the candidates');
 assert.equal(inferDueDate('Feb 28','2028-02-10'),'2028-02-28');
});
test('every form the collector stores is read; anything else gives nothing',()=>{
 for(const [label,want] of [['11月6日',[11,6]],['11月 23日',[11,23]],['12月19日',[12,19]],['Nov 6',[11,6]],['November 19',[11,19]],['Dec 19',[12,19]],['Mar 7',[3,7]],['nov 06',[11,6]],['Sept 3',[9,3]],['Sep. 3',[9,3]]])
  assert.deepEqual(parseMonthDay(label),{month:want[0],day:want[1]},label);
 for(const label of ['','13月1日','0月2日','4月31日','2月30日','Nov 31','Novem 6','Smarch 6','Nov','6 Nov','2026-11-06','11/06',null,undefined,42])
  assert.equal(parseMonthDay(label),null,String(label));
 assert.equal(inferDueDate('Nov 31','2026-11-11'),null);
});
test('the read day comes from a date or a timestamp on the wallet calendar',()=>{
 assert.equal(readDayOf('2026-12-20'),'2026-12-20');
 assert.equal(readDayOf('2027-01-01T03:00:00Z'),'2026-12-31','Chicago calendar');
 for(const bad of ['', 'yesterday','2026-02-30',null,undefined])assert.equal(readDayOf(bad),null,String(bad));
 assert.equal(inferDueDate('Jan 15',undefined),null,'no read day, no year');
 assert.equal(inferDueDate('Jan 15','garbage'),null);
});
test('a card gets its due date from the latest reading, the bank\'s full date first',()=>{
 const card=f=>({id:'s',bank:'Amex US',currency:'USD',updated:'2026-12-20',...f});
 assert.deepEqual(cardDue(card({duePartial:'Jan 15',fieldDates:{duePartial:'2026-12-20T18:00:00Z'}})),{date:'2027-01-15',field:'duePartial',inferred:true,label:'Jan 15'});
 assert.deepEqual(cardDue(card({duePartial:'Jan 15'})),null,'a yearless date with no reading time of its own is not the latest reading');
 assert.deepEqual(cardDue(card({due:'2027-01-10',duePartial:'Jan 15',fieldDates:{due:'2026-12-21T00:00:00Z',duePartial:'2026-12-20T00:00:00Z'}})),{date:'2027-01-10',field:'due',inferred:false});
 assert.deepEqual(cardDue(card({due:'2026-12-10',duePartial:'Jan 15',fieldDates:{due:'2026-11-21T00:00:00Z',duePartial:'2026-12-20T00:00:00Z'}})).date,'2027-01-15','a newer yearless reading replaces an older full date');
 assert.equal(cardDue(card({due:'2026-12-10',duePartial:'Smarch 15',fieldDates:{due:'2026-11-21T00:00:00Z',duePartial:'2026-12-20T00:00:00Z'}})),null,'an unreadable newer label does not fall back to the old date');
 assert.equal(cardDue(card({due:'2026-02-30'})),null);
});
test('the wallet shows the inferred date with its note in three languages',()=>{
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8'),pay=readFileSync(new URL('../src/PaymentAssistant.jsx',import.meta.url),'utf8');
 const catalog=JSON.parse(readFileSync(new URL('../src/translations.json',import.meta.url),'utf8'));
 assert.match(main,/cardDue\(c\)/,'card list');assert.match(main,/cardDue\(detail\)/,'card details');assert.match(pay,/cycle\.inferred/,'payment assistant');
 for(const key of ['（年份按读取日期推断）','年份按读取日期推断'])for(const lang of ['en-US','zh-TW'])assert.ok(catalog[lang][key],`${lang}: ${key}`);
});
