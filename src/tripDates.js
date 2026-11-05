// Date phrases are resolved here, against the wallet day, so the model never does calendar arithmetic.
// The grammar fails closed: a phrase is accepted only if every date-like part of it was understood.
export const MAX_TRIP_DAYS=92;
const pad=n=>String(n).padStart(2,'0');
const iso=(y,m,d)=>`${y}-${pad(m)}-${pad(d)}`;
const lastDay=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
export const isRealDate=value=>typeof value==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export const addDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export const tripDays=(start,end)=>Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000)+1;
const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const ZH_DIGITS={'〇':0,'零':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
const SEP='(?:到|至|-|–|—|~|～|to|until|through|thru)';
const DAY_END='(?:日|号|號|st|nd|rd|th)?';
const PARTS={初:[1,10],月初:[1,10],上旬:[1,10],中旬:[11,20],月中:[11,20],底:[21,null],月底:[21,null],末:[21,null],月末:[21,null],下旬:[21,null]};
const PART='月初|月中|月底|月末|上旬|中旬|下旬|初|底|末';
const zhNumber=text=>{
 if(!text.includes('十'))return Number([...text].map(c=>ZH_DIGITS[c]).join(''));
 const [tens,ones]=text.split('十');return (tens?ZH_DIGITS[tens]:1)*10+(ones?ZH_DIGITS[ones]:0);
};
/** Rewrites every supported spelling into [YYYY年]M月[D日|part], so one grammar reads them all. */
function canonical(phrase,today){
 const thisYear=Number(today.slice(0,4)),thisMonth=Number(today.slice(5,7));
 let t=phrase.normalize('NFKC').toLowerCase().trim();
 t=t.replace(/[〇零一二三四五六七八九]{4}(?=年)/g,m=>[...m].map(c=>ZH_DIGITS[c]).join(''));
 t=t.replace(/[一二三四五六七八九十]+(?=月)/g,zhNumber).replace(/[一二三四五六七八九十]+(?=[日号號])/g,zhNumber);
 t=t.replace(/\b(20\d{2})-(\d{2})-(\d{2})\b/g,'$1年$2月$3日').replace(/\b(20\d{2})\/(\d{1,2})\/(\d{1,2})\b/g,'$1年$2月$3日');
 t=t.replace(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g,'$3年$1月$2日').replace(/\b(\d{1,2})\/(20\d{2})\b/g,'$2年$1月').replace(/\b(20\d{2})\/(\d{1,2})\b/g,'$1年$2月').replace(/\b(\d{1,2})\/(\d{1,2})\b/g,'$1月$2日');
 // "may" is an ordinary English word, so it is a month only where the phrase reads as a date.
 t=t.replace(/\bmay\b(?=\.?\s*(?:\d|$|to\b|-))|(?<=(?:^|\bin |\d\s))may\b/g,'may_month');
 t=t.replace(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may_month|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?/g,m=>(MONTHS.indexOf(m.slice(0,3))+1)+'月 ');
 t=t.replace(/\b(\d{1,2})月\s*(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(20\d{2})\b/g,'$3年$1月$2日').replace(/\b(\d{1,2})月\s*,?\s*(20\d{2})\b/g,'$2年$1月').replace(/\b(20\d{2})\s+(\d{1,2})月/g,'$1年$2月');
 t=t.replace(new RegExp(`(?<![\\d月])(\\d{1,2})\\s*${SEP}\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(\\d{1,2})月`,'g'),'$3月$1日到$2日').replace(/(?<![\d月])(\d{1,2})(?:st|nd|rd|th)?\s+(\d{1,2})月/g,'$2月$1日');
 t=t.replace(/\b(?:early|beginning of)\s+(\d{1,2})月/g,'$1月初').replace(/\b(?:mid|middle of)[\s-]+(\d{1,2})月/g,'$1月中旬').replace(/\b(?:late|end of)\s+(\d{1,2})月/g,'$1月底');
 const next=thisMonth===12?iso(thisYear+1,1,1):iso(thisYear,thisMonth+1,1);
 t=t.replace(/下个月|下個月|下月|next month/g,`${Number(next.slice(0,4))}年${Number(next.slice(5,7))}月`).replace(/这个月|這個月|本月|this month/g,`${thisYear}年${thisMonth}月`);
 t=t.replace(/明年|next year/g,'@NEXT').replace(/今年|this year/g,'@THIS');
 for(const [marker,year] of [['@NEXT',thisYear+1],['@THIS',thisYear]])t=t.replace(new RegExp(`${marker}\\s*(?:的|in\\s+)?(\\d{1,2})月`,'g'),`${year}年$1月`).replace(new RegExp(`(\\d{1,2})月\\s*(?:of\\s+)?${marker}`,'g'),`${year}年$1月`);
 t=t.replace(/christmas(?: day| eve)?|xmas|圣诞节?|聖誕節?/g,'<X>').replace(/new year(?:'s)?(?: day| eve)?|元旦|跨年/g,'<N>');
 // "12月圣诞节" and "Christmas in December" name the holiday twice.
 t=t.replace(/(?:20\d{2}年)?12月\s*(?:的\s*)?<X>/g,m=>(m.match(/20\d{2}/)?m.match(/20\d{2}/)[0]+'年':'')+'<X>').replace(/<X>\s*(?:in\s+)?(?:20\d{2}年)?12月/g,'<X>');
 return t;
}
const endpointPattern=`(?:(20\\d{2})年)?\\s*(\\d{1,2})月\\s*(?:(${PART})|(\\d{1,2})${DAY_END}(?![\\d月]))?`;
const toEndpoint=([,y,m,part,d])=>{
 const month=Number(m);if(month<1||month>12)return null;
 const range=part?PARTS[part]:null;
 return {year:y?Number(y):null,month,from:d?Number(d):range?range[0]:1,to:d?Number(d):range?range[1]:null,kind:d?'day':part?'part':'month'};
};
const failure=reason=>({ok:false,reason});
function finish(start,end,precision,assumptions,phrase,today){
 if(!isRealDate(start)||!isRealDate(end)||start>end)return failure('invalid_dates');
 if(end<today)return failure('past_dates');
 if(tripDays(start,end)>MAX_TRIP_DAYS)return failure('window_too_long');
 return {ok:true,start,end,precision,assumptions,phrase};
}
/** The earliest year whose window has not ended, so a stay already under way stays in place. */
function placeYears(first,second,today){
 const thisYear=Number(today.slice(0,4));
 const build=y=>{const endYear=second.year||(second.month<first.month?y+1:y);return {start:iso(y,first.month,first.from),end:iso(endYear,second.month,second.to||lastDay(endYear,second.month)),year:y};};
 if(first.year)return {...build(first.year),assumptions:[]};
 const placed=[thisYear-1,thisYear,thisYear+1].map(build).find(w=>w.end>=today);
 return {...placed,assumptions:['year-assumed-next-occurrence',...(placed.year>thisYear?['rolled-to-next-year']:[])]};
}
/** Returns {ok,start,end,precision,assumptions,phrase} or {ok:false,reason}. Every inference is listed; nothing is guessed silently. */
export function resolveTripDates(phrase,today){
 if(typeof phrase!=='string'||!phrase.trim()||!isRealDate(today))return failure('unparsed_dates');
 const raw=phrase.trim();
 // Words that shift or measure dates in ways this grammar does not model.
 if(/下下|上个月|上個月|去年|前年|\blast\b|\bprevious\b|\bago\b|\d\s*(?:晚|天|周|週|个星期|個星期|星期|nights?\b|weeks?\b|days?\b)/i.test(raw.normalize('NFKC')))return failure('unparsed_dates');
 const text=canonical(raw,today);
 const yearMatch=text.match(/^\s*(20\d{2})年?\s*<X>/);
 const forcedYear=yearMatch?Number(yearMatch[1]):null;
 const body=forcedYear?text.replace(/^\s*20\d{2}年?\s*/,''):text;
 const hasX=body.includes('<X>'),hasN=body.includes('<N>');
 let first=null,second=null,rest=body,precision=null,extra=[];
 const take=re=>{const m=rest.match(re);if(m)rest=rest.slice(0,m.index)+' '+rest.slice(m.index+m[0].length);return m;};
 if(hasX||hasN){
  const holidayToDate=take(new RegExp(`<X>\\s*${SEP}\\s*(?:<N>|${endpointPattern})`));
  if(holidayToDate){
   first={year:forcedYear,month:12,from:24,to:null};
   second=holidayToDate[0].includes('<N>')?{year:forcedYear?forcedYear+1:null,month:1,from:1,to:1}:toEndpoint(holidayToDate);
   if(!second)return failure('invalid_dates');
   extra=['christmas-assumed-to-start-12-24'];
  }else if(take(/<X>/)){
   first={year:forcedYear,month:12,from:1,to:null};second=first;extra=['christmas-assumed-whole-december-no-stay-dates-given'];
  }else if(take(/<N>/)){
   first={year:forcedYear,month:12,from:31,to:null};second={year:forcedYear?forcedYear+1:null,month:1,from:1,to:1};extra=['new-year-assumed-12-31-to-01-01'];
  }
  precision='holiday';
 }else{
  const pair=take(new RegExp(`${endpointPattern}\\s*${SEP}\\s*${endpointPattern}`));
  if(pair){first=toEndpoint(pair);second=toEndpoint([null,...pair.slice(5)]);}
  else{
   const toDay=take(new RegExp(`${endpointPattern}\\s*${SEP}\\s*(\\d{1,2})${DAY_END}(?![\\d月])`));
   if(toDay){first=toEndpoint(toDay);second=first&&{...first,year:first.year,from:Number(toDay[5]),to:Number(toDay[5]),kind:'day'};}
   else{const one=take(new RegExp(endpointPattern));if(one){first=toEndpoint(one);second=first;}}
  }
  if(!first)return failure(/\d月/.test(body)?'invalid_dates':'unparsed_dates');
  if(!second)return failure('invalid_dates');
  precision=first.kind==='day'&&second.kind==='day'?'days':first.kind==='part'||second.kind==='part'?'part-of-month':'month';
  if(precision==='month')extra=[first===second?'whole-month-assumed-no-stay-dates-given':'whole-months-assumed-no-stay-dates-given'];
  if(precision==='part-of-month')extra=['part-of-month-assumed-from-phrase'];
 }
 // Anything date-like left over means part of the phrase was not understood. Asking beats a wrong window.
 const separatorLeft=new RegExp(`(?:^|\\s)${SEP}(?:\\s|$)`).test(rest.trim())||/^\s*(?:到|至|-|–|—|~|～)/.test(rest)||/(?:到|至|-|–|—|~|～)\s*$/.test(rest);
 if(/\d|月|<|春节|春節|国庆|國慶|中秋/.test(rest)||separatorLeft)return failure('unparsed_dates');
 const placed=placeYears(first,second,today);
 // A named Christmas that has passed means the next one.
 if(precision==='holiday'&&first===second&&!first.year&&today>iso(Number(today.slice(0,4)),12,25)&&placed.start<=today&&placed.end>=today){
  const y=Number(today.slice(0,4))+1;return finish(iso(y,12,1),iso(y,12,31),precision,[...extra,'year-assumed-next-occurrence','rolled-to-next-year'],raw,today);
 }
 const whole=first===second&&first.kind!=='day'&&first.kind!=='part';
 const started=whole&&placed.start<=today&&placed.end>=today;
 return finish(started?today:placed.start,placed.end,precision,[...placed.assumptions,...extra,...(started?['started-from-today']:[])],raw,today);
}
