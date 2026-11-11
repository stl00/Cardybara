import React,{useEffect,useMemo,useState} from 'react';
import {App,Button,Card,Empty,InputNumber,Space,Table,Tag,Typography} from 'antd';
import {t,useI18n} from './i18n';
import ItemLogo from './ItemLogo';
import {RegionFlag} from './Identity';
import {cardEarnings} from './cardDecision.js';
import {walletDay} from './personalBenefits.js';
import {POINT_VALUES_KEY,MAX_CENTS,readPointValueOverrides,storedPointValues,valuationTable,walletValuations,withPointValue} from './pointValues.js';
const {Paragraph,Text,Link}=Typography;
const CHANGE='cardybara-point-values-change';
// #193: the user's own value per point, kept apart from the defaults so a reset brings the default back.
export function loadPointValues(){try{return readPointValueOverrides(localStorage)}catch{return []}}
export function savePointValues(values){localStorage.setItem(POINT_VALUES_KEY,JSON.stringify(storedPointValues(values)));window.dispatchEvent(new Event(CHANGE));}
export function usePointValues(){
 const [values,setValues]=useState(loadPointValues);
 useEffect(()=>{const load=()=>setValues(loadPointValues());const onStorage=e=>{if(e.key===POINT_VALUES_KEY)load();};window.addEventListener(CHANGE,load);window.addEventListener('storage',onStorage);return()=>{window.removeEventListener(CHANGE,load);window.removeEventListener('storage',onStorage)}},[]);
 return values;
}
const unitLabel=p=>p.currency==='HKD'?t('港仙'):t('美分');
export default function PointValueSettings({cards=[]}){
 useI18n();const {message}=App.useApp(),values=usePointValues();
 const day=walletDay(),rows=useMemo(()=>walletValuations(cards,values,c=>cardEarnings(c,day)),[cards,values,day]);
 const [draft,setDraft]=useState({});
 const save=(p,cents)=>{try{savePointValues(withPointValue(loadPointValues(),p.id,cents));setDraft(d=>({...d,[p.id]:undefined}));}catch{message.error(t('估值需大于 0 且不超过 {0}。',[MAX_CENTS]));}};
 const columns=[
  {title:t('计划'),render:(_,p)=><Space size={6}><RegionFlag region={p.region} decorative/><ItemLogo programme={p.knowledgeProgrammeId||undefined}/>{p.name}</Space>},
  {title:t('默认市场估值'),render:(_,p)=>p.cents==null?<Text type="secondary">{t('没有可靠的公开估值，未设默认')}</Text>:<><Text>{p.unit==='mile'?t('每里 {0} {1}',[p.cents,unitLabel(p)]):t('每点 {0} {1}',[p.cents,unitLabel(p)])}</Text><br/><Link href={p.source.url} target="_blank" rel="noreferrer" type="secondary">{p.source.name}</Link></>},
  {title:t('你的估值'),render:(_,p)=><Space.Compact><InputNumber aria-label={t('{0} 你的估值',[p.name])} min={0.01} max={MAX_CENTS} step={0.1} precision={4} value={draft[p.id]!==undefined?draft[p.id]:p.own} placeholder={p.cents!=null?String(p.cents):t('未估值')} onChange={v=>setDraft(d=>({...d,[p.id]:v}))} onPressEnter={()=>save(p,draft[p.id]??p.own)} style={{width:140}} suffix={unitLabel(p)}/><Button onClick={()=>save(p,draft[p.id]??p.own)} disabled={draft[p.id]===undefined}>{t('保存')}</Button></Space.Compact>},
  {title:t('比较时使用'),render:(_,p)=>p.own!=null?<Tag color="blue">{t('你的估值')}</Tag>:p.cents!=null?<Tag>{t('默认')}</Tag>:<Tag>{t('未估值')}</Tag>},
  {title:'',render:(_,p)=>p.own!=null?<Button size="small" onClick={()=>save(p,null)}>{t('恢复默认')}</Button>:null}
 ];
 return <Card title={t('积分估值')} style={{marginBottom:16}}>
  <Paragraph type="secondary">{t('比较现金返现、积分和里程时，每点按这里的价值计算：你设了估值就用你的，否则用默认市场估值。默认值取自公开的估值文章（核对于 {0}），只是参考，不代表实际兑换价值。估值按计划自己的货币计算，不跨货币比较。',[valuationTable.checkedAt])}</Paragraph>
  {rows.length?<Table size="small" rowKey="id" columns={columns} dataSource={rows} pagination={false} scroll={{x:720}}/>:<Empty description={t('钱包里的卡没有积分或里程计划。')}/>}
 </Card>;
}
