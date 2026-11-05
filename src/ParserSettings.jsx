import React,{useEffect,useState} from 'react';
import {Alert,Button,Card,Checkbox,Flex,Space,Switch,Tag,Typography} from 'antd';
import {t,useI18n} from './i18n';
import ModelKeySettings from './ModelKeySettings';
import {autoSuggestOn,setAutoSuggest} from './CardProductPicker.jsx';
const {Paragraph,Text}=Typography;
const internal=()=>location.protocol==='chrome-extension:'&&!!globalThis.chrome?.runtime?.id;
export default function ParserSettings(){
 useI18n();const [state,setState]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[consent,setConsent]=useState(false),[auto,setAuto]=useState(autoSuggestOn);
 const call=async(type,extra={})=>{const r=await chrome.runtime.sendMessage({type,...extra});if(!r?.ok)throw Error();setState(r.result);setConsent(!!r.result.settings?.cloudConsent);return r.result;};
 const action=async fn=>{setBusy(true);setError('');try{await fn()}catch{setError(internal()?t('暂时读不到 AI 设置，请稍后重试。'):t('未连接到本机解析服务，请确认本机调试服务已启动。'))}finally{setBusy(false)}};
 const localStatus=async()=>{const r=await fetch('/api/parser/status');if(!r.ok)throw Error();setState(await r.json())};
 useEffect(()=>{void action(()=>internal()?call('parser-state'):localStatus())},[]);
 return <div className="parser-settings"><Card title={t('卡片与福利资料')}><Space wrap><Button onClick={()=>location.hash='guide'}>{t('查看完整福利资料')}</Button><Button onClick={()=>location.hash='catalog'}>{t('卡片资料库')}</Button></Space></Card><Card title={t('银行刷新')}><Paragraph>{t('MVP 刷新只读取积分、余额、账单、最低还款与还款日。优惠、福利和交易不参与本轮刷新。')}</Paragraph><Paragraph type="secondary">{t('需要登录时在银行官网完成；未读取到的字段保留原值与原日期。')}</Paragraph></Card>
 <ModelKeySettings/>
 {!internal()&&<Card title={t('可选 AI 解析')} extra={<Tag color={state?.configured?'success':'default'}>{state?.configured?t('已连接'):t('未连接')}</Tag>}>
 <Paragraph>{t('本页由本机调试服务提供，AI 使用服务端 .env.local 里的配置。')}</Paragraph><Text code>{location.origin}</Text>
 {error&&<Alert showIcon type="warning" title={error} style={{marginTop:16}}/>}
 <Space wrap style={{marginTop:16}}><Button loading={busy} onClick={()=>action(localStatus)}>{t('检查连接')}</Button>{state?.model&&<Text type="secondary">{state.model}</Text>}</Space>
 </Card>}{internal()&&<Card title={t('自动补全银行数据')}>
 <Checkbox checked={consent} disabled={!internal()||busy} onChange={e=>setConsent(e.target.checked)}>{t('允许刷新时，将脱敏后的金额、积分和账单片段直接发送给 DeepSeek 解析。')}</Checkbox>
 <Flex align="center" gap={12} wrap style={{marginTop:20}}><Switch checked={!!state?.settings?.enabled} disabled={!internal()||busy||!state?.configured||!consent} onChange={enabled=>action(()=>call('parser-config',{enabled,cloudConsent:consent}))}/><Text>{t('刷新时自动补全')}</Text></Flex>
 {!!state?.settings?.enabled&&!consent&&<Button style={{marginTop:16}} onClick={()=>action(()=>call('parser-config',{enabled:false,cloudConsent:false}))}>{t('停止使用云端解析')}</Button>}
 <Paragraph type="secondary" className="source-note">{t('不再需要分别启动金额读取与 AI 任务。同一轮进度会说明已更新、未找到、需要登录或服务离线；未找到不等于余额为零。')}</Paragraph>
 </Card>}<Card title={t('已归档的实验功能')}><Paragraph type="secondary">{t('此前的代码与历史记录均保留；MVP 默认不刷新这些数据。')}</Paragraph><Space wrap>{[['offers','卡片优惠'],['benefits','福利进度'],['transactions','交易记录']].map(([key,label])=><Button key={key} onClick={()=>location.hash=key}>{t(label)}</Button>)}</Space></Card></div>
}
