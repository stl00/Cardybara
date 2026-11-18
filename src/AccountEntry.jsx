import React,{useEffect,useState} from 'react';
import {Avatar,Button,Drawer,Modal,Popover} from 'antd';
import {t,useI18n} from './i18n';
import AccountSettings from './AccountSettings.jsx';
import {ACCOUNT_CHANGE_EVENT,SYNC_CHANGE_EVENT,SYNC_STATUS_EVENT,readAccount,syncIsOn} from './accountClient.js';

// The header's account entry (#500): a plain Sign in button when signed out (never a badge or a prompt), an avatar with a
// sync dot when signed in. The panel is the same AccountSettings flow as Settings, in a bottom sheet on phones and a
// modal (signed out) or popover (signed in) on desktop.
const noStore={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const store=()=>typeof localStorage==='undefined'?noStore:localStorage;
const DOT={synced:'synced',syncing:'syncing',offline:'offline',error:'error',signed_out:'error',newer:'error'};

export default function AccountEntry({gateway,phone,onSettings}){
 useI18n();
 const [account,setAccount]=useState(()=>readAccount(store()));
 const [on,setOn]=useState(()=>syncIsOn(store()));
 const [status,setStatus]=useState(null);
 const [open,setOpen]=useState(false);
 useEffect(()=>{
  const a=()=>{const next=readAccount(store());setAccount(prev=>{if(!prev&&next)setOpen(false);return next;});setOn(syncIsOn(store()));};
  const o=()=>{setOn(syncIsOn(store()));setStatus(null);};
  const s=e=>setStatus(e.detail);
  window.addEventListener(ACCOUNT_CHANGE_EVENT,a);window.addEventListener(SYNC_CHANGE_EVENT,o);window.addEventListener(SYNC_STATUS_EVENT,s);
  return()=>{window.removeEventListener(ACCOUNT_CHANGE_EVENT,a);window.removeEventListener(SYNC_CHANGE_EVENT,o);window.removeEventListener(SYNC_STATUS_EVENT,s);};
 },[]);
 const panel=<AccountSettings gateway={gateway} variant="sheet" onSettings={()=>{setOpen(false);onSettings?.();}}/>;
 const sheet=<Drawer rootClassName="account-drawer" placement="bottom" size="auto" open={open} onClose={()=>setOpen(false)} destroyOnHidden title={null} closable={false}><div className="more-handle" aria-hidden="true"/>{panel}</Drawer>;
 if(!account)return <>
  <Button className="account-entry" onClick={()=>setOpen(true)}>{t('登录')}</Button>
  {phone?sheet:<Modal className="account-modal" open={open} onCancel={()=>setOpen(false)} footer={null} width={400} destroyOnHidden>{panel}</Modal>}
 </>;
 const dot=on?DOT[status]||'syncing':null;
 const email=account.email||'';
 const avatar=<button type="button" className="account-entry account-avatar" data-sync={dot||'off'} aria-label={t('账号')+(email?' · '+email:'')} onClick={phone?()=>setOpen(true):undefined}>
  <Avatar size={32}>{(email.trim()[0]||'?').toUpperCase()}</Avatar>{dot&&<span className={'sync-dot sync-dot-'+dot} aria-hidden="true"/>}
 </button>;
 if(phone)return <>{avatar}{sheet}</>;
 return <Popover trigger="click" placement="bottomRight" open={open} onOpenChange={setOpen} destroyOnHidden content={<div className="account-popover">{panel}</div>}>{avatar}</Popover>;
}
