import React from 'react';
import {Button,Input,Select,Switch,Typography} from 'antd';
import SearchOutlined from '@ant-design/icons/es/icons/SearchOutlined';
import {BankIdentity,RegionLabel} from './Identity';
import {t} from './i18n';
export default function WalletFilters({country,setCountry,bank,setBank,search,setSearch,favoriteOnly,setFavoriteOnly,hiddenCount=0,showHidden=false,setShowHidden,countries,banks,onReset}){
 const active=country!=='all'||bank!=='all'||search||favoriteOnly;
 return <div className="wallet-filters filters" role="search" aria-label={t('筛选卡片')}>
 <label><Typography.Text type="secondary">{t('地区')}</Typography.Text><Select aria-label={t('地区')} value={country} onChange={setCountry} options={[{value:'all',label:t('全部地区')},...Object.keys(countries).map(value=>({value,label:<RegionLabel region={value}/>}))]}/></label>
 <label><Typography.Text type="secondary">{t('银行')}</Typography.Text><Select aria-label={t('银行')} value={bank} onChange={setBank} options={[{value:'all',label:t('全部银行')},...banks.map(value=>({value,label:<BankIdentity bank={value} size={18}/>}))]}/></label>
 <label className="wallet-search"><Typography.Text type="secondary">{t('搜索')}</Typography.Text><Input allowClear prefix={<SearchOutlined/>} placeholder={t('卡片名称或尾号')} aria-label={t('搜索卡片')} value={search} onChange={e=>setSearch(e.target.value)}/></label>
 <label className="favorite-filter"><Switch checked={favoriteOnly} onChange={setFavoriteOnly} size="small"/><span>{t('只看收藏')}</span></label>{hiddenCount>0&&setShowHidden&&<label className="favorite-filter"><Switch checked={showHidden} onChange={setShowHidden} size="small"/><span>{t('显示已隐藏的卡（{0}）',[hiddenCount])}</span></label>}<Button type="text" disabled={!active} onClick={onReset}>{t('重置筛选')}</Button>
 </div>
}
