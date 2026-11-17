import React,{useEffect,useState} from 'react';
import {Alert,App,Button,Descriptions,Flex,Form,Input,InputNumber,Modal,Select,Space,Tag,Typography} from 'antd';
import {t,useI18n} from './i18n';
import {BankIdentity,RegionLabel} from './Identity';
import {CARD_EDITS_KEY,readCardEdits,withCardEdit,regionBanks,validCardName} from './cardEdits.js';
import {anniversaryPeriod,cleanFeeDate,feeDateText} from './feeDate.js';
import {profileForCard} from './benefitRules.js';
import {walletDay} from './personalBenefits.js';
const {Text,Paragraph}=Typography;
const CHANGE='cardybara-card-edits-change';
export function loadCardEdits(){try{return readCardEdits(localStorage)}catch{return []}}
export function saveCardEdits(edits){localStorage.setItem(CARD_EDITS_KEY,JSON.stringify(edits));window.dispatchEvent(new Event(CHANGE));}
export function useCardEdits(){
 const [edits,setEdits]=useState(loadCardEdits);
 useEffect(()=>{const load=()=>setEdits(loadCardEdits());window.addEventListener(CHANGE,load);window.addEventListener('storage',load);return()=>{window.removeEventListener(CHANGE,load);window.removeEventListener('storage',load)}},[]);
 return edits;
}
/** Credits on this card that reset on the account anniversary and are in force today. */
export function anniversaryCredits(card,asOf=walletDay()){
 return (profileForCard(card)?.benefits||[]).filter(b=>['credit','promo'].includes(b.category)&&b.period==='account-anniversary'&&!b.applicability&&!(b.validFrom&&b.validFrom>asOf)&&!(b.validThrough&&b.validThrough<asOf));
}
/**
 * Month and day, and the year only if the user knows it. Empty means not set: nothing is filled in for the
 * user, so an unknown fee date never turns into the 1st of a month.
 */
