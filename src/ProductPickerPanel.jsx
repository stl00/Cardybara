import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Button,Empty,Flex,Grid,Input,Modal,Segmented,Tag,Typography} from 'antd';
import SearchOutlined from '@ant-design/icons/es/icons/SearchOutlined';
import {t,useI18n} from './i18n';
import {BankIdentity,BankMark,RegionFlag,bankName} from './Identity';
import {ArtImage} from './CardArt';
import {productDisplayName} from './cardName';
import {PICKER_BANKS,groupEntries,highlightRanges,matchedVia,pickerEntries} from './productPicker';
const {Text}=Typography;
const ART_HEIGHT=84;

function Highlight({text,query}){
 const ranges=highlightRanges(text,query);if(!ranges.length)return text;
 const out=[];let at=0;
 for(const [a,b] of ranges){if(a>at)out.push(text.slice(at,a));out.push(<mark key={a}>{text.slice(a,b)}</mark>);at=b;}
 if(at<text.length)out.push(text.slice(at));return out;
}
/** Only the product's own art; without it a neutral placeholder with the bank's mark, never another card's art. */
export function ProductArt({product,label}){
 const [broken,setBroken]=useState(false);
 return <div className="product-tile-art">{product.art?.file&&!broken?<ArtImage art={product.art} alt={t('{0} 产品卡面',[label])} height={ART_HEIGHT} onError={()=>setBroken(true)}/>:<div className="product-tile-noart"><BankMark bank={product.bank} size={26}/><span>{t('暂无卡面')}</span></div>}</div>;
}
/** The chosen product as a small card: art, name, bank and region. */
export function ChosenProduct({product,extra}){
 const {language}=useI18n(),label=productDisplayName(product.id,language)||product.name;
 return <div className="chosen-product"><ProductArt product={product} label={label}/><div className="chosen-product-text"><Text strong>{label}</Text><BankIdentity bank={product.bank} size={16}/></div>{extra}</div>;
}

/**
 * A panel of card tiles grouped by bank, with search on top. Type to search, arrows to move, Enter to choose,
 * Esc to close. `badges` puts tags on tiles (and those tiles first); `onOther` adds the "not listed" way out.
 */
