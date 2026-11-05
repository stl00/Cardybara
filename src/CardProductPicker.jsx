import React,{useEffect,useState} from 'react';
import {Alert,App,Button,Flex,Select,Tag,Typography} from 'antd';
import {t,useI18n} from './i18n';
import {cardProducts,matchCardProduct} from './productCatalog';
import {CARD_PRODUCT_KEY,readCardProductChoices,withCardProductChoice} from './cardProductChoice';
const {Text,Paragraph}=Typography;
const CHANGE='cardybara-card-products-change';
export function loadCardProductChoices(){try{return readCardProductChoices(localStorage)}catch{return []}}
export function saveCardProductChoices(choices){localStorage.setItem(CARD_PRODUCT_KEY,JSON.stringify(choices));window.dispatchEvent(new Event(CHANGE));}
export function useCardProductChoices(){
 const [choices,setChoices]=useState(loadCardProductChoices);
 useEffect(()=>{const load=()=>setChoices(loadCardProductChoices());window.addEventListener(CHANGE,load);window.addEventListener('storage',load);return()=>{window.removeEventListener(CHANGE,load);window.removeEventListener('storage',load)}},[]);
 return choices;
}
/** In card details: what the wallet recognised, and a way to pick the card type when it could not tell. */
export default function CardProductPicker({card}){
 useI18n();const {message}=App.useApp();
 // Recognition is judged on the card as read, without the user's own choice.
 const auto=matchCardProduct({...card,productId:undefined}),chosen=card.productChosen?cardProducts.find(p=>p.id===card.productId):null;
 const scoped=cardProducts.filter(p=>p.bank===card.bank&&p.region===card.region);
 const first=new Set(auto.candidates);
 const options=[...scoped].sort((a,b)=>Number(first.has(b.id))-Number(first.has(a.id))||a.name.localeCompare(b.name)).map(p=>({value:p.id,label:p.name,search:[p.name,...p.aliases].join(' '),art:!!p.art}));
 const [editing,setEditing]=useState(false);
 const save=productId=>{try{saveCardProductChoices(withCardProductChoice(loadCardProductChoices(),card,productId));setEditing(false);message.success(productId?t('已设定卡种。'):t('已改回自动识别。'))}catch{message.error(t('保存失败，刚才的设置没有生效。'))}};
 const status=chosen?<><Tag color="blue">{t('你选择的卡种')}</Tag><Text>{chosen.name}</Text></>:auto.status==='matched'?<><Tag color="success">{t('已自动识别')}</Tag><Text>{auto.product.name}</Text></>:auto.status==='ambiguous'?<Tag color="warning">{t('有 {0} 个可能的卡种，无法确定',[auto.candidates.length])}</Tag>:<Tag>{t('未能识别卡种')}</Tag>;
 const product=chosen||auto.product,showPicker=editing||(!product&&scoped.length>0);
 return <div className="card-product-picker">
  <Flex align="center" gap={8} wrap><Text type="secondary">{t('卡种')}</Text>{status}{product&&!product.art&&<Text type="secondary">{t('这个卡种暂时没有卡面图片。')}</Text>}</Flex>
  {showPicker?<Flex gap={8} wrap align="center" style={{marginTop:8}}>
   <Select showSearch size="small" style={{minWidth:260,maxWidth:'100%'}} placeholder={t('选择这张卡的卡种')} aria-label={t('选择这张卡的卡种')} value={chosen?.id} onChange={save} optionFilterProp="search"
    options={options.map(o=>({value:o.value,search:o.search,label:<span>{o.label}{first.has(o.value)&&<Tag style={{marginInlineStart:6}}>{t('可能')}</Tag>}{!o.art&&<Text type="secondary"> · {t('无卡面')}</Text>}</span>}))}/>
   {editing&&<Button size="small" type="text" onClick={()=>setEditing(false)}>{t('取消')}</Button>}
  </Flex>:<Flex gap={8} wrap style={{marginTop:4}}>
   <Button size="small" type="link" style={{paddingInline:0}} onClick={()=>setEditing(true)}>{t('改选卡种')}</Button>
   {chosen&&<Button size="small" type="link" onClick={()=>save(null)}>{t('改回自动识别')}</Button>}
  </Flex>}
  {!product&&!scoped.length&&<Paragraph type="secondary" style={{margin:'6px 0 0'}}>{t('资料库里还没有这家银行的卡种。')}</Paragraph>}
  {showPicker&&<Paragraph type="secondary" style={{margin:'6px 0 0',fontSize:12}}>{t('只用来显示卡面和公开福利，不改变银行读到的卡名和金额。')}</Paragraph>}
 </div>;
}
