import React,{useEffect} from 'react';
import {Alert,Button,Spin} from 'antd';
import {t,useI18n} from './i18n';
import {LANDING_GIVE_UP_MS,LANDING_POLL_MS,LANDING_TIMEOUT_MS} from './plaidLanding.js';

/** While a landing waits for its cards: read the Plaid list every few seconds, and say so once it takes long. */
export function usePlaidLandingReads({client,landing,setLanding}){
 const waiting=!!landing&&landing.phase!=='done';
 useEffect(()=>{
  if(!waiting||!client)return;
  let busy=false;
  const read=()=>{if(busy)return;busy=true;client.cards().finally(()=>{busy=false;});};
  read();
  const poll=setInterval(read,LANDING_POLL_MS);
  const late=setTimeout(()=>setLanding(v=>v&&v.phase==='waiting'?{...v,phase:'late'}:v),LANDING_TIMEOUT_MS);
  const stop=setTimeout(()=>clearInterval(poll),LANDING_GIVE_UP_MS);
  return()=>{clearInterval(poll);clearTimeout(late);clearTimeout(stop);};
 },[waiting,client]);
}

/** The one strip a landing shows on the wallet page: still reading, or how many new cards want a card type. */
export function PlaidLandingStrip({landing,count,onCheck,onClose}){
 useI18n();
 if(landing.phase==='waiting')return <Alert className="plaid-landing" type="info" showIcon icon={<Spin size="small"/>} style={{marginBottom:20}} title={t('正在读取你的卡…')}/>;
 if(landing.phase==='late')return <Alert className="plaid-landing plaid-landing-late" type="info" showIcon closable={{onClose,'aria-label':t('关闭')}} style={{marginBottom:20}} title={t('还在读取你的卡，读到后会自动出现。')}/>;
 if(landing.cardIds.length<2||!count)return null;
 return <Alert className="plaid-landing plaid-landing-types" type="info" showIcon style={{marginBottom:20}} title={t('{0} 张卡需要选卡种',[count])} action={<Button size="small" type="primary" onClick={onCheck}>{t('去看看')}</Button>}/>;
}

/** On top of a new card's drawer: that it was added, and while its type is open, a way to leave it as it is. */
export function PlaidAddedBanner({ask,onKeep}){
 useI18n();
 return <Alert className="plaid-added-banner" type="success" showIcon style={{marginBottom:12}} title={ask?t('已添加到钱包。卡种还没认出来。'):t('已添加到钱包。')}
  action={ask?<Button size="small" className="plaid-keep" onClick={onKeep}>{t('保持现状')}</Button>:null}/>;
}