export default function ProductPickerPanel({open,onClose,afterClose,onChoose,onOther,products,title,badges={},selectedId}){
 const {language}=useI18n(),screen=Grid.useBreakpoint(),narrow=!screen.md;
 const [query,setQuery]=useState(''),[bank,setBank]=useState(null),[type,setType]=useState('all'),[active,setActive]=useState(0);
 const input=useRef(null),list=useRef(null),fromKeys=useRef(false);
 const entries=useMemo(()=>pickerEntries(products,p=>productDisplayName(p.id,language)||p.name),[products,language]);
 const banks=useMemo(()=>[...new Set(entries.map(e=>e.bank))].sort((a,b)=>PICKER_BANKS.indexOf(a)-PICKER_BANKS.indexOf(b)),[entries]);
 const hasBusiness=entries.some(e=>e.business)&&entries.some(e=>!e.business);
 const pinned=Object.keys(badges);
 const groups=useMemo(()=>groupEntries(entries,{query,bank,type,pinned}),[entries,query,bank,type,pinned.join()]);
 const flat=groups.flatMap(g=>g.items);
 useEffect(()=>{setActive(0);if(list.current)list.current.scrollTop=0;},[query,bank,type]);
 useEffect(()=>{if(fromKeys.current)document.getElementById(`product-tile-${flat[active]?.id}`)?.scrollIntoView({block:'nearest'});fromKeys.current=false;},[active]);
 const choose=entry=>entry&&onChoose(entry.id,entry.product);
 // Up and down follow the grid as drawn, so they work across group headers and any column count.
 const vertical=dir=>{
  const tiles=[...(list.current?.querySelectorAll('.product-tile')||[])];const here=tiles[active]?.getBoundingClientRect();if(!here)return active;
  const x=here.left+here.width/2;let best=-1,bestKey=null;
  tiles.forEach((tile,i)=>{const r=tile.getBoundingClientRect(),dy=(r.top-here.top)*dir;if(dy<=4)return;const key=[dy,Math.abs(r.left+r.width/2-x)];if(!bestKey||key[0]<bestKey[0]-4||(Math.abs(key[0]-bestKey[0])<=4&&key[1]<bestKey[1])){best=i;bestKey=key;}});
  return best<0?active:best;
 };
 const onKeyDown=e=>{
  if(e.nativeEvent.isComposing)return;
  const inInput=!!e.target.closest?.('.product-picker-search');
  const move=next=>{e.preventDefault();fromKeys.current=true;setActive(Math.max(0,Math.min(flat.length-1,next)));if(!inInput)setTimeout(()=>document.getElementById(`product-tile-${flat[Math.max(0,Math.min(flat.length-1,next))]?.id}`)?.focus(),0);};
  if(e.key==='ArrowDown')move(vertical(1));
  else if(e.key==='ArrowUp')move(vertical(-1));
  else if(e.key==='ArrowRight'&&!inInput)move(active+1);
  else if(e.key==='ArrowLeft'&&!inInput)move(active-1);
  // A focused tile is the active one, so Enter chooses the same tile from the search box or the grid.
  else if(e.key==='Enter'&&(inInput||e.target.closest?.('.product-tile'))){e.preventDefault();choose(inInput?flat[active]:flat.find(x=>x.id===e.target.closest('.product-tile').dataset.productId));}
  else if(e.key===' '&&e.target.closest?.('.product-tile')){e.preventDefault();choose(flat.find(x=>x.id===e.target.closest('.product-tile').dataset.productId));}
  else if(!inInput&&e.key.length===1&&!e.metaKey&&!e.ctrlKey&&!e.altKey)input.current?.focus();
 };
 const other=onOther&&<Button className="product-picker-other" type="dashed" block onClick={()=>onOther(bank)}>{t('找不到我的卡')}<Text type="secondary" style={{marginInlineStart:6}}>{t('（自己填写卡名）')}</Text></Button>;
 return <Modal className={`product-picker-modal${narrow?' narrow':''}`} title={title||t('选择卡种')} open={open} onCancel={onClose} footer={null} width={narrow?'100%':920} destroyOnHidden centered={!narrow} afterOpenChange={o=>{if(o)input.current?.focus();else{setQuery('');setBank(null);setType('all');setActive(0);afterClose?.();}}}>
  <div className="product-picker" onKeyDown={onKeyDown}>
   <Input ref={input} className="product-picker-search" size="large" autoFocus allowClear prefix={<SearchOutlined/>} value={query} onChange={e=>setQuery(e.target.value)}
    placeholder={t('搜索卡名、品牌或银行，例如 Sapphire、Marriott、万豪')} aria-label={t('搜索卡种')} role="combobox" aria-expanded aria-controls="product-picker-list" aria-activedescendant={flat[active]?`product-tile-${flat[active].id}`:undefined}/>
   {(banks.length>1||hasBusiness)&&<Flex className="product-picker-filters" gap={8} wrap align="center">
    {banks.length>1&&<Flex className="product-picker-banks" gap={4} wrap role="group" aria-label={t('银行与地区')}>
     <Tag.CheckableTag checked={!bank} onChange={()=>setBank(null)}>{t('全部银行')}</Tag.CheckableTag>
     {banks.map(b=><Tag.CheckableTag key={b} checked={bank===b} onChange={on=>setBank(on?b:null)}><BankIdentity bank={b} size={14}/></Tag.CheckableTag>)}
    </Flex>}
    {hasBusiness&&<Segmented size="small" value={type} onChange={setType} options={[{value:'all',label:t('全部')},{value:'personal',label:t('个人卡')},{value:'business',label:t('商务卡')}]}/>}
   </Flex>}
   <div className="product-picker-list" id="product-picker-list" role="listbox" aria-label={t('卡种')} ref={list}>
    {groups.map(g=><section key={g.bank} className="product-picker-group" role="group" data-bank={g.bank} aria-label={bankName(g.bank)}>
     <div className="product-picker-group-head"><BankIdentity bank={g.bank} size={18}/><Text type="secondary">{t('{0} 种',[g.items.length])}</Text></div>
     <div className="product-picker-grid">{g.items.map(entry=>{const i=flat.indexOf(entry),via=matchedVia(entry,query);
      return <button type="button" key={entry.id} id={`product-tile-${entry.id}`} data-product-id={entry.id} role="option" aria-selected={i===active} tabIndex={i===active?0:-1}
       className={`product-tile${i===active?' active':''}${entry.id===selectedId?' selected':''}`} onClick={()=>choose(entry)} onFocus={()=>i!==active&&setActive(i)} onMouseMove={()=>i!==active&&setActive(i)}>
       <ProductArt product={entry.product} label={entry.label}/>
       <span className="product-tile-name"><Highlight text={entry.label} query={query}/></span>
       {via&&<span className="product-tile-via"><Highlight text={via} query={query}/></span>}
       <span className="product-tile-meta"><RegionFlag region={entry.region}/><span className="product-tile-bank">{bankName(entry.bank)}</span>{entry.business&&<Tag color="geekblue">{t('商务')}</Tag>}{badges[entry.id]}</span>
      </button>;})}</div>
    </section>)}
   </div>
   {!flat.length&&<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('没有匹配的卡种')}/>}
   {other&&<div className="product-picker-end">{other}</div>}
  </div>
 </Modal>;
}
