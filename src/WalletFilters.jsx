import React,{useState} from 'react';
import {Badge,Button,Input,Select,Switch,Typography} from 'antd';
import SearchOutlined from '@ant-design/icons/es/icons/SearchOutlined';
import FilterOutlined from '@ant-design/icons/es/icons/FilterOutlined';
import {BankIdentity,RegionLabel} from './Identity';
import {t} from './i18n';
// Quiet UI (#684): only search is visible; the rest sits behind Filter, whose badge counts what is on.
export default function WalletFilters({country,setCountry,bank,setBank,search,setSearch,favoriteOnly,setFavoriteOnly,hiddenCount=0,showHidden=false,setShowHidden,countries,banks,onReset}){
 const [open,setOpen]=useState(false);
 const count=[country!=='all',bank!=='all',favoriteOnly,showHidden&&hiddenCount>0].filter(Boolean).length;
 const active=country!=='all'||bank!=='all'||search||favoriteOnly;
 return <div className="wallet-filters filters" role="search" aria-label={t('筛选卡片')}>
 <Input className="wallet-search" allowClear prefix={<SearchOutlined/>} placeholder={t('卡片名称或尾号')} aria-label={t('搜索卡片')} value={search} onChange={e=>setSearch(e.target.value)}/>
 <Badge count={count} size="small"><Button className="wallet-filter-toggle" icon={<FilterOutlined/>} aria-expanded={open} onClick={()=>setOpen(!open)}>{t('筛选')}</Button></Badge>
 {open&&<div className="wallet-filter-panel">
  <label><Typography.Text type="secondary">{t('地区')}</Typography.Text><Select aria-label={t('地区')} value={country} onChange={setCountry} options={[{value:'all',label:t('全部地区')},...Object.keys(countries).map(value=>({value,label:<RegionLabel region={value}/>}))]}/></label>
  <label><Typography.Text type="secondary">{t('银行')}</Typography.Text><Select aria-label={t('银行')} value={bank} onChange={setBank} options={[{value:'all',label:t('全部银行')},...banks.map(value=>({value,label:<BankIdentity bank={value} size={18}/>}))]}/></label>
  <label className="favorite-filter"><Switch checked={favoriteOnly} onChange={setFavoriteOnly} size="small"/><span>{t('只看收藏')}</span></label>{hiddenCount>0&&setShowHidden&&<label className="favorite-filter"><Switch checked={showHidden} onChange={setShowHidden} size="small"/><span>{t('显示已隐藏的卡（{0}）',[hiddenCount])}</span></label>}<Button type="text" disabled={!active} onClick={onReset}>{t('重置筛选')}</Button>
 </div>}
 </div>
}
