import React,{useMemo,useState} from 'react';
import {App,Alert,Button,Card,Typography} from 'antd';
import {t,useI18n} from './i18n';
import {GATEWAY_ORIGIN} from '../extension-next/model-client.js';
import {createAccountClient} from './accountClient.js';
import {ROUTE_PREFIX,routeExtensionId} from './extensionSignIn.js';
const {Paragraph}=Typography;

/** True when the location hash is the extension sign-in route, valid or not (an invalid one shows an error, never a redirect). */
export const isExtensionSignInHash=hash=>typeof hash==='string'&&hash.startsWith(ROUTE_PREFIX);

// The PWA half of the extension passkey sign-in (#472). Opened by the browser identity web-auth flow (launchWebAuthFlow) at /#extension-signin/<extension-id>.
// A click runs the passkey sign-in, then the browser goes to https://<extension-id>.chromiumapp.org/ with the session in the fragment.
// The target comes only from the validated id. Nothing here logs the session.
export default function ExtensionSignInRoute({hash=globalThis.location?.hash,go=url=>globalThis.location.replace(url)}){
 useI18n();
 const id=routeExtensionId(hash);
 const client=useMemo(()=>createAccountClient({gateway:GATEWAY_ORIGIN}),[]);
 const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 const run=async()=>{
  setBusy(true);setFailed(false);
  try{const r=await client.passkeyHandoff(id);if(r.ok)return go(r.url);setFailed(true);}
  finally{setBusy(false);}
 };
 return <App><div style={{maxWidth:420,margin:'0 auto',padding:16}}>
  <Card className="extension-signin" title={t('登录 Cardybara 扩展')}>
   {id?<>
    <Paragraph type="secondary">{t('用通行密钥登录，完成后会自动回到扩展。')}</Paragraph>
    {failed&&<Alert type="error" showIcon role="alert" title={t('没有登录成功。请再试一次，或回到扩展改用邮箱和密码。')} style={{marginBottom:12}}/>}
    <Button type="primary" block loading={busy} onClick={run} style={{minHeight:44}}>{t('用通行密钥登录')}</Button>
   </>:<Alert type="error" showIcon role="alert" title={t('这个登录链接无效。请回到扩展重新开始。')}/>}
  </Card>
 </div></App>;
}