export function FeeDateInput({value,onChange,id}){
 useI18n();const v=value||{},set=patch=>{const next={...v,...patch};for(const k of Object.keys(next))if(next[k]==null)delete next[k];onChange?.(Object.keys(next).length?next:null);};
 return <Space wrap id={id}>
  <InputNumber aria-label={t('年费日的月份')} className="fee-month" min={1} max={12} precision={0} value={v.month??null} onChange={month=>set({month})} style={{width:92}} suffix={t('月')}/>
  <InputNumber aria-label={t('年费日的日期')} className="fee-day" min={1} max={31} precision={0} value={v.day??null} onChange={day=>set({day})} style={{width:92}} suffix={t('日')}/>
  <InputNumber aria-label={t('开卡年份（可不填）')} className="fee-year" min={1950} max={2100} precision={0} placeholder={t('年份（可不填）')} value={v.year??null} onChange={year=>set({year})} style={{width:150}}/>
 </Space>;
}
/** A fee date is optional, but a partly filled or impossible one is an error rather than a guess. */
export const feeDateRule={validator:(_,value)=>!value||cleanFeeDate(value)?Promise.resolve():Promise.reject(Error(t('请填写有效的月份和日期；年份可以不填。')))};
const UserTag=()=><Tag color="blue" style={{marginInlineStart:6}}>{t('你设置的')}</Tag>;
/** In card details: the card's own facts the user can correct, its annual fee date, and the edit form. */
export function CardEditSection({card,cards,onSave,onManualEdit,openFeeDate=false}){
 useI18n();const {message}=App.useApp(),[open,setOpen]=useState(false),[form]=Form.useForm(),[busy,setBusy]=useState(false);
 const manual=card.identitySource!=='bank-page',set=f=>card.userSet?.includes(f),day=walletDay(),credits=anniversaryCredits(card,day);
 const period=anniversaryPeriod(card.feeDate,day),banks=manual?regionBanks(card.detected?.bank??card.bank):[];
 const save=patch=>{try{saveCardEdits(withCardEdit(loadCardEdits(),card,patch));onSave?.();return true;}catch{message.error(t('保存失败，刚才的设置没有生效。'));return false;}};
 const reset=field=>{if(save({[field]:null}))message.success(t('已恢复为银行读取的值。'));};
 const edit=()=>{form.setFieldsValue({name:card.name,tail:card.tail||'',bank:card.bank,feeDate:card.feeDate||null});setOpen(true);};
 // Arriving from a credit row that asks for the fee date opens the editor straight away, once per card.
 useEffect(()=>{if(openFeeDate&&!card.feeDate)edit();},[openFeeDate,card.id]);
 const submit=async()=>{
  let v;try{v=await form.validateFields()}catch{return;}
  const patch={};
  if(v.name.trim()!==card.name)patch.name=v.name.trim();
  if((v.tail||'')!==(card.tail||''))patch.tail=v.tail||null;
  if(manual&&v.bank!==card.bank)patch.bank=v.bank;
  // Saving the date again, even unchanged, confirms it and settles a migration's conflict note.
  const fee=cleanFeeDate(v.feeDate);if(JSON.stringify(fee)!==JSON.stringify(card.feeDate||null)||fee&&card.feeDateConflict)patch.feeDate=fee;
  // A field set back to what the bank showed is no longer a correction.
  for(const f of ['name','tail','bank'])if(f in patch&&card.detected?.[f]===patch[f])patch[f]=null;
  // A manual card's own facts are edited where the wallet keeps the card; only its fee date is an overlay.
  const own=manual?Object.fromEntries(['name','tail','bank'].filter(f=>f in patch).map(f=>[f,patch[f]??card.detected?.[f]??card[f]])):{};
  const overlay=manual?('feeDate' in patch?{feeDate:patch.feeDate}:{}):patch;
  setBusy(true);
  try{
   if(Object.keys(own).length)onManualEdit(card,own);
   if(!Object.keys(overlay).length||save(overlay)){setOpen(false);if(Object.keys(patch).length)message.success(t(card.bank!==(own.bank??card.bank)?'卡片信息已保存；换了地区，请重新选择卡种。':'卡片信息已保存。'));}
  }catch(e){message.error(t(e.message==='duplicate_card'?'这家银行的同一尾号卡片已经在钱包里。':'保存失败，刚才的设置没有生效。'));}finally{setBusy(false)}
 };
 const tailTaken=(bank,tail)=>cards.some(c=>c.id!==card.id&&c.bank===bank&&(c.tail===tail||c.detected?.tail===tail));
 const resetLink=field=>!manual&&set(field)&&<Button size="small" type="link" onClick={()=>reset(field)}>{t('恢复银行显示的值')}</Button>;
 return <div className="card-edit-section" style={{margin:'12px 0'}}>
  <Descriptions size="small" column={1} title={t('卡片信息')} extra={<Button size="small" onClick={edit}>{t('编辑卡片信息')}</Button>} items={[
   {key:'name',label:t('显示名称'),children:<Flex align="center" wrap gap={4}><Text>{card.name}</Text>{!manual&&set('name')&&<UserTag/>}{resetLink('name')}</Flex>},
   {key:'tail',label:t('尾号'),children:<Flex align="center" wrap gap={4}><Text>{card.tail?`•••• ${card.tail}`:t('待识别')}</Text>{!manual&&set('tail')&&<><UserTag/><Text type="secondary">{t('银行显示：{0}',[card.detected.tail?`•••• ${card.detected.tail}`:t('待识别')])}</Text></>}{resetLink('tail')}</Flex>},
   {key:'region',label:t('地区'),children:<RegionLabel region={card.region}/>},
   {key:'fee',label:t('年费日'),children:<Flex align="center" wrap gap={4}>{card.feeDate?<><Text>{feeDateText(card.feeDate)}</Text><UserTag/></>:<><Text type="secondary">{t('未设置')}</Text><Button className="fee-date-set" size="small" type="link" onClick={edit}>{t('去设置')}</Button></>}</Flex>},
  ]}/>
  {card.feeDate&&period&&<Paragraph type="secondary" style={{fontSize:12,margin:'4px 0 0'}}>{t('当前持卡年度：{0} — {1}；周年福利、年费提醒和持卡成本都按它计算。',[period.start,period.end])}</Paragraph>}
  {card.feeDate&&card.feeDateConflict&&<Paragraph type="secondary" className="fee-date-conflict" style={{fontSize:12,margin:'4px 0 0'}}>{t('年费日取自你以前记录的持卡年度（最新一条）；那些记录用过不同的日期：{0}。请核对。',[card.feeDateConflict.join(' / ')])}</Paragraph>}
  {!card.feeDate&&credits.length>0&&<Alert className="fee-date-prompt" type="info" showIcon style={{marginTop:8}} title={t('填年费日，周年福利才能算周期')} action={<Button size="small" type="link" onClick={edit}>{t('设置年费日')}</Button>}/>}
  <Modal className="card-edit-modal" title={t('编辑卡片信息')} open={open} onCancel={()=>setOpen(false)} onOk={submit} confirmLoading={busy} okText={t('保存')} cancelText={t('取消')} destroyOnHidden>
   {!manual&&<Alert type="info" showIcon style={{marginBottom:16}} title={t('你的修改会保留，之后刷新银行也不会被覆盖；随时可以恢复银行显示的值。')}/>}
   <Form form={form} layout="vertical">
    <Form.Item name="name" label={t('显示名称')} rules={[{required:true,whitespace:true},{validator:(_,v)=>!v||validCardName(v)?Promise.resolve():Promise.reject(Error(t('名称不能超过 100 个字，也不能包含卡号。')))}]}><Input maxLength={100}/></Form.Item>
    <Form.Item name="tail" label={t('卡片尾号（4 或 5 位）')} dependencies={['bank']} rules={[{required:!!(card.detected?.tail??card.tail),pattern:/^\d{4,5}$/,message:t('请填写 4 或 5 位数字，不要填写完整卡号。')},({getFieldValue})=>({validator:(_,v)=>v&&tailTaken(getFieldValue('bank')||card.bank,v)?Promise.reject(Error(t('这家银行的同一尾号卡片已经在钱包里。'))):Promise.resolve()})]}><Input inputMode="numeric" maxLength={5} autoComplete="off"/></Form.Item>
    {manual&&banks.length>1&&<Form.Item name="bank" label={t('地区')}><Select options={banks.map(b=>({value:b,label:<BankIdentity bank={b}/>}))}/></Form.Item>}
    <Form.Item name="feeDate" label={t('年费日（持卡周年日）')} rules={[feeDateRule]} extra={t('每张卡只填这一个日期：周年福利、年费提醒和持卡成本都按它计算。银行页面不显示年费日，按你的账单或年费扣款记录填写；不知道可以留空。')}><FeeDateInput/></Form.Item>
   </Form>
  </Modal>
 </div>;
}
