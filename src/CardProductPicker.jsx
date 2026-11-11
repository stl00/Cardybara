import React,{useEffect,useState} from 'react';
import {Alert,App,Button,Flex,Select,Tag,Typography} from 'antd';
import {t,useI18n} from './i18n';
import {cardProducts,matchCardProduct} from './productCatalog';
import {productDisplayName} from './cardName';
import {CARD_PRODUCT_KEY,readCardProductChoices,withCardProductChoice} from './cardProductChoice';
import {AUTO_SUGGEST_KEY,SUGGESTION_KEY,needsSuggestion,readSuggestions,requestSuggestion,suggestInExtension,suggestionFor,suggestionKey,withSuggestion} from './productSuggestion';
import {isModelReady,completeJSON} from '../extension-next/model-client.js';
const {Text,Paragraph}=Typography;
const CHANGE='cardybara-card-products-change';
export function loadCardProductChoices(){try{return readCardProductChoices(localStorage)}catch{return []}}
export function saveCardProductChoices(choices){localStorage.setItem(CARD_PRODUCT_KEY,JSON.stringify(choices));window.dispatchEvent(new Event(CHANGE));}
const SUGGESTED='cardybara-product-suggestions-change',SUGGEST_PER_LOAD=10;
export function loadSuggestions(){try{return readSuggestions(localStorage)}catch{return []}}
export function useSuggestions(){
 const [rows,setRows]=useState(loadSuggestions);
 useEffect(()=>{const load=()=>setRows(loadSuggestions());window.addEventListener(SUGGESTED,load);window.addEventListener('storage',load);return()=>{window.removeEventListener(SUGGESTED,load);window.removeEventListener('storage',load)}},[]);
 return rows;
}
const extensionPage=()=>location.protocol==='chrome-extension:'&&!!globalThis.chrome?.runtime?.id;
async function modelReady(){
 if(extensionPage())return isModelReady();
 const r=await fetch('/api/parser/status',{signal:AbortSignal.timeout(2500)});return r.ok&&(await r.json()).configured===true;
}
/** Asks the user's own model about unrecognised cards, one at a time. Without a configured model it does nothing. */
// The extension calls the provider with the owner's key; the source wallet asks the local server.
const suggest=card=>extensionPage()?suggestInExtension(card,{completeJSON}):requestSuggestion('',card);
const saveSuggestion=(card,productId)=>{localStorage.setItem(SUGGESTION_KEY,JSON.stringify(withSuggestion(loadSuggestions(),card,productId)));window.dispatchEvent(new Event(SUGGESTED));};
export function autoSuggestOn(){try{return localStorage.getItem(AUTO_SUGGEST_KEY)==='on'}catch{return false}}
export function setAutoSuggest(on){localStorage.setItem(AUTO_SUGGEST_KEY,on?'on':'off');window.dispatchEvent(new Event(SUGGESTED));}
export function useModelReady(){const [ready,setReady]=useState(false);useEffect(()=>{let alive=true;modelReady().then(r=>{if(alive)setReady(!!r)},()=>{});return()=>{alive=false}},[]);return ready;}
/**
 * Off unless the user turns on automatic suggestions in Settings: sending card names to a cloud model
 * is its own consent. Otherwise a suggestion is asked for only from a card's own button.
 */
