import React,{useMemo,useState} from 'react';
import {Alert,Button,Flex,Form,Input,Modal,Select,Space,Typography} from 'antd';
import {ACTIVE_BANKS,PROVIDERS} from '../extension-next/providers.js';
import {BankIdentity} from './Identity';
import {t,useI18n} from './i18n';
import {cardProducts} from './productCatalog';
import {productDisplayName} from './cardName';
import ProductPickerPanel,{ChosenProduct} from './ProductPickerPanel.jsx';
import {FeeDateInput,feeDateRule} from './CardEditor.jsx';
const {Text}=Typography;
// "Not in the list": the user names the card themself and it stays unrecognised.
export const OTHER_PRODUCT='other';
/**
 * Adds a card the bank pages did not show. The product comes from the same catalogue the detected-card picker
 * uses, so a manual card gets the same art, benefits and credits; a free-text name covers anything else.
 */
export function AddWalletCard({onAdd}){
 const {language}=useI18n();const [open,setOpen]=useState(false),[picking,setPicking]=useState(false),[form]=Form.useForm(),[error,setError]=useState('');
 // undefined until the user picks a tile or "not listed"; the product decides the bank, so only "not listed" asks for one.
 const [choice,setChoice]=useState(),[otherBank,setOtherBank]=useState();
 const products=useMemo(()=>cardProducts.filter(p=>ACTIVE_BANKS.includes(p.bank)&&p.region===PROVIDERS[p.bank]?.region),[]);
 const product=choice&&choice!==OTHER_PRODUCT?products.find(p=>p.id===choice):null;
 const start=()=>{setError('');setChoice(undefined);setOtherBank(undefined);setOpen(true);setPicking(true);};
 const close=()=>{setOpen(false);setPicking(false);};
 const focusTail=()=>document.querySelector('.add-card-modal .add-card-tail')?.focus();
 // Closing the panel before anything was chosen ends adding; after a choice it goes back to the form.
 const closePicker=()=>{setPicking(false);if(choice===undefined)setOpen(false);};
 const submit=async()=>{try{const value=await form.validateFields();onAdd({...value,bank:product?product.bank:value.bank,productId:product?product.id:null});form.resetFields();setError('');close();}catch(e){if(!e.errorFields)setError(t(e.message==='duplicate_card'?'这家银行的同一尾号卡片已经在钱包里。':'卡片未保存，请检查信息或浏览器存储空间。'));}};
 return <><Button onClick={start}>{t('添加卡片')}</Button>
 <ProductPickerPanel open={open&&picking} onClose={closePicker} afterClose={focusTail} products={products} title={t('添加卡片：选择卡种')} selectedId={product?.id}
  onChoose={id=>{setChoice(id);setPicking(false);}} onOther={bank=>{setChoice(OTHER_PRODUCT);setOtherBank(bank||undefined);setPicking(false);}}/>
 <Modal className="add-card-modal" title={t('添加自己的卡片')} open={open&&choice!==undefined} afterOpenChange={o=>o&&focusTail()} onCancel={close} onOk={submit} okText={t('保存卡片')} cancelText={t('取消')} destroyOnHidden>
  <Alert type="info" showIcon title={t('只填写卡种和尾号，不要填写完整卡号、密码或验证码。')} style={{marginBottom:20}}/>
  <Form form={form} layout="vertical" className="add-card-form" preserve={false}>
   {product?<ChosenProduct product={product} extra={<Button className="add-card-change" onClick={()=>setPicking(true)}>{t('更换')}</Button>}/>:<>
    <Flex className="add-card-unlisted" align="center" justify="space-between" gap={8} wrap style={{marginBottom:16}}><Text type="secondary">{t('不在列表里（自己填写卡名）')}</Text><Button size="small" className="add-card-change" onClick={()=>setPicking(true)}>{t('从列表选择')}</Button></Flex>
    <Form.Item name="bank" label={t('银行与地区')} initialValue={otherBank} rules={[{required:true}]}><Select className="add-card-bank" aria-label={t('银行与地区')} showSearch optionFilterProp="search" options={ACTIVE_BANKS.map(b=>({value:b,search:`${b} ${t(PROVIDERS[b].issuer)}`,label:<BankIdentity bank={b}/>}))}/></Form.Item>
   </>}
   <Form.Item name="name" label={product?t('显示名称（可不填，默认用卡种名称）'):t('卡片名称')} rules={[{required:!product,whitespace:true,max:100}]}><Input className="add-card-name" maxLength={100} placeholder={product?productDisplayName(product.id,language)||product.name:undefined}/></Form.Item>
   <Form.Item name="tail" label={t('卡片尾号（4 或 5 位）')} rules={[{required:true,pattern:/^\d{4,5}$/,message:t('请填写 4 或 5 位数字，不要填写完整卡号。')}]}><Input className="add-card-tail" inputMode="numeric" maxLength={5} autoComplete="off"/></Form.Item>
   <Form.Item name="feeDate" label={t('年费日（持卡周年日，可不填）')} rules={[feeDateRule]} extra={t('银行页面不显示年费日。按你的账单或年费扣款记录填写；不知道可以留空，之后在卡片详情里设置。')}><FeeDateInput/></Form.Item>
  </Form>{error&&<Alert type="error" title={error}/>}</Modal></>;
}
export function EmptyWalletWelcome({onConnect}){
 useI18n();return <Alert style={{marginBottom:20}} type="info" showIcon title={t('欢迎，这是你的新钱包')} description={<Space orientation="vertical"><span>{t('选择一家银行并登录，读取页面上可确认的卡片；没有识别到时，可以手动添加卡种与尾号。不需要旧备份。')}</span><Button type="primary" onClick={onConnect}>{t('连接第一家银行')}</Button></Space>}/>;
}
