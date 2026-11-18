import React,{useEffect,useRef,useState} from 'react';
import {Avatar,Button,Drawer,Modal,Popover,Typography} from 'antd';
import {t,useI18n} from './i18n';
import {CapybaraMark} from './NavIcon.jsx';
import {AccountMenu,SignedOutForm,useAccountFlow} from './AccountSettings.jsx';
import {syncState} from './accountClient.js';
const {Paragraph,Text,Title}=Typography;

// The header's account entry (#500, epic #496). Signed out it is one plain "Sign in" button that opens a sheet on tap and never on its own;
// signed in it is an avatar with the email's first letter and a dot for the sync state. The flows are AccountSettings' own (useAccountFlow).
const dotLabel=s=>({synced:t('已同步'),syncing:t('正在同步…'),offline:t('离线：恢复网络后会自动同步。'),error:t('同步没有成功，稍后会重试。')})[s]||t('同步已关闭');

export default function AccountEntry({gateway,phone,onSettings}){
 useI18n();
 const [sheet,setSheet]=useState(false),[menu,setMenu]=useState(false);
 const f=useAccountFlow(gateway,{active:sheet||menu});
 const {account,status,on}=f;
 const was=useRef(!!account);
 // Signing in closes the sheet; the sign-in flow itself is unchanged.
 useEffect(()=>{if(account&&!was.current)setSheet(false);if(!account)setMenu(false);was.current=!!account;},[account]);
 const state=syncState(on,status);
 const settings=()=>{setMenu(false);onSettings?.();};
 if(!account){
  const form=<div className="account-sheet-body">
   <div className="account-sheet-head"><CapybaraMark size={44}/><Title level={4} style={{margin:'8px 0 4px'}}>{t('登录卡疲扒拉')}</Title><Text type="secondary">{t('手机和电脑用同一个钱包。')}</Text></div>
   <SignedOutForm f={f} sheet/>
   <Paragraph type="secondary" className="account-sheet-note" style={{marginTop:16,marginBottom:0,fontSize:12}}>{t('登录只用于同步钱包。不含银行密码，不登录也能完整使用。')}</Paragraph>
  </div>;
  return <>
   <Button className="account-entry account-signin" onClick={()=>setSheet(true)}>{t('登录')}</Button>
   {phone?<Drawer placement="bottom" height="auto" open={sheet} onClose={()=>setSheet(false)} destroyOnHidden title={null} className="account-sheet" styles={{body:{paddingBottom:'calc(24px + env(safe-area-inset-bottom))'}}}>{form}</Drawer>
    :<Modal open={sheet} onCancel={()=>setSheet(false)} footer={null} destroyOnHidden width={400} className="account-sheet" title={null}>{form}</Modal>}
  </>;
 }
 const letter=([...(account.email||'?')][0]||'?').toUpperCase();
 const avatar=<button type="button" className="account-entry account-avatar" aria-label={t('账号菜单')} title={dotLabel(state)} data-sync={state} onClick={phone?()=>setMenu(true):undefined}>
  <Avatar size={32}>{letter}</Avatar>{state!=='off'&&<span className={'sync-dot sync-dot-'+state} role="img" aria-label={dotLabel(state)}/>}
 </button>;
 const menuBody=<AccountMenu f={f} onSettings={settings}/>;
 return phone?<>{avatar}<Drawer placement="bottom" height="auto" open={menu} onClose={()=>setMenu(false)} destroyOnHidden title={t('账号')} className="account-sheet" styles={{body:{paddingBottom:'calc(24px + env(safe-area-inset-bottom))'}}}>{menuBody}</Drawer></>
  :<Popover trigger="click" placement="bottomRight" open={menu} onOpenChange={setMenu} content={<div style={{width:280}}>{menuBody}</div>}>{avatar}</Popover>;
}
