import React,{useEffect,useMemo,useState} from 'react';
import {Alert,App,Button,Card,Collapse,Empty,Flex,Input,Segmented,Space,Tag,Typography} from 'antd';
import SearchOutlined from '@ant-design/icons/es/icons/SearchOutlined';
import {t,useI18n} from './i18n';
import {CardIdentity} from './Identity';
import InfoTip from './InfoTip.jsx';
import MoreMenu from './MoreMenu.jsx';
import {walletDay} from './personalBenefits';
import {PAYMENT_MARKS_KEY,paymentGroup,paymentView,readPaymentMarks,withPaymentMark,withoutPaymentMark} from './paymentStates';
const {Text}=Typography;
export const PAYMENT_MARKS_CHANGE='cardybara-payment-marks-change';
const CHANGE=PAYMENT_MARKS_CHANGE;
const SEARCH_FROM=6;

export function loadPaymentMarks(){try{return readPaymentMarks(localStorage);}catch{return []}}
export function savePaymentMarks(marks){localStorage.setItem(PAYMENT_MARKS_KEY,JSON.stringify(marks));window.dispatchEvent(new Event(CHANGE));}
export function usePaymentMarks(){
 const [marks,setMarks]=useState(loadPaymentMarks);
 useEffect(()=>{const load=()=>setMarks(loadPaymentMarks());window.addEventListener(CHANGE,load);window.addEventListener('storage',load);return()=>{window.removeEventListener(CHANGE,load);window.removeEventListener('storage',load)}},[]);
 return marks;
}

