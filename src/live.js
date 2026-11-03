export const LIVE_KEY='cardybara-bank-live-v1';
const numeric=['balance','available','statement','statementClosing','minimum','creditLimit','bankRawBalance','offers'];
export function mergeBankResult(previous,result){
 const map=new Map((previous?.patches||[]).map(p=>[p.id,p]));
 for(const patch of result.patches||[]){
  const old=map.get(patch.id),fields={...old?.fields},fieldCapturedAt={...Object.fromEntries(Object.keys(old?.fields||{}).map(k=>[k,old.fieldCapturedAt?.[k]||old.capturedAt]))},fieldSources={...old?.fieldSources};
  for(const [key,value]of Object.entries(patch.fields||{})){const time=patch.fieldCapturedAt?.[key]||patch.capturedAt;if(!Number.isFinite(Date.parse(time))||(fieldCapturedAt[key]&&Date.parse(time)<Date.parse(fieldCapturedAt[key])))continue;fields[key]=value;fieldCapturedAt[key]=time;if(patch.fieldSources?.[key])fieldSources[key]=patch.fieldSources[key];else delete fieldSources[key];}
  map.set(patch.id,{...patch,fields,fieldCapturedAt,fieldSources});
 }
 return {...result,receivedCount:result.patches?.length||0,patches:[...map.values()]};
}
export function applyLive(base,live={}){
 const cards=base.cards.map(card=>{
  const entry=live[card.bank],patch=entry?.patches?.find(p=>p.id===card.id);
  if(!patch||!Number.isFinite(Date.parse(patch.capturedAt)))return card;
  const next={...card,fieldDates:{...Object.fromEntries(['balance','available','statement','statementClosing','minimum','creditLimit','due','autopay','offers'].filter(k=>card[k]!=null).map(k=>[k,card.updated+'T00:00:00Z'])),...card.fieldDates}};
  for(const [k,v]of Object.entries(patch.fields||{})){
   if(!numeric.includes(k)||!Number.isFinite(v))continue;
   const oldDate=card.fieldDates?.[k]||card.updated+'T00:00:00Z',fieldTime=patch.fieldCapturedAt?.[k]||patch.capturedAt;
   if(!Number.isFinite(Date.parse(fieldTime))||fieldTime<oldDate)continue;
   next[k]=v;next.fieldDates[k]=fieldTime;
   if(patch.fieldSources?.[k])next.fieldSources={...next.fieldSources,[k]:patch.fieldSources[k]};
  }
  if(next.fieldDates.balance)next.updated=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(next.fieldDates.balance));
  return next;
 });
 return {...base,asOf:[base.asOf,...cards.map(c=>c.updated)].filter(Boolean).sort().at(-1),cards,connections:base.connections.map(c=>{
  const entry=live[c.bank];if(!entry?.attemptedAt||entry.attemptedAt<(c.lastAttemptAt||''))return c;
  const received=entry.receivedCount??entry.patches?.length??0,updated=received>0&&['updated','partial'].includes(entry.status);
  return {...c,lastAttemptAt:entry.attemptedAt,liveStatus:entry.status,liveTabId:entry.tabId,liveCount:received,
   ...(updated?{status:'partial',outcome:'live_partial',note:`本机 Chrome 已读取 ${received} 张卡的可见字段；其他金额、积分与账单保留各自原采集日期。`}:{outcome:'live_failed',note:'本次未读取新数据；保留此前成功读取的字段和原采集日期。'} )};
 })};
}
