// Isolated-world DOM reader. Never reads form values, network responses or cookies.
(()=>{
 const labels={statementClosing:/^(?:月結單結欠|月结单结欠|賬單結欠|账单结欠|statement balance|statement closing balance)$/i,creditLimit:/^(?:approved credit limit|total credit line|credit limit|信用限額|信用額度|信用额度)$/i,balance:/^(current balance|outstanding balance|total balance|balance outstanding|總結欠|总欠款|总计结欠|總計結欠|目前結欠|現時結欠|目前結餘|結欠|結餘|現時結餘|当前余额|目前结欠|现时结欠|目前结余|结欠|结余|solde actuel)$/i,available:/^(total credit available|available credit|available credit limit|available credit amount|可用信貸額|可用信貸額度|可用信用額|可用信用額度|可用信用限額|可用信用限额|可用額度|可用额度|可用信贷额|可用信贷额度|crédit disponible)$/i,statement:/^(billed balance|statement balance|remaining statement balance|last statement balance|statement closing balance|賬單結欠|帳單結欠|月結單結欠|月結單結餘|結單結欠|结单结欠|月结单结欠|solde du relevé)$/i,minimum:/^(total min payment due|total minimum payment due|minimum payment due|minimum payment|minimum amount due|minimum due|最低還款|最低还款|最低還款額|最低還款金額|最低付款額|最低付款金額|最低还款额|最低还款金额|paiement minimum)$/i};
 const currencyToken=/^(?:HK\$|CA\$|US\$|\$|HKD|CAD|USD|CNY|RMB|CN¥)$/i;
 // A rewards label by its shape, used only to report a programme this version does not collect.
 // structural: the unit words are generic vocabulary, and a verb-led phrase is an action, not a balance.
 function rewardLabel(line){const t=String(line||'').trim();return t.length>=2&&t.length<=60&&!/\d/.test(t)&&/\b(?:points?|miles?|rewards?|cash ?back)\b|\S(?:Miles|Points)\b|積分|积分|獎賞|奖赏|里數|里数|哩|萬里|万里|回贈|回赠/.test(t.replace(/\b(points?|miles?|rewards?|cash ?back)\b/gi,m=>m.toLowerCase()))&&!/^(?:points?|miles?|rewards?|cash ?back)$/i.test(t)&&!/^(?:redeem|use|earn|view|see|explore|learn|go to|transfer|shop|book|pay|manage|how|about)\b/i.test(t)&&!/\b(?:earned|earning|bonus|expir\w*|redeemed|multiplier|activity|pending|per|lifetime|this (?:month|year)|offers?)\b/i.test(t)&&!/^(?:兌換|兑换|查看|了解)|已賺取|已赚取|即將到期|即将到期/.test(t);}
 // Another programme must have a name of its own. "Available Points" or 積分結餘 names none, and could be the required one.
 function namesAProgramme(label){return /[\p{L}]{2}/u.test(label.replace(/\b(?:available|total|current|your|my|the|account|balance|points?|miles?|rewards?|cash ?back|program(?:me)?)\b/gi,'').replace(/可用|總|总|現有|现有|我的|賬戶|账户|結餘|结余|餘額|余额|積分|积分|獎賞|奖赏|里數|里数|回贈|回赠|計劃|计划/g,'').trim());}
 function otherRewardLabels(lines,isRequired){const seen=new Set();for(let i=0;i<lines.length-1;i++)if(rewardLabel(lines[i])&&namesAProgramme(lines[i])&&/^\d[\d,]*$/.test(lines[i+1])&&!isRequired(lines[i]))seen.add(lines[i]);return [...seen];}
 function labelText(value){return value.normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g,'').replace(/[:：]\s*$/,'').replace(/\s*[（(](?:HKD|USD|CAD|港元|港幣|港币)[）)]\s*$/i,'').trim();}
 function resolveLocale(lang,locales){
  const normalized=(lang||'').replaceAll('_','-').toLowerCase();
  return locales.find(l=>l.toLowerCase()===normalized)||locales.find(l=>l.split('-')[0].toLowerCase()===normalized.split('-')[0])||null;
 }
 function followingMoney(lines,index,currency,locale){
  let first=lines[index];
  // Amex renders its accessible tooltip label as a visible text line between
  // a financial field label and value. Skip exactly that known helper row.
  if(/^More info on [a-z_]+$/i.test(first||'')){index++;first=lines[index];}
  if(!first)return null;
  // Adjacent currency and number spans often become separate visible lines.
  if(currencyToken.test(first)&&lines[index+1]){const integer=lines[index+1];const cents=lines[index+2]||'';if(/^[\d, ]+$/.test(integer)&&/^\.\d{2}(?:\s*(?:CR|DR))?$/i.test(cents))return money(first+' '+integer+cents,currency,locale);return money(first+' '+integer,currency,locale);}
  if(currencyToken.test(lines[index+1]||''))return money(first+' '+lines[index+1],currency,locale);
  if(/\d$/.test(first)&&/^\.\d{2}(?:\s*(?:CR|DR))?$/i.test(lines[index+1]||''))return money(first+lines[index+1],currency,locale);
  return money(first,currency,locale);
 }
 function money(text,currency,locale){
  let s=text.normalize('NFKC').trim().replace(/[\u00a0\u202f\u200b-\u200d\ufeff]/g,' '),explicit=s.match(/HK\$|CA\$|US\$|HKD|CAD|USD|CNY|RMB|CN¥/i)?.[0]?.toUpperCase();
  const currencies={'HK$':'HKD','CA$':'CAD','US$':'USD','HKD':'HKD','CAD':'CAD','USD':'USD','CNY':'CNY','RMB':'CNY','CN¥':'CNY'};
  if(explicit&&currencies[explicit]!==currency)return null;
  const credit=/\bCR$/i.test(s);s=s.replace(/(?:HK|CA|US)?\$|HKD|CAD|USD|CNY|RMB|CN¥|\bCR\b|\bDR\b/gi,'').trim();const negative=credit||/^[-−(]/.test(s);s=s.replace(/^[-−(]\s*/,'').replace(/\)\s*$/,'').replace(/(?<=\d)\s+(?=\.\d{2}$)/,'');
  if(locale==='fr-CA'){if(!/^(?:\d{1,3}(?: \d{3})+|\d+),\d{2}$/.test(s))return null;s=s.replaceAll(' ','').replace(',','.');}
  else{if(!/^(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}$/.test(s))return null;s=s.replaceAll(',','');}
  const n=Number(s);return Number.isFinite(n)&&n<=1e9?(negative?-n:n):null;
 }
 function parseAccount(text,bank,card,locale,capturedAt,maxLength=16000){
  if(text.length>maxLength)return null;
  const lines=text.replace(/[\u00a0\u202f]/g,' ').split('\n').map(x=>x.trim()).filter(Boolean),fields={};
  if(!new RegExp(`(?:^|[^0-9])${card.tail}(?:[^0-9]|$)`).test(text))return null;
  // A second currency in the same card container requires a dedicated subaccount adapter.
  if(card.currency==='HKD'&&/CNY|RMB|CN¥|人民幣|人民币/i.test(text))return null;
  for(const [key,baseLabel]of Object.entries(labels)){
   if(key==='statementClosing'&&bank!=='Amex HK')continue;
   const hsbcLabels={balance:/^(?:balance|account balance|current balance|outstanding balance|total balance|目前結欠|現時結欠|目前結餘|現時結餘|結欠|結餘|当前余额|目前结欠|现时结欠|目前结余|结欠|结余|戶口結餘|户口结余)$/i,statement:/^(?:current amount due|最新應繳結欠|最新应缴结欠)$/i,minimum:/^(?:total minimum payment amount|最低付款總額|最低付款总额|minimum payment due|minimum payment|minimum amount due|minimum due|最低還款|最低还款|最低還款額|最低還款金額|最低付款額|最低付款金額|最低还款额|最低还款金额)$/i};
   const label=bank==='HSBC HK'?(hsbcLabels[key]||baseLabel):bank==='Amex HK'&&key==='statement'?/^(?:未繳付月結單結欠|未缴付月结单结欠|remaining statement balance)$/i:baseLabel;
   const values=[];
   for(let i=0;i<lines.length;i++){
    // CA distinguishes the unpaid statement from the current total using this
    // accessible helper. The same "Outstanding Balance" label elsewhere is
    // insufficient evidence to change its meaning.
    const remainingStatement=bank==='Amex CA'&&/^outstanding balance$/i.test(labelText(lines[i]))&&/^More info on remaining_statement_balance_tooltip$/i.test(lines[i+1]||'');
    if(remainingStatement){if(key==='statement'){const v=followingMoney(lines,i+1,card.currency,locale);if(v!==null)values.push(v);}continue;}
    const inline=lines[i].match(/^(.*?)(?:\s*[:：]\s*|\s+)((?:[-−(]|HK\$|CA\$|US\$|\$|HKD|CAD|USD|\d).*)$/i);
    if(inline&&label.test(labelText(inline[1]))){const v=money(inline[2],card.currency,locale);if(v!==null)values.push(v);}
    if(label.test(labelText(lines[i]))&&lines[i+1]){const next=i+1+(key==='statementClosing'&&/^\d{1,2}月\s*\d{1,2}[o日]?\s*[-–]\s*\d{1,2}月\s*\d{1,2}[o日]?$/.test(lines[i+1])?1:0);const v=followingMoney(lines,next,card.currency,locale);if(v!==null)values.push(v);}
   }
   const unique=[...new Set(values)];if(unique.length===1)fields[key]=bank==='HSBC HK'&&key==='balance'?-unique[0]:unique[0];
  }
  return Object.keys(fields).length?{id:card.id,fields,capturedAt,locale}:null;
 }

 // Pure HK MVP extraction: only selected-card text, explicit dates, no current-year guessing.
 function amexHkMvp(text,card,page='overview'){
  if(card.currency!=='HKD'||!/^\d{4,5}$/.test(card.tail)||text.length>100000)return [];
  const tails=[...text.matchAll(/(?:[•*]{2,}\s*|-\s*)(\d{4,5})(?!\d)/g)].map(m=>m[1]);
  if(!tails.includes(card.tail)||tails.some(t=>t!==card.tail))return [];
  const lines=text.split('\n').map(x=>x.trim()).filter(Boolean),items=[];
  const add=(kind,key,value,evidence,date='')=>items.push({kind,cardId:'C1',key,title:key,value,currency:kind==='reward'?'points':'HKD',date,status:'unknown',evidence});
  if(page==='overview'){
   const parsed=parseAccount(text,'Amex HK',card,'zh-HK',new Date().toISOString(),100000);
   for(const [key,value]of Object.entries(parsed?.fields||{})){
    const label=key==='statement'?/^(?:未繳付月結單結欠|未缴付月结单结欠|remaining statement balance)$/i:labels[key];
    const at=lines.findIndex(l=>label?.test(labelText(l)));if(at>=0){const evidence=lines.slice(at,at+5).join('\n');if(evidence.length<1000)add('card',key,value,evidence);}
   }
  }
  // These are observations, never substitute amounts or complete calendar dates.
  const noPayment=lines.filter(l=>/^(?:暫時毋須付款|暂时毋须付款|No payment (?:is )?(?:required|due))(?:[。.!！])?$/i.test(l));
  if(page==='overview'&&new Set(noPayment).size===1){add('billing','paymentStatus',null,noPayment[0]);items.at(-1).title=noPayment[0];}
  const dates=[],partialDates=[];
  for(let i=0;i<lines.length;i++)if(/^(?:還款到期日|还款到期日|繳款到期日|缴款到期日|付款到期日|請於此日期或之前付款|请于此日期或之前付款|Payment due date)[:：]?$/i.test(lines[i])){
   const printed=lines[i+1]||'',partial=printed.match(/^(\d{1,2})月\s*(\d{1,2})日$/);
   if(partial){const month=Number(partial[1]),day=Number(partial[2]);if(month>=1&&month<=12&&day>=1&&day<=[31,29,31,30,31,30,31,31,30,31,30,31][month-1])partialDates.push({text:printed,evidence:lines.slice(i,i+2).join('\n')});}
   const zh=printed.match(/^(20\d{2})年(\d{1,2})月(\d{1,2})日$/),iso=printed.match(/^(20\d{2})-(\d{2})-(\d{2})$/),en=printed.match(/^(\d{1,2}) ([A-Za-z]+) (20\d{2})$/);let date;
   if(zh||iso){const m=zh||iso;date=m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');}
   if(en){const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(en[2].slice(0,3).toLowerCase())+1;if(month)date=en[3]+'-'+String(month).padStart(2,'0')+'-'+en[1].padStart(2,'0');}
   if(date&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date)dates.push({date,evidence:lines.slice(i,i+2).join('\n')});
  }
  if(new Set(dates.map(d=>d.date)).size===1)add('billing','due',null,dates[0].evidence,dates[0].date);
  if(!dates.length&&new Set(partialDates.map(d=>d.text.replace(/\s/g,''))).size===1){add('billing','duePartial',null,partialDates[0].evidence);items.at(-1).title=partialDates[0].text;}
  // An overview with a positive minimum or a printed due conflicts with no-payment wording.
  if(items.some(i=>(i.key==='minimum'&&i.value>0)||['due','duePartial'].includes(i.key)))for(let i=items.length-1;i>=0;i--)if(items[i].key==='paymentStatus')items.splice(i,1);
  if(['overview','rewards'].includes(page))for(let i=0;i<lines.length-1;i++)if(/^(?:Membership Rewards[®™]?|美國運通積分計劃|美国运通积分计划)$/i.test(lines[i])&&/^\d[\d,]*$/.test(lines[i+1])){
   const n=Number(lines[i+1].replaceAll(',',''));if(Number.isSafeInteger(n)&&n<=1e9){add('reward',lines[i],n,lines.slice(i,i+2).join('\n'));}
  }
  // Conflicting duplicate observations are not financial evidence.
  return items.filter(i=>!items.some(x=>x.kind===i.kind&&x.key===i.key&&x.value!==i.value)).filter((i,n,a)=>a.findIndex(x=>x.kind===i.kind&&x.key===i.key)===n);
 }
 function authState(bank,pathname,title){
  // An ended session lands on the public home page of the language in use.
  if(bank==='HSBC HK'&&/^\/[a-z]{2}-[a-z]{2}\/?$/.test(pathname))return 'needs_login';
  if(bank!=='HSBC HK'||!/^\/security(?:\/|$)/.test(pathname))return null;
  if(title==='Security code | Log on | HSBC')return 'needs_confirmation';
  if(/^(?:Username|Password) \| Log on \| HSBC$/.test(title))return 'needs_login';
  return null;
 }
 function hsbcTransactionRows(rows,card,alias='C1'){
  const items=[],rejected=[],counts=new Map(),months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  for(const [index,row]of rows.entries()){
   const m=String(row.date||'').trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})$/),month=m?months.indexOf(m[2].slice(0,3).toLowerCase())+1:0;
   const date=m&&month?m[3]+'-'+String(month).padStart(2,'0')+'-'+m[1].padStart(2,'0'):null;
   if(row.tail!==card.tail||!date||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date){rejected.push({index,reason:'scope_or_date'});continue;}
   const incoming=String(row.amountIn||'').trim(),outgoing=String(row.amountOut||'').trim(),title=String(row.description||'').trim();
   if(!title||title.length>500||!!incoming===!!outgoing){rejected.push({index,reason:'direction'});continue;}
   const printed=incoming||outgoing,value=money(printed,card.currency,'en-HK');if(value===null||value<0){rejected.push({index,reason:'amount'});continue;}
   const signed=incoming?-value:value,identity=date+'|'+title+'|'+signed,occurrence=(counts.get(identity)||0)+1;counts.set(identity,occurrence);
   const evidence='['+alias+']\nTransaction date\n'+row.date+'\nCard ending in '+row.tail+'\nDescription\n'+title+'\n'+(incoming?'Amount in':'Amount out')+'\n'+printed;
   // Local occurrence keys preserve identical visible rows; these are not bank IDs.
   items.push({kind:'transaction',cardId:alias,key:'observed-row|'+identity+'|'+occurrence,title,value:signed,currency:card.currency,date,status:'unknown',evidence});
  }
  return {items,rejected};
 }
 function amexHkTransactionRows(rows,card,period,alias='C1'){
  const items=[],rejected=[],counts=new Map(),p=String(period||'').match(/^(20\d{2})年(\d{1,2})月(\d{1,2})日\s*至\s*(20\d{2})年(\d{1,2})月(\d{1,2})日$/);
  for(const [index,row]of rows.entries()){
   const d=String(row.date||'').match(/^(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日$/),years=new Set();
   if(d?.[1])years.add(Number(d[1]));else if(d&&p){if(Number(d[2])===Number(p[2]))years.add(Number(p[1]));if(Number(d[2])===Number(p[5]))years.add(Number(p[4]));}
   const date=d&&years.size===1?[...years][0]+'-'+d[2].padStart(2,'0')+'-'+d[3].padStart(2,'0'):null;
   if(!date||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date){rejected.push({index,reason:'date_unresolved'});continue;}
   const title=String(row.description||'').trim(),value=money(String(row.amount||''),card.currency,'zh-HK');
   if(!title||title.length>500||value===null){rejected.push({index,reason:'amount_or_title'});continue;}
   const status=/^入賬交易$/.test(row.status)?'posted':/^待決交易$/.test(row.status)?'pending':'unknown',identity=date+'|'+title+'|'+value,occurrence=(counts.get(identity)||0)+1;counts.set(identity,occurrence);
   const evidence='['+alias+']\n'+(p?'Statement Period:\n'+period+'\n':'')+'Transaction:\n日期\n'+row.date+'\n狀態\n'+row.status+'\n描述\n'+title+'\n金額\n'+row.amount;
   items.push({kind:'transaction',cardId:alias,key:'observed-row|'+identity+'|'+occurrence,title,value,currency:card.currency,date,status,evidence});
  }
  return {items,rejected};
 }
 function chaseDate(value){
  const s=String(value||'').trim(),names=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];let y,m,d;
  const a=s.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/),b=s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})$/);
  if(a){[,m,d,y]=a;}else if(b){y=b[3];m=names.indexOf(b[1].slice(0,3).toLowerCase())+1;d=b[2];}else return null;
  const date=String(y)+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');return Number(m)>0&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date?date:null;
 }
 function chaseTransactions(rows,card,alias='C1'){
  const items=[],rejected=[],counts=new Map();for(const [index,row]of rows.entries()){
   const date=chaseDate(row.date),title=String(row.description||'').split('\n').map(s=>s.trim()).filter(Boolean)[0]||'',value=money(String(row.amount||''),card.currency,'en-US');
   if(!date||!title||title.length>500||value===null){rejected.push({index,reason:'date_amount_or_description'});continue;}
   const identity=date+'|'+title+'|'+value,occurrence=(counts.get(identity)||0)+1;counts.set(identity,occurrence);
   const status=/^pending$/i.test(row.status||'')?'pending':/^posted$/i.test(row.status||'')?'posted':'unknown';
   items.push({kind:'transaction',cardId:alias,key:'observed-row|'+identity+'|'+occurrence,title,value,currency:card.currency,date,status,evidence:'['+alias+']\nDate\n'+row.date+'\nDescription\n'+title+'\nAmount\n'+row.amount+(row.status?'\nStatus\n'+row.status:'')});
  }return {items,rejected};
 }
 function chaseDetail(snapshot,card,alias='C1'){
  if(!new RegExp('\\(\\.\\.\\.'+card.tail+'\\)').test(snapshot.title||''))return {items:[],rejected:['card_scope']};
  const raw={...Object.fromEntries((snapshot.dataItems||[]).map(i=>[i.key,i.text])),...snapshot.fields},items=[],rejected=[],otherProgrammes=[];
  const add=(kind,key,title,value,currency,date,status,evidence)=>items.push({kind,cardId:alias,key,title,value,currency,date,status,evidence:'['+alias+']\n'+snapshot.title+'\n'+evidence});
  for(const [key,id,label]of [['balance','currentBalance','Current balance'],['statement','remainingStatementBalance-dataItem','Remaining statement balance'],['statementClosing','lastStatementBalance-dataItem','Last statement balance'],['minimum','minimumPaymentDue-dataItem','Minimum payment due'],['available','availableCredit-dataItem','Available credit']]){
   const text=raw[id];if(typeof text!=='string')continue;const values=[...new Set(text.split('\n').map(s=>money(s,card.currency,'en-US')).filter(n=>n!==null))];if(values.length===1)add('card',key,label,values[0],card.currency,'','unknown',label+'\n'+text);
  }
  const due=raw['nextPaymentDueDate-dataItem'];if(due){const dates=due.split('\n').map(chaseDate).filter(Boolean);if(new Set(dates).size===1)add('billing','due','Payment due date',null,card.currency,dates[0],'unknown',due);}
  const notices=(snapshot.paymentNotices||[]).map(t=>String(t).trim().replace(/^Success:\s*/i,'')).filter(t=>/^You (?:don['’]t|do not) have a payment due right now[.]?$/i.test(t));
  // Needs this card's own balance on screen: a banner alone may belong to the previous card.
  if(new Set(notices).size===1&&items.some(i=>i.key==='balance')&&!String(due||'').trim()&&!items.some(i=>i.key==='minimum'&&i.value>0))items.push({kind:'billing',cardId:alias,key:'paymentStatus',title:notices[0],value:null,currency:card.currency,date:'',status:'unknown',evidence:'['+alias+']\n'+notices[0]});
  const autopay=raw['autoPay-dataItem'],a=autopay?.match(/^Automatic payments\s*\n\s*(On|Off)(?:\s|$)/i);if(a)add('billing','autopay','Automatic payments',null,card.currency,'',a[1].toLowerCase(),autopay);
  for(const [id,programme]of [['ultimateRewards-dataItem',null],['partnerRewards-dataItem',snapshot.rewardLabel]]){
   const text=raw[id];if(!text)continue;const lines=text.split('\n').map(s=>s.trim()).filter(Boolean),name=programme||(/^Ultimate Rewards[®™]? points$/i.test(lines[0])?lines[0]:null),numbers=lines.filter(s=>/^\d[\d,]*$/.test(s));
   if(name&&numbers.length===1)add('reward',name,name,Number(numbers[0].replaceAll(',','')),'points','','unknown',name+'\n'+text);
   // A rewards row this version cannot name is still evidence of another programme.
   else if(id==='partnerRewards-dataItem'&&numbers.length)otherProgrammes.push('unnamed');
  }
  for(const table of snapshot.tables||[]){if(!table.headers?.some(h=>/^Date\b/.test(h))||!table.headers?.some(h=>/^Amount\b/.test(h)))continue;const tx=chaseTransactions(table.rows.map(c=>({date:c[0],description:c[1],amount:c[3],status:''})),card,alias);items.push(...tx.items);rejected.push(...tx.rejected);}
  return {items,rejected,otherProgrammes};
 }
 function chaseOffer(row,card,alias='C1',view=''){
  const label=String(row.label||''),position=label.match(/^(\d+) of (\d+)\s+(.+)$/);if(!position)return null;
  const added=view==='added'||/\bSuccess Added\s*$/i.test(label),available=/\bAdd Offer(?:\s+New)?\s*$/i.test(label);if(!added&&!available)return null;
  const body=position[3].replace(/\s+Success Added\s*$/i,'').replace(/\s+Add Offer(?:\s+New)?\s*$/i,'');
  const rate=body.match(/\s+(?:Up to\s+)?(?:\$[\d,.]+|[\d.]+%)\s+(?:cash back|back)\b/i);if(!rate)return null;const title=body.slice(0,rate.index).replace(/\s+(?:Use online only|Exclusive)$/i,'').trim();if(!title||title.length>500)return null;
  return {kind:'offer',cardId:alias,key:row.offerId?'dom-offer|'+row.offerId:'',title,value:null,currency:card.currency,date:'',status:added?'added':'available',evidence:'['+alias+']\n'+label};
 }
 function chaseBenefitText(text,card,alias='C1'){
  const lines=String(text||'').split('\n').map(s=>s.trim()).filter(Boolean),title=lines[0]?.replace(/\s*(?:See benefit|Learn More).*$/i,'').trim();if(!title||title.length>350||!/[\*\^]$/.test(title))return null;
  const statuses={Activated:'activated','Activation required':'requires_activation',Redeemed:'redeemed',Locked:'locked'},states=[...new Set(lines.filter(s=>Object.hasOwn(statuses,s)).map(s=>statuses[s]))];if(states.length>1)return null;
  return {kind:'benefit',cardId:alias,key:'entitlement',title,value:null,currency:card.currency,date:'',status:states[0]||'unknown',evidence:'['+alias+']\n'+text};
 }
 function chaseBenefitGauge(title,ratio,validThrough,card,alias='C1',context=''){
  const m=String(ratio||'').match(/^\$([\d,]+(?:\.\d{2})?)\s*\/\s*\$([\d,]+(?:\.\d{2})?)$/);if(!m||card.currency!=='USD')return [];
  const value=Number(m[1].replaceAll(',','')),limit=Number(m[2].replaceAll(',',''));if(!Number.isFinite(value)||!Number.isFinite(limit)||Math.max(value,limit)>1e9)return [];
  const date=chaseDate(String(validThrough||'').replace(/^Good through\s+/i,''))||'',spend=title==='Spend & unlock more benefits',evidence='['+alias+']\n'+title+'\n'+ratio+(context?'\n'+context:'')+(validThrough?'\n'+validThrough:'');
  return [[spend?'spend_progress':'credit_progress',value],[spend?'spend_limit':'credit_limit',limit]].map(([key,value])=>({kind:'benefit',cardId:alias,key,title,value,currency:card.currency,date,status:'unknown',evidence}));
 }
 async function chaseSnapshot(cards,contextIds=[]){
  const pageHref=location.href,route=location.hash,now=new Date().toISOString(),roots=[document];for(let n=0;n<roots.length&&n<300;n++)for(const el of roots[n].querySelectorAll('*'))if(el.shadowRoot)roots.push(el.shadowRoot);
  const q=s=>roots.flatMap(r=>[...r.querySelectorAll(s)]),text=e=>(e?.innerText||e?.textContent||'').trim(),visible=e=>!!e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden',safe=s=>String(s).replace(/(?:\d[ -]?){8,19}/g,v=>/^20\d{2}-\d{2}-\d{2}$/.test(v.trim())?v:'[number]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[email]');
  if(q('input[type="password"]').some(visible))return {error:'needs_login'};
  const overview=/^#\/dashboard\/overview(?:[/?]|$)/.test(route),heads=q('h1,[role="heading"][aria-level="1"]').map(text).filter(Boolean),buttons=q('button,[role="button"]');let selected=null;
  if(!overview){const evidence=/\/summary\//.test(route)?heads.join('\n'):heads.join('\n')+'\n'+buttons.filter(visible).map(e=>e.getAttribute('aria-label')||text(e)).filter(t=>/\.{3}\s*\d{4}\)?$/.test(t)).join('\n');const found=cards.filter(c=>new RegExp('\\.\\.\\.\\s*'+c.tail+'(?![0-9])').test(evidence));if(found.length!==1)return {error:'card_not_identified'};selected=found[0];if(contextIds.length===1&&selected.id!==contextIds[0])return {error:'document_changed'};}
  const matches=selected?[selected]:cards,aliases=matches.map((c,i)=>({id:'C'+(i+1),cardId:c.id,currency:c.currency})),observations=[],blocks=[],empty=[],coverage=[],notCollected=[];let rejected=0;
  const add=i=>{const item={...i,evidence:safe(i.evidence)};observations.push(item);blocks.push({id:'B'+(blocks.length+1),text:item.evidence});};
  if(overview){
   // The overview transaction picker may be a checking account. Never expose its
   // rows to the credit-card model just because a transfer mentions a card tail.
   const suffix={balance:['currentBalance','Current balance'],available:['availableCredit','Available credit'],statement:['remainingStatementBalance','Remaining statement balance'],statementClosing:['lastStatementBalance','Last statement balance'],minimum:['minimumPaymentDue','Minimum payment due']};
   for(const c of matches){const bs=[...document.querySelectorAll('[id^="accounts-name-link-button-"]')].filter(b=>new RegExp('\\(\\.\\.\\.'+c.tail+'\\)').test(text(b)));if(bs.length!==1)continue;const internal=bs[0].id.slice('accounts-name-link-button-'.length);if(!/^\d+$/.test(internal))continue;const alias=aliases.find(a=>a.cardId===c.id).id;
    for(const [key,[part,label]]of Object.entries(suffix)){const node=document.getElementById(internal+'-'+part+'-dataItem');if(!node)continue;const raw=text(node),values=[...new Set(raw.split('\n').map(s=>money(s,c.currency,'en-US')).filter(n=>n!==null))];if(values.length===1)add({kind:'card',cardId:alias,key,title:label,value:values[0],currency:c.currency,date:'',status:'unknown',evidence:'['+alias+']\n'+text(bs[0])+'\n'+label+'\n'+raw});}
   }
  }else if(/\/summary\//.test(route)){
   const dataItems=[...document.querySelectorAll('[id$="-dataItem"]')].map(n=>({key:n.id,text:text(n)})),fields={currentBalance:text(document.getElementById('currentBalance'))},label=q('button,[role="button"],[aria-label]').map(e=>e.getAttribute('aria-label')||text(e)).find(t=>/^(?:MileagePlus[®™]? Miles|IHG One Rewards points)$/.test(t));
   const tables=[...document.querySelectorAll('main table')].map(t=>({headers:[...t.querySelectorAll('thead th')].map(text),rows:[...t.querySelectorAll('tbody tr')].map(tr=>[...tr.querySelectorAll('th,td')].map(text))}));
   const result=chaseDetail({title:heads.find(t=>new RegExp('\\.\\.\\.'+selected.tail).test(t)),dataItems,fields,rewardLabel:label,paymentNotices:q('[id="title-focus-target"]').filter(e=>visible(e)&&!self.CardyChaseStaleNotices?.has(e)).map(text),tables},selected);result.items.forEach(add);rejected+=result.rejected.length;for(const programme of result.otherProgrammes||[])notCollected.push({cardId:'C1',programme});
   const noActivity=q('p,[role="paragraph"]').some(e=>visible(e)&&text(e)==='You have no activity to display from this time. Try updating your filters.');if(noActivity)empty.push({kind:'transaction',cardId:selected.id});
  }else if(/\/merchantOffers\//.test(route)){
   const initial=window.scrollY,seen=new Map();let expected=0,stable=0,last=-1;
   for(let pass=0;pass<40;pass++){
    const rows=q('button[aria-label],[role="button"][aria-label]').map(e=>({offerId:e.id.match(/(?:FIGG:\d+|CDLX:\d+:\d+-c)/)?.[0]||'',label:e.getAttribute('aria-label')||''})).filter(r=>/^\d+ of \d+ /.test(r.label));expected=Math.max(0,...rows.map(r=>Number(r.label.match(/^\d+ of (\d+)/)[1])));
    for(const r of rows){const m=r.label.match(/^(\d+) of (\d+)/);if(Number(m[2])!==expected)continue;seen.set(Number(m[1]),r);}
    if(expected>0&&seen.size===expected)break;stable=seen.size===last?stable+1:0;if(stable>=3)break;last=seen.size;window.scrollBy({top:Math.max(300,window.innerHeight*.8),behavior:'instant'});await new Promise(r=>setTimeout(r,200));
   }
   window.scrollTo({top:initial,behavior:'instant'});
   const addedView=/\/offer-wallet/.test(route)&&q('button,[role=\"button\"]').some(e=>/^Added(?:\s+\d+ of \d+)?\s+selected$/i.test(e.getAttribute('aria-label')||text(e)));for(const row of seen.values()){const item=chaseOffer(row,selected,'C1',addedView?'added':'');if(item)add(item);else {rejected++;blocks.push({id:'B'+(blocks.length+1),text:'[C1]\n'+safe(row.label)});}}
   if(expected>0)coverage.push({kind:'offer',cardId:selected.id,view:'all',expected,confirmedEmpty:false});
  }else if(/\/benefits\//.test(route)){
   const seen=new Set();for(const link of q('a,[role="link"]').filter(visible)){const raw=text(link),item=chaseBenefitText(raw,selected);if(item&&!seen.has(item.title)){seen.add(item.title);add(item);}}
   const values=q('span,div').map(text).filter(t=>t.length<800),ratios=[...new Set(values.filter(t=>/^\$[\d,.]+\s*\/\s*\$[\d,.]+$/.test(t)))];
   const qualifying=values.filter(t=>t.includes('Spend & unlock more benefits')&&ratios.some(r=>t.includes(r))).sort((a,b)=>a.length-b.length)[0];
   if(qualifying){const ratio=ratios.find(r=>qualifying.includes(r)),due=qualifying.match(/\b([A-Za-z]+ \d{1,2}, 20\d{2})\b/)?.[1];chaseBenefitGauge('Spend & unlock more benefits',ratio,due,selected,'C1',qualifying).forEach(add);}
   else if(ratios.length===1){const title=heads.find(t=>!/^Benefits\s*\(/.test(t)),validThrough=values.find(t=>/^Good through \d{1,2}\/\d{1,2}\/20\d{2}$/.test(t));if(title)chaseBenefitGauge(title,ratios[0],validThrough,selected).forEach(add);}
  }
  const current=q('h1,[role="heading"][aria-level="1"],button,[role="button"]').map(e=>e.getAttribute('aria-label')||text(e)).join('\n');if(selected&&!new RegExp('\\.\\.\\.\\s*'+selected.tail+'(?![0-9])').test(current))return {error:'document_changed'};
  return {pageHref,capturedAt:now,aliases,observations,blocks,links:[],empty,coverage,notCollected,rulesComplete:rejected===0,ruleRejected:rejected};
 }
 const shown=el=>el&&el.getClientRects().length>0&&el.ownerDocument.defaultView.getComputedStyle(el).visibility!=='hidden';
 function identify(text,cards){const matches=cards.filter(c=>new RegExp(`(?:^|[^0-9])${c.tail}(?:[^0-9]|$)`).test(text));return matches.length===1?matches[0].id:null;}
 function parseAmexOverview(text,selectedHeading,cards,locale,capturedAt){
  // The active card is identified by a visible heading, never by position or a
  // random number in the page. Separate balance widgets can live beyond nine
  // ancestors of that heading on the HK dashboard.
  const id=identify(selectedHeading,cards);
  if(!id||identify(text,cards)!==id||text.length>100000)return null;
  return parseAccount(text,cards.find(c=>c.id===id).bank||'Amex HK',cards.find(c=>c.id===id),locale,capturedAt,100000);
 }
 function chaseBindings(bindings,cards,capturedAt){
  const patches=[];
  for(const card of cards){
   if(cards.filter(c=>c.tail===card.tail).length!==1)continue;
   const matches=bindings.filter(b=>new RegExp(`\\(\\.\\.\\.${card.tail}\\)`).test(b.name));if(matches.length!==1)continue;
   const fields={};
   for(const [key,text]of Object.entries(matches[0].fields)){
    if(!Object.hasOwn(labels,key)||typeof text!=='string')continue;
    const values=[...new Set(text.split('\n').map(line=>money(line,card.currency,'en-US')).filter(v=>v!==null))];if(values.length===1)fields[key==='statement'&&/^Last statement balance\b/i.test(text.trim())?'statementClosing':key]=values[0];
   }
   if(Object.keys(fields).length)patches.push({id:card.id,fields,locale:'en-US',capturedAt});
  }
  return {status:patches.length?'updated':'no_data',patches};
 }
 function readChase(doc,cards){
  // Confirmed against the live Chase overview DOM. IDs stay transient in this tab.
  const suffix={balance:'currentBalance',available:'availableCredit',statement:'remainingStatementBalance',statementClosing:'lastStatementBalance',minimum:'minimumPaymentDue'};
  const bindings=[...doc.querySelectorAll('[id^="accounts-name-link-button-"]')].filter(shown).map(button=>{
   const internal=button.id.slice('accounts-name-link-button-'.length),fields={};if(!/^\d+$/.test(internal))return {name:'',fields};
   for(const [key,part]of Object.entries(suffix)){const n=doc.getElementById(`${internal}-${part}-dataItem`);if(shown(n))fields[key]=n.innerText;}
   return {name:button.innerText,fields};
  });
  return chaseBindings(bindings,cards,new Date().toISOString());
 }
 function readHsbcDetails(doc,cards,locale){
  // The page repeats some ids on a hidden copy, so only the shown one counts.
  const byId=id=>[...doc.querySelectorAll(`[id="${id}"]`)].find(shown)||null;
  const title=byId('account-summary-name');if(!title)return null;
  const root=title.closest('.account-summary-title-detail');if(!root)return {status:'no_data',patches:[]};
  // Exclude the account-switch menu: it contains balances for other cards and
  // deposit accounts, including other currencies.
  const metadata=[...root.children].filter(e=>e.classList.contains('account-detail-row')).map(e=>e.innerText||'').join('\n');
  const id=identify(byId('account-number-value')?.innerText||metadata,cards);if(!id)return {status:'no_data',patches:[]};
  const card=cards.find(c=>c.id===id),ledger=byId('ledger-account-amount');
  let text=[title.innerText,metadata,ledger?.innerText||''].join('\n');
  for(const [label,key]of [['Current amount due','credit-card-amount-due-value'],['Total minimum payment amount','credit-card-total-minimum-payment-amount-value']]){const e=byId(key);if(e)text+='\n'+label+'\n'+e.innerText;}
  const overlay=byId('account-details-overlay');if(overlay)text+='\n'+overlay.innerText;
  const patch=parseAccount(text,'HSBC HK',card,locale,new Date().toISOString());
  return {status:patch?'updated':'no_data',patches:patch?[patch]:[]};
 }
 function read(bank,cards,locales){
  let locale=document.documentElement.lang;
  if([...document.querySelectorAll('input[type=password]')].some(shown))return {status:'needs_login',patches:[]};
  if(bank.startsWith('Amex ')&&!locales.some(l=>l.toLowerCase()===(locale||'').replaceAll('_','-').split('-').filter(p=>p.length!==4).join('-').toLowerCase()))return {status:'ambiguous',patches:[]};
  const rawLanguage=locale;locale=resolveLocale(locale,locales);
  self.CardyReader.lastDiagnostic={adapterBuild:'reader-2026-10-26-7',language:rawLanguage||'(empty)',locale:locale||'(unsupported)',cards:cards.length};
  if(!locale)return {status:'no_data',patches:[]};
  if(bank==='Chase'&&locale==='en-US'){const structured=readChase(document,cards);if(structured.patches.length)return structured;}
  const docs=[document];
  for(let i=0;i<docs.length&&i<8;i++)for(const f of docs[i].querySelectorAll('iframe')){try{if(shown(f)&&f.contentDocument?.body&&!docs.includes(f.contentDocument)&&docs.length<8)docs.push(f.contentDocument);}catch{}}
  const patches=new Map(),conflicts=new Set();let status='no_data';
  const uniqueCards=cards.filter(c=>cards.filter(x=>x.tail===c.tail).length===1);
  for(const doc of docs){
   if(!doc.body)continue;const body=doc.body.innerText.slice(0,1000000);
   const auth=authState(bank,doc.location?.pathname||'',doc.title||'');if(auth){status=auth;continue;}
   if([...doc.querySelectorAll('input[type=password]')].some(shown)){status='needs_login';continue;}
   if(/verification code|one.time (?:code|passcode)|check your (?:phone|mobile)|approve.*(?:app|mobile)|認證碼|驗證碼|流動保安編碼|验证码/i.test(body)){status='needs_confirmation';continue;}
   if(/unable to load|temporarily unavailable|暫時未能|暫時無法/i.test(body))status='load_error';
   if(bank==='HSBC HK'){const scoped=readHsbcDetails(doc,uniqueCards,locale);if(scoped){status=scoped.status;for(const p of scoped.patches)patches.set(p.id,p);continue;}}
   if(bank.startsWith('Amex ')){const selected=[...doc.querySelectorAll('h1,h2,h3')].filter(shown).map(el=>el.innerText||'').join('\n');const p=parseAmexOverview(body,selected,uniqueCards.map(c=>({...c,bank})),locale,new Date().toISOString());Object.assign(self.CardyReader.lastDiagnostic,{uniqueCards:uniqueCards.length,bodyLength:body.length,selectedCardMatched:!!identify(selected,uniqueCards),bodyCardMatched:!!identify(body,uniqueCards),fieldCount:p?Object.keys(p.fields).length:0,mixedCurrency:/CNY|RMB|CN¥|人民幣|人民币/i.test(body),fieldShapes:Object.fromEntries(Object.entries(labels).map(([k,re])=>{const ls=body.split('\n').map(x=>x.trim()).filter(Boolean);const i=ls.findIndex(x=>re.test(labelText(x)));return [k,i<0?'label_not_found':ls.slice(i,i+5).join(' | ').replace(/\d/g,'#').slice(0,160)];}))});if(p)patches.set(p.id,p);}
   const walker=doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT);let count=0;
   while(walker.nextNode()&&count++<20000){
    const node=walker.currentNode;
    for(const card of uniqueCards){
     const match=(t,tail)=>new RegExp(`(?:^|[^0-9])${tail}(?:[^0-9]|$)`).test(t);
     if(!match(node.textContent,card.tail))continue;
     for(let el=node.parentElement,depth=0;el&&depth<9;el=el.parentElement,depth++){
      if(!shown(el))continue;const t=el.innerText||'';if(t.length>16000||identify(t,cards)!==card.id)break;
      const p=parseAccount(t,bank,card,locale,new Date().toISOString());if(!p)continue;
      const previous=patches.get(p.id);
      if(previous&&Object.entries(p.fields).some(([k,v])=>Object.hasOwn(previous.fields,k)&&previous.fields[k]!==v))conflicts.add(p.id);
      else patches.set(p.id,{...p,fields:{...previous?.fields,...p.fields}});
     }
    }
   }
  }
  const result=[...patches.values()].filter(p=>!conflicts.has(p.id));return {status:result.length?'updated':conflicts.size?'ambiguous':status,patches:result};
 }
 async function observe(bank,cards,locales){
  let current=read(bank,cards,locales);if(current.patches.length||['needs_login','needs_confirmation','load_error'].includes(current.status))return current;
  // DOM readiness is event driven; this bounded observation does not hold the worker alive.
  return new Promise(resolve=>{let timer,debounce;const finish=()=>{observer.disconnect();clearTimeout(timer);clearTimeout(debounce);resolve(read(bank,cards,locales));};const observer=new MutationObserver(()=>{clearTimeout(debounce);debounce=setTimeout(()=>{current=read(bank,cards,locales);if(current.patches.length||current.status!=='no_data')finish();},150);});observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});timer=setTimeout(finish,10000);});
 }
 // Billing for issuers with no dedicated adapter yet. Reads one card's scoped text by label; product names play no part.
 // Our own number must appear in a masked form. Hyphens count only after a non-digit, so a phone number or date never does.
 const ISSUER_MASK=/(?:[•●*xX]{2,}[\s-]*|[•●*xX]\s*|\.{3}\s*|…\s*|\bending(?:\s+(?:in|with))?[:\s]+|\bends\s+in[:\s]+|尾[號号数數][:：\s]*|[末后後]四位[:：\s]*|(?<!\d)[-–]\s*)(\d{4,5})(?!\d)(?!\.\d)/gi;
 const issuerTails=text=>[...String(text).matchAll(ISSUER_MASK)].map(m=>m[1]);
 // Anything else that looks like a card's last digits counts as another card, whatever its form: a wrong card is worse than a missing field.
 // Amounts, phone numbers, ranges and dates are not numbers on their own, and a bare year is not a tail unless it is masked.
 const TAIL_LIKE=/(?<![\d$])(?<!\d[.,\/\-–])\d{4,5}(?!\d|[,.\/\-–]\d)/g;
 const YEAR=/^(?:19|20)\d\d$/;
 // A year-shaped tail still counts when masked. Only a bare year, or a statement or period end date, is ignored.
 const maskedOther=(text,tail)=>[...String(text).matchAll(ISSUER_MASK)].some(m=>m[1]!==tail&&!(YEAR.test(m[1])&&/^ending/i.test(m[0])&&/\b(?:statement|period|cycle)\b[^\n]*$/i.test(String(text).slice(0,m.index))));
 const holdsOther=(text,tail,otherTails=[])=>maskedOther(text,tail)||[...String(text).matchAll(TAIL_LIKE)].some(m=>m[0]!==tail&&!YEAR.test(m[0]))||otherTails.some(t=>t!==tail&&new RegExp('(?:^|[^0-9])'+t+'(?:[^0-9]|$)').test(text));
 const MONTHS=['jan(?:uary)?','feb(?:ruary)?','mar(?:ch)?','apr(?:il)?','may','jun(?:e)?','jul(?:y)?','aug(?:ust)?','sep(?:tember)?','oct(?:ober)?','nov(?:ember)?','dec(?:ember)?'];
 const monthOf=name=>MONTHS.findIndex(m=>new RegExp('^'+m+'$','i').test(name))+1;
 // Only forms the validator can ground in evidence. Numeric order is per bank, from its real pages: SC HK prints day first.
 function issuerDate(text,bank){
  const t=String(text).trim();let y,m,d,x;
  if(x=t.match(/^(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日$/)||t.match(/^(20\d{2})-(\d{2})-(\d{2})$/))[y,m,d]=x.slice(1).map(Number);
  else if(x=t.match(/^([A-Za-z]+) (\d{1,2}),? (20\d{2})$/)){m=monthOf(x[1]);d=Number(x[2]);y=Number(x[3]);}
  else if(x=t.match(/^(\d{1,2}) ([A-Za-z]+) (20\d{2})$/)){d=Number(x[1]);m=monthOf(x[2]);y=Number(x[3]);}
  else if(x=t.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/)){y=Number(x[3]);if(['BOA','Amex US','Citi US'].includes(bank)){m=Number(x[1]);d=Number(x[2]);}else if(bank==='SC HK'){d=Number(x[1]);m=Number(x[2]);}else return null;}
  else return null;
  if(!m||m>12||!d)return null;const iso=y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  return Number.isFinite(Date.parse(iso))&&new Date(iso).toISOString().slice(0,10)===iso?iso:null;
 }
 // One labelled due date. Conflicting dates give nothing; a yearless date stays display-only.
 function issuerDue(lines,bank,card,alias='C1'){
  const items=[],add=(key,title,date,evidence)=>items.push({kind:'billing',cardId:alias,key,title,value:null,currency:card.currency,date,status:'unknown',evidence});
  const full=/^(?:payment due date|due date|next payment due|還款到期日|还款到期日|繳款到期日|缴款到期日|付款到期日|到期還款日|到期还款日|最後還款日期|最后还款日期)$/i,yearless=/^(?:payment due date|還款到期日|还款到期日|繳款到期日|缴款到期日|付款到期日)$/i,dates=[],partial=[];
  for(let i=0;i<lines.length;i++){
   const inline=lines[i].split(/\s*[:：]\s*/),own=full.test(labelText(lines[i])),value=own?lines[i+1]:inline.length===2&&full.test(labelText(inline[0]))?inline[1]:null;if(!value)continue;
   const evidence=own?lines.slice(i,i+2).join('\n'):lines[i],iso=issuerDate(value,bank);
   if(iso)dates.push({iso,evidence});else if(own&&yearless.test(labelText(lines[i]))&&/^\d{1,2}月\s*\d{1,2}日$/.test(value))partial.push({value,evidence});
  }
  // A minimum printed with its date on one line, e.g. "$35.00 due Nov 19". The year is never assumed.
  for(let i=0;i<lines.length;i++){const combined=(lines[i+1]||'').match(/^\S*\d\S* due ([A-Za-z]{3,9} \d{1,2}(?:, 20\d{2})?)$/i);if(!combined||!labels.minimum.test(labelText(lines[i])))continue;const date=issuerDate(combined[1],bank),both=lines.slice(i,i+2).join('\n');if(date)dates.push({iso:date,evidence:both});else if(monthOf(combined[1].split(' ')[0]))partial.push({value:combined[1],evidence:both});}
  if(new Set(dates.map(d=>d.iso)).size===1)add('due','Payment due date',dates[0].iso,dates[0].evidence);
  else if(!dates.length&&new Set(partial.map(d=>d.value.replace(/\s/g,''))).size===1)add('duePartial',partial[0].value,'',partial[0].evidence);
  return items;
 }
 function issuerBilling(text,bank,card,otherTails=[],alias='C1'){
  if(text.length>100000||!issuerTails(text).includes(card.tail)||holdsOther(text,card.tail,otherTails))return [];
  const raw=text.replace(/[\u00a0\u202f]/g,' ').split('\n').map(x=>x.trim()).filter(Boolean);
  // A known help control can sit between a "Label:" and its value. Any other word there leaves the value unpaired.
  const isValue=l=>/^(?:[-−]?\s*(?:HK\$|US\$|\$|HKD|USD)\s*[-−]?[\d,]+\.\d{2})/.test(l||'');
  const lines=raw.filter((l,i)=>!(/^(?:layer|info|help)$/i.test(l)&&/:$/.test(raw[i-1]||'')&&isValue(raw[i+1])));
  // Money parsing sees the amount alone; a due date on that line is read separately.
  const moneyText=lines.map(l=>isValue(l)?l.replace(/\s+due\s+.*$/i,''):l).join('\n'),items=[];
  const parsed=parseAccount(moneyText,bank,card,'en-US',new Date().toISOString(),100000);
  for(const [key,value]of Object.entries(parsed?.fields||{})){
   // Evidence is the labelled line that actually carries this value, not the first label of that name.
   const digits=new RegExp('(?<![\\d.])'+Math.abs(value).toFixed(2).replace('.','\\.')+'(?!\\d)'),carries=at=>digits.test(lines.slice(at,at+4).join(' ').replaceAll(',',''));
   const at=lines.findIndex((l,i)=>(labels[key]?.test(labelText(l))||labels[key]?.test(labelText(l.split(/\s*[:：]\s*/)[0]))||labels[key]?.test(labelText(l.replace(/\s+(?:[-−(]|HK\$|US\$|\$|HKD|USD|\d).*$/,''))))&&carries(i));
   if(at>=0)items.push({kind:'card',cardId:alias,key,title:labelText(lines[at]).slice(0,80),value,currency:card.currency,date:'',status:'unknown',evidence:lines.slice(at,at+4).join('\n')});
  }
  items.push(...issuerDue(lines,bank,card,alias));
  const notices=lines.filter(l=>/^(?:暫時毋須付款|暂时毋须付款|No payment (?:is )?(?:required|due)|You (?:don['’]t|do not) have a payment due right now)(?:[。.!！])?$/i.test(l));
  if(new Set(notices).size===1&&!items.some(i=>(i.key==='minimum'&&i.value>0)||['due','duePartial'].includes(i.key)))items.push({kind:'billing',cardId:alias,key:'paymentStatus',title:notices[0],value:null,currency:card.currency,date:'',status:'unknown',evidence:notices[0]});
  return items;
 }
 // The largest visible container holding this card's number and no other card's.
 function issuerScope(tail,otherTails=[],doc=document){
  const walker=doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT),own=new RegExp('(?:^|[^0-9])'+tail+'(?:[^0-9]|$)');let best='',count=0;
  while(walker.nextNode()&&count++<20000){
   if(!own.test(walker.currentNode.textContent))continue;
   for(let el=walker.currentNode.parentElement;el;el=el.parentElement){
    if(!shown(el))continue;const t=el.innerText||'';if(t.length>16000||holdsOther(t,tail,otherTails))break;
    if(issuerTails(t).includes(tail)&&t.length>best.length)best=t;
   }
  }
  return best;
 }
 // SC HK account details: a table of "Label: | value" rows. The page prints the full card number, so only its last four digits are ever kept.
 function scDetails(cards,doc=document){
  const cell=label=>{for(const r of doc.querySelectorAll('tr')){const c=[...r.cells],i=c.findIndex(x=>(x.innerText||'').trim()===label);if(i>=0&&c[i+1])return (c[i+1].innerText||'').trim();}return '';};
  const digits=(cell('Card Number:').match(/\d(?:[\d\s.\u2013-]*\d){7,}/)?.[0]||'').replace(/\D/g,''),tail=digits.length>=12?digits.slice(-4):null;if(!tail)return null;
  const card=cards.find(c=>c.tail===tail);if(!card)return {tail};
  const lines=['Card ending in '+tail];
  for(const label of ['Current Balance:','Approved Credit Limit:','Available Credit Limit:','Billed Balance:','Minimum Payment Due:','Payment Due Date:']){const value=cell(label);if(value)lines.push(label,value);}
  return {tail,card,text:lines.join('\n')};
 }
 self.CardyReader={scDetails,issuerDue,issuerBilling,issuerScope,rewardLabel,otherRewardLabels,amexHkMvp,chaseSnapshot,chaseBenefitText,chaseBenefitGauge,chaseDate,chaseTransactions,chaseDetail,chaseOffer,amexHkTransactionRows,hsbcTransactionRows,authState,money,parseAccount,identify,chaseBindings,read,observe,resolveLocale,parseAmexOverview};
})();
