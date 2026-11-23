import React,{useEffect,useState} from 'react';
import {Alert,Button} from 'antd';
import {t,useI18n} from './i18n';
import {ACCOUNT_CHANGE_EVENT,OPEN_ACCOUNT_EVENT,readAccount} from './accountClient.js';
import {isStandalone,watchSupport} from './webPush.js';

// #578: on iPhone the Safari tab and the Home Screen app are separate browsers with separate storage, so the Home Screen app
// starts signed out. Say so once, on Overview, and point at the sign-in sheet. Never shown in a normal tab or when signed in.
export const HOME_BANNER_KEY='cardybara-home-screen-banner-v1';
const store=()=>{try{return typeof localStorage==='undefined'?null:localStorage}catch{return null}};
const dismissed=()=>{try{return store()?.getItem(HOME_BANNER_KEY)==='1'}catch{return false}};
/** The banner's whole condition, kept apart so a test can drive it. */
export const showHomeBanner=({standalone,account,seen})=>!!standalone&&!account&&!seen;

export default function HomeScreenBanner(){
 useI18n();
 const read=()=>showHomeBanner({standalone:isStandalone(),account:readAccount(store()??{getItem:()=>null}),seen:dismissed()});
 const [show,setShow]=useState(read);
 useEffect(()=>{
  const again=()=>setShow(read());
  window.addEventListener(ACCOUNT_CHANGE_EVENT,again);const off=watchSupport(again);
  return()=>{window.removeEventListener(ACCOUNT_CHANGE_EVENT,again);off();};
 },[]);
 const dismiss=()=>{try{store()?.setItem(HOME_BANNER_KEY,'1')}catch{/* it may show again next time */}setShow(false);};
 if(!show)return null;
 return <Alert className="home-screen-banner" type="info" showIcon closable onClose={dismiss} style={{marginBottom:20}}
  title={t('这个主屏幕 App 和 Safari 是分开的。登录后，把你的钱包带到这里。')}
  action={<Button size="small" type="primary" onClick={()=>{dismiss();window.dispatchEvent(new Event(OPEN_ACCOUNT_EVENT));}}>{t('登录')}</Button>}/>;
}
