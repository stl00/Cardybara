import React,{useEffect,useState} from 'react';
import {Alert,App,Button,Card,Flex,Input,Popconfirm,Radio,Select,Space,Switch,Tag,Typography} from 'antd';
import {t,useI18n} from './i18n';
import {PROVIDERS,HOSTED,gatewayConfigured,ownKeyAllowed,keyStatus,saveKey,deleteKey,setModelEnabled,testKey,requestPermission,validKey,validInvite} from '../extension-next/model-client.js';
const {Paragraph,Text}=Typography;
const internal=()=>location.protocol==='chrome-extension:'&&!!globalThis.chrome?.runtime?.id;
const failures={invalid_key:'这看起来不是有效的密钥，请检查后重新粘贴。',model_auth_failed:'服务商拒绝了这个密钥，请检查是否复制完整或已过期。',model_rate_limited:'服务商暂时限流，请稍后再测试。',model_failed:'暂时连不上服务商，请稍后再试。',model_not_ready:'请先保存密钥并允许扩展访问服务商。',permission_denied:'没有获得访问服务商的权限，密钥未保存。',looks_like_invite:'这是 Cardybara 邀请码，请选择“使用 Cardybara 托管服务（输入邀请码）”后再粘贴。'};
const hostedFailures={invalid_invite:'这看起来不是有效的邀请码，请检查后重新粘贴。',invite_invalid:'托管服务不认识这个邀请码，请检查是否复制完整。',invite_revoked:'这个邀请码已停用，请联系发码人。',hosted_over_cap:'已达到托管服务的用量上限，请稍后再试。',model_rate_limited:'服务商暂时限流，请稍后再测试。',model_failed:'暂时连不上托管服务，请稍后再试。',model_not_ready:'请先保存邀请码并允许扩展访问托管服务。',permission_denied:'没有获得访问托管服务的权限，邀请码未保存。'};
const ownProviders=Object.entries(PROVIDERS).filter(([,p])=>!p.hosted);
const host=provider=>PROVIDERS[provider].origin.replace('https://','');
export default function ModelKeySettings(){
 useI18n();const {message}=App.useApp();
 const [status,setStatus]=useState(null),[devOwn,setDevOwn]=useState(false),[mode,setMode]=useState('hosted'),[ownProvider,setOwnProvider]=useState('deepseek'),[draft,setDraft]=useState(''),[editing,setEditing]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const hosted=mode==='hosted',provider=hosted?HOSTED:ownProvider;
 // An own key is a developer-only mode; the beta shows the hosted service only. A key saved before the beta
 // still shows, so it can be removed.
 const refresh=async()=>{const [next,dev]=await Promise.all([keyStatus(),ownKeyAllowed()]);setStatus(next);setDevOwn(dev);if(next.saved)setMode(next.hosted?'hosted':'own');else if(!dev)setMode('hosted');};
 useEffect(()=>{if(internal())void refresh();},[]);
 const run=async(name,fn)=>{setBusy(name);setError('');try{await fn();}catch(e){const list=hosted?hostedFailures:failures;setError(t(list[e.message]||list.model_failed));}finally{setBusy('');}};
 if(!internal())return <Card title={t('AI 服务')}><Paragraph>{t('AI 在浏览器扩展里设置：打开扩展里的钱包，进入设置。本页使用本机调试服务。')}</Paragraph></Card>;
 const save=()=>run('save',async()=>{
  const key=draft.trim();
  if(!hosted&&validInvite(key))throw Error('looks_like_invite');
  if(hosted?!validInvite(key):!validKey(key))throw Error(hosted?'invalid_invite':'invalid_key');
  // The permission prompt must come from this click.
  if(!await requestPermission(provider))throw Error('permission_denied');
  // A credential that is rejected is not saved. A network or rate-limit problem doesn't prove it wrong, so it is saved with a warning.
  let checked=true;try{await testKey({provider,key});}catch(e){if(['model_auth_failed','invalid_key','invalid_invite','invite_invalid','invite_revoked'].includes(e.message))throw e;checked=false;}
  await saveKey({provider,key});setDraft('');setEditing(false);await refresh();
  if(hosted)checked?message.success(t('邀请码已保存，只存放在本扩展里。')):message.warning(t('邀请码已保存，但暂时没能连上托管服务确认，请稍后点测试连接。'));
  else checked?message.success(t('密钥已保存，只存放在本扩展里。')):message.warning(t('密钥已保存，但暂时没能连上服务商确认，请稍后点测试连接。'));
 });
 const test=()=>run('test',async()=>{const candidate=editing||!status?.saved;if(candidate&&!await requestPermission(provider))throw Error('permission_denied');await testKey(candidate?{provider,key:draft.trim()}:undefined);message.success(t(hosted?'连接成功，邀请码可用。':'连接成功，密钥可用。'));});
 const showForm=!status?.saved||editing;
 const privacy=hosted
  ?<><Paragraph>{t('聊天内容和卡片识别会经过 Cardybara 网关转发给模型服务商，网关不保存这些内容，只记录邀请码编号、时间、用量和状态。用托管服务时，AI 补全银行数据不可用，银行数据不经过网关。')}</Paragraph>
   <Paragraph type="secondary">{t('邀请码只保存在本扩展的本地存储里，不同步、不写入备份、日志或诊断报告，只发送给 Cardybara 托管服务。保存后只显示首尾几位。')}</Paragraph></>
  :<Paragraph type="secondary">{t('密钥只保存在本扩展的本地存储里，不同步、不写入备份、日志或诊断报告，只发送给你选择的服务商。保存后只显示首尾几位。')}</Paragraph>;
 return <Card title={t('AI 服务')} extra={<Tag color={status?.ready?'success':'default'}>{status?.ready?t('已就绪'):status?.saved?t('已保存，未启用'):t('未添加')}</Tag>}>
  <Paragraph>{hosted?t('输入邀请码后即可使用聊天助手和 AI 识别卡种。不输入也能正常使用钱包，只是没有 AI。'):t('聊天助手、卡片识别和 AI 补全银行数据都通过这里的设置调用模型。不设置也能正常使用钱包，只是没有 AI。')}</Paragraph>
  {status?.saved&&!editing&&<Flex vertical gap={12}>
   {privacy}
   <Space wrap><Text>{t(status.label)}</Text><Text code>{status.masked}</Text>{status.savedAt&&<Text type="secondary">{t('保存于 {0}',[status.savedAt.slice(0,10)])}</Text>}</Space>
   {!status.permission&&<Alert showIcon type="warning" title={t(status.hosted?'扩展还没有访问托管服务的权限，请更换邀请码并在弹窗里允许。':'扩展还没有访问服务商的权限，请替换密钥并在弹窗里允许。')}/>}
   <Flex align="center" gap={12} wrap><Switch checked={status.enabled} loading={busy==='enabled'} onChange={on=>run('enabled',async()=>{await setModelEnabled(on);await refresh();})}/><Text>{t('在本扩展里使用 AI')}</Text></Flex>
   <Space wrap><Button loading={busy==='test'} onClick={test}>{t('测试连接')}</Button><Button onClick={()=>{setEditing(true);setDraft('');if(!devOwn)setMode('hosted');}}>{t(status.hosted?'更换邀请码':'替换密钥')}</Button><Popconfirm title={t(status.hosted?'删除后需要重新输入邀请码才能使用 AI。':'删除后需要重新粘贴密钥才能使用 AI。')} okText={t('删除')} cancelText={t('取消')} onConfirm={()=>run('delete',async()=>{await deleteKey();await refresh();})}><Button danger loading={busy==='delete'}>{t(status.hosted?'删除邀请码':'删除密钥')}</Button></Popconfirm></Space>
  </Flex>}
  {showForm&&<Flex vertical gap={12}>
   {devOwn&&<Radio.Group className="model-mode" value={mode} onChange={e=>{setMode(e.target.value);setDraft('');setError('');}} options={[{value:'hosted',label:t('使用 Cardybara 托管服务（输入邀请码）')},{value:'own',label:t('使用自己的 key')}]}/>}
   {privacy}
   {hosted&&!gatewayConfigured&&<Alert showIcon type="info" title={t('托管服务还没有开通，暂时请使用自己的 key。')}/>}
   {!hosted&&<Select value={ownProvider} onChange={setOwnProvider} style={{maxWidth:240}} options={ownProviders.map(([value,p])=>({value,label:p.label}))}/>}
   <Input.Password value={draft} onChange={e=>setDraft(e.target.value)} placeholder={t(hosted?'粘贴邀请码':'粘贴你的 API 密钥')} autoComplete="off" spellCheck={false} maxLength={200}/>
   <Paragraph type="secondary" style={{margin:0}}>{t('保存时浏览器会询问是否允许扩展访问 {0}。',[host(provider)])}</Paragraph>
   <Space wrap><Button type="primary" disabled={!draft.trim()} loading={busy==='save'} onClick={save}>{t(hosted?'保存邀请码':'保存密钥')}</Button><Button disabled={!draft.trim()} loading={busy==='test'} onClick={test}>{t('测试连接')}</Button>{editing&&<Button onClick={()=>{setEditing(false);setDraft('');setError('');if(status?.saved)setMode(status.hosted?'hosted':'own');}}>{t('取消')}</Button>}</Space>
  </Flex>}
  {error&&<Alert showIcon type="warning" title={error} style={{marginTop:16}}/>}
 </Card>;
}
