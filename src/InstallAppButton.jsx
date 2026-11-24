import React,{useEffect,useState} from 'react';
import {Button} from 'antd';
import {t,useI18n} from './i18n';
import {startInstallPrompt} from './installPrompt.js';
// #573: shows only when the browser offered its install prompt; calls prompt() on tap. Web build only (callers gate it).
export default function InstallAppButton({controller,className='install-app'}){
 useI18n();const [c]=useState(()=>controller||startInstallPrompt()),[,tick]=useState(0);
 useEffect(()=>c.subscribe(()=>tick(n=>n+1)),[c]);
 return c.canInstall()?<Button className={className} type="primary" onClick={()=>c.install()}>{t('安装应用')}</Button>:null;
}
