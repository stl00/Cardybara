import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {Alert,App,Button,Card,Descriptions,Empty,Flex,List,Popconfirm,Space,Tag,Typography} from 'antd';
import {t,useI18n,formatNumber,formatDateTime} from './i18n';
import platform from './platform';
import {readAccount} from './accountClient.js';
import {createPlaidClient,readPlaidCache,PLAID_CHANGE_EVENT} from './plaidClient.js';
import {issuerOf,purchaseApr} from './plaidCards.js';
const {Text,Paragraph}=Typography;

// US credit cards linked through Plaid (PLAID_PLAN.md), in the extension and the PWA (owner 2026-11-17), for any signed-in
// account. The gateway hosts Plaid Link; here we only open its page (a tab in the extension, this window in the PWA, which
// the Link page sends back), then read the card list back when the wallet is shown again (no polling). Without Plaid on
// the gateway (plaid_unavailable) the panel only says so; when the plan's connection slots are used up (plaid_limit) it
// keeps the linked cards and Sync but offers no new link.
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
const money=(v,currency)=>v==null?t('未知'):formatNumber(v,{style:'currency',currency:currency||'USD'});

export default function PlaidCards({gateway}){
 useI18n();const {message:toast}=App.useApp();
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
 const itemOf=id=>view.items.find(i=>i.itemId===id);
 const unavailable=err==='plaid_unavailable',full=err==='plaid_limit';
 return <Card className="plaid-cards" style={{marginBottom:20}} title={t('通过 Plaid 连接的美国信用卡')}>
  {/* The actions sit in the body, not the title bar, so a phone-width title is not cut off. */}
  {signedIn&&!unavailable&&<Space wrap style={{marginBottom:12}}>
  <Button type="primary" onClick={()=>open()} loading={busy==='link'} disabled={full}>{t('添加信用卡')}</Button>
  {view.items.length>0&&<Button onClick={refresh} loading={busy==='refresh'}>{t('同步')}</Button>}</Space>}
  {!signedIn?<Paragraph type="secondary">{t('在设置里登录卡疲扒拉账号后，可以通过 Plaid 添加美国信用卡，自动读取余额、账单金额、最低还款、还款日和 APR。')}</Paragraph>:<>
  <Paragraph type="secondary">{t('只读：卡疲扒拉不能动钱。银行密码只交给银行和 Plaid；连接可以随时断开。')}</Paragraph>
  {err&&<Alert type={unavailable?'info':'warning'} showIcon title={errorText(err)} style={{marginBottom:12}}/>}
  {view.items.filter(i=>['login_required','pending_disconnect'].includes(i.status)).map(i=><Alert key={i.itemId} type="warning" showIcon style={{marginBottom:12}}
   title={t('{0} 需要重新登录才能继续同步。',[i.institution||t('这家银行')])} action={<Button size="small" loading={busy==='repair:'+i.itemId} onClick={()=>open(i.itemId)}>{t('重新连接')}</Button>}/>)}
  {view.items.some(i=>i.status==='ok'&&!i.historicalComplete)&&<Paragraph type="secondary">{t('还在导入历史交易，稍后点「同步」查看。')}</Paragraph>}
  {view.cards.length===0?<Empty description={view.items.length?t('还没有读到信用卡数据，稍后点「同步」。'):t('还没有连接信用卡。')}/>:
  <List dataSource={view.cards} rowKey="accountId" renderItem={c=>{const item=itemOf(c.itemId),apr=purchaseApr(c);return <List.Item>
   <Flex vertical gap={8} style={{width:'100%'}}>
    <Flex justify="space-between" align="center" wrap gap={8}><Text strong>{c.name||c.officialName||t('信用卡')}{c.mask&&` ••${c.mask}`}</Text>
     <Space size={4} wrap><Text type="secondary">{c.institution}</Text>{item&&statusTag(item.status)}{!issuerOf(c.institution)&&<Tag>{t('仅在此处显示')}</Tag>}{c.isOverdue&&<Tag color="error">{t('已逾期')}</Tag>}</Space></Flex>
    <Descriptions size="small" column={{xs:1,sm:2,md:3}} items={[
     {key:'due',label:t('到期还款日'),children:c.dueDate||t('未知')},
     {key:'statement',label:t('账单金额'),children:money(c.statementBalance,c.currency)},
     {key:'minimum',label:t('最低还款'),children:money(c.minimumPayment,c.currency)},
     {key:'balance',label:t('当前余额'),children:money(c.balance,c.currency)},
     {key:'limit',label:t('信用额度'),children:money(c.limit,c.currency)},
     {key:'apr',label:t('购物 APR'),children:apr==null?t('未知'):formatNumber(apr/100,{style:'percent',maximumFractionDigits:2})},
     ...(c.statementDate?[{key:'statementDate',label:t('账单日'),children:c.statementDate}]:[]),
    ]}/>
    <Flex justify="space-between" align="center" wrap gap={8}><Text type="secondary">{c.readAt?t('读取于 {0}',[formatDateTime(c.readAt*1000,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})]):''}</Text>
     <Popconfirm title={t('断开这个连接？')} description={t('这家银行的所有卡都会停止同步，已同步的数据从服务器删除。')} okText={t('断开')} cancelText={t('取消')} onConfirm={()=>remove(c.itemId)}>
      <Button size="small" type="link" danger loading={busy==='remove:'+c.itemId}>{t('断开')}</Button></Popconfirm></Flex>
   </Flex></List.Item>;}}/>}
  </>}
 </Card>;
}
