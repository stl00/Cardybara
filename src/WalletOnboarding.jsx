import React,{useMemo,useRef,useState} from 'react';
import {Alert,Button,Dropdown,Flex,Form,Input,Modal,Select,Space,Typography} from 'antd';
import {DownOutlined} from '@ant-design/icons';
import {ACTIVE_BANKS,CONNECTABLE_BANKS,SCOPED,bankOrder,connectable} from '../extension-next/providers.js';
import {BankIdentity,bankName} from './Identity';
import {t,useI18n} from './i18n';
import {cardProducts} from './productCatalog';
import {MANUAL_BANK_NAMES,bankProfile} from './manualBanks.js';
import {productDisplayName} from './cardName';
import ProductPickerPanel,{ChosenProduct} from './ProductPickerPanel.jsx';
import {FeeDateInput,feeDateRule} from './CardEditor.jsx';
import usePlaidLink from './usePlaidLink.js';
const {Text}=Typography;
// "Not in the list": the user names the card themself and it stays unrecognised.
export const OTHER_PRODUCT='other';
/**
 * Adds a card. With `plaidGateway` (the web wallet with Plaid on its gateway) the button itself starts Plaid Link, the only
 * automatic import there, and typing the product and tail moves to the menu beside it; otherwise it adds a card the bank
 * pages did not show. The product comes from the same catalogue the detected-card picker
 * uses, so a manual card gets the same art, benefits and credits; a free-text name covers anything else.
 */
