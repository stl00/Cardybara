import React,{useState,useEffect} from 'react';
import {Alert,Button,Card,Checkbox,Flex,Input,Select,Space,Table,Tag,Typography,Collapse,Empty} from 'antd';
import {t,useI18n} from './i18n';
import {BankIdentity} from './Identity';
import {MODELS} from '../extension-next/agent-core';
import {visibleConnections} from './walletRegistry.js';
const {Text,Paragraph}=Typography;
const ownExtension=()=>location.protocol==='chrome-extension:'&&!!globalThis.chrome?.runtime?.id;
const errors={needs_login:'请先在银行官网完成登录。',card_not_identified:'页面未显示已知卡片，请打开卡片详情。',no_financial_text:'当前页面没有找到可解析的财务内容。',document_changed:'银行页面已改变，请重新预览。',wrong_bank_page:'请选择该银行已登录的账户页。',agent_busy:'正在解析，请等待或停止任务。',preview_required:'请先预览当前银行页面。',model_permission_required:'请先授权模型服务连接。',model_auth_failed:'模型密钥无效或没有权限。',model_rate_limited:'模型服务限流，请稍后重试。',model_timeout:'模型响应超时，未更新钱包。',model_unavailable:'模型服务暂不可用。',model_parse_failed:'模型返回格式异常，未更新钱包。',model_output_too_large:'模型返回内容过多，未更新钱包。',invalid_model_output:'模型结果未通过校验。',empty_model_output:'模型没有返回解析结果。',step_limit:'已达到本轮五页限制，请重新开始。',no_next_page:'没有可继续读取的页面。',page_loading:'银行页面仍在加载，请稍后继续。',review_required:'请先核对解析结果。',agent_action_failed:'操作未完成，已保留钱包数据。'};
export default function AgentPanel({data,onApplied}){
 useI18n();const [provider,setProvider]=useState('deepseek'),[model,setModel]=useState(MODELS.deepseek.model),[key,setKey]=useState(''),[bank,setBank]=useState(()=>sessionStorage.getItem('cardybara-agent-bank')||'Amex HK'),[tabs,setTabs]=useState([]),[tabId,setTabId]=useState(),[state,setState]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[consent,setConsent]=useState(false),[indices,setIndices]=useState([]);
 const enabled=ownExtension();
 async function call(type,extra={}){const r=await chrome.runtime.sendMessage({type,...extra});if(!r?.ok)throw Error(r?.error||'agent_action_failed');return r.result;}
 const act=async fn=>{setBusy(true);setError('');try{await fn();}catch(e){setError(errors[e.message]||errors.agent_action_failed)}finally{setBusy(false)}};
 const receive=s=>{setState(s);setConsent(false);setIndices([])};
 useEffect(()=>{if(enabled)void act(async()=>{const s=await call('agent-state');receive(s);setProvider(s.provider);setModel(s.model)})},[]);
 useEffect(()=>{if(!enabled)return;void act(async()=>{const result=await call('agent-tabs',{bank});setTabs(result.tabs);setTabId(result.tabs.length===1?result.tabs[0].id:undefined)})},[bank]);
 useEffect(()=>{if(state?.status!=='running')return;const timer=setInterval(()=>{void call('agent-state').then(s=>{if(s.status!=='running')receive(s)}).catch(()=>{})},2000);return()=>clearInterval(timer)},[state?.status]);
 const selected=MODELS[provider];
 return <div className="agent-layout">
 {!enabled&&<Alert showIcon type="info" title={t('AI 助手在 Chrome 扩展内运行')} description={t('请安装独立钱包扩展，从扩展菜单打开钱包。此网页仅预览界面，不会发送银行数据或保存密钥。')} style={{marginBottom:20}} action={<Button href="/cardybara-extension-standalone.zip" download>{t('下载独立钱包扩展')}</Button>}/>}
 {error&&<Alert closable onClose={()=>setError('')} type="error" showIcon title={t(error)} style={{marginBottom:20}}/>}
 <Card title={t('1 · 连接解析模型')} extra={<Tag color={state?.configured?'success':'default'}>{state?.configured?t('本次会话已连接'):t('尚未配置')}</Tag>}>
 <div className="agent-controls"><label><Paragraph>{t('模型服务')}</Paragraph><Select style={{width:'100%'}} value={provider} disabled={!enabled||busy||state?.status==='running'} onChange={v=>{setProvider(v);setModel(MODELS[v].model)}} options={Object.entries(MODELS).map(([value,m])=>({value,label:m.label}))}/></label><label><Paragraph>{t('模型名称')}</Paragraph><Input value={model} disabled={!enabled||busy||state?.status==='running'} onChange={e=>setModel(e.target.value)}/></label></div>
 <Space.Compact style={{width:'100%',marginTop:16}}><Input.Password aria-label={t('模型 API 密钥')} placeholder={t('在此填写 API 密钥，不要发送到聊天')} autoComplete="off" value={key} disabled={!enabled||busy||state?.status==='running'} onChange={e=>setKey(e.target.value)}/><Button disabled={!enabled||!key||busy||state?.status==='running'} onClick={()=>{void act(async()=>{const granted=await chrome.permissions.request({origins:[selected.origin+'/*']});if(!granted)throw Error('model_permission_required');const s=await call('agent-config',{provider,model,key:key.trim()});setKey('');receive(s)})}}>{t('连接模型')}</Button></Space.Compact>
 <Paragraph type="secondary" className="source-note">{t('密钥只存于本次 Chrome 会话，不随钱包导出；重启浏览器后需重新填写。连接只保存配置，首次解析才会验证密钥。')}</Paragraph>
 {state?.configured&&<Button type="link" onClick={()=>act(async()=>receive(await call('agent-forget')))}>{t('移除会话密钥')}</Button>}
 </Card>
 <Card title={t('2 · 选择已登录的银行页面')}>
 <Space wrap><Select aria-label={t('选择银行')} style={{width:250}} value={bank} onChange={setBank} disabled={!enabled||busy||state?.status==='running'} options={visibleConnections(data).map(c=>({value:c.bank,label:<BankIdentity bank={c.bank}/>}))}/><Select aria-label={t('选择银行标签页')} style={{minWidth:260,maxWidth:'100%'}} value={tabId} placeholder={t('选择银行标签页')} disabled={!enabled||busy||state?.status==='running'} onChange={setTabId} options={tabs.map(tab=>({value:tab.id,label:`${tab.label} · #${tab.id}`}))}/><Button disabled={!enabled||busy} onClick={()=>act(async()=>{const s=await call('agent-tabs',{bank});setTabs(s.tabs);setTabId(s.tabs.length===1?s.tabs[0].id:undefined)})}>{t('重新查找页面')}</Button><Button disabled={!enabled||!tabId||busy||state?.status==='running'} onClick={()=>act(async()=>receive(await call('agent-preview',{bank,tabId,cards:data.cards.filter(c=>c.bank===bank).map(({id,bank,tail,currency})=>({id,bank,tail,currency}))})))}>{t('预览可读取内容')}</Button></Space>
 <Paragraph className="source-note" type="secondary">{t('先从“银行连接”打开官网并登录。助手只读取显示在页面上的内容，登录、认证与翻页加载由银行完成。')}</Paragraph>
 </Card>
 {state?.snapshot&&<Card title={t('3 · 检查并解析')} extra={<Tag>{t('本轮已读 {0} / 5 页',[state.steps||0])}</Tag>}>
 <Flex justify="space-between" wrap gap={8}><BankIdentity bank={state.bank}/><Button type="text" disabled={busy} onClick={()=>act(async()=>receive(await call('agent-clear')))}>{t('清除页面片段')}</Button></Flex><Paragraph type="secondary">{state.snapshot.page}</Paragraph>
 <Collapse items={[{key:'preview',label:t('查看将发送的页面片段（{0} 段）',[state.snapshot.blocks.length]),children:<div className="agent-evidence">{state.snapshot.blocks.map(b=><p key={b.id}>{b.id} · {b.text}</p>)}</div>}]}/>
 <Paragraph style={{marginTop:16}}>{t('解析服务会收到上述余额、积分、优惠或交易片段。已屏蔽可识别的长号码和邮箱；请检查片段中是否仍有不想分享的信息。')}</Paragraph>
 <Checkbox checked={consent} disabled={busy||state.status==='running'} onChange={e=>setConsent(e.target.checked)}>{t('允许将这些片段发送给 {0} 进行本次解析',[MODELS[state.provider||provider]?.label])}</Checkbox>
 <Flex gap={12} wrap style={{marginTop:16}}><Button type="primary" loading={state.status==='running'} disabled={!enabled||!state.configured||!consent||busy||!['preview','error'].includes(state.status)} onClick={()=>act(async()=>receive(await call('agent-run',{id:state.id})))}>{t('解析本页')}</Button><Button disabled={!enabled||!['running','preview','review','navigating','error'].includes(state.status)} onClick={async()=>{try{receive(await call('agent-cancel'))}catch{setError(errors.agent_action_failed)}}}>{t('停止本轮')}</Button></Flex>
 {state.error&&<Alert style={{marginTop:16}} showIcon type="warning" title={t(errors[state.error]||errors.agent_action_failed)}/>}
 {state.status==='interrupted'&&<Alert style={{marginTop:16}} showIcon type="warning" title={t('任务已中断，请重新预览。已保存的数据不受影响。')}/>}
 </Card>}
 {['review','saved'].includes(state?.status)&&<Card title={t('4 · 核对结果后保存')} extra={<Tag>{t('{0} 项可核对',[state.items.length])}</Tag>}>
 {!!state.rejected?.length&&<Alert showIcon type="warning" title={t('{0} 项结果未通过证据校验，已排除。',[state.rejected.length])} style={{marginBottom:16}}/>}
 <Table size="small" rowKey={r=>String(r._index)} dataSource={state.items.map((r,i)=>({...r,_index:i}))} rowSelection={state.status==='review'?{selectedRowKeys:indices.map(String),onChange:keys=>setIndices(keys.map(Number))}:undefined} pagination={{pageSize:8}} scroll={{x:750}} columns={[{title:t('类型'),dataIndex:'kind',width:90,render:v=>t(({card:'卡片',reward:'积分',offer:'优惠',transaction:'交易',benefit:'福利'})[v])},{title:t('卡片'),dataIndex:'cardId',width:140,render:id=>data.cards.find(c=>c.id===id)?.name},{title:t('项目'),render:(_,r)=>r.title||r.key,width:180},{title:t('数值'),render:(_,r)=>r.value===null?'—':`${r.value} ${r.currency}`,width:140},{title:t('页面证据'),dataIndex:'evidence',width:330}]}/>
 {state.status==='review'?<Button type="primary" disabled={!indices.length||busy} onClick={()=>act(async()=>{receive(await call('agent-apply',{id:state.id,indices}));onApplied()})}>{t('保存所选 {0} 项',[indices.length])}</Button>:<Tag color="success">{t('已保存到钱包')}</Tag>}
 {state.nextLinkId&&state.steps<5&&<div className="agent-next"><Text type="secondary">{t('建议继续读取：{0}',[state.snapshot.links.find(l=>l.id===state.nextLinkId)?.label])}</Text> <Button disabled={busy} onClick={()=>act(async()=>receive(await call('agent-next',{id:state.id})))}>{t('打开下一页')}</Button></div>}
 <Paragraph type="secondary" className="source-note">{t('模型结果不会自动覆盖钱包。请核对卡片归属、借贷符号、币种和积分池；共享积分按银行、地区和计划去重。')}</Paragraph>
 </Card>}
 {state?.status==='navigating'&&<Card><Paragraph>{t('已打开建议页面。等待银行加载完毕后，继续预览。')}</Paragraph><Button onClick={()=>act(async()=>receive(await call('agent-continue',{id:state.id})))}>{t('页面已加载，继续')}</Button></Card>}
 {!state?.snapshot&&<Empty description={t('选择银行页面，开始本轮采集')}/>}
 </div>
}
