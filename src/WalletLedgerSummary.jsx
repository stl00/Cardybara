import React from 'react';
import {Card,Typography} from 'antd';
import {t,useI18n} from './i18n';
import {walletLedgerSummary} from './walletLedger';
import {CardIdentity} from './Identity';
import InfoTip from './InfoTip';
const {Text}=Typography;
const cash=(n,c)=>`${({USD:'US$',HKD:'HK$',CAD:'CA$'})[c]||c} ${n.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2})}`;
/** Wallet-wide credit summary on the Credits page: one line per card on its current card year, and a total per currency (#568). Amounts hide in hidden mode. */
export default function WalletLedgerSummary({cards,events,day,hidden=false,onSetFeeDate}){
 useI18n();
 const {rows,totals}=walletLedgerSummary(cards,events,day);
 if(!rows.length)return null;
 const show=(n,c)=>hidden?'••••':cash(n,c);
 const line=(r,c)=>t('{0} 可用 · {1} 已用 · {2} 未记录',[show(r.available,c),show(r.used,c),show(r.notCaptured,c)]);
 return <Card size="small" className="wallet-ledger" style={{marginBottom:20}} title={<>{t('全部卡的 Credit 账本')} <InfoTip title={t('每张卡按自己的持卡年度计算；不同币种不相加。“已用”只来自你自己的标记，“未记录”是周期已结束但没有标记的部分。')}/></>}>
  {rows.map(r=>{const card=cards.find(c=>c.id===r.cardId);return <div key={r.cardId} className="wallet-ledger-row" style={{padding:'6px 0'}}>
   <div className="wallet-ledger-card"><CardIdentity card={card}/></div>
   {r.needsFeeDate?<Text type="secondary">{t('填年费日，周年福利才能算周期')}{onSetFeeDate&&<> · <a onClick={()=>onSetFeeDate(card)}>{t('设置年费日')}</a></>}</Text>
    :<Text type="secondary" style={{overflowWrap:'anywhere'}}>{line(r,r.currency)}</Text>}
  </div>;})}
  {totals.length>0&&<div className="wallet-ledger-totals" style={{borderTop:'1px solid rgba(128,128,128,.25)',marginTop:8,paddingTop:8}}>
   {totals.map(x=><div key={x.currency}><Text strong style={{overflowWrap:'anywhere'}}>{x.currency} · {t('{0} 张卡',[x.cards])}：{line(x,x.currency)}</Text></div>)}
  </div>}
 </Card>;
}
