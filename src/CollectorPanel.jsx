import React,{useState} from 'react';
import {Alert,Button,Card,Select,Space,Table,Tag,Typography} from 'antd';
import {useI18n,t} from './i18n';
import {BankIdentity} from './Identity';
import {PROVIDERS} from '../extension-next/providers.js';
export default function CollectorPanel({connected,state,send}){
 useI18n();const [bank,setBank]=useState('Chase');
 const rows=Object.entries(PROVIDERS).map(([bank,p])=>({bank,key:bank,money:['Chase','Amex HK','HSBC HK'].includes(bank)?t('已在一个开发账户上实测部分金额'):t('尚未完成验收'),other:t('已接入统一刷新，实际结果待核对')}));
 return <Card title={t('数据读取支持')}>
 <Typography.Paragraph type="secondary">{t('银行页面会变化。完成一轮刷新不代表每类数据都已读取，具体以银行卡片上的本次结果与字段日期为准。')}</Typography.Paragraph>
 <Typography.Paragraph type="secondary">{t('真实验证目前只来自一个开发账户。其他卡种和积分计划只经过合成页面测试，遇到未识别的内容会显示为部分读取。')}</Typography.Paragraph>
 <Table size="small" pagination={false} scroll={{x:650}} dataSource={rows} columns={[{title:t('银行'),dataIndex:'bank',render:v=><BankIdentity bank={v}/>},{title:t('卡片金额'),dataIndex:'money'},{title:t('积分与账单副页'),dataIndex:'other'}]}/>
 {connected&&<Space wrap style={{marginTop:20}}><Select aria-label={t('管理银行采集')} value={bank} onChange={setBank} style={{width:240}} options={Object.keys(PROVIDERS).map(b=>({value:b,label:<BankIdentity bank={b} size={20}/>}))}/><Button onClick={()=>send(state?.disabled.includes(bank)?'connect':'disconnect',bank)}>{state?.disabled.includes(bank)?t('启用采集'):t('停用并清除读数')}</Button><Button onClick={()=>send('clear',bank)}>{t('清除此银行本机读数')}</Button><Button disabled={state?.run?.status!=='running'} onClick={()=>send('cancel')}>{t('取消本轮采集')}</Button></Space>}
 <Typography.Paragraph type="secondary" className="source-note">{t('清除读数只影响扩展采集的数据，导入的历史备份仍会保留。')}</Typography.Paragraph>
 </Card>;
}
