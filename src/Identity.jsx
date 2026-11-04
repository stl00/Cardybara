import React,{useState} from 'react';
import BankOutlined from '@ant-design/icons/es/icons/BankOutlined';
import {t,useI18n} from './i18n';
const regions={US:['🇺🇸','美国'],HK:['🇭🇰','香港'],CA:['🇨🇦','加拿大'],UK:['🇬🇧','英国']};
const banks={
 'Amex US':['amex.svg','American Express 美国','US'],
 'Amex HK':['amex.svg','American Express 香港','HK'],
 'Amex CA':['amex.svg','American Express 加拿大','CA'],
 Chase:['chase.ico','Chase','US'],
 'HSBC HK':['hsbc.png','香港汇丰','HK'],
 'SC HK':['sc.png','香港渣打','HK'],
 BOA:['boa.png','Bank of America','US'],
 'Citi US':[null,'Citi','US'],
 Hilton:['hilton.png','Hilton Honors','US'],
 IHG:['ihg.ico','IHG One Rewards','US']
};
export function RegionFlag({region,decorative=false}){
 useI18n();const entry=regions[region];
 return entry?<span className="region-flag" role={decorative?undefined:"img"} aria-hidden={decorative||undefined} aria-label={decorative?undefined:t(entry[1])} title={t(entry[1])}>{entry[0]}</span>:null;
}
export function RegionLabel({region,label}){
 useI18n();return <span className="region-identity"><RegionFlag region={region} decorative/><span>{label||t(regions[region]?.[1]||region)}</span></span>;
}
export function BankMark({bank,size=24}){
 const [broken,setBroken]=useState(false);const entry=banks[bank];
 return <span className="bank-mark" style={{'--bank-mark-size':`${size}px`}} aria-hidden="true">{entry?.[0]&&!broken?<img src={`/brand/banks/${entry[0]}`} alt="" onError={()=>setBroken(true)}/>:<BankOutlined/>}</span>;
}
export function BankIdentity({bank,label,flag=true,size=24}){
 useI18n();const entry=banks[bank];
 return <span className="bank-identity"><BankMark bank={bank} size={size}/><span className="identity-name">{label||t(entry?.[1]||bank)}</span>{flag&&<RegionFlag region={entry?.[2]}/>}</span>;
}
export function CardIdentity({card,showFlag=true}){
 return card?<BankIdentity bank={card.bank} label={card.name} flag={showFlag} size={20}/>:null;
}
export function rewardBank(reward){return reward.bank||({'us-mr':'Amex US','hk-mr':'Amex HK','ca-mr':'Amex CA',ur:'Chase',hilton:'Hilton',ihg:'IHG','boa-cash-rewards':'BOA'})[reward.id];}
export function RewardRegion({reward}){const bank=rewardBank(reward);return <BankIdentity bank={bank} label={t(reward.label)} size={20}/>;}
