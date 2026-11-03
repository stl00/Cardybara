import React from 'react';
import {Card,Row,Col,Statistic,Typography,Tag,Empty,Collapse} from 'antd';
import {t,useI18n} from './i18n';
import {BankIdentity,CardIdentity,RegionLabel} from './Identity';
const {Paragraph,Text}=Typography;
export default function RewardsView({accounts,cards,count}){
 useI18n();const render=r=><Col xs={24} md={12} xl={8} key={r.id}><Card className="reward-card" title={<BankIdentity bank={r.bank} label={r.label} flag={false}/>} extra={<RegionLabel region={r.region}/>}><Statistic value={r.amount} formatter={()=>count(r.amount)} suffix={r.unit==='USD'?t('美元现金奖励'):r.unit}/>{r.cardReading?<><div style={{marginTop:16}}><CardIdentity card={cards.find(c=>c.id===r.card)}/></div><Paragraph type="secondary" style={{marginTop:8,marginBottom:8}}>{t('卡片页面读数；共用积分池关系未确认，不合计。')}</Paragraph><Tag color="success">{t('已读取积分')}</Tag></>:<Paragraph type="secondary" style={{marginTop:16}}>{t('历史记录；本次尚未取得更新读数。')}</Paragraph>}<Text type="secondary">{t('采集于 ')}{r.date}</Text></Card></Col>;
 return <><Paragraph type="secondary">{t('最新卡片读数优先展示。不同国家、不同计划分别列出；不推测或重复汇总积分池。')}</Paragraph><Row gutter={[20,20]}>{accounts.current.map(render)}</Row>{!accounts.current.length&&<Empty description={t('尚未读取积分，请刷新对应银行。')}/>} {!!accounts.historical.length&&<Collapse style={{marginTop:24}} items={[{key:'history',label:t('查看之前的积分记录'),children:<Row gutter={[16,16]}>{accounts.historical.map(r=>render({...r,historical:true}))}</Row>}]} />}</>;
}
