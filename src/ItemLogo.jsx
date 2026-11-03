import React,{useEffect,useState} from 'react';
import Icon from '@ant-design/icons/es/components/Icon';
import CarOutlined from '@ant-design/icons/es/icons/CarOutlined';
import TruckOutlined from '@ant-design/icons/es/icons/TruckOutlined';
import RestOutlined from '@ant-design/icons/es/icons/RestOutlined';
import HomeOutlined from '@ant-design/icons/es/icons/HomeOutlined';
import IdcardOutlined from '@ant-design/icons/es/icons/IdcardOutlined';
import CoffeeOutlined from '@ant-design/icons/es/icons/CoffeeOutlined';
import GlobalOutlined from '@ant-design/icons/es/icons/GlobalOutlined';
import PlaySquareOutlined from '@ant-design/icons/es/icons/PlaySquareOutlined';
import ShoppingOutlined from '@ant-design/icons/es/icons/ShoppingOutlined';
import HeartOutlined from '@ant-design/icons/es/icons/HeartOutlined';
import GiftOutlined from '@ant-design/icons/es/icons/GiftOutlined';
import CrownOutlined from '@ant-design/icons/es/icons/CrownOutlined';
import SafetyOutlined from '@ant-design/icons/es/icons/SafetyOutlined';
import DollarOutlined from '@ant-design/icons/es/icons/DollarOutlined';
import CreditCardOutlined from '@ant-design/icons/es/icons/CreditCardOutlined';
import MobileOutlined from '@ant-design/icons/es/icons/MobileOutlined';
import WalletOutlined from '@ant-design/icons/es/icons/WalletOutlined';
import {t,useI18n} from './i18n';
import {logoPresentation,resolveItem} from './logoRegistry';
// Ant Design has no aeroplane; this glyph is authored for the project (see ASSET-SOURCES.md).
const Plane=()=><svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M12 2c-.8 0-1.4.7-1.4 1.6V9L2 14.2V16l8.6-2.6v5.2l-2.2 1.7V22l3.6-1 3.6 1v-1.7l-2.2-1.7v-5.2L22 16v-1.8L13.4 9V3.6C13.4 2.7 12.8 2 12 2z"/></svg>;
const AirlineOutlined=props=><Icon component={Plane} {...props}/>;
const icons={CarOutlined,TruckOutlined,RestOutlined,HomeOutlined,airline:AirlineOutlined,IdcardOutlined,CoffeeOutlined,GlobalOutlined,PlaySquareOutlined,ShoppingOutlined,HeartOutlined,GiftOutlined,CrownOutlined,SafetyOutlined,DollarOutlined,CreditCardOutlined,MobileOutlined,WalletOutlined};
/** The one way to show a merchant, programme or category: logo, then category icon, then nothing. */
export default function ItemLogo({size=16,...item}){
 useI18n();const resolved=resolveItem(item),[broken,setBroken]=useState(false);useEffect(()=>setBroken(false),[resolved.logo]);
 const shown=logoPresentation(resolved,{broken});if(!shown)return null;
 const label=shown.labelParams?t(shown.label,shown.labelParams):t(shown.label),Glyph=icons[shown.icon];
 return <span className={`item-logo ${shown.kind==='logo'?'is-logo':'is-icon'}`} role="img" aria-label={label} title={label} style={{'--item-logo-size':`${size}px`}}>{shown.kind==='logo'?<img src={`/${shown.src}`} alt="" onError={()=>setBroken(true)}/>:<Glyph aria-hidden="true"/>}</span>;
}
