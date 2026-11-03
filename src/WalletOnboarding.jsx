import React,{useState} from 'react';
import {Alert,Button,Form,Input,Modal,Select,Space} from 'antd';
import {ACTIVE_BANKS} from '../extension-next/providers.js';
import {BankIdentity} from './Identity';
import {t,useI18n} from './i18n';
export function AddWalletCard({onAdd}){
 useI18n();const [open,setOpen]=useState(false),[form]=Form.useForm(),[error,setError]=useState('');
 const submit=async()=>{try{const value=await form.validateFields();onAdd(value);form.resetFields();setError('');setOpen(false);}catch(e){if(!e.errorFields)setError(t(e.message==='duplicate_card'?'这家银行的同一尾号卡片已经在钱包里。':'卡片未保存，请检查信息或浏览器存储空间。'));}};
 return <><Button onClick={()=>{setError('');setOpen(true)}}>{t('添加卡片')}</Button><Modal title={t('添加自己的卡片')} open={open} onCancel={()=>setOpen(false)} onOk={submit} okText={t('保存卡片')} cancelText={t('取消')} destroyOnHidden><Alert type="info" showIcon title={t('只填写卡名和尾号，不要填写完整卡号、密码或验证码。')} style={{marginBottom:20}}/><Form form={form} layout="vertical"><Form.Item name="bank" label={t('银行')} rules={[{required:true}]}><Select options={ACTIVE_BANKS.map(bank=>({value:bank,label:<BankIdentity bank={bank}/>}))}/></Form.Item><Form.Item name="name" label={t('卡片名称')} rules={[{required:true,whitespace:true,max:100}]}><Input maxLength={100}/></Form.Item><Form.Item name="tail" label={t('卡片尾号（4 或 5 位）')} rules={[{required:true,pattern:/^\d{4,5}$/}]}><Input inputMode="numeric" maxLength={5} autoComplete="off"/></Form.Item></Form>{error&&<Alert type="error" title={error}/>}</Modal></>;
}
export function EmptyWalletWelcome({onConnect}){
 useI18n();return <Alert style={{marginBottom:20}} type="info" showIcon title={t('欢迎，这是你的新钱包')} description={<Space orientation="vertical"><span>{t('选择一家银行并登录，读取页面上可确认的卡片；没有识别到时，可以手动添加卡名与尾号。不需要旧备份。')}</span><Button type="primary" onClick={onConnect}>{t('连接第一家银行')}</Button></Space>}/>;
}
