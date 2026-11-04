import React,{useEffect,useRef,useState} from 'react';
import {Alert,App,Button,Card,Checkbox,Flex,Select,Switch,Typography} from 'antd';
import {t,useI18n} from './i18n';
import {usePersonalMarks} from './PersonalWallet.jsx';
import {PAYMENT_MARKS_CHANGE,loadPaymentMarks} from './PaymentAssistant.jsx';
import {LEAD_DAYS,REMINDER_SENT_KEY,REMINDER_SETTINGS_KEY,SCHEDULE_DAYS,normalizeSettings,pendingNotifications,pruneSent,publishSchedule,readSent,readSettings} from './reminders.js';
import {reminderText} from '../extension-next/reminder-core.js';
const {Paragraph,Text}=Typography;
const CHECK_MS=30*60000,CHANGE='cardybara-reminder-settings-change';
const supported=()=>typeof Notification!=='undefined';
const extensionPage=()=>location.protocol==='chrome-extension:'&&!!globalThis.chrome?.permissions;
const allowed=()=>supported()&&Notification.permission==='granted';
// In the packaged extension "notifications" is an optional permission, asked for only here.
async function askPermission(){
 if(!supported())return false;
 if(extensionPage()&&!await chrome.permissions.request({permissions:['notifications']}))return false;
 return Notification.permission==='granted'||await Notification.requestPermission()==='granted';
}
async function dropPermission(){if(extensionPage())await chrome.permissions.remove({permissions:['notifications']}).catch(()=>{});}
function saveSettings(next){localStorage.setItem(REMINDER_SETTINGS_KEY,JSON.stringify(next));window.dispatchEvent(new Event(CHANGE));}
function show(title,body,tag){const n=new Notification(title,{body,tag,icon:'/cardybara.svg'});n.onclick=()=>{window.focus();location.hash='overview';n.close();};}
// The worker has no translations, so the page hands it these in the current language. {0} is filled in when sent.
const phrases=()=>({bill:t('账单提醒'),credit:t('福利提醒'),billSummary:t('{0} 笔账单快到期或已过还款日，打开钱包查看。',['{0}']),creditSummary:t('{0} 项福利快到期，打开钱包查看。',['{0}']),overdue:t('还款日已过 {0} 天',['{0}']),dueToday:t('今天到期'),dueTomorrow:t('明天到期'),endsToday:t('今天截止'),endsTomorrow:t('明天截止'),later:t('还有 {0} 天',['{0}']),stale:t('读数已过期')});
function message(item){
 const p=phrases();
 if(item.type==='bill-summary')return [p.bill,p.billSummary.replace('{0}',item.count)];
 if(item.type==='credit-summary')return [p.credit,p.creditSummary.replace('{0}',item.count)];
 const credit=item.type==='credit',text=reminderText({group:credit?'credits':'bills',label:credit?`${t(item.title)} · ${item.name}`:item.name,days:item.days,stale:item.stale,amount:item.statement!=null&&item.currency?`${item.currency} ${Number(item.statement).toLocaleString()}`:null},p);
 return [text.title,text.message];
}
/** A plain web page has no worker, so it can only check while it is open. */
function pageCheck(cards,events,day){
 const settings=readSettings(localStorage);
 if(!settings.enabled||!allowed())return;
 // Read the log just before sending so a second wallet tab finds the first one's entries.
 const sent=readSent(localStorage),items=pendingNotifications({cards,marks:loadPaymentMarks(),events,settings,sent,asOf:day}),shown=[];
 if(!items.length)return;
 try{for(const item of items){const [title,body]=message(item);show(title,body,item.tag);shown.push(...item.ids.map(id=>({id,day})));}}
 finally{localStorage.setItem(REMINDER_SENT_KEY,JSON.stringify(pruneSent([...sent,...shown],day)));}
}
/** Waits for the user's marks, so a used credit never fires. In the extension the worker does the firing, so nothing is shown from here twice. */
export function ReminderRunner({cards}){
 const {events,ready,day}=usePersonalMarks(),{language}=useI18n(),latestCards=useRef(cards),publishing=useRef(Promise.resolve());latestCards.current=cards;
 const signature=JSON.stringify(cards);
 useEffect(()=>{
  const check=()=>{
   try{
    if(!extensionPage()){if(ready)pageCheck(latestCards.current,events,day);return;}
    const off=!readSettings(localStorage).enabled;
    if(!ready&&!off)return;
    publishing.current=publishing.current.then(async()=>publishSchedule({area:chrome.storage.local,storage:localStorage,granted:await chrome.permissions.contains({permissions:['notifications']}),cards:latestCards.current,marks:loadPaymentMarks(),events,asOf:day,phrases:phrases(),translate:t})).catch(()=>{});
   }catch{/* A reminder must never break the wallet. */}
  };
  check();const timer=setInterval(check,CHECK_MS);
  for(const name of ['focus','storage',CHANGE,PAYMENT_MARKS_CHANGE])window.addEventListener(name,check);
  return()=>{clearInterval(timer);for(const name of ['focus','storage',CHANGE,PAYMENT_MARKS_CHANGE])window.removeEventListener(name,check)};
 },[day,events,ready,language,signature]);
 return null;
}
export default function ReminderSettings(){
 useI18n();const {message:toast}=App.useApp();
 const [settings,setSettings]=useState(()=>{try{return readSettings(localStorage)}catch{return normalizeSettings(null)}}),[denied,setDenied]=useState(false),[busy,setBusy]=useState(false);
 const update=patch=>{const next=normalizeSettings({...settings,...patch});try{saveSettings(next);setSettings(next)}catch{toast.error(t('保存失败，刚才的设置没有生效。'))}};
 const toggle=async on=>{
  setDenied(false);
  if(!on){update({enabled:false});await dropPermission();return;}
  setBusy(true);
  try{if(await askPermission())update({enabled:true});else setDenied(true);}catch{setDenied(true)}finally{setBusy(false)}
 };
 const lead=()=>LEAD_DAYS.map(days=>({value:days,label:t('提前 {0} 天',[days])}));
 const lost=settings.enabled&&supported()&&Notification.permission!=='granted';
 return <Card title={t('账单和福利提醒')} style={{marginBottom:20}}>
  <Flex align="center" gap={12} wrap><Switch aria-label={t('开启提醒')} checked={settings.enabled} loading={busy} disabled={!supported()} onChange={toggle}/><Text strong>{t('开启浏览器通知')}</Text></Flex>
  <Paragraph type="secondary" style={{marginTop:12}}>{extensionPage()?t('默认关闭。开启时 Chrome 会请求通知权限，关闭后不再提醒。钱包页面关闭时也会提醒，但 Chrome 需要在运行；Chrome 没运行时到点的提醒，下次启动后补发，已经过时的不再发。提醒按你上次打开钱包时的数据，安排接下来 {0} 天：在银行付款后，到钱包标记已处理才会停止。',[SCHEDULE_DAYS]):t('默认关闭。开启时 Chrome 会请求通知权限，关闭后不再提醒。只在 Chrome 中打开着钱包页面时检查；页面关闭时不会提醒。福利可以另外用福利页的日历提醒，账单目前没有这个备用方式。')}</Paragraph>
  {!supported()&&<Alert type="info" showIcon title={t('这个浏览器不支持通知。')} style={{marginBottom:12}}/>}
  {denied&&<Alert type="warning" showIcon title={t('没有获得通知权限，提醒保持关闭。可以在 Chrome 的网站设置里修改后再试。')} style={{marginBottom:12}}/>}
  {lost&&<Alert type="warning" showIcon title={t('通知权限已被关闭，目前不会提醒。')} style={{marginBottom:12}}/>}
  {settings.enabled&&<Flex vertical gap={12}>
   <Flex align="center" gap={12} wrap><Checkbox checked={settings.bills} onChange={e=>update({bills:e.target.checked})}>{t('账单到期')}</Checkbox><Select aria-label={t('账单提前天数')} size="small" value={settings.billDays} disabled={!settings.bills} onChange={billDays=>update({billDays})} options={lead()}/></Flex>
   <Flex align="center" gap={12} wrap><Checkbox checked={settings.credits} onChange={e=>update({credits:e.target.checked})}>{t('福利快到期')}</Checkbox><Select aria-label={t('福利提前天数')} size="small" value={settings.creditDays} disabled={!settings.credits} onChange={creditDays=>update({creditDays})} options={lead()}/></Flex>
   <Checkbox checked={settings.showAmounts} onChange={e=>update({showAmounts:e.target.checked})}>{t('在通知里显示账单金额（锁屏上可能被看到）')}</Checkbox>
   <div><Button size="small" disabled={!allowed()} onClick={()=>extensionPage()?chrome.notifications.create('cardybara-test',{type:'basic',iconUrl:chrome.runtime.getURL('icons/128.png'),title:t('账单提醒'),message:t('这是一条测试通知，提醒已开启。')}).catch(()=>{}):show(t('账单提醒'),t('这是一条测试通知，提醒已开启。'),'cardybara-test')}>{t('发送测试通知')}</Button></div>
  </Flex>}
  <Paragraph type="secondary" style={{marginTop:12,marginBottom:0}}>{t('已处理、银行显示无需付款、未读取的账单不会提醒；自动还款已开启且读数较新的账单也不会提醒。只有月日、没有年份的还款日同样不会提醒，因为无法判断离现在多远。')}</Paragraph>
 </Card>;
}
