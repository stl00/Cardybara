import React,{useEffect,useState} from 'react';
import {Alert,Button} from 'antd';
import {t,useI18n} from './i18n';
import platform from './platform';
import {offerDismissed,dismissOffer,showPlaidOffer} from './plaidOffer.js';
import {readPlaidCache,PLAID_CHANGE_EVENT} from './plaidClient.js';
import usePlaidLink from './usePlaidLink.js';

// #581: Plaid is the web wallet's only automatic import, so Overview offers it up front while no Plaid link exists.
// Plaid Link always needs the user, per bank; "on by default" therefore means offered, not started. One button:
// signed in -> open the gateway's Link page; signed out -> open the sign-in sheet first and continue into Link once the
// account appears (usePlaidLink). Dismissal is kept on this device. Never offered in the extension (it collects from bank
// pages), without a gateway, or after the gateway said plaid_unavailable.
const noStore={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const store=()=>{try{return typeof localStorage==='undefined'?noStore:localStorage}catch{return noStore}};

export default function PlaidOfferCard({gateway,collects=false,gatewayConfigured=true}){
 useI18n();
 const active=!collects&&!!platform.plaid&&gatewayConfigured;
 const {press,busy,unavailable,signedIn}=usePlaidLink({gateway,active});
 const [linked,setLinked]=useState(()=>readPlaidCache(store()).items.length>0);
 const [dismissed,setDismissed]=useState(()=>offerDismissed());
 useEffect(()=>{
  if(!active)return;
  const sync=()=>setLinked(readPlaidCache(store()).items.length>0);
  window.addEventListener(PLAID_CHANGE_EVENT,sync);
  return()=>window.removeEventListener(PLAID_CHANGE_EVENT,sync);
 },[active]);
 if(!showPlaidOffer({collects,hasPlaid:!!platform.plaid,gatewayConfigured,linked,dismissed,unavailable}))return null;
 return <Alert className="plaid-offer" type="info" showIcon closable style={{marginBottom:20}}
  onClose={()=>{dismissOffer();setDismissed(true);}}
  title={t('连接美国信用卡（Plaid），自动填入余额和还款日。')}
  action={<Button size="small" type="primary" loading={busy} onClick={press}>{signedIn()?t('连接信用卡'):t('登录并连接')}</Button>}/>;
}
