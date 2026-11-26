// The composer's side of dictation (#655): dialogs, messages and appending to the text box. It never submits.
import {useEffect,useRef,useState} from 'react';
import {App} from 'antd';
import {t} from './i18n';
import platform from './platform';
import {appendTranscript,createDictation,readCloudConsent,setCloudConsent,speechLang} from './dictation.js';

const ERRORS={'not-allowed':'没有麦克风权限。请在浏览器的网站设置里允许使用麦克风。','no-speech':'没有听到声音，可以再点一次麦克风。','language-not-supported':'这个浏览器暂时不支持用当前语言做语音输入。','download-failed':'语音模型没有下载成功，可以稍后再试。',failed:'语音输入没有成功，请再试一次。'};

export function useDictation({language,value,setValue,focus}){
 const {message,modal}=App.useApp();
 const [speech]=useState(()=>platform.speech);
 const [state,setState]=useState('idle');
 const latest=useRef({}),base=useRef(null),dialog=useRef(null),was=useRef('idle');
 latest.current={value,setValue,focus,message,modal};
 const [dictation]=useState(()=>{
  if(!speech)return null;
  const confirm=options=>new Promise(resolve=>{dialog.current=latest.current.modal.confirm({...options,cancelText:t('取消'),onOk:()=>resolve(true),onCancel:()=>resolve(false)});});
  return createDictation({speech,consent:{get:()=>readCloudConsent(),set:on=>setCloudConsent(on)},
   confirmCloud:()=>confirm({title:t('使用浏览器的语音服务？'),content:t('语音将由浏览器的语音服务识别（例如 Google / Apple）。卡疲扒拉不录音、不保存音频。'),okText:t('同意并开始')}),
   confirmDownload:()=>confirm({title:t('下载本机语音模型（约 60 MB）？'),content:t('模型由浏览器下载。下载后，语音在本机识别。'),okText:t('下载')}),
   onState:next=>{
    if(next==='starting')base.current=null;
    // Back to the box once a recording is over.
    if(was.current==='recording'&&next==='idle')latest.current.focus();
    was.current=next;setState(next);
   },
   onText:heard=>{base.current??=latest.current.value;latest.current.setValue(appendTranscript(base.current,heard));},
   onError:code=>{const say=code==='no-speech'||code==='language-not-supported'?latest.current.message.info:latest.current.message.warning;say(t(ERRORS[code]));}
  });
 });
 const cancel=()=>{dictation?.cancel();dialog.current?.destroy();dialog.current=null;};
 // A recording belongs to this box and this language.
 useEffect(()=>cancel,[language]);
 return {supported:!!speech,state,toggle:()=>dictation?.toggle(speechLang(language)),cancel,
  // Typing during a recording keeps what the user typed and drops the recording.
  typed:()=>{if(dictation?.state==='recording')dictation.cancel();}};
}
