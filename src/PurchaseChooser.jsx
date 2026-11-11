import React,{useMemo,useRef,useState} from 'react';
import {Button,Card,Collapse,Empty,Input,InputNumber,Select,Space,Tag,Typography} from 'antd';
import MessageOutlined from '@ant-design/icons/es/icons/MessageOutlined';
import DownOutlined from '@ant-design/icons/es/icons/DownOutlined';
import UpOutlined from '@ant-design/icons/es/icons/UpOutlined';
import {t,formatNumber,useI18n} from './i18n';
import {usePersonalMarks} from './PersonalWallet.jsx';
import {QUICK_CATEGORIES,walletCurrencies,quickChoice} from './purchaseChoice.js';
import {usePointValues} from './PointValueSettings.jsx';
import {ArtImage} from './CardArt.jsx';
import {BankMark} from './Identity.jsx';
import ItemLogo from './ItemLogo.jsx';
import {cardPresentation} from './productCatalog.js';
const {Text}=Typography;
const CATEGORY_LABELS={dining:'餐厅',supermarket:'超市',gas:'加油',['online-retail']:'网购',flight:'机票',hotel:'酒店',travel:'旅行',transit:'公共交通',streaming:'流媒体',drugstore:'药妆店',entertainment:'娱乐',other:'其他消费'};
// The icon each chip shows, from the logo registry's categories, so a chip looks like the same thing elsewhere.
const CATEGORY_ICONS={dining:'dining',supermarket:'grocery',gas:'fuel',['online-retail']:'shopping',flight:'airline',hotel:'hotel',travel:'travel',transit:'ground-transport',streaming:'streaming',drugstore:'pharmacy',entertainment:'entertainment',other:'general'};
// Most-used first; the rest open under "more". Only categories the engine offers are drawn.
const PRIMARY=['dining','supermarket','online-retail','gas','travel','other'].filter(c=>QUICK_CATEGORIES.includes(c));
const MORE=QUICK_CATEGORIES.filter(c=>!PRIMARY.includes(c));
const MAX_RUNNERS_UP=2;
const SYMBOLS={USD:'US$',HKD:'HK$',CAD:'CA$'};
const symbolOf=c=>SYMBOLS[c]||c||'';
const money=(n,c,hidden)=>hidden?'••••':`${symbolOf(c)}${formatNumber(n,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const APPROX='≈ ';
const percentText=n=>`${formatNumber(n,{maximumFractionDigits:2})}%`;
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
const ruleText=e=>e?.programme&&!e.isCash?`${rateText(e)} · ${e.programme}`:rateText(e);
// #193: whose value a point was compared at, always said beside the result.
function valueBasis(v){
 const unit=v.currency==='HKD'?t('港仙'):t('美分');
 if(v.basis==='default')return t('积分按默认市场估值每点 {0} {1}（{2}），可在设置里改',[v.cents,unit,v.source?.name||'']);
 return v.basis==='user'?t('积分按你设定的每点 {0} {1}',[v.cents,unit]):t('积分按你说的每点 {0} {1}',[v.cents,unit]);
}
function changeText(c){
 if(c.kind==='credit-if-it-applies')return c.wouldChangeChoice?t('如果 {0} 的「{1}」还能用，它会更划算。',[c.card,t(c.title)]):t('{0} 的「{1}」没有计入：还没标记为未使用，或商户不在名单上。',[c.card,t(c.title)]);
 if(c.kind==='higher-rate-if')return t('{0} 满足额外条件时可达 {1}。',[c.card,rateText(c)]);
 if(c.kind==='if-coded-differently')return t('如果商户没有按这个类别入账，{0} 更好。',[c.card]);
 if(c.kind==='cap')return t('{0} 的奖励有上限，剩余额度未知。',[c.card]);
 return t('{0} 的外币手续费没有记录，不代表没有。',[c.card]);
}
/** The held card a result row names; the engine names cards, the art needs the card. */
const cardFor=(cards,name,region)=>cards.find(c=>c.name===name&&(!region||c.region===region))||cards.find(c=>c.name===name)||null;
/** A card's own product art at a fixed height, or a neutral tile with the bank's mark; never another card's art. */
function ChoiceArt({card,height,size}){
 const [broken,setBroken]=useState(false),art=card?cardPresentation(card).art:null;
 return <span className={`pc-art pc-art-${size}`} aria-hidden="true">{art?.file&&!broken?<ArtImage art={art} alt="" height={height} onError={()=>setBroken(true)}/>:<span className="pc-art-none">{card?<BankMark bank={card.bank} size={Math.round(height*0.42)}/>:null}</span>}</span>;
}
/** What a runner-up gives up against the choice: money when both came to money, else percentage points. */
function gapText(lead,o,currency,hidden){
 if(lead.value!=null&&o.value!=null){const d=Math.round((lead.value-o.value)*100)/100;return d<=0?t('持平'):t('少 {0}',[money(d,currency,hidden)]);}
 if(lead.percent!=null&&o.percent!=null){const d=Math.round((lead.percent-o.percent)*100)/100;return d<=0?t('持平'):t('少 {0} 个百分点',[formatNumber(d,{maximumFractionDigits:2})]);}
 return null;
}
function Hero({r,card,hidden,onDetail}){
 const cash=!!r.earn?.isCash,big=r.percent!=null?`${cash?'':APPROX}${percentText(r.percent)}`:null;
 const name=onDetail&&card?<button type="button" className="pc-card-name" onClick={()=>onDetail(card)} aria-label={t('查看 {0} 的详情',[r.card])}>{r.card}</button>:<span className="pc-card-name">{r.card}</span>;
 return <div className="pc-hero">
  <ChoiceArt card={card} height={56} size="hero"/>
  <div className="pc-hero-main">
   <Text type="secondary" className="pc-eyebrow">{t('建议用')}</Text>
   {name}
   <Text className="pc-rule">{ruleText(r.earn)}</Text>
   <Space size={[6,6]} wrap className="pc-tags">
    <Tag color={r.certainty==='confirmed'?'success':'warning'}>{r.certainty==='confirmed'?t('规则没有附加条件'):t('有附加条件')}</Tag>
    {r.credit&&<Tag color="blue">{t('已计入 {0}',[t(r.credit.title)])}</Tag>}
   </Space>
  </div>
  <div className="pc-hero-return">
   {big?<span className="pc-big">{big}</span>:<span className="pc-big pc-big-rate">{rateText(r.earn)}</span>}
   <Text type="secondary" className="pc-big-caption">{r.basis==='money'&&r.value!=null?t('这笔约得 {0}',[money(r.value,r.currency,hidden)]):big?(cash?t('现金返现'):t('按积分估值折算')):t('积分未估值')}</Text>
  </div>
 </div>;
}
function RunnerUps({r,cards,hidden,breakEven}){
 const list=r.others.slice(0,MAX_RUNNERS_UP);if(!list.length)return null;
 return <div className="pc-others">
  <Text type="secondary" className="pc-section-label">{r.kind==='use-card'?t('其他选择'):t('可比较的卡')}</Text>
  <ul>{list.map(o=>{
   const gap=r.kind==='use-card'?gapText(r,o,r.currency,hidden):null,even=breakEven.get(o.card);
   return <li key={o.card+(o.cardRegion||'')} className="pc-other">
    <ChoiceArt card={cardFor(cards,o.card,o.cardRegion)} height={28} size="row"/>
    <span className="pc-other-main"><span className="pc-other-name">{o.card}</span><Text type="secondary" className="pc-other-rule" title={ruleText(o)}>{ruleText(o)}</Text></span>
    <span className="pc-other-return">{o.percent!=null?<span className="pc-other-percent">{`${o.isCash?'':APPROX}${percentText(o.percent)}`}</span>:null}{gap?<Text type="secondary" className="pc-other-gap">{gap}</Text>:even!=null&&r.kind==='use-card'?<Text type="secondary" className="pc-other-gap">{t('每点估值超过 {0} 分时更划算',[even])}</Text>:null}</span>
   </li>;
  })}</ul>
 </div>;
}
/** Everything that qualifies the answer, folded into one disclosure instead of a wall of notes. */
function Why({r,onSettings}){
 const values=new Map();
 if(r.pointValue)values.set(r.pointValue.programme+'|'+r.pointValue.basis,{v:r.pointValue,holds:r.holdsAbove});
 for(const p of r.points)if(p.pointValue){const k=p.pointValue.programme+'|'+p.pointValue.basis;if(!values.has(k))values.set(k,{v:p.pointValue});}
 const lines=[];
 if(r.kind==='use-card')lines.push(r.certainty==='confirmed'?t('{0} 这类消费的规则没有附加条件。',[r.card]):t('有条件：商户编码、上限或登记未确认'));
 for(const {v,holds} of values.values())lines.push(t('{0}：{1}',[v.programme||'',valueBasis(v)])+(holds!=null?' · '+t('每点估值不低于 {0} 分时结论不变',[holds]):''));
 for(const c of r.changes)lines.push(changeText(c));
 if(r.excluded)lines.push(t('{0} 张卡没有这类消费的规则或无法识别卡种，未参与比较。',[r.excluded]));
 if(r.otherCurrency)lines.push(t('{0} 张卡以其他货币结算，未参与比较。',[r.otherCurrency]));
 lines.push(t('按持有卡的公开规则计算，不含优惠活动；实际入账以银行为准。'));
 const count=r.changes.length;
 return <Collapse ghost size="small" className="pc-why" items={[{key:'why',label:<span>{t('为什么 · 可能改变结果的情况')}{count?<Tag className="pc-why-count">{count}</Tag>:null}</span>,children:<>
  <ul className="pc-why-list">{lines.map((line,i)=><li key={i}>{line}</li>)}</ul>
  {values.size>0&&onSettings&&<Button type="link" size="small" className="pc-why-settings" onClick={onSettings}>{t('调整积分估值')}</Button>}
 </>}]}/>;
}
/** The result as drawn for one quickChoice answer; exported for the render test. */
export function ChoiceResult({r,cards,hidden,onDetail,onSettings,setCurrency}){
 if(r.kind==='none')return <div className="pc-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><Text>{t('你持有的卡里，没有这类消费的规则。')}</Text><br/><Text type="secondary">{t('换个类别试试，或在卡片详情里确认卡种。')}</Text></>}/></div>;
 if(r.kind==='depends-on-currency')return <div className="pc-currency"><Text>{t('你的卡用不同货币结算，请选择付款货币。')}</Text><Space wrap size={8}>{r.options.map(o=><Button key={o.currency} onClick={()=>setCurrency(o.currency)}>{o.card?t('{0}：{1}',[o.currency,o.card]):o.currency}</Button>)}</Space></div>;
 const breakEven=new Map(r.points.filter(p=>p.breakEvenCentsPerPoint!=null).map(p=>[p.card,p.breakEvenCentsPerPoint]));
 return <>
  {r.kind==='use-card'?<Hero r={r} card={cardFor(cards,r.card,r.cardRegion)} hidden={hidden} onDetail={onDetail}/>:<div className="pc-notice"><Text>{t('这笔没有现金返现卡可比；积分卡之间要看你给每点的估值，可在设置的积分估值里填写。')}</Text>{onSettings&&<Button type="link" size="small" onClick={onSettings}>{t('调整积分估值')}</Button>}</div>}
  <RunnerUps r={r} cards={cards} hidden={hidden} breakEven={breakEven}/>
  <Why r={r} onSettings={onSettings}/>
 </>;
}
/** The chips are one radio group: arrows move and choose, Tab leaves, as in any radio group. */
function CategoryChips({value,onChange}){
 const [more,setMore]=useState(MORE.includes(value)),group=useRef(null);
 const shown=more?[...PRIMARY,...MORE]:[...PRIMARY,...(MORE.includes(value)?[value]:[])];
 const onKeyDown=e=>{
  const step={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[e.key],at=shown.indexOf(value);
  let next=null;if(step)next=(at+step+shown.length)%shown.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=shown.length-1;
  if(next==null)return;e.preventDefault();onChange(shown[next]);setTimeout(()=>group.current?.querySelector(`[data-category="${shown[next]}"]`)?.focus(),0);
 };
 return <div className="pc-chips-row">
  <div className="pc-chips" role="radiogroup" aria-label={t('消费类别')} ref={group} onKeyDown={onKeyDown}>
   {shown.map(c=><button key={c} type="button" role="radio" aria-checked={c===value} tabIndex={c===value?0:-1} data-category={c} className="pc-chip" onClick={()=>onChange(c)}><span aria-hidden="true" className="pc-chip-icon"><ItemLogo category={CATEGORY_ICONS[c]} size={15}/></span>{t(CATEGORY_LABELS[c])}</button>)}
  </div>
  {MORE.length>0&&<button type="button" className="pc-chip pc-chip-more" aria-expanded={more} onClick={()=>setMore(!more)}>{more?t('收起'):t('更多类别')}{more?<UpOutlined aria-hidden="true"/>:<DownOutlined aria-hidden="true"/>}</button>}
 </div>;
}
export default function PurchaseChooser({cards,hidden=false,onAsk,onDetail,onSettings}){
 useI18n();const {events=[],day}=usePersonalMarks()||{},pointValues=usePointValues();
 const currencies=walletCurrencies(cards);
 const [category,setCategory]=useState('dining'),[amount,setAmount]=useState(null),[merchant,setMerchant]=useState(''),[currency,setCurrency]=useState(currencies.length===1?currencies[0]:undefined);
 const result=useMemo(()=>day?quickChoice({category,amount,merchant,currency},{cards,events,day,pointValues}):null,[category,amount,merchant,currency,cards,events,day,pointValues]);
 const single=currencies.length===1?currencies[0]:null;
 const amountField=<InputNumber aria-label={t('金额（选填）')} placeholder={t('金额（选填）')} min={0} inputMode="decimal" value={amount} onChange={v=>setAmount(v??null)} prefix={single?<Text type="secondary">{symbolOf(single)}</Text>:undefined} className="pc-amount"/>;
 const summary=result?.kind==='use-card'?t('建议用 {0}',[result.card])+(result.percent!=null?' · '+percentText(result.percent):''):'';
 return <Card className="purchase-chooser" title={t('这笔消费，用哪张卡？')} extra={onAsk&&<Button type="link" icon={<MessageOutlined/>} onClick={onAsk}>{t('问卡疲扒拉')}</Button>}>
  <CategoryChips value={category} onChange={setCategory}/>
  <div className="pc-fields">
   {currencies.length>1?<Space.Compact className="pc-amount-group"><Select aria-label={t('付款货币')} placeholder={t('付款货币')} allowClear value={currency} onChange={setCurrency} options={currencies.map(value=>({value,label:value}))} className="pc-currency-select"/>{amountField}</Space.Compact>:amountField}
   <Input aria-label={t('商户（选填）')} placeholder={t('商户（选填）')} value={merchant} onChange={e=>setMerchant(e.target.value)} maxLength={80} allowClear className="pc-merchant"/>
  </div>
  <span className="pc-sr" aria-live="polite">{summary}</span>
  {result&&<div className="pc-result"><ChoiceResult r={result} cards={cards} hidden={hidden} onDetail={onDetail} onSettings={onSettings} setCurrency={setCurrency}/></div>}
 </Card>;
}
