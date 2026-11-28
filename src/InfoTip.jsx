import React,{useState} from 'react';
import {Popover,Tooltip} from 'antd';
import InfoCircleOutlined from '@ant-design/icons/es/icons/InfoCircleOutlined';
import {t,useI18n} from './i18n';

// Quiet UI (#682): explanations and caveats sit behind an ⓘ instead of an always-on paragraph. A pointer that can hover
// gets a Tooltip (it also opens on keyboard focus); touch gets a Popover that opens on tap. The trigger is a plain button,
// not an antd Button: it is not an action, so the density check does not count it as one.
const HOVER='(hover: hover) and (pointer: fine)';
const canHover=()=>typeof matchMedia!=='function'||matchMedia(HOVER).matches;

export default function InfoTip({title,label,hover}){
 useI18n();
 const [detected]=useState(canHover);
 if(!title)return null;
 const trigger=<button type="button" className="info-tip" aria-label={label||t('说明')} onClick={e=>e.stopPropagation()}><InfoCircleOutlined aria-hidden="true"/></button>;
 const content=<div className="info-tip-content">{title}</div>;
 return (hover??detected)?<Tooltip title={content} trigger={['hover','focus']}>{trigger}</Tooltip>:<Popover content={content} trigger="click">{trigger}</Popover>;
}
