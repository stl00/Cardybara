// Some banks print the due date without a year. The date on the page belongs to the statement
// cycle in progress, so it lies close to the day it was read: the year is the one (read year −1, same
// or +1) that puts the month and day nearest that day, the coming side winning a tie. The read day is
// used, never today, so a date read on 20 December stays in January of the next year forever.
const DAY_MS=86400000;
const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const isoDay=/^\d{4}-\d{2}-\d{2}$/;
const chicagoDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'});
const pad=n=>String(n).padStart(2,'0');
const leap=y=>y%4===0&&(y%100!==0||y%400===0);
const daysIn=(y,m)=>[31,leap(y)?29:28,31,30,31,30,31,31,30,31,30,31][m-1];

/** Month and day from the forms the collector stores ("11月 23日", "Nov 6", "November 19"), or null. */
export function parseMonthDay(label){
 const text=String(label??'').normalize('NFKC').trim();
 let month,day;
 const zh=text.match(/^(\d{1,2})\s*月\s*(\d{1,2})\s*日$/);
 if(zh){month=Number(zh[1]);day=Number(zh[2]);}
 else{
  const en=text.match(/^([a-z]+)\.?\s+(\d{1,2})$/i),name=en?.[1].toLowerCase(),at=name?MONTHS.indexOf(name.slice(0,3)):-1;
  // The full name or its three-letter form ("Sept" too), nothing in between that could be another word.
  const full=at<0?'':['january','february','march','april','may','june','july','august','september','october','november','december'][at];
  if(at<0||!(name===MONTHS[at]||name===full||name==='sept'))return null;
  month=at+1;day=Number(en[2]);
 }
 // Feb 29 exists in some year; a day no year has is not a date.
 return month>=1&&month<=12&&day>=1&&day<=daysIn(2000,month)?{month,day}:null;
}

/** The calendar day a reading was taken on, on the wallet's calendar; null when it is unusable. */
export function readDayOf(value){
 if(typeof value!=='string'||!value)return null;
 if(isoDay.test(value)){const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value?value:null;}
 const date=new Date(value);return Number.isFinite(date.getTime())?chicagoDay.format(date):null;
}

/** "YYYY-MM-DD" for a yearless bank date read on `readAt`, or null when either cannot be used. */
export function inferDueDate(label,readAt){
 const md=parseMonthDay(label),day=readDayOf(readAt);
 if(!md||!day)return null;
 const year=Number(day.slice(0,4)),base=Date.parse(day+'T00:00:00Z');
 let best=null;
 for(const y of [year-1,year,year+1]){
  if(md.day>daysIn(y,md.month))continue; // Feb 29 in a common year is not a candidate.
  const iso=`${y}-${pad(md.month)}-${pad(md.day)}`,diff=(Date.parse(iso+'T00:00:00Z')-base)/DAY_MS;
  if(!best||Math.abs(diff)<Math.abs(best.diff)||(Math.abs(diff)===Math.abs(best.diff)&&diff>best.diff))best={iso,diff};
 }
 return best?.iso??null;
}
