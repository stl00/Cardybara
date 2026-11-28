import React,{useEffect,useState} from 'react';
import {Card,Flex,Switch,Typography} from 'antd';
import {t,useI18n} from './i18n';
import InfoTip from './InfoTip.jsx';
import {VOICE_CHANGE,VOICE_CLOUD_KEY,readCloudConsent,setCloudConsent} from './dictation.js';
const {Text}=Typography;
// Revokes the cloud speech consent (#655). It is only given from the notice on the assistant's mic button, so the
// switch cannot turn it on here.
export default function VoiceSettings(){
 useI18n();
 const [on,setOn]=useState(()=>readCloudConsent());
 useEffect(()=>{const load=()=>setOn(readCloudConsent());const onStorage=e=>{if(e.key===VOICE_CLOUD_KEY)load();};window.addEventListener(VOICE_CHANGE,load);window.addEventListener('storage',onStorage);return()=>{window.removeEventListener(VOICE_CHANGE,load);window.removeEventListener('storage',onStorage)}},[]);
 return <Card className="voice-settings" title={<span className="settings-title">{t('语音输入')}<InfoTip title={t('浏览器能在本机识别时优先在本机识别。否则语音将由浏览器的语音服务识别（例如 Google / Apple），第一次使用麦克风时会先问你；关闭后下次会再问。卡疲扒拉不录音、不保存音频。')}/></span>} style={{marginBottom:20}}>
  <Flex align="center" gap={12} wrap><Switch aria-label={t('允许浏览器的语音服务')} checked={on} disabled={!on} onChange={next=>{if(!next)setCloudConsent(false)}}/><Text>{t('允许浏览器的语音服务')}</Text></Flex>
 </Card>;
}
