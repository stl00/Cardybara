import React,{useState} from 'react';
import {Alert,Button,Modal,Radio,Space,Typography} from 'antd';
import {t} from './i18n';
import {preselectedMerges} from './frictionDefaults.js';
const {Paragraph,Text}=Typography;
const label=c=>c.name+(c.tail?` · ${c.tail}`:'');
/** Shown until the next sync cycle ends: a merge that happened, with the way back. */
export function CardMergeUndo({undos,onUndo}){
 return <>{undos.map(u=><Alert key={u.manualId+u.bankId} className="card-merge-undo" type="info" showIcon style={{marginBottom:12}}
  title={t('{0} 已和银行读到的同一张卡合并，你填写的内容都保留了。',[u.manual.name])}
  action={<Button size="small" onClick={()=>onUndo(u)}>{t('撤销合并')}</Button>}/>)}</>;
}
/** One prompt for every case the wallet cannot settle alone: pick the manual card that is the bank card, or none. */
export function CardMergeQuestions({questions,onAnswer,onLater}){
 const [picked,setPicked]=useState(()=>preselectedMerges(questions));
 if(!questions.length)return null;
 const answers=()=>questions.map(q=>({bankId:q.bank.id,candidates:q.manual.map(c=>c.id),manualId:picked[q.bank.id]&&picked[q.bank.id]!=='none'?picked[q.bank.id]:null,decided:!!picked[q.bank.id]})).filter(a=>a.decided);
 return <Modal open title={t('这是同一张卡吗？')} className="card-merge-modal" onCancel={onLater}
  footer={<Space><Button className="card-merge-later" onClick={onLater}>{t('稍后再说')}</Button><Button className="card-merge-ok" type="primary" disabled={!answers().length} onClick={()=>onAnswer(answers())}>{t('确定')}</Button></Space>}>
  <Paragraph type="secondary">{t('银行读到了下面的卡。钱包里有手动添加的卡可能就是同一张；选“合并”后，你填写的内容、费用和福利记录都会保留在一张卡上。')}</Paragraph>
  {questions.map(q=><div key={q.bank.id} className="card-merge-question" style={{marginBottom:16}}>
   <Text strong>{label(q.bank)}</Text>
   <Radio.Group style={{display:'block',marginTop:8}} value={picked[q.bank.id]} onChange={e=>setPicked(p=>({...p,[q.bank.id]:e.target.value}))}>
    <Space direction="vertical">
     {q.manual.map(c=><Radio key={c.id} value={c.id}>{t('与 {0} 合并',[label(c)])}</Radio>)}
     <Radio value="none">{t('都不是同一张卡')}</Radio>
    </Space>
   </Radio.Group>
  </div>)}
 </Modal>;
}
