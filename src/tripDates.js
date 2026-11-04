// Date phrases are resolved here, against the wallet day, so the model never does calendar arithmetic.
export const MAX_TRIP_DAYS=92;
const pad=n=>String(n).padStart(2,'0');
const iso=(y,m,d)=>`${y}-${pad(m)}-${pad(d)}`;
const lastDay=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
export const isRealDate=value=>typeof value==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export const addDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export const tripDays=(start,end)=>Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000)+1;
const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const ZH_NUMBERS=[['十二',12],['十一',11],['十',10],['九',9],['八',8],['七',7],['六',6],['五',5],['四',4],['三',3],['二',2],['一',1]];
const SEP='(?:到|至|-|–|—|~|～|to|until|through|thru)';
const DAY='(\\d{1,2})(?:日|号|號|st|nd|rd|th)?';
function normalize(phrase){
 let text=phrase.normalize('NFKC').toLowerCase().trim();
 for(const [zh,n] of ZH_NUMBERS)text=text.replaceAll(zh+'月',n+'月');
 text=text.replace(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?/g,m=>(MONTHS.indexOf(m.slice(0,3))+1)+'月 ');
 // 12/2026 is a month; 12/20 is a day.
 text=text.replace(/\b(\d{1,2})\/(20\d{2})\b/g,'$2 $1月').replace(/\b(\d{1,2})\/(\d{1,2})\b/g,'$1月$2日');
 return text;
}
const failure=reason=>({ok:false,reason});
function finish(start,end,precision,assumptions,phrase,today){
 if(!isRealDate(start)||!isRealDate(end)||start>end)return failure('invalid_dates');
 if(end<today)return failure('past_dates');
 if(tripDays(start,end)>MAX_TRIP_DAYS)return failure('window_too_long');
 return {ok:true,start,end,precision,assumptions,phrase};
}
/** Returns {ok,start,end,precision,assumptions,phrase} or {ok:false,reason}. Nothing is guessed silently: every inference is listed. */
export function resolveTripDates(phrase,today){
 if(typeof phrase!=='string'||!phrase.trim()||!isRealDate(today))return failure('unparsed_dates');
 const raw=phrase.trim();
 const range=raw.match(/(20\d{2}-\d{2}-\d{2})\s*(?:到|至|-|–|—|~|～|to|until|through)\s*(20\d{2}-\d{2}-\d{2})/i);
 if(range)return finish(range[1],range[2],'days',[],raw,today);
 const single=raw.match(/20\d{2}-\d{2}-\d{2}/);
 if(single)return finish(single[0],single[0],'days',[],raw,today);
 const text=normalize(raw),thisYear=Number(today.slice(0,4)),thisMonth=Number(today.slice(5,7));
 const stated=text.match(/\b(20\d{2})\b|(20\d{2})年/);
 const year=stated?Number(stated[1]||stated[2]):/明年|next year/.test(text)?thisYear+1:/今年|this year/.test(text)?thisYear:null;
 // Next occurrence, reported as an assumption, when the phrase gives no year.
 const place=(build)=>{
  if(year)return {...build(year),assumptions:[]};
  const first=build(thisYear);
  if(first.end>=today)return {...first,assumptions:['year-assumed-next-occurrence']};
  return {...build(thisYear+1),assumptions:['year-assumed-next-occurrence','rolled-to-next-year']};
 };
 const whole=(m,precision,extra=[])=>{
  const placed=place(y=>({start:iso(y,m,1),end:iso(y,m,lastDay(y,m))}));
  const started=placed.start<=today&&placed.end>=today;
  return finish(started?today:placed.start,placed.end,precision,[...placed.assumptions,...extra,...(started?['started-from-today']:[])],raw,today);
 };
 const days=text.match(new RegExp(`(\\d{1,2})月\\s*${DAY}\\s*${SEP}\\s*(?:(\\d{1,2})月\\s*)?${DAY}(?!\\d|月)`));
 if(days){
  const [,m1,d1,m2,d2]=days.map(Number),endMonth=m2||m1,wraps=endMonth<m1;
  const placed=place(y=>({start:iso(y,m1,d1),end:iso(wraps?y+1:y,endMonth,d2)}));
  return finish(placed.start,placed.end,'days',placed.assumptions,raw,today);
 }
 const oneDay=text.match(new RegExp(`(\\d{1,2})月\\s*${DAY}(?!\\d|月)`));
 if(oneDay){
  const m=Number(oneDay[1]),d=Number(oneDay[2]),placed=place(y=>({start:iso(y,m,d),end:iso(y,m,d)}));
  return finish(placed.start,placed.end,'days',placed.assumptions,raw,today);
 }
 if(/圣诞|聖誕|christmas|xmas/.test(text)){
  const y=year||(today>iso(thisYear,12,25)?thisYear+1:thisYear);
  if(/跨年|元旦|new year/.test(text))return finish(iso(y,12,24),iso(y+1,1,1),'holiday',['christmas-through-new-year-assumed-12-24-to-01-01',...(year?[]:['year-assumed-next-occurrence'])],raw,today);
  const start=today>=iso(y,12,1)&&today<=iso(y,12,31)?today:iso(y,12,1);
  return finish(start,iso(y,12,31),'holiday',['christmas-assumed-whole-december-no-stay-dates-given',...(year?[]:['year-assumed-next-occurrence']),...(start===today?['started-from-today']:[])],raw,today);
 }
 const months=text.match(new RegExp(`(\\d{1,2})月\\s*${SEP}\\s*(\\d{1,2})月`));
 if(months){
  const m1=Number(months[1]),m2=Number(months[2]),wraps=m2<m1;
  const placed=place(y=>({start:iso(y,m1,1),end:iso(wraps?y+1:y,m2,lastDay(wraps?y+1:y,m2))}));
  return finish(placed.start,placed.end,'month',[...placed.assumptions,'whole-months-assumed-no-stay-dates-given'],raw,today);
 }
 const month=text.match(/(\d{1,2})月/);
 if(month){
  const m=Number(month[1]);if(m<1||m>12)return failure('invalid_dates');
  const part=/月初|上旬|\bearly\b|beginning/.test(text)?[1,10]:/中旬|月中|\bmid\b|middle/.test(text)?[11,20]:/月底|月末|下旬|\blate\b|\bend of\b/.test(text)?[21,null]:null;
  if(part){
   const placed=place(y=>({start:iso(y,m,part[0]),end:iso(y,m,part[1]||lastDay(y,m))}));
   return finish(placed.start,placed.end,'part-of-month',[...placed.assumptions,'part-of-month-assumed-from-phrase'],raw,today);
  }
  return whole(m,'month',['whole-month-assumed-no-stay-dates-given']);
 }
 const relative=/下个月|下個月|下月|next month/.test(text)?1:/这个月|這個月|本月|this month/.test(text)?0:null;
 if(relative!==null){
  const m=(thisMonth-1+relative)%12+1,y=thisYear+(thisMonth+relative>12?1:0),started=relative===0;
  return finish(started?today:iso(y,m,1),iso(y,m,lastDay(y,m)),'month',['whole-month-assumed-no-stay-dates-given',...(started?['started-from-today']:[])],raw,today);
 }
 return failure('unparsed_dates');
}
