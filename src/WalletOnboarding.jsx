import React,{useState} from 'react';
import {Alert,Button,Form,Input,Modal,Select,Space,Typography} from 'antd';
import {ACTIVE_BANKS,CONNECTABLE_BANKS,PROVIDERS,SCOPED,bankOrder,connectable} from '../extension-next/providers.js';
import {BankIdentity,RegionLabel,bankLabel} from './Identity';
import {t,useI18n} from './i18n';
import {cardProducts} from './productCatalog';
import {productDisplayName} from './cardName';
import CardArt from './CardArt';
import {FeeDateInput,feeDateRule} from './CardEditor.jsx';
const {Text}=Typography;
// "Not in the list": the user names the card themself and it stays unrecognised.
export const OTHER_PRODUCT='other';
/**
 * Adds a card the bank pages did not show. The product comes from the same catalogue the detected-card picker
 * uses, so a manual card gets the same art, benefits and credits; a free-text name covers anything else.
 */
export function AddWalletCard({onAdd}){
 const {language}=useI18n();const [open,setOpen]=useState(false),[form]=Form.useForm(),[error,setError]=useState('');
 const bank=Form.useWatch('bank',form),productId=Form.useWatch('productId',form);
 const label=p=>productDisplayName(p.id,language)||p.name;
 const products=bank?cardProducts.filter(p=>p.bank===bank&&p.region===PROVIDERS[bank]?.region).sort((a,b)=>label(a).localeCompare(label(b))):[];
 const product=products.find(p=>p.id===productId);
 const submit=async()=>{try{const value=await form.validateFields();onAdd({...value,productId:value.productId===OTHER_PRODUCT?null:value.productId});form.resetFields();setError('');setOpen(false);}catch(e){if(!e.errorFields)setError(t(e.message==='duplicate_card'?'这家银行的同一尾号卡片已经在钱包里。':'卡片未保存，请检查信息或浏览器存储空间。'));}};
 return <><Button onClick={()=>{setError('');setOpen(true)}}>{t('添加卡片')}</Button><Modal className="add-card-modal" title={t('添加自己的卡片')} open={open} onCancel={()=>setOpen(false)} onOk={submit} okText={t('保存卡片')} cancelText={t('取消')} destroyOnHidden>
  <Alert type="info" showIcon title={t('只填写卡种和尾号，不要填写完整卡号、密码或验证码。')} style={{marginBottom:20}}/>
  <Form form={form} layout="vertical" className="add-card-form">
   <Form.Item name="bank" label={t('银行与地区')} rules={[{required:true}]}><Select className="add-card-bank" aria-label={t('银行与地区')} showSearch optionFilterProp="search" onChange={()=>form.setFieldsValue({productId:undefined})} options={bankOrder(ACTIVE_BANKS).map(b=>({value:b,search:`${b} ${t(PROVIDERS[b].issuer)}`,label:<BankIdentity bank={b}/>}))}/></Form.Item>
   {bank&&<Text type="secondary" style={{display:'block',margin:'-16px 0 16px'}}>{t('地区')}：<RegionLabel region={PROVIDERS[bank].region}/></Text>}
   {SCOPED&&bank&&!connectable(bank)&&<Alert className="add-card-not-read" type="warning" showIcon style={{marginBottom:16}} title={t('这个测试版只从 {0} 的官网读取余额和账单。',[liveBanks()])} description={t('这张卡可以记在钱包里，用来看福利和问用卡助手；它的余额、账单和还款日不会自动更新。')}/>}
   <Form.Item name="productId" label={t('卡种')} rules={[{required:true,message:t('请选择卡种；找不到时选“不在列表里”。')}]} extra={bank&&!products.length?t('资料库里还没有这家银行的卡种。'):null}>
    <Select className="add-card-product" aria-label={t('卡种')} showSearch disabled={!bank} placeholder={t('搜索卡种名称')} optionFilterProp="search"
     options={[...products.map(p=>({value:p.id,search:[label(p),p.name,...p.aliases].join(' '),label:<span>{label(p)}{!p.art&&<Text type="secondary"> · {t('无卡面')}</Text>}</span>})),{value:OTHER_PRODUCT,search:`${t('不在列表里')} other`,label:t('不在列表里（自己填写卡名）')}]}/>
   </Form.Item>
   {product&&<div style={{marginBottom:16}}><CardArt card={{id:'new',bank,region:product.region,name:label(product),productId:product.id}}/></div>}
   <Form.Item name="name" label={productId===OTHER_PRODUCT?t('卡片名称'):t('显示名称（可不填，默认用卡种名称）')} rules={[{required:productId===OTHER_PRODUCT,whitespace:true,max:100}]}><Input className="add-card-name" maxLength={100}/></Form.Item>
   <Form.Item name="tail" label={t('卡片尾号（4 或 5 位）')} rules={[{required:true,pattern:/^\d{4,5}$/,message:t('请填写 4 或 5 位数字，不要填写完整卡号。')}]}><Input className="add-card-tail" inputMode="numeric" maxLength={5} autoComplete="off"/></Form.Item>
   <Form.Item name="feeDate" label={t('年费日（持卡周年日，可不填）')} rules={[feeDateRule]} extra={t('银行页面不显示年费日。按你的账单或年费扣款记录填写；不知道可以留空，之后在卡片详情里设置。')}><FeeDateInput/></Form.Item>
  </Form>{error&&<Alert type="error" title={error}/>}</Modal></>;
}
// The banks a scoped build reads, as one phrase ("Chase、American Express 美国").
export const liveBanks=()=>CONNECTABLE_BANKS.map(bankLabel).join(t('、'));
export function EmptyWalletWelcome({onConnect}){
 useI18n();return <Alert style={{marginBottom:20}} type="info" showIcon title={t('欢迎，这是你的新钱包')} description={<Space orientation="vertical"><span>{t('选择一家银行并登录，读取页面上可确认的卡片；没有识别到时，可以手动添加卡种与尾号。不需要旧备份。')}</span>{SCOPED&&<span className="beta-scope-note">{t('这个测试版可以连接 {0}。',[liveBanks()])}</span>}<Button type="primary" onClick={onConnect}>{t('连接第一家银行')}</Button></Space>}/>;
}
