import React from 'react';
import {Button,Dropdown} from 'antd';
import EllipsisOutlined from '@ant-design/icons/es/icons/EllipsisOutlined';
import {t,useI18n} from './i18n';

// Quiet UI (#682): a row keeps its most used action visible and puts the rest behind ⋯. `items` are antd menu items
// (falsy entries are skipped); `onClick` gets the item key. Clicks stop here, so a menu on a clickable row or tile does
// not also open it.
// `open` and `onOpenChange` are for a row that also opens the menu another way (long press on a wallet tile).
export default function MoreMenu({items,onClick,label,disabled=false,size='small',open,onOpenChange}){
 useI18n();
 const shown=(items||[]).filter(Boolean);
 if(!shown.some(item=>item.type!=='divider'))return null;
 return <Dropdown disabled={disabled} trigger={['click']} {...(open===undefined?{}:{open,onOpenChange})} menu={{items:shown,onClick:({key,domEvent})=>{domEvent?.stopPropagation();onClick?.(key);}}}>
  <Button className="more-menu-trigger" size={size} disabled={disabled} aria-label={label||t('更多操作')} icon={<EllipsisOutlined/>} onClick={e=>e.stopPropagation()}/>
 </Dropdown>;
}
