import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Alert,App,Button} from 'antd';
import {t,useI18n} from './i18n';
import platform from './platform';
import {ACCOUNT_CHANGE_EVENT,OPEN_ACCOUNT_EVENT,readAccount} from './accountClient.js';
import {PENDING_MS,offerDismissed,dismissOffer,showPlaidOffer} from './plaidOffer.js';
import {createPlaidClient,readPlaidCache,PLAID_CHANGE_EVENT} from './plaidClient.js';

// #581: Plaid is the web wallet's only automatic import, so Overview offers it up front while no Plaid link exists.
// Plaid Link always needs the user, per bank; "on by default" therefore means offered, not started. One button:
// signed in -> open the gateway's Link page; signed out -> open the sign-in sheet first and continue into Link once the
// account appears. Dismissal is kept on this device. Never offered in the extension (it collects from bank pages), without
// a gateway, or after the gateway said plaid_unavailable.
const noStore={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const store=()=>{try{return typeof localStorage==='undefined'?noStore:localStorage}catch{return noStore}};

export default function PlaidOfferCard({gateway,collects=false,gatewayConfigured=true}){
 useI18n();const {message:toast}=App.useApp();
 const client=useMemo(()=>createPlaidClient({gateway,storage:store()}),[gateway]);
 const [linked,setLinked]=useState(()=>readPlaidCache(store()).items.length>0);
 const [dismissed,setDismissed]=useState(()=>offerDismissed());
 const [unavailable,setUnavailable]=useState(false),[busy,setBusy]=useState(false);
 const pending=useRef(0),signedInNow=()=>!!readAccount(store());
 const active=!collects&&!!platform.plaid&&gatewayConfigured;
 const start=async()=>{
  setBusy(true);
  try{
   try{await platform.account?.allow(gateway);}catch{}
   const r=await client.startLink();
   if(!r.ok){if(r.code==='plaid_unavailable')setUnavailable(true);else toast.error(r.code==='offline'?t('连不上服务器。检查网络后再试。'):t('Plaid 暂时没有回应，请稍后再试。'));return;}
   await platform.plaid.open(r.url);
  }finally{setBusy(false);}
 };
 const startRef=useRef(start);startRef.current=start;
 useEffect(()=>{
  if(!active)return;
  const sync=()=>setLinked(readPlaidCache(store()).items.length>0);
  // Signed in after pressing the button: continue into Plaid Link.
  const account=()=>{if(pending.current&&Date.now()-pending.current<PENDING_MS&&signedInNow()){pending.current=0;startRef.current();}};
  window.addEventListener(PLAID_CHANGE_EVENT,sync);window.addEventListener(ACCOUNT_CHANGE_EVENT,account);
  // Signed in already: ask the gateway whether Plaid is set up, so the offer is not made where it cannot work.
  if(signedInNow())client.cards().then(r=>{if(!r.ok&&r.code==='plaid_unavailable')setUnavailable(true);});
  return()=>{window.removeEventListener(PLAID_CHANGE_EVENT,sync);window.removeEventListener(ACCOUNT_CHANGE_EVENT,account);};
 },[active,client]);
 if(!showPlaidOffer({collects,hasPlaid:!!platform.plaid,gatewayConfigured,linked,dismissed,unavailable}))return null;
 const press=()=>{if(signedInNow())return start();pending.current=Date.now();window.dispatchEvent(new Event(OPEN_ACCOUNT_EVENT));};
 return <Alert className="plaid-offer" type="info" showIcon closable style={{marginBottom:20}}
  onClose={()=>{dismissOffer();setDismissed(true);}}
  title={t('连接美国信用卡（Plaid），自动填入余额和还款日。')}
  action={<Button size="small" type="primary" loading={busy} onClick={press}>{signedInNow()?t('连接信用卡'):t('登录并连接')}</Button>}/>;
}
