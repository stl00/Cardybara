import React,{useEffect,useState} from 'react';
import {Alert,App,Button,Card,Flex,Input,Popconfirm,Select,Space,Switch,Tag,Typography} from 'antd';
import {t,useI18n} from './i18n';
import {PROVIDERS,gatewayConfigured,ownKeyAllowed,keyStatus,saveKey,deleteKey,setModelEnabled,testKey,requestPermission,validKey} from '../extension-next/model-client.js';
const {Paragraph,Text}=Typography;
const internal=()=>location.protocol==='chrome-extension:'&&!!globalThis.chrome?.runtime?.id;
const failures={invalid_key:'这看起来不是有效的密钥，请检查后重新粘贴。',model_auth_failed:'服务商拒绝了这个密钥，请检查是否复制完整或已过期。',model_rate_limited:'服务商暂时限流，请稍后再测试。',model_failed:'暂时连不上服务商，请稍后再试。',model_not_ready:'请先保存密钥并允许扩展访问服务商。',permission_denied:'没有获得访问服务商的权限，密钥未保存。'};
const hostedFailures={hosted_over_cap:'已达到托管服务的用量上限，请稍后再试。',hosted_client_cap:'今天从这个网络使用托管服务的次数已到上限，请明天再试。',model_rate_limited:'托管服务暂时繁忙，请稍后再试。',model_failed:'暂时连不上托管服务，请稍后再试。',model_not_ready:'托管服务还没有开通，请稍后再试。'};
const ownProviders=Object.entries(PROVIDERS).filter(([,p])=>!p.hosted);
const host=provider=>PROVIDERS[provider].origin.replace('https://','');
// The hosted service needs no invite code (owner decision 2026-11-16): it is on by default, and this card only turns
// it off or on. An own key is a developer-only mode; a key saved earlier still shows, so it can be removed.
export default function ModelKeySettings(){
 useI18n();const {message}=App.useApp();
 const [status,setStatus]=useState(null),[devOwn,setDevOwn]=useState(false),[ownProvider,setOwnProvider]=useState('deepseek'),[draft,setDraft]=useState(''),[editing,setEditing]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const hosted=!editing&&status?.hosted!==false;
 const refresh=async()=>{const [next,dev]=await Promise.all([keyStatus(),ownKeyAllowed()]);setStatus(next);setDevOwn(dev);};
 useEffect(()=>{if(internal())void refresh();},[]);
 const run=async(name,fn)=>{setBusy(name);setError('');try{await fn();}catch(e){const list=hosted?hostedFailures:failures;setError(t(list[e.message]||list.model_failed));}finally{setBusy('');}};
 if(!internal())return <Card title={t('AI 服务')}><Paragraph>{t('AI 在浏览器扩展里设置：打开扩展里的钱包，进入设置。本页使用本机调试服务。')}</Paragraph></Card>;
 const save=()=>run('save',async()=>{
  const key=draft.trim();
  if(!validKey(key))throw Error('invalid_key');
  // The permission prompt must come from this click.
  if(!await requestPermission(ownProvider))throw Error('permission_denied');
  // A key that is rejected is not saved. A network or rate-limit problem doesn't prove it wrong, so it is saved with a warning.
  let checked=true;try{await testKey({provider:ownProvider,key});}catch(e){if(['model_auth_failed','invalid_key'].includes(e.message))throw e;checked=false;}
  await saveKey({provider:ownProvider,key});setDraft('');setEditing(false);await refresh();
  checked?message.success(t('密钥已保存，只存放在本扩展里。')):message.warning(t('密钥已保存，但暂时没能连上服务商确认，请稍后点测试连接。'));
 });
 const test=()=>run('test',async()=>{
  if(editing){if(!await requestPermission(ownProvider))throw Error('permission_denied');await testKey({provider:ownProvider,key:draft.trim()});}
  else await testKey();
  message.success(t(hosted?'连接成功，托管服务可用。':'连接成功，密钥可用。'));
 });
 const toggle=<Flex align="center" gap={12} wrap><Switch checked={!!status?.enabled} loading={busy==='enabled'} onChange={on=>run('enabled',async()=>{await setModelEnabled(on);await refresh();})}/><Text>{t('在本扩展里使用 AI')}</Text></Flex>;
 return <Card title={t('AI 服务')} extra={<Tag color={status?.ready?'success':'default'}>{status?.ready?t('已就绪'):status?.provider?t('已关闭'):t('未添加')}</Tag>}>
  {hosted&&<Flex vertical gap={12}>
   <Paragraph style={{margin:0}}>{t('聊天助手和 AI 识别卡种通过 Cardybara 托管服务运行，不需要邀请码，打开就能用。不想用 AI 可以在这里关闭，钱包其他功能不受影响。')}</Paragraph>
   <Paragraph type="secondary" style={{margin:0}}>{t('聊天助手在 Cardybara 服务上运行：服务收到你的问题、持有的卡种和助手请求的钱包查询结果，交给 AI 模型处理；不收到卡号、余额或账单，钱包只保存在本机。服务不保存这些内容，只记录时间、用量和状态。为了限制每个网络每天的用量，服务只保留网络地址加盐后的哈希值，保留一天。卡片识别也经过 Cardybara 服务。')}</Paragraph>
   {!gatewayConfigured&&<Alert showIcon type="info" title={t(devOwn?'托管服务还没有开通，暂时请使用自己的 key。':'托管服务还没有开通，请稍后再试。')}/>}
   {status?.provider&&toggle}
   {status?.provider&&<Space wrap><Button loading={busy==='test'} onClick={test}>{t('测试连接')}</Button></Space>}
  </Flex>}
  {hosted&&devOwn&&<Button style={{marginTop:12}} onClick={()=>{setEditing(true);setDraft('');setError('');}}>{t('使用自己的 key')}</Button>}
  {!hosted&&status?.saved&&!editing&&<Flex vertical gap={12}>
   <Paragraph type="secondary" style={{margin:0}}>{t('密钥只保存在本扩展的本地存储里，不同步、不写入备份、日志或诊断报告，只发送给你选择的服务商。保存后只显示首尾几位。')}</Paragraph>
   <Space wrap><Text>{t(status.label)}</Text><Text code>{status.masked}</Text>{status.savedAt&&<Text type="secondary">{t('保存于 {0}',[status.savedAt.slice(0,10)])}</Text>}</Space>
   {!status.permission&&<Alert showIcon type="warning" title={t('扩展还没有访问服务商的权限，请替换密钥并在弹窗里允许。')}/>}
   {toggle}
   <Space wrap><Button loading={busy==='test'} onClick={test}>{t('测试连接')}</Button><Button onClick={()=>{setEditing(true);setDraft('');}}>{t('替换密钥')}</Button><Popconfirm title={t('删除后改用 Cardybara 托管服务。')} okText={t('删除')} cancelText={t('取消')} onConfirm={()=>run('delete',async()=>{await deleteKey();await refresh();})}><Button danger loading={busy==='delete'}>{t('删除密钥')}</Button></Popconfirm></Space>
  </Flex>}
  {editing&&<Flex vertical gap={12}>
   <Paragraph type="secondary" style={{margin:0}}>{t('密钥只保存在本扩展的本地存储里，不同步、不写入备份、日志或诊断报告，只发送给你选择的服务商。保存后只显示首尾几位。')}</Paragraph>
   <Select value={ownProvider} onChange={setOwnProvider} style={{maxWidth:240}} options={ownProviders.map(([value,p])=>({value,label:p.label}))}/>
   <Input.Password value={draft} onChange={e=>setDraft(e.target.value)} placeholder={t('粘贴你的 API 密钥')} autoComplete="off" spellCheck={false} maxLength={200}/>
   <Paragraph type="secondary" style={{margin:0}}>{t('保存时浏览器会询问是否允许扩展访问 {0}。',[host(ownProvider)])}</Paragraph>
   <Space wrap><Button type="primary" disabled={!draft.trim()} loading={busy==='save'} onClick={save}>{t('保存密钥')}</Button><Button disabled={!draft.trim()} loading={busy==='test'} onClick={test}>{t('测试连接')}</Button><Button onClick={()=>{setEditing(false);setDraft('');setError('');}}>{t('取消')}</Button></Space>
  </Flex>}
  {error&&<Alert showIcon type="warning" title={error} style={{marginTop:16}}/>}
 </Card>;
}
