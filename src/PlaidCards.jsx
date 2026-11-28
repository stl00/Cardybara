import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {Alert,App,Button,Card,Descriptions,Empty,Flex,Select,Tag,Typography} from 'antd';
import {t,useI18n,formatNumber,formatDateTime} from './i18n';
import InfoTip from './InfoTip.jsx';
import MoreMenu from './MoreMenu.jsx';
import NudgeSlot from './NudgeSlot.jsx';
import platform from './platform';
import {readAccount} from './accountClient.js';
import {createPlaidClient,readPlaidCache,PLAID_CHANGE_EVENT} from './plaidClient.js';
import {plaidBank,purchaseApr,plaidWalletCard,readPlaidLinks,savePlaidLinks,withPlaidLink,isManualLink,canTakePlaid,setPlaidDismissed} from './plaidCards.js';
const {Text,Paragraph}=Typography;

// US credit cards linked through Plaid (PLAID_PLAN.md), in the extension and the PWA (owner 2026-11-17), for any signed-in
// account. The gateway hosts Plaid Link; here we only open its page (a tab in the extension, this window in the PWA, which
// the Link page sends back), then read the card list back when the wallet is shown again (no polling). Without Plaid on
// the gateway (plaid_unavailable) the panel only says so; when the plan's connection slots are used up (plaid_limit) it
// keeps the linked cards and Sync but offers no new link. Each card says which wallet card it fills (`pairs` from
// main.jsx's matchPlaidCards). main.jsx adds an unmatched card it can place to the wallet on its own (#535); one it cannot
// place, or one the user removed from the wallet, can be linked to a wallet card by hand or added to the wallet here.
// Layout (#679, quiet UI #682): grouped by connection, problems first; one compact row per card with one status tag; the full
// figures open under the row (a card that fills no wallet card starts open, it needs an answer); disconnect is in ⋯.
const noStore={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const store=()=>typeof localStorage==='undefined'?noStore:localStorage;
const errorText=code=>({
 offline:t('连不上服务器。检查网络后再试。'),
 unauthorized:t('登录已失效，请重新登录。'),
 plaid_unavailable:t('Plaid 连接服务还没开通，钱包照常使用。'),
 plaid_limit:t('Plaid 连接名额已用完，暂时不能添加新的银行连接。已连接的卡照常同步。'),
 account_unavailable:t('账号服务暂时不可用，钱包照常使用。'),
 plaid_error:t('Plaid 暂时没有回应，请稍后再试。'),
 item_not_found:t('这个连接已经不存在了。'),
})[code]||t('出错了，请稍后再试。');
const statusTag=s=>({ok:<Tag color="success">{t('已连接')}</Tag>,login_required:<Tag color="warning">{t('需要重新登录')}</Tag>,pending_disconnect:<Tag color="warning">{t('即将断开，请重新连接')}</Tag>,revoked:<Tag color="error">{t('已在银行撤销授权')}</Tag>,error:<Tag color="error">{t('连接出错')}</Tag>})[s]||<Tag>{s}</Tag>;
const broken=s=>['login_required','pending_disconnect'].includes(s);
// One tag per row, the most urgent fact: overdue, then the connection's problem, then connected.
const rowTag=(c,item)=>c.isOverdue?<Tag color="error">{t('已逾期')}</Tag>:item?statusTag(item.status):null;
const money=(v,currency)=>v==null?t('未知'):formatNumber(v,{style:'currency',currency:currency||'USD'});

export default function PlaidCards({gateway,walletCards=[],pairs=[],onAddCard}){
 useI18n();const {message:toast,modal}=App.useApp();
 const client=useMemo(()=>createPlaidClient({gateway,storage:store()}),[gateway]);
 const [view,setView]=useState(()=>readPlaidCache(store()));
 const [err,setErr]=useState(null),[busy,setBusy]=useState(null);
 const signedIn=!!readAccount(store());
 const load=useCallback(async()=>{const r=await client.cards();if(r.ok){setView(readPlaidCache(store()));setErr(null);}else if(r.code!=='offline')setErr(r.code);},[client]);
 useEffect(()=>{
  if(!signedIn||!platform.plaid)return;
  load();
  const sync=()=>setView(readPlaidCache(store()));
  // Back from the Link tab: read the list again (the gateway already ran the first sync when the link completed).
  const back=()=>{if(document.visibilityState==='visible')load();};
  window.addEventListener(PLAID_CHANGE_EVENT,sync);document.addEventListener('visibilitychange',back);
  return()=>{window.removeEventListener(PLAID_CHANGE_EVENT,sync);document.removeEventListener('visibilitychange',back);};
 },[signedIn,load]);
 if(!platform.plaid)return null;
 const run=async(key,fn)=>{setBusy(key);setErr(null);try{try{await platform.account?.allow(gateway);}catch{}await fn();}finally{setBusy(null);}};
 const open=itemId=>run(itemId?'repair:'+itemId:'link',async()=>{
  const r=await client.startLink(itemId);
  if(!r.ok)return setErr(r.code);
  await platform.plaid.open(r.url);
 });
 const refresh=()=>run('refresh',async()=>{const r=await client.refresh();if(!r.ok)return setErr(r.code);setView(readPlaidCache(store()));toast.success(t('已同步。'));});
 const remove=itemId=>run('remove:'+itemId,async()=>{const r=await client.remove(itemId);if(!r.ok)return setErr(r.code);setView(readPlaidCache(store()));toast.success(t('已断开这个连接。'));});
 const walletOf=c=>{const id=pairs.find(([,p])=>p.accountId===c.accountId)?.[0];return id?walletCards.find(w=>w.id===id)||null:null;};
 const cardLabel=w=>w.name+(w.tail?` ••${w.tail}`:'');
 const link=(c,cardId)=>{try{savePlaidLinks(store(),withPlaidLink(readPlaidLinks(store()),c,cardId));}catch{toast.error(t('这张卡缺少尾号信息，不能手动对应。'));}};
 const addToWallet=c=>{const spec=plaidWalletCard(c);if(!spec)return;try{onAddCard(spec);setPlaidDismissed(store(),c,false);}catch(e){toast.error(e?.message==='duplicate_card'?t('钱包里已经有同一发卡行、同一尾号的卡。'):t('添加失败，钱包没有变化。'));}};
 const walletRow=c=>{
  const w=walletOf(c);
  if(w)return <Flex align="center" wrap gap={8}><Text type="secondary">{t('对应钱包里的卡：{0}',[cardLabel(w)])}</Text>
   {isManualLink(readPlaidLinks(store()),c,w.id)&&<Button size="small" type="link" onClick={()=>link(c,null)}>{t('取消对应')}</Button>}</Flex>;
  const taken=new Set(pairs.map(([id])=>id)),bank=plaidBank(c);
  // Same issuer first; a card another Plaid card already fills, or one in another currency, is not offered.
  const options=walletCards.filter(x=>!taken.has(x.id)&&canTakePlaid(x,c)).sort((a,b)=>(b.bank===bank)-(a.bank===bank)).map(x=>({value:x.id,label:cardLabel(x)}));
  const spec=onAddCard?plaidWalletCard(c):null;
  return <Flex vertical gap={6}><Text type="secondary">{t('还没有对应到钱包里的卡，金额只在这里显示。')}</Text>
   <Flex wrap gap={8}>{options.length>0&&<Select size="small" style={{minWidth:200,maxWidth:'100%'}} placeholder={t('对应到钱包里的卡')} aria-label={t('对应到钱包里的卡')} options={options} onChange={id=>link(c,id)}/>}
    {spec&&<Button size="small" onClick={()=>addToWallet(c)}>{t('添加到钱包')}</Button>}</Flex></Flex>;
 };
 const unavailable=err==='plaid_unavailable',full=err==='plaid_limit';
 const confirmRemove=itemId=>modal.confirm({title:t('断开这个连接？'),content:t('这家银行的所有卡都会停止同步，已同步的数据从服务器删除。'),okText:t('断开'),okButtonProps:{danger:true},cancelText:t('取消'),onOk:()=>remove(itemId)});
 // One group per connection: the ones needing a login first, then the ones with an overdue card. A card whose connection is
 // not in the list still shows, under its own institution name.
 const groups=[...view.items,...[...new Set(view.cards.map(c=>c.itemId))].filter(id=>!view.items.some(i=>i.itemId===id)).map(id=>({itemId:id,institution:view.cards.find(c=>c.itemId===id).institution,status:null}))]
  .map(item=>({item,cards:view.cards.filter(c=>c.itemId===item.itemId).sort((a,b)=>!!b.isOverdue-!!a.isOverdue)}))
  .map(g=>({...g,rank:g.item.status&&g.item.status!=='ok'?0:g.cards.some(c=>c.isOverdue)?1:2})).sort((a,b)=>a.rank-b.rank);
 const row=(c,item)=>{const apr=purchaseApr(c);return <details key={c.accountId} className="plaid-row" open={!walletOf(c)}>
  <summary>
   <span className="plaid-row-main"><span className="plaid-row-name">{c.name||c.officialName||t('信用卡')}{c.mask&&` ••${c.mask}`}</span>
    <span className="plaid-row-figures">{t('到期还款日')} {c.dueDate||t('未知')} · {t('账单金额')} {money(c.statementBalance,c.currency)}</span></span>
   {rowTag(c,item)}
  </summary>
  <Flex vertical gap={8} className="plaid-row-detail">
   <Descriptions size="small" column={{xs:1,sm:2,md:3}} items={[
    {key:'due',label:t('到期还款日'),children:c.dueDate||t('未知')},
    {key:'statement',label:t('账单金额'),children:money(c.statementBalance,c.currency)},
    {key:'minimum',label:t('最低还款'),children:money(c.minimumPayment,c.currency)},
    {key:'balance',label:t('当前余额'),children:money(c.balance,c.currency)},
    {key:'limit',label:t('信用额度'),children:money(c.limit,c.currency)},
    {key:'apr',label:t('购物 APR'),children:apr==null?t('未知'):formatNumber(apr/100,{style:'percent',maximumFractionDigits:2})},
    ...(c.statementDate?[{key:'statementDate',label:t('账单日'),children:c.statementDate}]:[]),
   ]}/>
   {walletRow(c)}
   {!!c.readAt&&<Text type="secondary">{t('读取于 {0}',[formatDateTime(c.readAt*1000,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})])}</Text>}
  </Flex>
 </details>;};
 const nudges=[
  {kind:'error',key:'request',node:err&&<Alert type={unavailable?'info':'warning'} showIcon title={errorText(err)}/>},
  // One banner at a time; every broken connection also has Reconnect in its ⋯ menu.
  ...view.items.filter(i=>broken(i.status)).map(i=>({kind:'error',key:i.itemId,node:<Alert type="warning" showIcon
   title={t('{0} 需要重新登录才能继续同步。',[i.institution||t('这家银行')])} action={<Button size="small" loading={busy==='repair:'+i.itemId} onClick={()=>open(i.itemId)}>{t('重新连接')}</Button>}/>})),
 ];
 const actions=signedIn&&!unavailable;
 return <Card className="plaid-cards" style={{marginBottom:20}}
  title={<span className="settings-title">{t('已连接的卡')}<InfoTip title={<>{t('通过 Plaid 连接的美国信用卡')}<br/>{t('只读：卡疲扒拉不能动钱。银行密码只交给银行和 Plaid；连接可以随时断开。')}</>}/></span>}>
  {/* The actions sit in the body, not the title bar, so a phone-width title is not cut off. */}
  {actions&&<Flex gap={8} wrap style={{marginBottom:8}}>
   <Button type="primary" onClick={()=>open()} loading={busy==='link'} disabled={full}>{t('添加信用卡')}</Button>
   {view.items.length>0&&<Button onClick={refresh} loading={busy==='refresh'}>{t('同步')}</Button>}</Flex>}
  {!signedIn?<Paragraph type="secondary" style={{marginBottom:0}}>{t('在设置里登录卡疲扒拉账号后，可以通过 Plaid 添加美国信用卡，自动读取余额、账单金额、最低还款、还款日和 APR。')}</Paragraph>:<>
  <NudgeSlot nudges={nudges}/>
  {view.items.some(i=>i.status==='ok'&&!i.historicalComplete)&&<Paragraph type="secondary" style={{marginBottom:8}}>{t('还在导入历史交易，稍后点「同步」查看。')}</Paragraph>}
  {!groups.length?<Empty description={t('还没有连接信用卡。')}/>:groups.map(({item,cards})=><section key={item.itemId} className="plaid-group">
   <Flex justify="space-between" align="center" gap={8} className="plaid-group-head"><Text strong>{item.institution||t('这家银行')}</Text>
    <MoreMenu label={t('{0} 的更多操作',[item.institution||t('这家银行')])} disabled={busy==='remove:'+item.itemId}
     items={item.status&&[broken(item.status)&&{key:'repair',label:t('重新连接')},{key:'disconnect',label:t('断开'),danger:true}]}
     onClick={key=>key==='repair'?open(item.itemId):confirmRemove(item.itemId)}/></Flex>
   {cards.length?cards.map(c=>row(c,item.status?item:null)):<Flex justify="space-between" align="center" gap={8}><Text type="secondary">{t('还没有读到信用卡数据，稍后点「同步」。')}</Text>{statusTag(item.status)}</Flex>}
  </section>)}
  </>}
 </Card>;
}
