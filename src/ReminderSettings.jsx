import React,{useEffect,useRef,useState} from 'react';
import {Alert,App,Button,Card,Checkbox,Flex,Select,Switch,Typography} from 'antd';
import {t,ruleField,useI18n} from './i18n';
import {usePersonalMarks} from './PersonalWallet.jsx';
import {PAYMENT_MARKS_CHANGE,loadPaymentMarks} from './PaymentAssistant.jsx';
import {pushTimes,debounce,watchSupport} from './webPush.js';
import {LEAD_DAYS,REMINDER_SENT_KEY,REMINDER_SETTINGS_KEY,SCHEDULE_DAYS,normalizeSettings,pendingNotifications,pruneSent,publishSchedule,readSent,readSettings} from './reminders.js';
import {PAYMENT_MARKS_KEY} from './paymentStates.js';
import {PUSH_GENERIC_KEY,REMINDER_SCHEDULE_KEY} from './pushMirror.js';
import {reminderText} from '../extension-next/reminder-core.js';
import platform from './platform';
const {Paragraph,Text}=Typography;
const CHECK_MS=30*60000,CHANGE='cardybara-reminder-settings-change';
const supported=()=>typeof Notification!=='undefined';
const worker=()=>!!platform.notifications.worker;
const allowed=()=>supported()&&Notification.permission==='granted';
// In the packaged extension "notifications" is an optional permission, asked for only here.
async function askPermission(){
 if(!supported())return false;
 if(worker()&&!await platform.notifications.request())return false;
 return Notification.permission==='granted'||await Notification.requestPermission()==='granted';
}
async function dropPermission(){if(worker())await platform.notifications.drop();}
function saveSettings(next){localStorage.setItem(REMINDER_SETTINGS_KEY,JSON.stringify(next));window.dispatchEvent(new Event(CHANGE));}
function show(title,body,tag){const n=new Notification(title,{body,tag,icon:'/cardybara.svg'});n.onclick=()=>{window.focus();location.hash='overview';n.close();};}
// The worker has no translations, so the page hands it these in the current language. {0} is filled in when sent.
const phrases=()=>({bill:t('账单提醒'),credit:t('福利提醒'),billSummary:t('{0} 笔账单快到期或已过还款日，打开钱包查看。',['{0}']),creditSummary:t('{0} 项福利快到期，打开钱包查看。',['{0}']),overdue:t('还款日已过 {0} 天',['{0}']),dueToday:t('今天到期'),dueTomorrow:t('明天到期'),endsToday:t('今天截止'),endsTomorrow:t('明天截止'),later:t('还有 {0} 天',['{0}']),stale:t('读数已过期'),reuse:t('{0}：{1} 可以再次使用',['{0}','{1}'])});
function message(item){
 const p=phrases();
 if(item.type==='bill-summary')return [p.bill,p.billSummary.replace('{0}',item.count)];
 if(item.type==='credit-summary')return [p.credit,p.creditSummary.replace('{0}',item.count)];
 if(item.type==='reuse')return [p.credit,t('{0}：{1} 可以再次使用',[item.name,ruleField(item.title,item,'title')])];
 const credit=item.type==='credit',text=reminderText({group:credit?'credits':'bills',label:credit?`${ruleField(item.title,item,'title')} · ${item.name}`:item.type==='fee'?`${t('年费日')} · ${item.name}`:item.name,days:item.days,stale:item.stale,amount:item.statement!=null&&item.currency?`${item.currency} ${Number(item.statement).toLocaleString()}`:null},p);
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
// Web Push (web build only): keep the plan the service worker reads, and send the gateway the fire times, debounced.
const pushSend=debounce(async(push,times)=>{try{if(times)await push.sync(times);else await push.forget();}catch{/* the next change or load sends again */}});
async function syncPush({push,cards,marks,events,day}){
 const settings=readSettings(localStorage),active=push.active();
 if(!settings.enabled||!allowed()){if(active){pushSend.cancel();await push.disable().catch(()=>{});await push.area().remove(REMINDER_SCHEDULE_KEY).catch(()=>{});}return;}
 if(!active)return;
 const schedule=await publishSchedule({area:push.area(),storage:localStorage,granted:true,cards,marks,events,asOf:day,phrases:phrases(),translate:(key,item)=>item?ruleField(key,item,'title'):t(key)});
 await push.area().set({[PUSH_GENERIC_KEY]:{title:t('账单提醒'),body:t('打开钱包，看看有什么快到期。')}});
 pushSend(push,cards.length?pushTimes(schedule,Date.now()):null);
}
/** Waits for the user's marks, so a used credit never fires. In the extension the worker does the firing, so nothing is shown from here twice. */
export function ReminderRunner({cards}){
 const {events,ready,day}=usePersonalMarks(),{language}=useI18n(),latestCards=useRef(cards),publishing=useRef(Promise.resolve());latestCards.current=cards;
 const signature=JSON.stringify(cards);
 useEffect(()=>{
  const check=()=>{
   try{
    if(!worker()){
     if(ready)pageCheck(latestCards.current,events,day);
     const push=platform.notifications.push;
     if(push&&ready)publishing.current=publishing.current.then(()=>syncPush({push,cards:latestCards.current,marks:loadPaymentMarks(),events,day})).catch(()=>{});
     return;
    }
    const off=!readSettings(localStorage).enabled;
    if(!ready&&!off)return;
    publishing.current=publishing.current.then(async()=>publishSchedule({area:platform.notifications.area(),storage:localStorage,granted:await platform.notifications.contains(),cards:latestCards.current,marks:loadPaymentMarks(),events,asOf:day,phrases:phrases(),translate:(key,item)=>item?ruleField(key,item,'title'):t(key)})).catch(()=>{});
   }catch{/* A reminder must never break the wallet. */}
  };
  // Another tab's card changes arrive through the cards prop once this tab has reloaded them, so they are not checked here against the old cards.
  const fromOtherTab=e=>{if([REMINDER_SETTINGS_KEY,PAYMENT_MARKS_KEY].includes(e.key))check();};
  check();const timer=setInterval(check,CHECK_MS);const unwatch=watchSupport(check);window.addEventListener('storage',fromOtherTab);
  for(const name of ['focus',CHANGE,PAYMENT_MARKS_CHANGE])window.addEventListener(name,check);
  return()=>{clearInterval(timer);unwatch();window.removeEventListener('storage',fromOtherTab);for(const name of ['focus',CHANGE,PAYMENT_MARKS_CHANGE])window.removeEventListener(name,check)};
 },[day,events,ready,language,signature]);
 return null;
}
export default function ReminderSettings({pushApi}={}){
 useI18n();const {message:toast}=App.useApp();
 // Re-read support when the page is shown again (Home Screen install, permission change in Settings), not once at mount.
 const [,recheck]=useState(0);useEffect(()=>watchSupport(()=>recheck(n=>n+1)),[]);
 const [settings,setSettings]=useState(()=>{try{return readSettings(localStorage)}catch{return normalizeSettings(null)}}),[denied,setDenied]=useState(false),[busy,setBusy]=useState(false);
 const update=patch=>{const next=normalizeSettings({...settings,...patch});try{saveSettings(next);setSettings(next)}catch{toast.error(t('保存失败，刚才的设置没有生效。'))}};
 const push=pushApi??platform.notifications.push,support=push?.support()??'unsupported',[pushOn,setPushOn]=useState(()=>!!push?.active());
 const turnOnPush=async()=>{
  setDenied(false);setBusy(true);
  try{if(!await askPermission()){setDenied(true);return;}await push.enable();update({enabled:true});setPushOn(true);window.dispatchEvent(new Event(CHANGE));}catch{setDenied(true)}finally{setBusy(false)}
 };
 const turnOffPush=async()=>{setBusy(true);try{await push.disable();}catch{/* the subscription is gone either way */}setPushOn(false);setBusy(false);};
 const toggle=async on=>{
  setDenied(false);
  if(!on){update({enabled:false});await dropPermission();if(push?.active()){await push.disable().catch(()=>{});setPushOn(false);}return;}
  setBusy(true);
  try{if(await askPermission())update({enabled:true});else setDenied(true);}catch{setDenied(true)}finally{setBusy(false)}
 };
 const lead=()=>LEAD_DAYS.map(days=>({value:days,label:t('提前 {0} 天',[days])}));
 const lost=settings.enabled&&supported()&&Notification.permission!=='granted';
 return <Card title={t('账单和福利提醒')} style={{marginBottom:20}}>
  {support!=='install'&&<><label className="account-sync-switch"><Switch aria-label={t('开启提醒')} checked={settings.enabled} loading={busy} disabled={!supported()} onChange={toggle}/><Text strong>{t('开启浏览器通知')}</Text></label>
  <Paragraph type="secondary" style={{marginTop:12}}>{worker()?t('默认关闭。开启时 Chrome 会请求通知权限，关闭后不再提醒。钱包页面关闭时也会提醒，但 Chrome 需要在运行；Chrome 没运行时到点的提醒，下次启动后补发，已经过时的不再发。提醒按你上次打开钱包时的数据，安排接下来 {0} 天：在银行付款后，到钱包标记已处理才会停止。',[SCHEDULE_DAYS]):platform.kind==='web'?t('默认关闭。开启时浏览器会请求通知权限，关闭后不再提醒。只在打开着钱包页面时检查；页面关闭时不会提醒。福利可以另外用福利页的日历提醒，账单目前没有这个备用方式。'):t('默认关闭。开启时 Chrome 会请求通知权限，关闭后不再提醒。只在 Chrome 中打开着钱包页面时检查；页面关闭时不会提醒。福利可以另外用福利页的日历提醒，账单目前没有这个备用方式。')}</Paragraph></>}
  {support==='install'&&<Alert type="info" showIcon title={t('在 iPhone 或 iPad 上，要先把 Cardybara 添加到主屏幕（iOS 16.4 或更高），才能收到钱包关闭时的提醒。')} description={<>{t('在 Safari 点“分享”，选“添加到主屏幕”，再从主屏幕图标打开钱包，回到这里开启。')}<br/>{t('主屏幕上的 App 和 Safari 是两个独立的浏览器，数据不共用，需要在主屏幕 App 里重新登录。')}</>} style={{marginBottom:12}}/>}
  {support==='ready'&&<div style={{marginBottom:12}}>
   {pushOn?<Flex align="center" gap={12} wrap><Text>{t('钱包关闭时也会提醒（Web Push）。')}</Text><Button size="small" loading={busy} onClick={turnOffPush}>{t('关闭后台提醒')}</Button></Flex>
   :<><Button type="primary" className="wrap-button" loading={busy} onClick={turnOnPush}>{t('开启钱包关闭时的提醒')}</Button><Paragraph type="secondary" style={{marginTop:8,marginBottom:0}}>{t('只把提醒的时间发给 Cardybara 服务器，不含卡名、尾号、金额；提醒的文字由本机生成。')}</Paragraph></>}
  </div>}
  {!supported()&&support!=='install'&&<Alert type="info" showIcon title={t('这个浏览器不支持通知。')} style={{marginBottom:12}}/>}
  {denied&&<Alert type="warning" showIcon title={platform.kind==='web'?t('没有获得通知权限，提醒保持关闭。可以在浏览器的网站设置里修改后再试。'):t('没有获得通知权限，提醒保持关闭。可以在 Chrome 的网站设置里修改后再试。')} style={{marginBottom:12}}/>}
  {lost&&<Alert type="warning" showIcon title={t('通知权限已被关闭，目前不会提醒。')} style={{marginBottom:12}}/>}
  {settings.enabled&&<Flex vertical gap={12}>
   <Flex align="center" gap={12} wrap><Checkbox checked={settings.bills} onChange={e=>update({bills:e.target.checked})}>{t('账单到期')}</Checkbox><Select aria-label={t('账单提前天数')} size="small" value={settings.billDays} disabled={!settings.bills} onChange={billDays=>update({billDays})} options={lead()}/></Flex>
   <Flex align="center" gap={12} wrap><Checkbox checked={settings.credits} onChange={e=>update({credits:e.target.checked})}>{t('福利快到期')}</Checkbox><Select aria-label={t('福利提前天数')} size="small" value={settings.creditDays} disabled={!settings.credits} onChange={creditDays=>update({creditDays})} options={lead()}/></Flex>
   <Flex align="center" gap={12} wrap><Checkbox checked={settings.fees} onChange={e=>update({fees:e.target.checked})}>{t('年费日（你设置了年费日的卡）')}</Checkbox><Select aria-label={t('年费日提前天数')} size="small" value={settings.feeDays} disabled={!settings.fees} onChange={feeDays=>update({feeDays})} options={lead()}/></Flex>
   <Checkbox checked={settings.showAmounts} onChange={e=>update({showAmounts:e.target.checked})}>{t('在通知里显示账单金额（锁屏上可能被看到）')}</Checkbox>
   <div><Button size="small" disabled={!allowed()} onClick={()=>worker()?platform.notifications.test(t('账单提醒'),t('这是一条测试通知，提醒已开启。')).catch(()=>{}):show(t('账单提醒'),t('这是一条测试通知，提醒已开启。'),'cardybara-test')}>{t('发送测试通知')}</Button></div>
  </Flex>}
  <Paragraph type="secondary" style={{marginTop:12,marginBottom:0}}>{t('已处理、银行显示无需付款、未读取的账单不会提醒；自动还款已开启且读数较新的账单也不会提醒。只有月日、没有年份的还款日同样不会提醒，因为无法判断离现在多远。')}</Paragraph>
 </Card>;
}