export function AddWalletCard({onAdd,plaidGateway=null}){
 const {language}=useI18n();const plaid=usePlaidLink({gateway:plaidGateway,active:!!plaidGateway});const [open,setOpen]=useState(false),[picking,setPicking]=useState(false),[form]=Form.useForm(),[error,setError]=useState('');const lastField=useRef(null);
 // undefined until the user picks a tile or "not listed"; the product decides the bank, so only "not listed" asks for one.
 const [choice,setChoice]=useState(),[otherBank,setOtherBank]=useState();
 const products=useMemo(()=>cardProducts.filter(p=>[...ACTIVE_BANKS,...MANUAL_BANK_NAMES].includes(p.bank)&&p.region===bankProfile(p.bank)?.region),[]);
 const product=choice&&choice!==OTHER_PRODUCT?products.find(p=>p.id===choice):null;
 // A scoped build (the beta) can still hold a card of another bank, but says it won't be read.
 const typedBank=Form.useWatch('bank',form),chosenBank=product?product.bank:typedBank;
 const start=()=>{lastField.current=null;setError('');setChoice(undefined);setOtherBank(undefined);setOpen(true);setPicking(true);};
 const close=()=>{setOpen(false);setPicking(false);};
 // Runs when the dialog's open animation (or the catalogue's close animation) ends. By then antd has also moved focus (the
 // catalogue returns it to its trigger, the dialog to its close button), and on a slow phone the user may already be typing
 // the fee date. So go back to the field they last used and fall back to the tail only when they have not used one.
 const focusTail=()=>{const f=lastField.current;(f?.isConnected?f:document.querySelector('.add-card-modal .add-card-tail'))?.focus();};
 // Closing the panel before anything was chosen ends adding; after a choice it goes back to the form.
 const closePicker=()=>{setPicking(false);if(choice===undefined)setOpen(false);};
 const submit=async()=>{try{const value=await form.validateFields();onAdd({...value,bank:product?product.bank:value.bank,productId:product?product.id:null});form.resetFields();setError('');close();}catch(e){if(!e.errorFields)setError(t(e.message==='duplicate_card'?'这家银行的同一尾号卡片已经在钱包里。':'卡片未保存，请检查信息或浏览器存储空间。'));}};
 const viaPlaid=!!plaidGateway&&!plaid.unavailable;
 return <>{viaPlaid?<Space.Compact className="add-card-plaid"><Button type="primary" loading={plaid.busy} onClick={plaid.press}>{plaid.signedIn()?t('添加卡片'):t('登录并添加卡片')}</Button>
  <Dropdown trigger={['click']} placement="bottomRight" menu={{items:[{key:'plaid',label:t('通过 Plaid 连接美国信用卡（自动读取余额和还款日）')},{key:'manual',label:t('手动添加（选卡种、填尾号）')}],onClick:({key})=>key==='manual'?start():plaid.press()}}>
   <Button type="primary" className="add-card-more" aria-label={t('更多添加方式')} icon={<DownOutlined/>}/></Dropdown></Space.Compact>
 :<Button onClick={start}>{t('添加卡片')}</Button>}
 <ProductPickerPanel open={open&&picking} onClose={closePicker} afterClose={focusTail} products={products} title={t('添加卡片：选择卡种')} selectedId={product?.id}
  onChoose={id=>{setChoice(id);setPicking(false);}} onOther={bank=>{setChoice(OTHER_PRODUCT);setOtherBank(bank||undefined);if(bank&&form.getFieldInstance?.('bank'))form.setFieldsValue({bank});setPicking(false);}}/>
 <Modal className="add-card-modal" title={t('添加自己的卡片')} open={open&&choice!==undefined} afterOpenChange={o=>o&&focusTail()} onCancel={close} onOk={submit} okText={t('保存卡片')} cancelText={t('取消')} destroyOnHidden>
  <Alert type="info" showIcon title={t('只填写卡种和尾号，不要填写完整卡号、密码或验证码。')} style={{marginBottom:20}}/>
  <Form form={form} layout="vertical" className="add-card-form" preserve={false} onFocus={e=>{if(e.target.matches?.('input,textarea'))lastField.current=e.target;}}>
   {product?<ChosenProduct product={product} extra={<Button className="add-card-change" onClick={()=>setPicking(true)}>{t('更换')}</Button>}/>:<>
    <Flex className="add-card-unlisted" align="center" justify="space-between" gap={8} wrap style={{marginBottom:16}}><Text type="secondary">{t('不在列表里（自己填写卡名）')}</Text><Button size="small" className="add-card-change" onClick={()=>setPicking(true)}>{t('从列表选择')}</Button></Flex>
    <Form.Item name="bank" label={t('银行与地区')} initialValue={otherBank} rules={[{required:true}]}><Select className="add-card-bank" aria-label={t('银行与地区')} showSearch optionFilterProp="search" options={[...bankOrder(ACTIVE_BANKS),...MANUAL_BANK_NAMES].map(b=>({value:b,search:`${b} ${t(bankProfile(b).issuer)}`,label:<BankIdentity bank={b}/>}))}/></Form.Item>
   </>}
   {SCOPED&&chosenBank&&!connectable(chosenBank)&&<Alert className="add-card-not-read" type="warning" showIcon style={{marginBottom:16}} title={t('这个测试版只从 {0} 的官网读取余额和账单。',[liveBanks()])} description={t('这张卡可以记在钱包里，用来看福利和问用卡助手；它的余额、账单和还款日不会自动更新。')}/>}
   <Form.Item name="name" label={product?t('显示名称（可不填，默认用卡种名称）'):t('卡片名称')} rules={[{required:!product,whitespace:true,max:100}]}><Input className="add-card-name" maxLength={100} placeholder={product?productDisplayName(product.id,language)||product.name:undefined}/></Form.Item>
   <Form.Item name="tail" label={t('卡片尾号（4 或 5 位）')} rules={[{required:true,pattern:/^\d{4,5}$/,message:t('请填写 4 或 5 位数字，不要填写完整卡号。')}]}><Input className="add-card-tail" inputMode="numeric" maxLength={5} autoComplete="off"/></Form.Item>
   <Form.Item name="feeDate" label={t('年费日（持卡周年日，可不填）')} rules={[feeDateRule]} extra={t('银行页面不显示年费日。按你的账单或年费扣款记录填写；不知道可以留空，之后在卡片详情里设置。')}><FeeDateInput/></Form.Item>
  </Form>{error&&<Alert type="error" title={error}/>}</Modal></>;
}
// The banks a scoped build reads, as one phrase ("Chase、American Express 美国").
export const liveBanks=()=>CONNECTABLE_BANKS.map(bankName).join(t('、'));
// With `onConnect` the wallet can read bank pages and leads to the bank list. Without it (the web wallet, manual entry only)
// the first step is adding a card by hand through `onAdd`.
export function EmptyWalletWelcome({onConnect,onAdd,plaidGateway=null}){
 useI18n();if(!onConnect)return <Alert className="empty-wallet-manual" style={{marginBottom:20}} type="info" showIcon title={t('欢迎，这是你的新钱包')} description={<Space orientation="vertical"><span>{t('从卡种目录里选一张卡，再填写尾号，就能把它记进钱包。所有数据只保存在这个浏览器里。')}</span>{onAdd&&<AddWalletCard onAdd={onAdd} plaidGateway={plaidGateway}/>}</Space>}/>;return <Alert style={{marginBottom:20}} type="info" showIcon title={t('欢迎，这是你的新钱包')} description={<Space orientation="vertical"><span>{t('选择一家银行并登录，读取页面上可确认的卡片；没有识别到时，可以手动添加卡种与尾号。不需要旧备份。')}</span>{SCOPED&&<span className="beta-scope-note">{t('这个测试版可以连接 {0}。',[liveBanks()])}</span>}<Button type="primary" onClick={onConnect}>{t('连接第一家银行')}</Button></Space>}/>;
}
