import React,{useState} from 'react';
import {Button,Modal,Typography} from 'antd';
import {t,useI18n} from './i18n';
import {bankName} from './Identity';
import {collectReport,needsReport,reportFileName} from '../extension-next/problem-report.js';
// After a read that ended partial, failed or with a card missing a field, the wallet offers the same sanitized
// report as the extension popup (#196). The tester reads all of it, then saves the file. Nothing is sent.
export default function ProblemReport({bank,job,state}){
 useI18n();const [text,setText]=useState(null);
 if(!needsReport(job,state?.records?.[bank]))return null;
 const save=()=>{const url=URL.createObjectURL(new Blob([text+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=reportFileName(bank);a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const hasPage=text!=null&&JSON.parse(text).structure!=null;
 return <><Button className="problem-report-button" onClick={async()=>setText(JSON.stringify(await collectReport({...job,bank},state),null,2))}>{t('生成问题报告')}</Button>
 <Modal open={text!=null} width={720} title={t('问题报告预览 · {0}',[bankName(bank)])} onCancel={()=>setText(null)} okText={t('保存报告')} cancelText={t('取消')} onOk={save}>
  <Typography.Paragraph type="secondary">{t('报告只有页面结构和字段是否读到；金额、卡号、姓名、日期都已换成占位符。请先看一遍，确认后自己保存，再发给开发者。不会自动发送。')}</Typography.Paragraph>
  {!hasPage&&<Typography.Paragraph type="secondary">{t('这次没有记录到页面结构，报告只含任务状态。')}</Typography.Paragraph>}
  <pre className="problem-report-json" style={{maxHeight:'50vh',overflow:'auto',fontSize:12,whiteSpace:'pre-wrap',wordBreak:'break-all'}}>{text}</pre>
 </Modal></>;
}
