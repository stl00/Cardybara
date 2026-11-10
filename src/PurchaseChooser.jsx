import React,{useMemo,useState} from 'react';
import {Alert,Button,Card,Flex,Input,InputNumber,Select,Space,Tag,Typography} from 'antd';
import {t,formatNumber,useI18n} from './i18n';
import {usePersonalMarks} from './PersonalWallet.jsx';
import {QUICK_CATEGORIES,walletCurrencies,quickChoice} from './purchaseChoice.js';
const {Text,Paragraph}=Typography;
const CATEGORY_LABELS={dining:'餐厅',supermarket:'超市',gas:'加油',['online-retail']:'网购',flight:'机票',hotel:'酒店',travel:'其他旅行',transit:'公共交通',streaming:'流媒体',drugstore:'药妆店',entertainment:'娱乐',other:'其他消费'};
const SYMBOLS={USD:'US$',HKD:'HK$',CAD:'CA$'};
const money=(n,c,hidden)=>hidden?'••••':`${SYMBOLS[c]||c||''}${formatNumber(n,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
function rateText(e){
 if(!e)return '';
 if(e.unit==='cashback-percent')return t('{0}% 现金返现',[e.rate]);
 if(e.unit==='points-per-USD')return t('每美元 {0} 积分',[e.rate]);
 if(e.unit==='miles-per-USD')return t('每美元 {0} 里',[e.rate]);
 if(e.unit==='HKD-per-mile')return t('每 HK${0} 1 里',[e.rate]);
 if(e.unit==='points-per-HKD')return t('每港币 {0} 积分',[e.rate]);
 if(e.unit==='points-per-CAD')return t('每加元 {0} 积分',[e.rate]);
 return String(e.rate);
}
function changeText(c){
 if(c.kind==='credit-if-it-applies')return c.wouldChangeChoice?t('如果 {0} 的「{1}」还能用，它会更划算。',[c.card,t(c.title)]):t('{0} 的「{1}」没有计入：还没标记为未使用，或商户不在名单上。',[c.card,t(c.title)]);
 if(c.kind==='higher-rate-if')return t('{0} 满足额外条件时可达 {1}。',[c.card,rateText(c)]);
 if(c.kind==='if-coded-differently')return t('如果商户没有按这个类别入账，{0} 更好。',[c.card]);
 if(c.kind==='cap')return t('{0} 的奖励有上限，剩余额度未知。',[c.card]);
 return t('外币手续费没有记录，不代表没有。');
}
function Result({r,hidden}){
 if(r.kind==='none')return <Alert type="info" showIcon title={t('没有找到能比较的卡。')}/>;
 if(r.kind==='depends-on-currency')return <Alert type="info" showIcon title={t('你的卡用不同货币结算，请选择付款货币。')} description={r.options.map(o=><div key={o.currency}>{t('{0}：{1}',[o.currency,o.card||'—'])}</div>)}/>;
 const head=r.kind==='use-card'
  ?<><Text strong>{t('用 {0}',[r.card])}</Text><br/><Text>{r.basis==='money'&&r.value!=null?t('按记录的规则约得 {0}',[money(r.value,r.currency,hidden)]):rateText(r.earn)}</Text>{r.credit&&<><br/><Text type="secondary">{t('已计入 {0}',[t(r.credit.title)])}</Text></>}<br/><Tag color={r.certainty==='confirmed'?'success':'warning'} style={{marginTop:6}}>{r.certainty==='confirmed'?t('规则没有附加条件'):t('有条件：商户编码、上限或登记未确认')}</Tag></>
  :<Text strong>{t('这笔没有现金返现卡可比；积分卡之间要看你给每点的估值。')}</Text>;
 return <Space orientation="vertical" size={8} style={{width:'100%'}}>
  <div>{head}</div>
  {r.others.length>0&&<div><Text type="secondary">{t('其他选择')}</Text>{r.others.map(o=><div key={o.card}>{o.card} · {rateText(o)}</div>)}</div>}
  {r.points.length>0&&<div><Text type="secondary">{t('积分卡')}</Text>{r.points.map(p=><div key={p.card}>{p.card} · {rateText(p)}{p.breakEvenCentsPerPoint!=null&&<Text type="secondary">{' · '+t('每点估值超过 {0} 分时更划算',[p.breakEvenCentsPerPoint])}</Text>}</div>)}</div>}
  {r.changes.length>0&&<div><Text type="secondary">{t('可能改变结果')}</Text>{r.changes.map((c,i)=><div key={i}>{changeText(c)}</div>)}</div>}
  {(r.excluded>0||r.otherCurrency>0)&&<Text type="secondary">{[r.excluded&&t('{0} 张卡没有这类消费的规则或无法识别卡种，未参与比较。',[r.excluded]),r.otherCurrency&&t('{0} 张卡以其他货币结算，未参与比较。',[r.otherCurrency])].filter(Boolean).join(' ')}</Text>}
 </Space>;
}
export default function PurchaseChooser({cards,hidden=false,onAsk}){
 useI18n();const {events=[],day}=usePersonalMarks()||{};
 const currencies=walletCurrencies(cards);
 const [category,setCategory]=useState('dining'),[amount,setAmount]=useState(null),[merchant,setMerchant]=useState(''),[currency,setCurrency]=useState(currencies.length===1?currencies[0]:undefined);
 const result=useMemo(()=>day?quickChoice({category,amount,merchant,currency},{cards,events,day}):null,[category,amount,merchant,currency,cards,events,day]);
 return <Card style={{marginBottom:20}}>
  <Flex justify="space-between" align="center" wrap gap={12}><div><Text strong>{t('这笔消费，用哪张卡？')}</Text><Paragraph type="secondary" style={{marginBottom:0}}>{t('现金返现、积分和适用条件一起看。')}</Paragraph></div><Button onClick={onAsk}>{t('问卡疲扒拉')}</Button></Flex>
  <Flex wrap gap={8} style={{margin:'12px 0'}}>
   <Select aria-label={t('消费类别')} value={category} onChange={setCategory} style={{minWidth:140}} options={QUICK_CATEGORIES.map(value=>({value,label:t(CATEGORY_LABELS[value])}))}/>
   <InputNumber aria-label={t('金额（选填）')} placeholder={t('金额（选填）')} min={0} value={amount} onChange={v=>setAmount(v??null)} style={{width:140}}/>
   {currencies.length>1&&<Select aria-label={t('付款货币')} placeholder={t('付款货币')} allowClear value={currency} onChange={setCurrency} style={{width:120}} options={currencies.map(value=>({value,label:value}))}/>}
   <Input aria-label={t('商户（选填）')} placeholder={t('商户（选填）')} value={merchant} onChange={e=>setMerchant(e.target.value)} maxLength={80} style={{width:180}}/>
  </Flex>
  {result&&<Result r={result} hidden={hidden}/>}
  <Paragraph type="secondary" style={{marginTop:12,marginBottom:0}}>{t('按持有卡的公开规则计算，不含优惠活动；实际入账以银行为准。')}</Paragraph>
 </Card>;
}
