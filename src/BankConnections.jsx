import React from 'react';
import {Alert,Button,Card,Col,Collapse,Flex,Row,Space,Tag,Typography,Tooltip} from 'antd';
import ReloadOutlined from '@ant-design/icons/es/icons/ReloadOutlined';
import LinkOutlined from '@ant-design/icons/es/icons/LinkOutlined';
import CheckCircleOutlined from '@ant-design/icons/es/icons/CheckCircleOutlined';
import {BankIdentity} from './Identity';
import CollectorPanel from './CollectorPanel';
import {t,useI18n,formatDateTime,formatReadDate} from './i18n';
const {Text,Paragraph}=Typography;
const sectionNames={card:'余额与账单',reward:'积分'};
const phases={reading_all_data:'正在读取银行数据',understanding_page:'正在整理页面数据',reading_next_page:'正在读取下一页',complete:'本轮读取结束'};
const statuses={load_error:'银行概览尚未显示完整卡片信息',navigation_changed:'银行页面已切换，读取已停止',cancelled:'本轮已停止',incomplete:'仅部分记录已读取',navigation_timeout:'银行页面加载超时',parser_timeout:'解析超时，请重试',parser_busy:'解析服务忙，请重试',model_request_failed:'模型服务暂时不可用',page_read_failed:'页面暂时无法读取',checked_empty:'已检查，当前无记录',partial:'积分池待核对',updated:'已更新',reading:'读取中',not_found:'本次未读到',setup_required:'解析服务未启用',connect_local_service:'解析服务未连接',local_service_offline:'本机服务离线',parser_unavailable:'解析暂时失败',needs_login:'需要登录',card_not_identified:'页面未显示卡片',document_changed:'页面已改变',no_financial_text:'本次未读到'};
export default function BankConnections({data,connected,collectorConnected,collectorState,sendCollector,bankState,isBusy,refreshBank,urls,onSetup,onRestore,refreshing,onFocus}){
 useI18n();
 const guides={needs_login:'请在银行官网登录，然后在引导条点击“读取本页”。',needs_confirmation:'请在银行 App 完成确认，再读取页面。',no_data:'未识别到金额。请打开具体卡片详情后重试。',ambiguous:'账户或币种不明确，暂未更新金额。',load_error:'银行页面没有正常加载，请在官网检查后重试。',timeout:'读取超时，已保留之前的数据。'};
 return <><div className="connection-intro"><Flex align="center" justify="space-between" wrap gap={16}><Space><span className={`connection-indicator ${connected?'ready':''}`}><CheckCircleOutlined/></span><div><Text strong>{connected?t('浏览器采集已就绪'):t('先连接 Chrome 扩展')}</Text><div><Text type="secondary">{t('你在银行官网登录，卡疲扒拉读取当前页面。')}</Text></div></div></Space><Button onClick={onSetup} icon={<LinkOutlined/>}>{connected?t('查看使用说明'):t('连接扩展')}</Button></Flex></div>
 <Row gutter={[20,20]}>{data.connections.map(connection=>{
  const cards=data.cards.filter(card=>card.bank===connection.bank);
  const job=collectorState?.run?.jobs.find(job=>job.bank===connection.bank);
  const status=job?.status||connection.liveStatus;
  const dates=cards.filter(card=>card.balance!=null).map(card=>formatReadDate(card.fieldDates?.balance||card.updated)).filter(Boolean).sort();
  const range=dates.length?(dates[0]===dates.at(-1)?dates[0]:`${dates[0]} – ${dates.at(-1)}`):t('尚未读取余额');
  const diagnostic=job?.diagnostic;const received=job?.received;const sections=job?.sections;const phase=phases[job?.phase];
  return <Col xs={24} md={12} xl={8} key={connection.bank}><Card className="connection-card account-connection" title={<BankIdentity bank={connection.bank} size={32}/>}>
   <Flex justify="space-between" align="center" gap={8} className="connection-card-summary"><Text type="secondary">{t('{0} 张卡',[cards.length])}</Text><Tag color={isBusy(connection.bank)?'processing':status==='updated'?'success':status==='partial'||guides[status]?'warning':'default'}>{bankState(connection.bank)||t(cards.length?'已保存历史记录':'尚未连接')}</Tag></Flex>
   {phase&&isBusy(connection.bank)&&<Text type="secondary" className="bank-task-phase">{t(phase)}</Text>}
   <div className="connection-data-date"><Text type="secondary">{t('余额数据日期')}</Text><Text>{range}</Text></div>
   {connection.lastAttemptAt&&<Text type="secondary" className="attempt-time">{t('上次尝试：{0}',[formatDateTime(connection.lastAttemptAt,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})])}</Text>}
   {guides[status]&&<Alert type="warning" showIcon title={t(guides[status])} className="bank-next-step"/>}
   {['updated','partial'].includes(status)&&received!=null&&<Text type="secondary">{t('本次读取 {0} 张卡；其余字段保留原日期。',[received])}</Text>}
   <div className="bank-section-progress"><Flex gap={6} wrap>{Object.entries(sectionNames).map(([key,name])=>{const status=sections?.[key]?.status;return <Tooltip key={key} title={`${t(name)} · ${t(key==='reward'&&status==='partial'?'仅部分卡片已读取积分':key==='reward'&&status==='updated'?'已读取所有登记卡片的积分；共用积分池关系单独核对':statuses[status]||(isBusy(connection.bank)?'等待读取':'尚未在本轮读取'))}`}><Tag color={['updated','checked_empty'].includes(status)?'success':status==='reading'?'processing':status&&status!=='not_found'?'warning':undefined}>{t(name)}{['updated','checked_empty'].includes(status)?' ✓':status==='partial'?' · '+t(key==='reward'?'部分已读':'待核对'):status==='reading'?' …':''}</Tag></Tooltip>})}</Flex></div>
   {sections?.card?.coverage&&<div className="bank-card-coverage">{sections.card.coverage.map(c=>{const reward=sections.reward?.coverage?.find(r=>r.cardId===c.cardId);return <Flex key={c.cardId} justify="space-between" align="center" wrap gap={8}><Text>{cards.find(card=>card.id===c.cardId)?.name||t('卡片待确认')}</Text><Space size={4}>{c.notApplicable?.length>0&&<Tag>{t('银行显示无需付款')}</Tag>}<Tag color={c.complete?'success':'default'}>{t('余额与账单')}{c.complete?' ✓':' · '+t('待补齐')}</Tag><Tag color={reward?.complete?'success':'default'}>{t('积分')}{reward?.complete?' ✓':' · '+t('待补齐')}</Tag></Space></Flex>})}</div>}
   <Flex gap={8} wrap className="connection-actions"><Button type="primary" icon={<ReloadOutlined/>} loading={isBusy(connection.bank)} onClick={()=>refreshBank(connection.bank)}>{t(cards.length?'刷新银行':'连接银行')}</Button><Button href={urls[connection.bank]} target="_blank" rel="noopener noreferrer">{t('打开官网')}</Button>{connection.liveTabId&&connected&&<Button onClick={()=>onFocus(connection.bank)}>{t('返回银行页面')}</Button>}</Flex>
   <Collapse ghost size="small" className="bank-read-detail" items={[{key:'details',label:t('读取记录'),children:<><Paragraph type="secondary">{t('实际运行版本')}：{collectorState?.runtimeBuild||t('未连接')}</Paragraph><Paragraph type="secondary">{t(connection.note)||t('尚未采集账户详情。')}</Paragraph>{diagnostic&&<Paragraph type="secondary">{t('读取诊断')}：{diagnostic.stage} / {diagnostic.code}</Paragraph>}{job?.readError&&<Alert type="warning" showIcon title={t('本轮读取提前结束')} description={<>{t(statuses[job.readError]||'页面暂时无法读取')}<Text type="secondary"> ({job.readError})</Text></>}/ >}{sections&&<><Text type="secondary">{t('本轮检查 {0} 页，排除 {1} 条无法确认的结果。',[job.pages||0,job.rejected||0])}</Text>{!!Object.keys(job.rejectReasons||{}).length&&<Paragraph type="secondary">{Object.entries(job.rejectReasons).map(([k,v])=>`${k==='unrecognized_programme'?t('未识别的积分项目'):k}: ${v}`).join(' · ')}</Paragraph>}{sections.card?.coverage?.filter(c=>!c.complete).map(c=><Paragraph key={c.cardId} type="secondary">{cards.find(card=>card.id===c.cardId)?.name} · {t('缺少：')}{c.missing.map(k=>t(({balance:'余额',statement:'账单金额',minimum:'最低还款',due:'还款日'})[k])).join('、')}</Paragraph>)}<div style={{marginTop:12}}>{Object.entries(sectionNames).map(([key,name])=><Flex key={key} justify="space-between"><Text>{t(name)}</Text><Text type="secondary">{t(statuses[sections[key]?.status]||'本次未读到')} · {sections[key]?.count||0}{Number.isInteger(sections[key]?.expected)?` / ${sections[key].expected}`:''}</Text></Flex>)}</div></>}</>}]}/>
  </Card></Col>;
 })}</Row>
 <Paragraph type="secondary" className="connection-settings-link">{t('本机调试服务可在设置中连接，无需在扩展填写密钥。')} <Button type="link" onClick={()=>location.hash='settings'}>{t('刷新设置')}</Button></Paragraph>
 <Collapse className="connection-help" items={[{key:'how',label:t('如何刷新银行数据？'),children:<ol className="connection-howto"><li>{t('点击银行旁的刷新按钮，打开银行官网。')}</li><li>{t('自行登录或完成手机确认；密码只交给银行。')}</li><li>{t('打开账户或卡片详情，在引导条读取本页。')}</li><li>{t('回到钱包查看本轮结果，未读取的项目保留原记录。')}</li></ol>},{key:'advanced',label:t('采集支持与高级设置'),children:<><CollectorPanel connected={collectorConnected} state={collectorState} send={sendCollector}/><Space wrap><Button onClick={onRestore} loading={refreshing}>{t('重新载入初始记录')}</Button><Text type="secondary">{t('这只载入已有记录，不会访问银行。')}</Text></Space></>}]} />
 <Paragraph type="secondary" className="connection-footnote">{t('本轮只读取余额、账单、还款日和积分；缺少的项目保留原数据与原日期。')}</Paragraph>
 </>;
}
