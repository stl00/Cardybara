import React,{useEffect,useRef,useState} from 'react';
import {Alert,App,Button,Card,Checkbox,Flex,Select,Switch,Typography} from 'antd';
import {t,useI18n} from './i18n';
import {usePersonalMarks} from './PersonalWallet.jsx';
import {loadPaymentMarks} from './PaymentAssistant.jsx';
import {LEAD_DAYS,REMINDER_SENT_KEY,REMINDER_SETTINGS_KEY,normalizeSettings,pendingNotifications,pruneSent,readSent,readSettings} from './reminders.js';
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
const whenText=(days,bill)=>days<0?t('还款日已过 {0} 天',[-days]):days===0?(bill?t('今天到期'):t('今天截止')):days===1?(bill?t('明天到期'):t('明天截止')):t('还有 {0} 天',[days]);
function message(item){
 if(item.type==='bill-summary')return [t('账单提醒'),t('{0} 笔账单快到期或已过还款日，打开钱包查看。',[item.count])];
 if(item.type==='credit-summary')return [t('福利提醒'),t('{0} 项福利快到期，打开钱包查看。',[item.count])];
 if(item.type==='credit')return [t('福利提醒'),`${t(item.title)} · ${item.name} · ${whenText(item.days)}`];
 const amount=item.statement!=null&&item.currency?` · ${item.currency} ${Number(item.statement).toLocaleString()}`:'';
 return [t('账单提醒'),`${item.name} · ${whenText(item.days,true)}${amount}${item.stale?` · ${t('读数已过期')}`:''}`];
}
/** Runs while a wallet page is open. Waits for the user's marks, so a used credit never fires. */
export function ReminderRunner({cards}){
 const {events,ready,day}=usePersonalMarks(),latestCards=useRef(cards);latestCards.current=cards;
 useEffect(()=>{
  const check=()=>{
   try{
    const settings=readSettings(localStorage);
    if(!ready||!settings.enabled||!allowed())return;
    // Read the log just before sending so a second wallet tab finds the first one's entries.
    const sent=readSent(localStorage),items=pendingNotifications({cards:latestCards.current,marks:loadPaymentMarks(),events,settings,sent,asOf:day}),shown=[];
    if(!items.length)return;
    try{for(const item of items){const [title,body]=message(item);show(title,body,item.tag);shown.push(...item.ids.map(id=>({id,day})));}}
    finally{localStorage.setItem(REMINDER_SENT_KEY,JSON.stringify(pruneSent([...sent,...shown],day)));}
   }catch{/* A reminder must never break the wallet. */}
  };
  check();const timer=setInterval(check,CHECK_MS);window.addEventListener('focus',check);window.addEventListener(CHANGE,check);
  return()=>{clearInterval(timer);window.removeEventListener('focus',check);window.removeEventListener(CHANGE,check)};
 },[day,events,ready]);
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
  <Paragraph type="secondary" style={{marginTop:12}}>{t('默认关闭。开启时 Chrome 会请求通知权限，关闭后不再提醒。只在 Chrome 中打开着钱包页面时检查；页面关闭时不会提醒。福利可以另外用福利页的日历提醒，账单目前没有这个备用方式。')}</Paragraph>
  {!supported()&&<Alert type="info" showIcon title={t('这个浏览器不支持通知。')} style={{marginBottom:12}}/>}
  {denied&&<Alert type="warning" showIcon title={t('没有获得通知权限，提醒保持关闭。可以在 Chrome 的网站设置里修改后再试。')} style={{marginBottom:12}}/>}
  {lost&&<Alert type="warning" showIcon title={t('通知权限已被关闭，目前不会提醒。')} style={{marginBottom:12}}/>}
  {settings.enabled&&<Flex vertical gap={12}>
   <Flex align="center" gap={12} wrap><Checkbox checked={settings.bills} onChange={e=>update({bills:e.target.checked})}>{t('账单到期')}</Checkbox><Select aria-label={t('账单提前天数')} size="small" value={settings.billDays} disabled={!settings.bills} onChange={billDays=>update({billDays})} options={lead()}/></Flex>
   <Flex align="center" gap={12} wrap><Checkbox checked={settings.credits} onChange={e=>update({credits:e.target.checked})}>{t('福利快到期')}</Checkbox><Select aria-label={t('福利提前天数')} size="small" value={settings.creditDays} disabled={!settings.credits} onChange={creditDays=>update({creditDays})} options={lead()}/></Flex>
   <Checkbox checked={settings.showAmounts} onChange={e=>update({showAmounts:e.target.checked})}>{t('在通知里显示账单金额（锁屏上可能被看到）')}</Checkbox>
   <div><Button size="small" disabled={!allowed()} onClick={()=>show(t('账单提醒'),t('这是一条测试通知，提醒已开启。'),'cardybara-test')}>{t('发送测试通知')}</Button></div>
  </Flex>}
  <Paragraph type="secondary" style={{marginTop:12,marginBottom:0}}>{t('已处理、银行显示无需付款、未读取的账单不会提醒；自动还款已开启且读数较新的账单也不会提醒。只有月日、没有年份的还款日同样不会提醒，因为无法判断离现在多远。')}</Paragraph>
 </Card>;
}
