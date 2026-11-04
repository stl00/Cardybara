import React,{useState} from 'react';
import {Alert,Card,Row,Col,Statistic,Typography,Tag,Empty,Collapse,InputNumber,Select,Space,Table,Tabs,Flex} from 'antd';
import {t,useI18n} from './i18n';
import {BankIdentity,CardIdentity,RegionLabel,RegionFlag} from './Identity';
import ItemLogo from './ItemLogo';
import {knowledgeSources} from './knowledge';
import {convertPoints,readingsFor,routesForProduct,transferProgrammes,transferRoutes} from './transferRoutes';
const {Paragraph,Text,Link}=Typography;
const whole=n=>Number(n).toLocaleString('en-US');
const unitLabels={hours:'{0} 小时','days':'{0} 天','business-days':'{0} 个营业日'};
const timeLabel=time=>time?`${time.qualifier==='up-to'?t('最长'):t('预计')} ${t(unitLabels[time.unit],[time.value])}`:t('未列明');
const feeLabel=fee=>fee.kind==='excise-tax-offset'?t('消费税抵销费'):t('行政费');
const money=(value,currency)=>`${currency==='HKD'?'HK$':'$'}${Number(value).toLocaleString('en-US',{minimumFractionDigits:value%1?2:0,maximumFractionDigits:2})}`;
// Hidden balances must not reappear through a computed result, so nothing is prefilled or derived.
function Result({row,points,hidden}){
 const result=convertPoints(points,row.terms);
 if(result.status==='ratio-unknown')return <Text type="secondary">{t('未知：官方未列明此比例')}</Text>;
 if(hidden&&points!=null)return '••••';
 if(result.status==='no-points')return <Text type="secondary">—</Text>;
 if(result.status==='below-minimum')return <Text type="secondary">{t('低于最低 {0} 点',[whole(result.minimumPoints)])}</Text>;
 return <><Text strong>{whole(result.receive)}</Text><br/><Text type="secondary">{t('使用 {0} 点',[whole(result.spend)])}{result.capped?` · ${t('已按单笔上限计算')}`:''}</Text>{result.fees.filter(f=>f.charge!=null).map(f=><div key={f.kind}><Text type="secondary">{feeLabel(f)} {money(f.charge,f.currency)}</Text></div>)}</>;
}
function PartnerTable({rows,points,hidden}){
 const columns=[
  {title:t('计划'),render:(_,r)=><><ItemLogo programme={r.partnerId}/> {r.partner}{r.cardSpecific?<div><Text type="secondary">{r.terms.ratio?t('仅适用 Sapphire Preferred、Ink Business Preferred'):t('Sapphire Reserve 页面未列明')}</Text></div>:null}</>},
  {title:t('兑换比例'),render:(_,r)=>r.terms.ratio?<>{whole(r.terms.ratio.from)} → {whole(r.terms.ratio.to)}{r.terms.ratioCondition==='turbo-program'?<div><Tag>{t('仅 Turbo 计划费率')}</Tag></div>:null}</>:<>{t('未逐项列明')}{r.terms.ratioStatement?<div><Text type="secondary">{t('Sapphire Preferred 页面称多数伙伴 {0}:{1}',[r.terms.ratioStatement.ratio.from,r.terms.ratioStatement.ratio.to])}</Text></div>:null}</>},
  {title:t('可得'),render:(_,r)=><Result row={r} points={points} hidden={hidden}/>},
  {title:t('最低 / 增量'),render:(_,r)=><>{r.terms.minimumPoints?whole(r.terms.minimumPoints):t('未列明')} / {r.terms.incrementPoints?whole(r.terms.incrementPoints):t('未列明')}</>},
  {title:t('到账时间'),render:(_,r)=>timeLabel(r.terms.estimatedTime)},
  {title:t('费用'),render:(_,r)=>r.terms.fees?.length?r.terms.fees.map(f=><div key={f.kind}>{feeLabel(f)}{f.amount?` ${money(f.amount,f.currency)}`:''}</div>):r.terms.feeStatement==='may-be-charged'?t('可能收取，转点前会告知'):t('页面未列明')},
 ];
 return <Table size="small" rowKey="ruleId" columns={columns} dataSource={rows} pagination={false} scroll={{x:760}}/>;
}
function ProgrammePanel({programme,accounts,cards,count,hidden}){
 const readings=readingsFor(programme,accounts,cards),[selected,setSelected]=useState(0),[manual,setManual]=useState(null);
 const reading=readings[selected]||null,points=manual??reading?.amount??null,all=transferRoutes(programme.id);
 const rows=routesForProduct(all,manual==null?reading?.productId:null);
 const airlines=rows.filter(r=>r.kind==='airline'),hotels=rows.filter(r=>r.kind==='hotel'),sources=knowledgeSources([...new Set(all.flatMap(r=>r.sourceIds))]);
 return <><Flex gap={16} wrap align="end" style={{marginBottom:16}}>
  {readings.length?<div><Text type="secondary">{t('卡片读数')}</Text><br/><Select aria-label={t('卡片读数')} value={selected} onChange={v=>{setSelected(v);setManual(null);}} style={{minWidth:260}} options={readings.map((r,i)=>({value:i,label:`${r.cardRecord?.name||r.label} · ${count(r.amount)}`}))}/></div>:null}
  <div><Text type="secondary">{t('试算积分')}</Text><br/><InputNumber aria-label={t('试算积分')} min={0} precision={0} max={1000000000} step={1000} value={manual} placeholder={hidden||reading==null?t('输入积分数'):whole(reading.amount)} onChange={v=>setManual(v??null)} style={{width:180}}/></div>
 </Flex>
 {!readings.length?<Alert showIcon type="info" title={t('尚未读取这个计划的积分')} description={t('刷新对应银行后会显示读数；也可以先输入积分数试算。')} style={{marginBottom:16}}/>:readings.length>1?<Paragraph type="secondary">{t('多张卡的读数分别列出；共用积分池未确认，不合计。')}</Paragraph>:null}
 {reading?.historical&&manual==null?<Paragraph type="secondary">{t('历史记录；本次尚未取得更新读数。')}</Paragraph>:null}
 {programme.id.endsWith('-hk')?<Alert showIcon type="warning" title={t('香港只公开 Turbo 计划费率')} description={t('是否已登记 Turbo 未核实，未登记的费率须登录查看。把已有伙伴账号加入转点时，页面列明每次收取400港元行政费，部分卡种除外。')} style={{marginBottom:16}}/>:null}
 {programme.id.includes('ultimate')?<Alert showIcon type="warning" title={t('Chase 没有逐项公布比例')} description={t('Sapphire Preferred 页面只说多数伙伴1:1，没有逐项列明，因此这些伙伴不计算结果。World of Hyatt 的4:3只有 Sapphire Preferred 和 Ink Business Preferred 页面写明。')} style={{marginBottom:16}}/>:null}
 <Space orientation="vertical" size="large" style={{width:"100%"}}>
  {airlines.length?<div><Paragraph strong style={{marginBottom:8}}>{t('航空伙伴')}</Paragraph><PartnerTable rows={airlines} points={points} hidden={hidden&&manual==null}/></div>:null}
  {hotels.length?<div><Paragraph strong style={{marginBottom:8}}>{t('酒店伙伴')}</Paragraph><PartnerTable rows={hotels} points={points} hidden={hidden&&manual==null}/></div>:null}
 </Space>
 <Paragraph type="secondary" style={{marginTop:12,marginBottom:0}}>{t('来源（核对 {0}）：',[all[0]?.checkedAt||'—'])}<Space wrap size={[12,4]}>{sources.map(s=><Link key={s.id} href={s.url} target="_blank" rel="noreferrer">{t(s.title)}</Link>)}</Space></Paragraph></>;
}
export default function RewardsView({accounts,cards,count,hidden=false}){
 useI18n();const render=r=><Col xs={24} md={12} xl={8} key={r.id}><Card className="reward-card" title={<BankIdentity bank={r.bank} label={r.label} flag={false}/>} extra={<RegionLabel region={r.region}/>}><Statistic value={r.amount} formatter={()=>count(r.amount)} suffix={r.unit==='USD'?t('美元现金奖励'):r.unit}/>{r.cardReading?<><div style={{marginTop:16}}><CardIdentity card={cards.find(c=>c.id===r.card)}/></div><Paragraph type="secondary" style={{marginTop:8,marginBottom:8}}>{t('卡片页面读数；共用积分池关系未确认，不合计。')}</Paragraph><Tag color="success">{t('已读取积分')}</Tag></>:<Paragraph type="secondary" style={{marginTop:16}}>{t('历史记录；本次尚未取得更新读数。')}</Paragraph>}<Text type="secondary">{t('采集于 ')}{r.date}</Text></Card></Col>;
 const tabs=transferProgrammes.map(programme=>({key:programme.id,label:<Space size={6}><RegionFlag region={programme.region} decorative/><ItemLogo programme={programme.id} size={14}/>{t(programme.label)} · {t(programme.region==='US'?'美国':'香港')}</Space>,children:<ProgrammePanel programme={programme} accounts={accounts} cards={cards} count={count} hidden={hidden}/>}));
 return <><Paragraph type="secondary">{t('最新卡片读数优先展示。不同国家、不同计划分别列出；不推测或重复汇总积分池。')}</Paragraph><Row gutter={[20,20]}>{accounts.current.map(render)}</Row>{!accounts.current.length&&<Empty description={t('尚未读取积分，请刷新对应银行。')}/>} {!!accounts.historical.length&&<Collapse style={{marginTop:24}} items={[{key:'history',label:t('查看之前的积分记录'),children:<Row gutter={[16,16]}>{accounts.historical.map(r=>render({...r,historical:true}))}</Row>}]} />}
 <Typography.Title level={4} style={{marginTop:32}}>{t('积分能转到哪里')}</Typography.Title>
 <Alert showIcon type="info" title={t('转点前请看')} description={<ul style={{margin:0,paddingInlineStart:18}}><li>{t('转点通常不可撤销，到账后积分不能退回。')}</li><li>{t('共用积分池需要证据：这里不把多张卡的读数相加。')}</li><li>{t('结果只是按公布比例算出的数量，不代表每点价值，也不代表有可兑换的航班或房间。')}</li><li>{t('账号是否已关联、是否满足条件未核实；本页不会执行转点。')}</li></ul>} style={{marginBottom:16}}/>
 <Tabs items={tabs}/></>;
}
