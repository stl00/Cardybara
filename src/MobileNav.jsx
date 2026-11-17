import React,{useSyncExternalStore} from 'react';
import EllipsisOutlined from '@ant-design/icons/es/icons/EllipsisOutlined';
import {t,tx} from './i18n';
import NavIcon,{CapybaraMark} from './NavIcon.jsx';

// Phones are below antd's `md` (768 px). Read from matchMedia so the first render already knows, rather than
// Grid.useBreakpoint, which reports nothing until after mount and would flash the desktop sider.
const PHONE_QUERY='(max-width: 767.98px)';
const subscribe=fn=>{if(typeof window==='undefined'||!window.matchMedia)return ()=>{};const m=window.matchMedia(PHONE_QUERY);m.addEventListener('change',fn);return ()=>m.removeEventListener('change',fn)};
const phoneNow=()=>typeof window!=='undefined'&&!!window.matchMedia?.(PHONE_QUERY).matches;
export function usePhone(){return useSyncExternalStore(subscribe,phoneNow,()=>false)}

// The phone tab bar (#498): the config's primary group with the assistant raised in the centre, then "More".
export function MobileTabBar({groups,page,onGo,onMore,moreOpen=false}){
 const inMore=moreOpen||!groups.primary.some(i=>i.key===page);
 const tab=(key,label,icon,active,onClick,centre=false)=><button key={key} type="button" data-nav-key={key} className={'mobile-tab'+(active?' is-active':'')+(centre?' mobile-tab-centre':'')} aria-current={active&&key!=='more'?'page':undefined} onClick={onClick}>
  <span className={centre?'mobile-tab-bubble':'mobile-tab-icon'} aria-hidden="true">{icon}</span><span className="mobile-tab-label">{label}</span></button>;
 return <nav className="mobile-tabbar" aria-label={t('主导航')}>
  {groups.primary.map(i=>tab(i.key,tx('nav',i.short),i.key==='advisor'?<CapybaraMark size={30}/>:<NavIcon name={i.icon}/>,page===i.key&&!moreOpen,()=>onGo(i.key),i.key==='advisor'))}
  {tab('more',t('更多'),<EllipsisOutlined/>,inMore,onMore)}
 </nav>;
}
