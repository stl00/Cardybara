import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import React,{useEffect,useRef,useState} from 'react';
import {Alert,Button,Tooltip,Typography,App} from 'antd';
import Bubble from '@ant-design/x/es/bubble';
import Sender from '@ant-design/x/es/sender';
import Welcome from '@ant-design/x/es/welcome';
import {ArrowUpOutlined,ArrowDownOutlined,PlusOutlined,StopOutlined,CopyOutlined,CheckOutlined,InfoCircleOutlined,ShopOutlined,CrownOutlined,GiftOutlined} from '@ant-design/icons';
import {useI18n,t} from './i18n';
import {runAgentTurn} from './agentSession';
import {requestAdvisor} from './advisorTransport';
const {Text}=Typography;
let session={history:[],turns:[]};
const strings={
 'zh-CN':{title:'用卡助手',sub:'聊聊这笔消费，或一起看看你的卡能做什么。',new:'新对话',input:'问问卡疲扒拉…',send:'发送',stop:'停止',intro:'你好，今天想怎么用你的卡？',examples:['在美国餐厅花100美元，用哪张卡？','我有哪些酒店福利和会籍？','本期有哪些 Credit 还待确认？'],notice:'由 DeepSeek 提供支持。对话及必要的卡名、公开权益和手动福利状态会发送给模型；不发送卡号或银行余额。对话仅保留在本次页面会话。',connecting:'正在连接…',thinking:'正在整理回答…',compare_cards:'正在比较你的卡…',find_benefits:'正在查找相关福利…',get_card_rules:'正在核对年费与转点规则…',query_credits:'正在核对 Credit…',list_cards:'正在查看持有卡片…',error:'这次没有完成，AI 服务可能暂时不可用。可以重试；你的钱包没有被修改。',retry:'重试',cancelled:'已停止，可以重新发送。',tools:'已查阅钱包资料',limit:'这段对话较长，请开启新对话继续。',disclaimer:'请核对商户分类、登记条件和官方条款；积分估值因人而异。'},
 'zh-TW':{title:'用卡助手',sub:'聊聊這筆消費，或一起看看你的卡能做什麼。',new:'新對話',input:'問問卡疲扒拉…',send:'傳送',stop:'停止',intro:'你好，今天想怎麼用你的卡？',examples:['在美國餐廳花100美元，用哪張卡？','我有哪些酒店福利和會籍？','本期有哪些 Credit 還待確認？'],notice:'由 DeepSeek 提供支援。對話及必要的卡名、公開權益和手動福利狀態會傳送給模型；不傳送卡號或銀行餘額。對話僅保留在本次頁面工作階段。',connecting:'正在連接…',thinking:'正在整理回答…',compare_cards:'正在比較你的卡…',find_benefits:'正在尋找相關福利…',get_card_rules:'正在核對年費與轉點規則…',query_credits:'正在核對 Credit…',list_cards:'正在查看持有卡片…',error:'這次未能完成，AI 服務可能暫時無法使用。可以重試；錢包沒有被修改。',retry:'重試',cancelled:'已停止，可以重新傳送。',tools:'已查閱錢包資料',limit:'這段對話較長，請開啟新對話繼續。',disclaimer:'請核對商戶分類、登記條件和官方條款；積分估值因人而異。'},
 'en-US':{title:'Card assistant',sub:'Talk through a purchase, or explore what your cards can do.',new:'New chat',input:'Ask Cardybara…',send:'Send',stop:'Stop',intro:'Hi! How can your cards help today?',examples:['Which card for a $100 restaurant bill in the US, paid in USD?','What hotel benefits and memberships do I have?','Which credits still need confirmation this cycle?'],notice:'Powered by DeepSeek. Chat and necessary card names, public benefits and manual benefit marks are sent to the model; card numbers and bank balances are excluded. Chat stays in this page session only.',connecting:'Connecting…',thinking:'Preparing your answer…',compare_cards:'Comparing your cards…',find_benefits:'Looking up benefits…',get_card_rules:'Checking fees and transfer rules…',query_credits:'Checking your credits…',list_cards:'Checking held cards…',error:'This turn could not finish. The AI service may be unavailable. Retry when ready; your wallet has not been changed.',retry:'Retry',cancelled:'Stopped. You can send again.',tools:'Wallet information consulted',limit:'This conversation is long. Start a new chat to continue.',disclaimer:'Check merchant category, enrollment requirements and official terms. Point values vary.'}
};
// Raw HTML and remote images are disabled; assistant text is never executed.
function ChatText({text}){return <div className="chat-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={url=>url.startsWith('https://')?url:''} components={{img:()=>null,a:({href,children})=>href?<a href={href} target="_blank" rel="noopener noreferrer">{children}</a>:<span>{children}</span>}}>{text}</Markdown></div>;}
export default function ChatAdvisor({cards,events,day}){
 const {language}=useI18n(),s=strings[language]||strings['zh-CN'],{message}=App.useApp();
 const ui=language==='en-US'?{copy:'Copy answer',copied:'Copied',copyFailed:'Copy unavailable',down:'Jump to latest',details:'Privacy and model',placeholder:'Message Cardybara',chips:['Choose a card','Hotel benefits','This cycle’s credits'],hint:'Enter to send · Shift + Enter for a new line',check:'Cardybara can make mistakes. Check important details.'}:language==='zh-TW'?{copy:'複製回答',copied:'已複製',copyFailed:'暫時無法複製',down:'回到最新訊息',details:'模型與隱私',placeholder:'傳訊息給卡疲扒拉',chips:['這筆刷哪張','酒店與會籍','本期 Credit'],hint:'Enter 傳送 · Shift + Enter 換行',check:'卡疲扒拉也可能出錯，重要資訊請核實。'}:{copy:'复制回答',copied:'已复制',copyFailed:'暂时无法复制',down:'回到最新消息',details:'模型与隐私',placeholder:'发消息给卡疲扒拉',chips:['这笔刷哪张','酒店与会籍','本期 Credit'],hint:'Enter 发送 · Shift + Enter 换行',check:'卡疲扒拉也可能出错，重要信息请核实。'};
 const [aiReady,setAiReady]=useState(null);
 useEffect(()=>{let alive=true;const probe=async()=>{try{let ready;if(location.protocol==='chrome-extension:'){const r=await chrome.runtime.sendMessage({type:'parser-state'});ready=r?.ok&&r.result?.configured===true;}else{const r=await fetch('/api/parser/status',{signal:AbortSignal.timeout(2500)});ready=r.ok&&(await r.json()).configured===true;}if(alive)setAiReady(!!ready);}catch{if(alive)setAiReady(false)}};void probe();return()=>{alive=false}},[]);
 const [turns,setTurns]=useState(session.turns),[question,setQuestion]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[failed,setFailed]=useState('');const controller=useRef(null),bottom=useRef(null),mounted=useRef(true),thread=useRef(null),follow=useRef(true),sender=useRef(null);const [away,setAway]=useState(false),[copied,setCopied]=useState(-1);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort()}},[]);
 const toLatest=()=>{follow.current=true;setAway(false);thread.current?.scrollTo({top:thread.current.scrollHeight,behavior:'smooth'})};
 useEffect(()=>{if(follow.current)thread.current?.scrollTo({top:thread.current.scrollHeight,behavior:'smooth'})},[turns,busy,progress]);
 const copy=async(text,index)=>{try{await navigator.clipboard.writeText(text);setCopied(index);setTimeout(()=>{if(mounted.current)setCopied(-1)},1800)}catch{message.warning(ui.copyFailed)}};
 const ask=async(value=question)=>{
  if(busy||!value.trim()||aiReady!==true)return;
  const q=value.trim();follow.current=true;setAway(false);setBusy(true);setQuestion('');setError('');setFailed('');setProgress(s.connecting);controller.current=new AbortController();
  setTurns([...session.turns,{role:'user',content:q}]);
  try{const result=await runAgentTurn({history:session.history,memory:session.memory||{},question:q,context:{cards,events,day},signal:controller.current.signal,onProgress:p=>{if(mounted.current)setProgress(s[p.name]||s[p.phase]||s.thinking)},request:async(payload,signal)=>{const base=location.protocol==='chrome-extension:'?'http://127.0.0.1:8766':'';return requestAdvisor(base,payload,AbortSignal.any([signal,AbortSignal.timeout(50000)]));}});
   if(!mounted.current)return;session={memory:result.memory,history:result.messages,turns:[...session.turns,{role:'user',content:q},{role:'assistant',content:result.answer,tools:result.tools}]};setTurns(session.turns);
  }catch(e){if(mounted.current){setTurns(session.turns);setError(e.name==='AbortError'?s.cancelled:e.message==='answer_not_grounded'?(language==='en-US'?'I could not verify this answer against wallet data. Try a more specific question.':language==='zh-TW'?'這次回答未通過資料核對，請換個更具體的問法。':'这次回答未通过资料核对，请换个更具体的问法。'):s.error);setFailed(q);setQuestion(q)}}finally{if(mounted.current){setBusy(false);setProgress('')}}
 };
 const empty=!turns.length&&!busy;
 const promptIcons=[<ShopOutlined/>,<CrownOutlined/>,<GiftOutlined/>];
 return <section className={'wallet-chat chat-x'+(empty?' is-empty':'')}>
 <header className="chat-header"><div className="chat-heading"><Text strong>{s.title}</Text><Tooltip title={s.notice}><Button type="text" size="small" className="chat-model" aria-label={ui.details}>DeepSeek <InfoCircleOutlined/></Button></Tooltip></div><Tooltip title={s.new}><Button type="text" icon={<PlusOutlined/>} disabled={busy} onClick={()=>{session={history:[],turns:[]};setTurns([]);setError('');setQuestion('');setFailed('');follow.current=true;setAway(false);sender.current?.focus()}}>{s.new}</Button></Tooltip></header>
 <div className="chat-body">{aiReady===false&&<Alert style={{margin:16}} type="info" showIcon title={t('聊天助手需要单独配置 AI 服务，银行规则读取不受影响。')} action={<Button onClick={()=>location.hash='settings'}>{t('设置 AI')}</Button>}/>}
 <div className="chat-thread" ref={thread} onScroll={()=>{const el=thread.current;const far=el.scrollHeight-el.scrollTop-el.clientHeight>100;follow.current=!far;setAway(far)}}>
 <div className="chat-flow" aria-live="polite">
 {empty&&<div className="chat-welcome"><Welcome variant="borderless" icon={<img src="/brand/zen.svg" alt="Cardybara" width="64" height="64"/>} title={s.intro}/></div>}
 {turns.map((m,i)=><Bubble key={i} className={'chat-bubble '+(m.role==='user'?'chat-bubble-user':'chat-bubble-assistant')} placement={m.role==='user'?'end':'start'} variant={m.role==='user'?'filled':'borderless'} shape="round" content={m.content} contentRender={text=><ChatText text={text}/>} styles={{content:m.role==='user'?{padding:'12px 18px',background:'var(--cb-fill-bubble)',borderRadius:22,maxWidth:'100%'}:{padding:0,background:'transparent'},body:{maxWidth:m.role==='user'?'85%':'100%',width:m.role==='user'?'auto':'100%'}}} footer={m.role==='assistant'?<div className="chat-message-actions"><Tooltip title={copied===i?ui.copied:ui.copy}><Button type="text" size="small" aria-label={copied===i?ui.copied:ui.copy} icon={copied===i?<CheckOutlined/>:<CopyOutlined/>} onClick={()=>copy(m.content,i)}/></Tooltip>{!!m.tools?.length&&<Tooltip title={[...new Set(m.tools)].map(n=>s[n]).join(' · ')}><span className="chat-tool-note"><CheckOutlined/> {s.tools}</span></Tooltip>}</div>:null}/>)}
 {busy&&<Bubble className="chat-bubble chat-bubble-assistant" variant="borderless" content={progress} loading loadingRender={()=><div className="chat-progress"><img src="/brand/zen.svg" alt="" width="24" height="24"/><span>{progress}</span><span className="chat-live-dot"/></div>} styles={{content:{padding:0,background:'transparent'}}}/>}
 <div ref={bottom}/>
 </div></div>
 <div className="chat-composer-area">{away&&<Tooltip title={ui.down}><Button className="chat-jump" shape="circle" aria-label={ui.down} icon={<ArrowDownOutlined/>} onClick={toLatest}/></Tooltip>}
 <div className="chat-compose">
 {error&&<Alert type="warning" showIcon title={error} action={failed&&<Button size="small" disabled={busy} onClick={()=>ask(failed)}>{s.retry}</Button>} style={{marginBottom:12}}/>}
 <Sender disabled={aiReady!==true} ref={sender} value={question} placeholder={ui.placeholder} loading={busy} onChange={value=>setQuestion(value.slice(0,4000))} onSubmit={value=>ask(value)} onCancel={()=>controller.current?.abort()} submitType="enter" autoSize={{minRows:2,maxRows:7}} suffix={false} footer={(_, {components:{SendButton,LoadingButton}})=><div className="chat-sender-footer"><Text type="secondary">{ui.hint}</Text>{busy?<LoadingButton aria-label={s.stop} title={s.stop} shape="circle" icon={<StopOutlined/>}/>:<SendButton aria-label={s.send} title={s.send} shape="circle" icon={<ArrowUpOutlined/>} disabled={aiReady!==true||!question.trim()}/>}</div>}/>
 <div className="chat-under-composer">{empty?<div className="chat-prompts">{s.examples.map((q,i)=><Button key={q} disabled={aiReady!==true} icon={promptIcons[i]} onClick={()=>ask(q)}>{ui.chips[i]}</Button>)}</div>:<Text type="secondary">{ui.check}</Text>}</div>
 </div></div>
 </div></section>;
}
