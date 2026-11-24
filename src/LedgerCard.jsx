import React,{useState} from 'react';
import {Card,Segmented,Descriptions,Typography} from 'antd';
import {t,useI18n} from './i18n';
import {creditLedger} from './creditLedger';
const {Text,Paragraph}=Typography;
const cash=(n,c)=>`${({USD:'US$',HKD:'HK$',CAD:'CA$'})[c]||c} ${n.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2})}`;
/** One card's credit ledger for the card year or the calendar year, from the user's own marks. Amounts hide in hidden mode. */
export default function LedgerCard({card,events,day,hidden=false,onSetFeeDate}){
 useI18n();
 const [basis,setBasis]=useState(card.feeDate?'card-year':'calendar-year');
 const [previous,setPrevious]=useState(false);
 const [l]=creditLedger([card],events,day,{basis,previous});
 if(!l)return null;
 const show=n=>n==null?'—':hidden?'••••':cash(n,l.currency);
 const missingDate=basis==='card-year'&&l.needsFeeDate;
 const items=[
  {key:'available',label:t(previous?'上期可用 Credit':'本期可用 Credit'),children:show(l.available)},
  {key:'used',label:t('你标记已用'),children:show(l.used)},
  {key:'captured',label:t('未记录（周期已结束）'),children:show(l.notCaptured)},
  ...(previous&&!l.open?[]:[{key:'open',label:t('周期未结束'),children:show(l.open)}]),
  ...(l.unused||l.skipped?[{key:'other',label:t('标记未用 / 不适用'),children:`${show(l.unused)} / ${show(l.skipped)}`}]:[]),
  ...(l.offCycle.count?[{key:'offCycle',label:t(previous?'四年期 / 一次性 Credit（上期已用）':'四年期 / 一次性 Credit（本期已用）'),children:`${show(l.offCycle.used)} · ${l.offCycle.credits.map(c=>c.title).join(' / ')}`}]:[]),
  {key:'fee',label:t('公布年费'),children:show(l.annualFee)},
  {key:'net',label:t('已用减年费'),children:show(l.netOfFee.used)}
 ];
 return <Card size="small" className="credit-ledger" style={{marginBottom:24}} title={t('Credit 账本')} extra={<Segmented size="small" value={basis} onChange={setBasis} options={[{value:'card-year',label:t('持卡年度')},{value:'calendar-year',label:t('日历年')}]}/>}>
  <Segmented size="small" value={previous?'previous':'current'} onChange={v=>setPrevious(v==='previous')} options={[{value:'current',label:t('本期')},{value:'previous',label:t('上一期')}]} style={{marginBottom:8}}/>
  {missingDate?<Paragraph type="secondary">{t('填年费日，周年福利才能算周期')}{onSetFeeDate&&<> · <a onClick={onSetFeeDate}>{t('设置年费日')}</a></>}</Paragraph>:l.beforeCard?<Paragraph type="secondary">{t('这张卡在上一个持卡年度还没开，没有账本。')}</Paragraph>:<>
   <Text type="secondary">{l.period.start} — {l.period.end}</Text>
   <Descriptions size="small" column={{xs:1,sm:2}} style={{marginTop:8}} items={items}/>
   {l.needsFeeDate&&<Paragraph type="secondary" style={{fontSize:12,margin:0}}>{t('{0} 项持卡年度 Credit 没有年费日，未计入。',[l.excluded.cardYearCredits])}</Paragraph>}
   <Paragraph type="secondary" style={{fontSize:12,margin:'8px 0 0'}}>{t('“已用”只来自你自己的标记；周期结束仍没标记的算“未记录”，不当作已用，也不当作错过。年费为公布标准年费，不是实际扣款。')}</Paragraph></>}
 </Card>;
}