export function ProductSuggestionRunner({cards}){
 const key=cards.map(c=>[c.id,c.bank,c.region,c.name,c.productChosen?1:0].join('|')).join('\n')+(autoSuggestOn()?'|on':'');
 useEffect(()=>{
  let alive=true;
  (async()=>{
   if(!autoSuggestOn())return;
   const waiting=cards.filter(c=>needsSuggestion(c,loadSuggestions())).slice(0,SUGGEST_PER_LOAD);
   if(!waiting.length)return;
   try{if(!await modelReady())return;}catch{return;}
   for(const card of waiting){
    if(!alive)return;
    if(!needsSuggestion(card,loadSuggestions()))continue;
    // A finished answer is kept even if the page moved on. A failed request is not cached and ends this run.
    let productId;try{productId=await suggest(card);}catch{return;}
    try{saveSuggestion(card,productId)}catch{return;}
   }
  })();
  return()=>{alive=false};
 },[key]); // Saved answers must not restart the run, or the per-load limit would never apply.
 return null;
}
export function useCardProductChoices(){
 const [choices,setChoices]=useState(loadCardProductChoices);
 useEffect(()=>{const load=()=>setChoices(loadCardProductChoices());window.addEventListener(CHANGE,load);window.addEventListener('storage',load);return()=>{window.removeEventListener(CHANGE,load);window.removeEventListener('storage',load)}},[]);
 return choices;
}
/** In card details: what the wallet recognised, and a way to pick the card type when it could not tell. */
export default function CardProductPicker({card}){
 const {language}=useI18n(),{message}=App.useApp(),suggestions=useSuggestions(),label=p=>productDisplayName(p.id,language)||p.name;
 // Recognition is judged on the card as read, without the user's own choice.
 const auto=matchCardProduct({...card,name:card.pageName??card.name,productId:undefined}),chosen=card.productChosen?cardProducts.find(p=>p.id===card.productId):null;
 const scoped=cardProducts.filter(p=>p.bank===card.bank&&p.region===card.region);
 const suggested=chosen||auto.status==='matched'?null:suggestionFor(card,suggestions);
 const ready=useModelReady(),[asking,setAsking]=useState(false),askable=!suggested&&!chosen&&auto.status!=='matched'&&ready&&needsSuggestion(card,suggestions);
 const ask=async()=>{setAsking(true);try{saveSuggestion(card,await suggest(card));}catch{message.error(t('AI 暂时无法给出建议，请稍后再试。'))}finally{setAsking(false)}};
 const answeredNone=!suggested&&!chosen&&auto.status!=='matched'&&suggestions.some(r=>r.key===suggestionKey(card)&&r.productId===null);
 const first=new Set([...(suggested?[suggested.id]:[]),...auto.candidates]);
 const options=[...scoped].sort((a,b)=>Number(b.id===suggested?.id)-Number(a.id===suggested?.id)||Number(first.has(b.id))-Number(first.has(a.id))||label(a).localeCompare(label(b))).map(p=>({value:p.id,label:label(p),search:[label(p),p.name,...p.aliases].join(' '),art:!!p.art}));
 const [editing,setEditing]=useState(false);
 const save=productId=>{try{saveCardProductChoices(withCardProductChoice(loadCardProductChoices(),card,productId));setEditing(false);message.success(productId?t('已设定卡种。'):t('已改回自动识别。'))}catch{message.error(t('保存失败，刚才的设置没有生效。'))}};
 const status=chosen?<><Tag color="blue">{t('你选择的卡种')}</Tag><Text>{label(chosen)}</Text></>:auto.status==='matched'?<><Tag color="success">{t('已自动识别')}</Tag><Text>{label(auto.product)}</Text></>:auto.candidates.length>1?<Tag color="warning">{t('有 {0} 个可能的卡种，无法确定',[auto.candidates.length])}</Tag>:<Tag>{t('未能识别卡种')}</Tag>;
 const product=chosen||auto.product,showPicker=editing||(!product&&!suggested&&scoped.length>0);
 return <div className="card-product-picker">
  {card.pageName&&card.pageName!==card.name&&<Paragraph type="secondary" style={{margin:'0 0 6px',fontSize:12}}>{t('银行页面显示：{0}',[card.pageName])}</Paragraph>}
  <Flex align="center" gap={8} wrap><Text type="secondary">{t('卡种')}</Text>{status}{product&&!product.art&&<Text type="secondary">{t('这个卡种暂时没有卡面图片。')}</Text>}</Flex>
  {suggested&&!editing&&<div className="card-product-suggestion">
   <Flex align="center" gap={8} wrap><Tag color="purple">{t('AI 建议')}</Tag><Text>{label(suggested)}</Text>{!suggested.art&&<Text type="secondary">· {t('无卡面')}</Text>}</Flex>
   <Paragraph type="secondary" style={{margin:'4px 0',fontSize:12}}>{t('由 AI 服务根据卡名推测，确认前不当作已识别。')}</Paragraph>
   <Flex gap={8} wrap><Button size="small" type="primary" onClick={()=>save(suggested.id)}>{t('确认是这个卡种')}</Button><Button size="small" onClick={()=>setEditing(true)}>{t('改选卡种')}</Button></Flex>
  </div>}
  {showPicker?<Flex gap={8} wrap align="center" style={{marginTop:8}}>
   <Select showSearch size="small" style={{minWidth:260,maxWidth:'100%'}} placeholder={t('选择这张卡的卡种')} aria-label={t('选择这张卡的卡种')} value={chosen?.id} onChange={save} optionFilterProp="search"
    options={options.map(o=>({value:o.value,search:o.search,label:<span>{o.label}{o.value===suggested?.id?<Tag color="purple" style={{marginInlineStart:6}}>{t('AI 建议')}</Tag>:first.has(o.value)&&<Tag style={{marginInlineStart:6}}>{t('可能')}</Tag>}{!o.art&&<Text type="secondary"> · {t('无卡面')}</Text>}</span>}))}/>
   {editing&&<Button size="small" type="text" onClick={()=>setEditing(false)}>{t('取消')}</Button>}
  </Flex>:<Flex gap={8} wrap style={{marginTop:4}}>
   {!suggested&&<Button size="small" type="link" style={{paddingInline:0}} onClick={()=>setEditing(true)}>{t('改选卡种')}</Button>}
   {chosen&&<Button size="small" type="link" onClick={()=>save(null)}>{t('改回自动识别')}</Button>}
  </Flex>}
  {askable&&<Flex gap={8} wrap align="center" style={{marginTop:8}}><Button size="small" loading={asking} onClick={ask}>{t('用 AI 推测卡种')}</Button><Text type="secondary" style={{fontSize:12}}>{t('会把银行、地区和卡名（不含尾号）发给 AI 服务。')}</Text></Flex>}
  {answeredNone&&<Paragraph type="secondary" style={{margin:'6px 0 0',fontSize:12}}>{t('AI 也无法确定这张卡的卡种。')}</Paragraph>}
  {!product&&!scoped.length&&<Paragraph type="secondary" style={{margin:'6px 0 0'}}>{t('资料库里还没有这家银行的卡种。')}</Paragraph>}
  {showPicker&&<Paragraph type="secondary" style={{margin:'6px 0 0',fontSize:12}}>{t('只用来显示卡面和公开福利，不改变银行读到的卡名和金额。')}</Paragraph>}
 </div>;
}