function dueText(item){
 const {cycle,days,state}=item;
 if(state==='no_payment')return t('银行显示无需付款');
 if(state==='nothing_billed')return t('读到的账单没有应付金额');
 if(cycle?.kind==='yearless')return t('还款日 {0}（银行未提供年份）',[cycle.label]);
 if(!cycle)return t('还款日未读取');
 if(cycle.inferred)return `${dueDayText(cycle,days)}${t('（年份按读取日期推断）')}`;
 return dueDayText(cycle,days);
}
function dueDayText(cycle,days){
 if(days===-1)return t('还款日 {0} · 昨天',[cycle.date]);
 if(days<0)return t('还款日 {0} · 已过 {1} 天',[cycle.date,-days]);
 if(days===0)return t('还款日 {0} · 今天到期',[cycle.date]);
 if(days===1)return t('还款日 {0} · 明天到期',[cycle.date]);
 return t('还款日 {0} · 还有 {1} 天',[cycle.date,days]);
}
// One tag per row (#682): the single most urgent fact.
function StateTag({item}){
 const {state,soon,stale,handled}=item;
 if(handled)return <Tag color="success">{t('本期已处理')}</Tag>;
 if(state==='overdue')return <Tag color="error">{t('还款日已过')}</Tag>;
 if(stale)return <Tag color="orange">{t('读数已过期')}</Tag>;
 if(state==='due')return soon?<Tag color="warning">{t('即将到期')}</Tag>:<Tag>{t('待还款')}</Tag>;
 if(state==='yearless')return <Tag color="warning">{t('年份未知')}</Tag>;
 if(state==='autopay')return <Tag color="processing">{t('自动还款已开启')}</Tag>;
 if(state==='no_payment')return <Tag>{t('无需付款')}</Tag>;
 if(state==='nothing_billed')return <Tag>{t('没有应付金额')}</Tag>;
 if(state==='unknown')return <Tag>{t('未读取')}</Tag>;
 return null;
}
function note(item){
 if(item.state==='overdue')return item.autopay==='on'?t('自动还款已开启，请到银行核对是否已扣款。'):t('钱包不知道你是否已还款；请到银行核对，或标记已处理。');
 if(item.state==='stale')return t('上次读到的还款日已过，读数太旧，无法判断这期是否已还。请刷新。');
 if(item.state==='yearless')return t('银行只显示月日，所以不计算剩余天数。');
 return null;
}
function PaymentRow({item,money,urls,onDetail,onMark,onUndo}){
 const {card,state}=item,paid=state==='no_payment',bank=urls[card.bank],hint=!item.handled&&note(item);
 const autopay=item.autopay==='on'?t('已开启'):item.autopay==='off'?t('未开启'):t('未读取');
 const about=<>{hint&&<div>{hint}</div>}{!paid&&<div>{t('最低 {0}',[money(card.minimum,card.currency)])}</div>}<div>{t('自动还款 {0}',[autopay])}</div><div>{item.readAt?t('读取于 {0}',[item.readAt]):t('读取时间未知')}</div></>;
 return <div className="payment-row" data-state={state}>
  <div className="payment-row-main">
   <Flex wrap align="center" gap={6}><CardIdentity card={card}/>{card.tail&&<Text type="secondary">•••• {card.tail}</Text>}<StateTag item={item}/><InfoTip title={about}/></Flex>
   <Text strong className="payment-due">{dueText(item)}</Text>
   {!paid&&<Text className="payment-amount">{t('账单 {0}',[money(card.statement,card.currency)])}</Text>}
  </div>
  <Space size={8} className="payment-actions">
   {item.handled?<Button size="small" onClick={()=>onUndo(item)}>{t('撤销')}</Button>:item.canMark&&<Button size="small" onClick={()=>onMark(item)}>{t('标记已处理')}</Button>}
   <MoreMenu items={[bank&&{key:'bank',label:<a href={bank} target="_blank" rel="noopener noreferrer">{t('去银行')}</a>},{key:'detail',label:t('详情')}]} onClick={key=>{if(key==='detail')onDetail(card)}}/>
  </Space>
 </div>;
}
// The "cannot judge" notice, drawn in the page's one banner slot (#686).
export function UnjudgedBills({cards,onRefresh}){
 useI18n();
 const marks=usePaymentMarks(),day=walletDay();
 const count=useMemo(()=>paymentView(cards,marks,day).refresh.length,[cards,marks,day]);
 if(!count)return null;
 return <Alert className="payment-refresh" type="info" showIcon style={{marginBottom:20}} title={t('{0} 张卡的账单未读取或读数已过期，暂时无法判断是否要还款',[count])} action={onRefresh&&<Button size="small" onClick={onRefresh}>{t('刷新银行')}</Button>}/>;
}
export default function PaymentAssistant({cards,hidden=false,urls,onDetail}){
 useI18n();
 const {message}=App.useApp(),marks=usePaymentMarks(),day=walletDay();
 const [filter,setFilter]=useState('all'),[search,setSearch]=useState('');
 const view=useMemo(()=>paymentView(cards,marks,day),[cards,marks,day]);
 const money=(value,currency)=>{
  if(value==null)return t('未读取');
  if(hidden)return '••••';
  return `${value<0?'-':''}${({USD:'$',HKD:'HK$',CAD:'CA$',CNY:'CN¥'})[currency]||currency+' '}${Math.abs(Number(value)).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
 };
 const save=next=>{try{savePaymentMarks(next);return true}catch{message.error(t('保存失败，刚才的标记没有生效。'));return false}};
 const onMark=item=>{
  if(!save(withPaymentMark(marks,item.key)))return;
  message.open({key:'payment-mark',type:'success',duration:6,content:<Space>{t('已标记本期已处理；钱包没有付款。')}<Button type="link" size="small" onClick={()=>{save(withoutPaymentMark(loadPaymentMarks(),item.key,item.legacyKey));message.destroy('payment-mark')}}>{t('撤销')}</Button></Space>});
 };
 const onUndo=item=>save(withoutPaymentMark(marks,item.key,item.legacyKey));
 const row=item=><PaymentRow key={item.card.id} item={item} money={money} urls={urls} onDetail={onDetail} onMark={onMark} onUndo={onUndo}/>;
 const counts={all:view.rest.length+view.handled.length,handled:view.handled.length};
 for(const item of view.rest){const group=paymentGroup(item);counts[group]=(counts[group]||0)+1;}
 const options=[['all','全部'],['due','待还款'],['autopay','自动还款'],['no_payment','无需付款'],['nothing_billed','没有应付金额'],['unknown','未读取或过期'],['handled','已处理']].filter(([value])=>value==='all'||counts[value]).map(([value,label])=>({value,label:`${t(label)} ${counts[value]}`}));
 const active=options.some(o=>o.value===filter)?filter:'all';
 const pool=active==='handled'?view.handled:active==='all'?[...view.rest,...view.handled]:view.rest.filter(i=>paymentGroup(i)===active);
 const query=search.trim().toLowerCase();
 const rows=query?pool.filter(i=>[i.card.name,i.card.bank,i.card.tail].join(' ').toLowerCase().includes(query)):pool;
 const headline=view.action?(view.urgent?t('{0} 笔要尽快处理，共 {1} 笔待还款',[view.urgent,view.action]):t('{0} 笔待还款',[view.action])):t('没有已知要处理的账单');
 const about=<><div>{t('钱包不会替你付款。“已处理”只是你在本机的记号，下一期账单会重新提醒。')}</div><a href="#settings">{t('设置提醒')}</a></>;
 return <Card className="payment-assistant" style={{marginBottom:20}} title={<Space size={4}>{t('现在要处理')}<InfoTip title={about}/></Space>} extra={<Text type="secondary" className="payment-headline">{headline}</Text>}>
  {view.top.map(row)}
  {counts.all>0&&<Collapse ghost size="small" className="payment-rest" items={[{key:'rest',label:t('其余 {0} 张卡',[counts.all]),children:<>
   <Flex wrap gap={12} align="center" justify="space-between" style={{marginBottom:8}}>
    <div className="payment-filter"><Segmented size="small" value={active} onChange={setFilter} options={options}/></div>
    {counts.all>=SEARCH_FROM&&<Input size="small" className="payment-search" allowClear prefix={<SearchOutlined/>} placeholder={t('搜索卡名、银行或尾号')} aria-label={t('搜索账单')} value={search} onChange={e=>setSearch(e.target.value)}/>}
   </Flex>
   {rows.length?rows.map(row):<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('没有匹配的卡片，请调整筛选条件')}/>}
  </>}]}/>}
 </Card>;
}
