import {useEffect,useMemo,useRef,useState} from 'react';
import {App} from 'antd';
import {t} from './i18n';
import platform from './platform';
import {ACCOUNT_CHANGE_EVENT,OPEN_ACCOUNT_EVENT,readAccount} from './accountClient.js';
import {PENDING_MS} from './plaidOffer.js';
import {createPlaidClient} from './plaidClient.js';

// Starting Plaid Link from a button, shared by the Overview offer (#581) and the wallet's "Add card" button.
// Signed in -> open the gateway's Link page; signed out -> open the sign-in sheet first and continue into Link once the
// account appears (within PENDING_MS). `unavailable` turns true when the gateway says Plaid is not set up, so callers can
// stop offering it. `active` false (extension, no gateway) makes the hook do nothing.
const noStore={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const store=()=>{try{return typeof localStorage==='undefined'?noStore:localStorage}catch{return noStore}};

export default function usePlaidLink({gateway,active}){
 const {message:toast}=App.useApp();
 const client=useMemo(()=>createPlaidClient({gateway,storage:store()}),[gateway]);
 const [unavailable,setUnavailable]=useState(false),[busy,setBusy]=useState(false);
 const pending=useRef(0),signedIn=()=>!!readAccount(store());
 const start=async()=>{
  setBusy(true);
  try{
   try{await platform.account?.allow(gateway);}catch{}
   const r=await client.startLink();
   if(!r.ok){
    if(r.code==='plaid_unavailable')setUnavailable(true);
    toast.error(r.code==='offline'?t('连不上服务器。检查网络后再试。'):r.code==='plaid_unavailable'?t('Plaid 连接服务还没开通，钱包照常使用。'):r.code==='plaid_limit'?t('Plaid 连接名额已用完，暂时不能添加新的银行连接。已连接的卡照常同步。'):t('Plaid 暂时没有回应，请稍后再试。'));
    return;
   }
   await platform.plaid.open(r.url);
  }finally{setBusy(false);}
 };
 const startRef=useRef(start);startRef.current=start;
 useEffect(()=>{
  if(!active)return;
  // Signed in after pressing the button: continue into Plaid Link.
  const account=()=>{if(pending.current&&Date.now()-pending.current<PENDING_MS&&signedIn()){pending.current=0;startRef.current();}};
  window.addEventListener(ACCOUNT_CHANGE_EVENT,account);
  // Signed in already: ask the gateway whether Plaid is set up, so the button is not offered where it cannot work.
  if(signedIn())client.cards().then(r=>{if(!r.ok&&r.code==='plaid_unavailable')setUnavailable(true);});
  return()=>window.removeEventListener(ACCOUNT_CHANGE_EVENT,account);
 },[active,client]);
 const press=()=>{if(signedIn())return start();pending.current=Date.now();window.dispatchEvent(new Event(OPEN_ACCOUNT_EVENT));};
 return {press,busy,unavailable,signedIn};
}
