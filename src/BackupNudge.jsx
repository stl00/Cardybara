import React,{useEffect,useState} from 'react';
import {Alert,Button,Space} from 'antd';
import {t,useI18n} from './i18n';
import {readSyncState,readSessionToken} from './walletSync.js';
import {BACKUP_EVENT,noteFirstCard,readNudgeInputs,recordDismiss,showBackupNudge} from './backupNudge.js';

// #572: one dismissible, non-blocking notice on the wallet page of the web build.
export default function BackupNudge({web,cardCount,onExport}){
 useI18n();
 const read=()=>{
  if(typeof localStorage==='undefined')return false;
  if(cardCount>0)noteFirstCard();
  let syncOn=false;try{syncOn=readSyncState(localStorage).on&&!!readSessionToken(localStorage)}catch{}
  return showBackupNudge({web,now:Date.now(),cardCount,syncOn,...readNudgeInputs()});
 };
 const [show,setShow]=useState(read);
 useEffect(()=>{setShow(read());const again=()=>setShow(read());window.addEventListener(BACKUP_EVENT,again);return()=>window.removeEventListener(BACKUP_EVENT,again);},[web,cardCount]);
 if(!show)return null;
 return <Alert className="backup-nudge" type="info" showIcon style={{marginBottom:20}}
  title={t('钱包已经有一阵子没有导出备份了。把它存成一个文件，换手机或浏览器清理数据时才不会丢。')}
  action={<Space size={8} wrap><Button size="small" type="primary" onClick={()=>onExport()}>{t('现在导出')}</Button><Button size="small" onClick={()=>recordDismiss()}>{t('以后再说')}</Button></Space>}/>;
}
