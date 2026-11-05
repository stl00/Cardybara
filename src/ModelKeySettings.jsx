import React,{useEffect,useState} from 'react';
import {Alert,App,Button,Card,Flex,Input,Popconfirm,Select,Space,Switch,Tag,Typography} from 'antd';
import {t,useI18n} from './i18n';
import {PROVIDERS,keyStatus,saveKey,deleteKey,setModelEnabled,testKey,requestPermission,validKey} from '../extension-next/model-client.js';
const {Paragraph,Text}=Typography;
const internal=()=>location.protocol==='chrome-extension:'&&!!globalThis.chrome?.runtime?.id;
const failures={invalid_key:'这看起来不是有效的密钥，请检查后重新粘贴。',model_auth_failed:'服务商拒绝了这个密钥，请检查是否复制完整或已过期。',model_rate_limited:'服务商暂时限流，请稍后再测试。',model_failed:'暂时连不上服务商，请稍后再试。',model_not_ready:'请先保存密钥并允许扩展访问服务商。',permission_denied:'没有获得访问服务商的权限，密钥未保存。'};
export default function ModelKeySettings(){
 useI18n();const {message}=App.useApp();
 const [status,setStatus]=useState(null),[provider,setProvider]=useState('deepseek'),[draft,setDraft]=useState(''),[editing,setEditing]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const refresh=async()=>setStatus(await keyStatus());
 useEffect(()=>{if(internal())void refresh();},[]);
 const run=async(name,fn)=>{setBusy(name);setError('');try{await fn();}catch(e){setError(t(failures[e.message]||failures.model_failed));}finally{setBusy('');}};
 if(!internal())return <Card title={t('AI 模型密钥')}><Paragraph>{t('密钥在浏览器扩展里添加：打开扩展里的钱包，进入设置。本页使用本机调试服务。')}</Paragraph></Card>;
 const save=()=>run('save',async()=>{
  const key=draft.trim();if(!validKey(key))throw Error('invalid_key');
  // The permission prompt must come from this click.
  if(!await requestPermission(provider))throw Error('permission_denied');
  await saveKey({provider,key});setDraft('');setEditing(false);await refresh();message.success(t('密钥已保存，只存放在本扩展里。'));
 });
 const test=()=>run('test',async()=>{await testKey(editing||!status?.saved?{provider,key:draft.trim()}:undefined);message.success(t('连接成功，密钥可用。'));});
 const showForm=!status?.saved||editing;
 return <Card title={t('AI 模型密钥')} extra={<Tag color={status?.ready?'success':'default'}>{status?.ready?t('已就绪'):status?.saved?t('已保存，未启用'):t('未添加')}</Tag>}>
  <Paragraph>{t('聊天助手、卡片识别和 AI 补全银行数据都用这里的密钥直接调用服务商。不添加也能正常使用钱包，只是没有 AI。')}</Paragraph>
  <Paragraph type="secondary">{t('密钥只保存在本扩展的本地存储里，不同步、不写入备份、日志或诊断报告，只发送给你选择的服务商。保存后只显示首尾几位。')}</Paragraph>
  {status?.saved&&!editing&&<Flex vertical gap={12}>
   <Space wrap><Text>{status.label}</Text><Text code>{status.masked}</Text>{status.savedAt&&<Text type="secondary">{t('保存于 {0}',[status.savedAt.slice(0,10)])}</Text>}</Space>
   {!status.permission&&<Alert showIcon type="warning" title={t('扩展还没有访问服务商的权限，请替换密钥并在弹窗里允许。')}/>}
   <Flex align="center" gap={12} wrap><Switch checked={status.enabled} loading={busy==='enabled'} onChange={on=>run('enabled',async()=>{await setModelEnabled(on);await refresh();})}/><Text>{t('在本扩展里使用 AI')}</Text></Flex>
   <Space wrap><Button loading={busy==='test'} onClick={test}>{t('测试连接')}</Button><Button onClick={()=>{setEditing(true);setDraft('');}}>{t('替换密钥')}</Button><Popconfirm title={t('删除后需要重新粘贴密钥才能使用 AI。')} okText={t('删除')} cancelText={t('取消')} onConfirm={()=>run('delete',async()=>{await deleteKey();await refresh();})}><Button danger loading={busy==='delete'}>{t('删除密钥')}</Button></Popconfirm></Space>
  </Flex>}
  {showForm&&<Flex vertical gap={12}>
   <Select value={provider} onChange={setProvider} style={{maxWidth:240}} options={Object.entries(PROVIDERS).map(([value,p])=>({value,label:p.label}))}/>
   <Input.Password value={draft} onChange={e=>setDraft(e.target.value)} placeholder={t('粘贴你的 API 密钥')} autoComplete="off" spellCheck={false} maxLength={200}/>
   <Paragraph type="secondary" style={{margin:0}}>{t('保存时浏览器会询问是否允许扩展访问 {0}。',[PROVIDERS[provider].origin.replace('https://','')])}</Paragraph>
   <Space wrap><Button type="primary" disabled={!draft.trim()} loading={busy==='save'} onClick={save}>{t('保存密钥')}</Button><Button disabled={!draft.trim()} loading={busy==='test'} onClick={test}>{t('测试连接')}</Button>{editing&&<Button onClick={()=>{setEditing(false);setDraft('');}}>{t('取消')}</Button>}</Space>
  </Flex>}
  {error&&<Alert showIcon type="warning" title={error} style={{marginTop:16}}/>}
 </Card>;
}
