// A card's annual fee date, which is also its account anniversary. Banks do not show it, so it only ever
// comes from the user: month and day, and the year the card was opened if they know it. Nothing here
// fills it in, defaults it to the 1st or works it out from other dates.
const DAY_MS=86400000;
const pad=n=>String(n).padStart(2,'0');
const leap=y=>y%4===0&&(y%100!==0||y%400===0);
const daysIn=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
const isDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const shift=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*DAY_MS).toISOString().slice(0,10);
/** A valid fee date, cleaned, or null. Feb 29 is allowed without a year; with a year it must be a leap year. */
export function cleanFeeDate(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const {month,day,year}=value;
 if(!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1)return null;
 if(year!=null&&(!Number.isInteger(year)||year<1950||year>2100))return null;
 if(day>(month===2?(year!=null&&!leap(year)?28:29):daysIn(2001,month)))return null;
 return year!=null?{month,day,year}:{month,day};
}
/** The fee date in a given year. Feb 29 falls on Feb 28 in a common year, as a bank posts it on the month's last day. */
export function feeDayIn(feeDate,year){
 const d=cleanFeeDate(feeDate);if(!d)return null;
 return `${year}-${pad(d.month)}-${pad(Math.min(d.day,daysIn(year,d.month)))}`;
}
/**
 * The card year that contains asOf: from the fee date on or before it to the day before the next one.
 * Null without a fee date, and before the first fee date when the user gave the year the card was opened.
 */
export function anniversaryPeriod(feeDate,asOf){
 const d=cleanFeeDate(feeDate);if(!d||!isDay(asOf))return null;
 const y=Number(asOf.slice(0,4)),thisYear=feeDayIn(d,y),startYear=thisYear<=asOf?y:y-1;
 if(d.year!=null&&startYear<d.year)return null;
 return {start:feeDayIn(d,startYear),end:shift(feeDayIn(d,startYear+1),-1)};
}
/** The next fee date on or after asOf, or null without a fee date. */
export function nextFeeDay(feeDate,asOf){
 const d=cleanFeeDate(feeDate);if(!d||!isDay(asOf))return null;
 const y=Math.max(Number(asOf.slice(0,4)),d.year??0),day=feeDayIn(d,y);
 return day>=asOf?day:feeDayIn(d,y+1);
}
/** Month-day text for display: 03-15, or 2024-03-15 when the year is known. */
export const feeDateText=feeDate=>{const d=cleanFeeDate(feeDate);return d?`${d.year!=null?d.year+'-':''}${pad(d.month)}-${pad(d.day)}`:'';};
/** The card years from the fee date, newest first: the one containing asOf and the `count-1` before it. */
export function cardYears(feeDate,asOf,count=3){
 const now=anniversaryPeriod(feeDate,asOf);if(!now)return [];
 const out=[now];
 while(out.length<count){const p=anniversaryPeriod(feeDate,shift(out.at(-1).start,-1));if(!p)break;out.push(p);}
 return out;
}
/**
 * A fee date from card years recorded before the fee date drove them: the latest start wins. `conflict` lists
 * every month-day the records used when they disagree, so the wallet can say which dates it chose between.
 */
export function feeDateFromCycles(starts){
 const days=(starts||[]).filter(isDay).sort().reverse();if(!days.length)return null;
 const feeDate=cleanFeeDate({month:Number(days[0].slice(5,7)),day:Number(days[0].slice(8,10))});if(!feeDate)return null;
 const seen=[...new Set(days.map(d=>d.slice(5)))];
 return seen.length>1?{feeDate,conflict:seen}:{feeDate};
}
