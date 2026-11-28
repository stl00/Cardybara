import React,{useEffect,useRef,useState} from 'react';
import {Card,Col,Collapse,Flex,Tag,Typography} from 'antd';
import StarOutlined from '@ant-design/icons/es/icons/StarOutlined';
import StarFilled from '@ant-design/icons/es/icons/StarFilled';
import EyeOutlined from '@ant-design/icons/es/icons/EyeOutlined';
import EyeInvisibleOutlined from '@ant-design/icons/es/icons/EyeInvisibleOutlined';
import {t,useI18n,formatReadDate} from './i18n';
import {BankMark,bankName} from './Identity';
import CardArt from './CardArt';
import MoreMenu from './MoreMenu';
import {usePaymentMarks} from './PaymentAssistant.jsx';
import {tileDue} from './paymentStates.js';
import {cardDue} from './agentData.js';
import {lastBankRead} from './bankReadings.js';
const {Text,Paragraph}=Typography;
const LONG_PRESS_MS=500,SLOP=10;

/** The favorite and hide actions of one card, used by its tile and by its detail drawer. */
export const cardActions=(favorite,hidden)=>[
 {key:'favorite',icon:favorite?<StarFilled/>:<StarOutlined/>,label:favorite?t('取消收藏'):t('收藏卡片')},
 {key:'hide',icon:hidden?<EyeOutlined/>:<EyeInvisibleOutlined/>,label:hidden?t('取消隐藏'):t('隐藏这张卡')},
];

// A finger held still on the tile opens its menu. The release must then neither close the menu (the mouse events a browser
// makes from a touch would land outside it) nor open the card.
function useLongPress(onLongPress){
 const press=useRef({timer:null,fired:false,touch:false,x:0,y:0});
 const cancel=()=>{clearTimeout(press.current.timer);press.current.timer=null;};
 const fire=()=>{cancel();press.current.fired=true;onLongPress();};
 useEffect(()=>cancel,[]);
 return {
  onPointerDown:e=>{const p=press.current;cancel();p.fired=false;p.touch=e.pointerType!=='mouse';if(!p.touch)return;p.x=e.clientX;p.y=e.clientY;p.timer=setTimeout(fire,LONG_PRESS_MS);},
  onPointerMove:e=>{const p=press.current;if(p.timer&&Math.hypot(e.clientX-p.x,e.clientY-p.y)>SLOP)cancel();},
  onPointerUp:cancel,onPointerCancel:cancel,onPointerLeave:cancel,
  onTouchEnd:e=>{if(press.current.fired&&e.cancelable)e.preventDefault();},
  // Some touch browsers report the long press as a context menu, before or instead of the timer.
  onContextMenu:e=>{if(!press.current.touch)return;e.preventDefault();if(!press.current.fired&&e.currentTarget.contains(e.target))fire();},
  // The menu is a portal: its clicks pass through here in React but are not inside the tile, and are left alone.
  onClickCapture:e=>{if(press.current.fired&&e.currentTarget.contains(e.target)){press.current.fired=false;e.preventDefault();e.stopPropagation();}},
 };
}

/**
 * One card in the wallet list (#684): art, name, last digits, balance and at most one tag. The whole tile opens the card;
 * the name is the keyboard and screen reader target, stretched over the tile. Favorite and hide sit in a ⋯ menu that
 * shows on hover or keyboard focus and opens on a long press; the detail drawer has the same menu.
 */
export default function WalletTile({card,amount,favorite,hidden,isNew,onOpen,onToggleFavorite,onToggleHidden}){
 useI18n();
 const [menu,setMenu]=useState(false),longPress=useLongPress(()=>setMenu(true));
 const due=tileDue(card,usePaymentMarks());
 const stop=e=>e.stopPropagation();
 const value=card.balance!=null?amount(card.balance,card.currency):card.available!=null?amount(card.available,card.currency):null;
 return <Col xs={24} sm={12} xl={8} xxl={6}><Card hoverable className={'wallet-card'+(isNew?' is-new':'')} cover={<div className="card-cover"><CardArt card={card}/></div>} onClick={onOpen} {...longPress}>
  <div className={'card-more'+(menu?' is-open':'')} onClick={stop} onPointerDown={stop}><MoreMenu size="middle" label={t('{0} 的更多操作',[card.name])} items={cardActions(favorite,hidden)} open={menu} onOpenChange={setMenu}
   onClick={key=>{setMenu(false);key==='favorite'?onToggleFavorite():onToggleHidden();}}/></div>
  <Flex align="center" gap={8}><BankMark bank={card.bank} size={20}/><button type="button" className="card-title" aria-haspopup="dialog" aria-label={`${bankName(card.bank)} · ${card.name}`}>{card.name}</button></Flex>
  <Flex className="card-bottom" justify="space-between" align="center" wrap gap={6}>
   <Text type="secondary" className="card-tail">{card.tail?`•••• ${card.tail}`:t('尾号待识别')}</Text>
   {due&&(due.kind==='overdue'?<Tag color="error">{t('还款日已过')}</Tag>:due.kind==='date'?<Tag color="warning">{due.date.slice(5).replace('-','/')}{t(' 还款')}</Tag>:<Tag>{t('{0}（银行未提供年份）',[due.label])}</Tag>)}
   <span className="card-balance">{card.balance==null&&card.available!=null&&<Text type="secondary">{t('可用信用额')} </Text>}{value!=null?<Text strong className="card-amount">{value}</Text>:<Text type="secondary" className="card-amount-unknown">{t('待更新')}</Text>}</span>
  </Flex>
 </Card></Col>;
}

/** Where a card's figures came from: collapsed in the detail drawer (#682: provenance is detail, not headline). */
export function CardDataSource({card,fieldDate}){
 useI18n();
 const read=lastBankRead(card),line=(key,children,className)=><div key={key} className={className}><Text type="secondary">{children}</Text></div>;
 return <Collapse ghost size="small" className="card-data-source" items={[{key:'source',label:t('数据来源'),children:<>
  {card.balance!=null&&line('balance',t('余额更新于 {0}',[fieldDate(card,'balance')]))}
  {card.identitySource==='bank-page'&&line('bank',read?t('来自银行 · 读取于 {0}',[formatReadDate(read)]):t('来自银行 · 尚未读取金额'),'card-source')}
  {cardDue(card)?.inferred&&line('year',t('年份按读取日期推断'))}
  {card.balance<0&&line('credit',t('账户有结余'))}
  {card.id==='corporate'&&line('corporate',t('公司卡'))}
  <Paragraph type="secondary" className="source-note">{card.art?(t(card.artNote)||t('公开产品卡面仅用于识别卡种，版本可能与你的实物不同。')):t('该卡卡面未确认，暂不使用其他卡种的图片代替。')}</Paragraph>
 </>}]}/>;
}
