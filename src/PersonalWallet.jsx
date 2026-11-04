import {PortfolioMetrics,FeeTracker,CreditAmountModal} from './CostTrackingUI';
import ChatAdvisor from './ChatAdvisor';
import React,{createContext,useContext,useEffect,useState} from 'react';
import {Alert,Button,Card,Checkbox,Collapse,Dropdown,Empty,Flex,Input,InputNumber,Select,Space,Tag,Typography,App} from 'antd';
import EllipsisOutlined from '@ant-design/icons/es/icons/EllipsisOutlined';
import SearchOutlined from '@ant-design/icons/es/icons/SearchOutlined';
import {t,useI18n} from './i18n';
import {profileForCard,benefitPeriod,benefitSources} from './benefitRules';
import {creditTasks,taskStatus,reminderTasks,creditCalendar,walletDay} from './personalBenefits';
import {readBenefitEvents,appendBenefitEvent} from './personalStore';
import {creditView,isDone,ENDING_SOON_DAYS,SHORT_LIST,COMPACT_LIST} from './creditView';
import {creditCategoryLabel} from './creditCategories';
import {CardIdentity} from './Identity';
import ItemLogo from './ItemLogo';
const {Text,Paragraph,Title}=Typography;
const Personal=createContext(null);
function broadcast(){if(typeof BroadcastChannel!=='undefined'){const c=new BroadcastChannel('cardybara-personal');c.postMessage('changed');c.close();}}
export function PersonalProvider({children}){
 const [events,setEvents]=useState([]),[ready,setReady]=useState(false),[error,setError]=useState(''),[day,setDay]=useState(walletDay());
 useEffect(()=>{let alive=true;const load=()=>readBenefitEvents().then(rows=>{if(alive){setEvents(rows);setReady(true);setError('')}}).catch(()=>{if(alive)setError(t('无法保存福利标记，请先导出备份并检查浏览器存储。'))});load();window.addEventListener('cardybara-personal-change',load);const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('cardybara-personal'):null;if(channel)channel.onmessage=load;const timer=setInterval(()=>setDay(walletDay()),60000);return()=>{alive=false;window.removeEventListener('cardybara-personal-change',load);channel?.close();clearInterval(timer)}},[]);
 const mark=async(key,status,revisionId,details={})=>{try{await appendBenefitEvent(key,status,revisionId,details);setEvents(await readBenefitEvents());broadcast()}catch{setError(t('保存失败，刚才的标记没有生效。'));throw Error('save_failed')}};
 return <Personal.Provider value={{events,ready,error,mark,day}}>{children}</Personal.Provider>;
}
const cash=(n,c)=>`${({USD:'US$',HKD:'HK$',CAD:'CA$'})[c]||c} ${n.toLocaleString()}`;
function Sources({ids=[]}){return <Space wrap>{ids.filter(id=>benefitSources[id]).map(id=><a key={id} href={benefitSources[id].url} target="_blank" rel="noopener noreferrer">{t('查看官方条款')}</a>)}</Space>;}
export function WalletBenefitHint({card}){useI18n();const {day,events}=useContext(Personal);const p=profileForCard(card),tasks=creditTasks([card],day),pending=tasks.filter(task=>!['used','skipped'].includes(taskStatus(task,events))).length;if(p?.coverage==='variant-unconfirmed')return <Tag>{t('权益待确认')}</Tag>;return <Space wrap size={4} style={{marginTop:12}}>{tasks.length>0&&<Tag color={pending?'blue':'success'}>{pending?t('待处理 {0} 项 Credit',[pending]):t('本期 Credit 已清理')}</Tag>}{p?.benefits.filter(b=>!b.applicability&&(!b.validFrom||b.validFrom<=day)&&(!b.validThrough||b.validThrough>=day)&&(['lounge','hotel-service'].includes(b.category)||b.category==='membership'&&b.partner)).slice(0,1).map(b=><Tag key={b.id}><ItemLogo ruleId={b.knowledgeRuleId} size={12}/>{t(b.title)}</Tag>)}</Space>;}
function endText(days){
 if(days===0)return t('今天截止');
 if(days===1)return t('明天截止');
 return t('还有 {0} 天',[days]);
}
export function CreditManager({cards,compact=false,hidden=false}){
 useI18n();const {events,ready,error,mark,day}=useContext(Personal),{message}=App.useApp();const [filter,setFilter]=useState('todo'),[busy,setBusy]=useState(''),[expanded,setExpanded]=useState(false),[editingUsage,setEditingUsage]=useState(null),[month,setMonth]=useState(''),[category,setCategory]=useState('all'),[query,setQuery]=useState('');
 const chosen=month&&month!==day.slice(0,7)?new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10):day;
 const nameOf=id=>cards.find(c=>c.id===id)?.name||'';
 const textOf=task=>[task.title,t(task.title),task.condition,t(task.condition),nameOf(task.cardId),...(task.categories||[]).flatMap(id=>[creditCategoryLabel(id),t(creditCategoryLabel(id))])].join(' ');
 const tasks=creditTasks(cards,chosen),due=chosen===day?reminderTasks(tasks,events,day):[];
 const view=creditView(tasks,events,chosen,{state:filter,category:compact?'all':category,query:compact?'':query,textOf,live:chosen===day});
 const singleCard=cards.length===1,limit=expanded||view.filtered?Infinity:compact?COMPACT_LIST:SHORT_LIST,rows=view.rows.slice(0,limit),more=view.rows.length-rows.length;
 const latest=task=>events.filter(e=>e.key===task.key).sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id))[0];
 const change=async(task,status)=>{const previous=taskStatus(task,events),previousEvent=latest(task);setBusy(task.key);try{await mark(task.key,status,task.revisionId);message.open({key:'credit-change',type:'success',duration:6,content:<Space><span><ItemLogo ruleId={task.ruleId}/>{t(task.title)}</span> · {t('已更新')}<Button type="link" size="small" onClick={()=>mark(task.key,previous,task.revisionId,previousEvent?.usage?{usage:previousEvent.usage}:{}).then(()=>message.destroy('credit-change')).catch(()=>message.error(t('保存失败，刚才的标记没有生效。')))}>{t('撤销')}</Button></Space>})}catch{message.error(t('保存失败，刚才的标记没有生效。'))}finally{setBusy('')}};
 const calendar=()=>{const url=URL.createObjectURL(new Blob([creditCalendar(tasks,events)],{type:'text/calendar;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='cardybara-credit-reminders.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
 const row=({task,status,days,endingSoon})=>{
  const usage=latest(task),currentUsage=usage?.revisionId===task.revisionId?usage.usage:null,card=cards.find(c=>c.id===task.cardId),done=isDone(status),past=chosen!==day;
  const others=[{key:'amount',label:t(currentUsage?'修改金额':'记金额')},...(status!=='skipped'?[{key:'skipped',label:t('本期不用')}]:[]),...(!['unused','used','partial'].includes(status)?[{key:'unused',label:t('确认未用')}]:[])];
  return <div key={task.key} className="credit-row"><Flex justify="space-between" align="start" gap={12} wrap>
   <div className="credit-row-main"><Flex wrap align="center" gap={6}><ItemLogo ruleId={task.ruleId}/><Text strong>{t(task.title)}</Text><Tag>{t(({unknown:'待确认',unused:'尚未使用',partial:'已用一部分',used:'已用完',skipped:'本期不适用'})[status])}</Tag>{!done&&!past&&<Tag color={endingSoon?'warning':'default'}>{endText(days)}</Tag>}{task.requiresEnrollment!==false&&<Tag color="warning">{t('需核对登记')}</Tag>}</Flex>
    {!singleCard&&<div className="credit-row-card"><CardIdentity card={card}/></div>}
    <Text type="secondary" className="credit-row-facts">{t('公开上限 {0} · 本期至 {1}',[cash(task.limit,task.currency),task.period.end])}</Text>
    {currentUsage&&<Paragraph type="secondary" style={{fontSize:12,margin:'6px 0 0'}}>{t('累计已用 {0} · 实际价值 {1}',[hidden?'••••':cash(currentUsage.amount,currentUsage.currency),hidden?'••••':currentUsage.value==null?t('尚未估值'):cash(currentUsage.value,currentUsage.currency)])}</Paragraph>}
   </div>
   <Space wrap size={8}><Button size="small" loading={busy===task.key} disabled={!ready} type={done?'default':'primary'} onClick={()=>currentUsage&&!done?setEditingUsage({...task,fillFull:true}):change(task,done?'unknown':'used')}>{done?t('撤销'):t('已用完')}</Button>
    <Dropdown disabled={!ready||!!busy} trigger={['click']} menu={{items:others,onClick:({key})=>key==='amount'?setEditingUsage(task):change(task,key)}}><Button size="small" aria-label={t('更多操作')} icon={<EllipsisOutlined/>}/></Dropdown></Space>
  </Flex>{!compact&&<Collapse ghost size="small" items={[{key:'terms',label:t('使用条件与来源'),children:<><Paragraph>{t(task.condition)}</Paragraph><Sources ids={task.sourceIds}/></>}]}/>}</div>;
 };
 const headline=view.open.length?(view.ending.length?t('{0} 项 {1} 天内截止，共 {2} 项待处理',[view.ending.length,ENDING_SOON_DAYS,view.open.length]):t('{0} 项待处理',[view.open.length])):null;
 return <Card className="credit-manager" title={t(compact&&!singleCard&&view.ending.length?'快到期的福利':'本期 Credit')} style={{marginBottom:20}} extra={compact?(singleCard?(view.rows.length>COMPACT_LIST&&<Button type="link" onClick={()=>setExpanded(!expanded)}>{expanded?t('收起'):t('查看本卡全部')}</Button>):<Button type="link" onClick={()=>location.hash='credits'}>{t('查看全部')}</Button>):<Button onClick={calendar}>{t('添加本期日历提醒')}</Button>}>
 {error&&<Alert type="error" showIcon title={error}/>}
 {headline&&<Paragraph type="secondary">{headline} · {t('用完点一下；默认是待确认，不会替你猜已用或未用。')}</Paragraph>}
 {!!due.length&&<Alert type="warning" showIcon title={t('{0} 项临近本期截止，仍待你确认',[due.length])} style={{marginBottom:16}}/>}
 {!compact&&<div className="credit-filters">
  <Input size="middle" className="credit-search" allowClear prefix={<SearchOutlined/>} placeholder={t('搜索福利、商户或卡片')} aria-label={t('搜索福利')} value={query} onChange={e=>setQuery(e.target.value)}/>
  <Select aria-label={t('筛选 Credit')} value={filter} onChange={setFilter} options={[{value:'todo',label:t('待处理 {0}',[view.open.length])},{value:'done',label:t('已处理')},{value:'all',label:t('全部')}]}/>
  <Input type="month" aria-label={t('查看福利月份')} value={month||day.slice(0,7)} max={day.slice(0,7)} style={{width:155}} onChange={e=>{if(!e.target.value||e.target.value<=day.slice(0,7))setMonth(e.target.value)}}/>
  {view.categories.length>0&&<Flex wrap gap={6} className="credit-categories" role="group" aria-label={t('按用途筛选')}><Tag.CheckableTag checked={view.category==='all'} onChange={()=>setCategory('all')}>{t('全部用途')} {view.pool.length}</Tag.CheckableTag>{view.categories.map(c=><Tag.CheckableTag key={c.id} checked={view.category===c.id} onChange={()=>setCategory(view.category===c.id?'all':c.id)}><ItemLogo category={c.id} size={13}/>{t(c.label)} {c.count}</Tag.CheckableTag>)}</Flex>}
 </div>}
 {rows.map(row)}
 {more>0&&!(compact&&singleCard)&&<Flex justify="center"><Button type="link" onClick={()=>compact&&!singleCard?location.hash='credits':setExpanded(true)}>{t('查看其余 {0} 项',[more])}</Button></Flex>}
 {!compact&&expanded&&!view.filtered&&view.rows.length>SHORT_LIST&&<Flex justify="center"><Button type="link" onClick={()=>setExpanded(false)}>{t('收起')}</Button></Flex>}
 {!rows.length&&<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={!ready?t('正在读取你的福利标记…'):view.filtered?t('没有匹配的福利，请调整筛选条件'):t('本期已处理，或没有可确定周期的 Credit')}/>}
 {!compact&&<Paragraph type="secondary" style={{marginTop:16}}>{t('标记由你记录，可撤销；新周期重新确认。')} {t('这里是公开周期清单，不代表已登记或仍有余额。周年不明和版本未确认的福利在卡片详情中查看。钱包打开时显示临期提示；关闭后请用导出的本期日历提醒，后续周期需重新添加。')}</Paragraph>}
 <CreditAmountModal task={editingUsage} previous={editingUsage?latest(editingUsage):null} onClose={()=>setEditingUsage(null)} onSave={async v=>{const task=editingUsage;await mark(task.key,v.amount>=task.limit?'used':v.amount>0?'partial':'unused',task.revisionId,v.amount>0?{usage:{amount:v.amount,value:v.value??null,date:v.date,currency:task.currency,limit:task.limit,title:task.title}}:{});}}/>
 </Card>;
}
export const usePersonalMarks=()=>useContext(Personal);
export function PortfolioSummary({cards,hidden}){const {events}=useContext(Personal);return <PortfolioMetrics cards={cards} benefitEvents={events} hidden={hidden}/>;}
export function CardBenefitDetails({card,hidden=false}){
 useI18n();const {events}=useContext(Personal),p=profileForCard(card);if(!p)return <FeeTracker card={card} benefitEvents={events} hidden={hidden}/>;
 return <><FeeTracker card={card} benefitEvents={events} hidden={hidden}/><Title level={4}>{t('这张卡能用什么')}</Title><CreditManager cards={[card]} compact hidden={hidden}/><Collapse items={[{key:'all',label:t('查看全部福利与会籍'),children:<Space orientation="vertical" size={20} style={{width:'100%'}}>{p.benefits.map(b=><div key={b.id}><ItemLogo ruleId={b.knowledgeRuleId}/><Text strong>{t(b.title)}</Text><Paragraph type="secondary" style={{marginTop:5}}>{t(b.condition)}</Paragraph><Sources ids={b.sourceIds}/></div>)}</Space>},{key:'fees',label:t('年费与资料备注'),children:<><Paragraph>{t('公布主卡年费：{0}',[p.fees.primaryAnnual==null?t('未核实'):cash(p.fees.primaryAnnual,p.fees.currency)])}</Paragraph>{p.knowledgeGaps?.map(g=><Paragraph key={g}>{t(g)}</Paragraph>)}{p.changeNotes.map(n=><Paragraph key={n.text}>{t(n.text)}</Paragraph>)}<Sources ids={p.fees.sourceIds}/></>} ]}/></>;
}
export function WalletAdvisor({cards}){
 const {events,day}=useContext(Personal);return <ChatAdvisor cards={cards} events={events} day={day}/>;
}
