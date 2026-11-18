import React,{useSyncExternalStore} from 'react';
import {Button,Drawer,Segmented} from 'antd';
import DownloadOutlined from '@ant-design/icons/es/icons/DownloadOutlined';
import UploadOutlined from '@ant-design/icons/es/icons/UploadOutlined';
import SettingOutlined from '@ant-design/icons/es/icons/SettingOutlined';
import RightOutlined from '@ant-design/icons/es/icons/RightOutlined';
import EllipsisOutlined from '@ant-design/icons/es/icons/EllipsisOutlined';
import {t,tx} from './i18n';
import NavIcon,{CapybaraMark} from './NavIcon.jsx';

// Phones are below antd's `md` (768 px). Read from matchMedia so the first render already knows, rather than
// Grid.useBreakpoint, which reports nothing until after mount and would flash the desktop sider.
const PHONE_QUERY='(max-width: 767px)';// the same edge as style.css's phone rules
const subscribe=fn=>{if(typeof window==='undefined'||!window.matchMedia)return ()=>{};const m=window.matchMedia(PHONE_QUERY);m.addEventListener('change',fn);return ()=>m.removeEventListener('change',fn)};
const phoneNow=()=>typeof window!=='undefined'&&!!window.matchMedia?.(PHONE_QUERY).matches;
export function usePhone(){return useSyncExternalStore(subscribe,phoneNow,()=>false)}

// The phone tab bar (#498): the config's primary group with the assistant raised in the centre, then "More".
export function MobileTabBar({groups,page,onGo,onMore,moreOpen=false,over=moreOpen}){
 const inMore=moreOpen||!groups.primary.some(i=>i.key===page);
 const tab=(key,label,icon,active,onClick,centre=false)=><button key={key} type="button" data-nav-key={key} className={'mobile-tab'+(active?' is-active':'')+(centre?' mobile-tab-centre':'')} aria-current={active&&key!=='more'?'page':undefined} onClick={onClick}>
  <span className={centre?'mobile-tab-bubble':'mobile-tab-icon'} aria-hidden="true">{icon}</span><span className="mobile-tab-label">{label}</span></button>;
 return <nav className={'mobile-tabbar'+(over?' is-over':'')} aria-label={t('主导航')}>
  {groups.primary.map(i=>tab(i.key,tx('nav',i.short),i.key==='advisor'?<CapybaraMark size={30}/>:<NavIcon name={i.icon}/>,page===i.key&&!moreOpen,()=>onGo(i.key),i.key==='advisor'))}
  {tab('more',t('更多'),<EllipsisOutlined/>,inMore,onMore)}
 </nav>;
}

const LANGUAGE_NAMES={'zh-CN':'简体中文','zh-TW':'繁體中文','en-US':'English'};
const LANGUAGE_OPTIONS=[{value:'zh-CN',label:'简'},{value:'zh-TW',label:'繁'},{value:'en-US',label:'EN'}];
// The phone "More" sheet (#499): the config's more pages as tiles, backup, language and settings, then the footer links.
// It opens above the tab bar, so the bar stays tappable (More closes it again) and nothing overlaps.
export function MoreDrawer({open,onClose,afterOpenChange,...sheet}){
 return <Drawer rootClassName="more-drawer" placement="bottom" size="auto" open={open} onClose={onClose} afterOpenChange={afterOpenChange} closable={false} title={null} aria-label={t('更多')}><MoreSheet {...sheet}/></Drawer>;
}
// The drawer's contents, separate so it can be rendered and tested without the portal.
export function MoreSheet({groups,page,onGo,onExport,onImport,language,setLanguage,onSources,onRelease,settingsLabel=t('设置')}){
 const pages=groups.more.filter(i=>i.key!=='settings');
 const row=(action,icon,label,onClick)=><button type="button" className="more-row" data-action={action} onClick={onClick}><span className="more-row-icon" aria-hidden="true">{icon}</span><span className="more-row-label">{label}</span><RightOutlined className="more-row-arrow" aria-hidden="true"/></button>;
 return <>
  <div className="more-handle" aria-hidden="true"/>
  <section className="more-section" aria-label={t('页面')}>
   <div className="more-grid">{pages.map(i=><button key={i.key} type="button" className={'more-tile'+(page===i.key?' is-active':'')} data-nav-key={i.key} aria-current={page===i.key?'page':undefined} onClick={()=>onGo(i.key)}><span className="more-tile-icon" aria-hidden="true"><NavIcon name={i.icon}/></span><span className="more-tile-label">{tx('nav',i.short)}</span></button>)}</div>
  </section>
  <section className="more-section"><div className="more-section-title">{t('数据')}</div>
   {row('export',<DownloadOutlined/>,t('导出备份'),onExport)}{row('import',<UploadOutlined/>,t('导入备份'),onImport)}
  </section>
  <section className="more-section"><div className="more-section-title">{t('偏好')}</div>
   <div className="more-language"><span>{t('界面语言')}</span><Segmented data-action="language" aria-label={t('界面语言')} value={language} onChange={setLanguage} options={LANGUAGE_OPTIONS.map(o=>({value:o.value,label:<><span aria-hidden="true">{o.label}</span><span className="visually-hidden">{LANGUAGE_NAMES[o.value]}</span></>}))}/></div>
   {row('settings',<SettingOutlined/>,settingsLabel,()=>onGo('settings'))}
  </section>
  <div className="more-links"><Button type="link" onClick={onSources}>{t('数据来源与说明')}</Button><Button type="link" onClick={onRelease}>{t('关于这个版本')}</Button></div>
 </>;
}
