import React,{useEffect,useMemo,useState} from 'react';
import {Alert,App,Button,Card,Flex,Input,Modal,Segmented,Switch,Typography} from 'antd';
import {t,useI18n} from './i18n';
import {SYNC_STATUS_EVENT,createAccountClient,emailLooksValid,passwordLongEnough,PASSWORD_MIN,readAccount,setSync,syncIsOn} from './accountClient.js';
const {Paragraph,Text}=Typography;

// Account and sync (stl00/Cardybara#415, epic #410): signed out is the default and the wallet works without any of this.
// Messages for each gateway error code; unknown codes get the generic one.
const errorText=(code,retryAfter)=>({
 offline:t('连不上服务器。检查网络后再试。'),
 bad_request:t('邮箱或输入的内容格式不对。'),
 weak_password:t('密码至少 {0} 个字符。',[PASSWORD_MIN]),
 code_invalid:t('验证码不对。重新输入，或重新获取一个。'),
 code_expired:t('验证码已过期。请重新获取。'),
 invalid_credentials:t('邮箱或密码不对。'),
 email_unverified:t('这个邮箱还没验证。'),
 account_locked:t('尝试次数太多，暂时锁定。{0} 分钟后再试。',[Math.max(1,Math.ceil((retryAfter||900)/60))]),
 too_many_codes:t('验证码发得太频繁了，稍后再试。'),
 mail_failed:t('验证邮件没发出去，稍后再试。'),
 account_unavailable:t('账号服务暂时不可用，钱包照常使用。'),
 unauthorized:t('登录已失效，请重新登录。'),
 too_large:t('钱包太大，无法同步。'),
})[code]||t('出错了，请稍后再试。');
const syncText=s=>({syncing:t('正在同步…'),synced:t('已同步'),offline:t('离线：恢复网络后会自动同步。'),signed_out:t('登录已失效，请重新登录。'),newer:t('另一台设备用了更新版本。请重新加载页面更新。'),error:t('同步没有成功，稍后会重试。')})[s]||null;

// Server-side rendering (tests) has no localStorage; the screens then read as signed out.
const noStore={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const store=()=>typeof localStorage==='undefined'?noStore:localStorage;
const field={style:{minHeight:44},maxLength:1024};
export default function AccountSettings({gateway}){
 useI18n();const {message:toast}=App.useApp();
 const client=useMemo(()=>createAccountClient({gateway,storage:store()}),[gateway]);
 const [account,setAccount]=useState(()=>readAccount(store()));
 const [on,setOn]=useState(()=>syncIsOn(store()));
 const [status,setStatus]=useState(null);
 const [mode,setMode]=useState('signin');
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState('');
 const [err,setErr]=useState(null),[note,setNote]=useState(null),[busy,setBusy]=useState(false);
 const [pw,setPw]=useState(false),[cur,setCur]=useState(''),[next,setNext]=useState('');
 const [del,setDel]=useState(false),[delPw,setDelPw]=useState('');
 useEffect(()=>{const h=e=>setStatus(e.detail);window.addEventListener(SYNC_STATUS_EVENT,h);return()=>window.removeEventListener(SYNC_STATUS_EVENT,h);},[]);

 const fail=r=>setErr(errorText(r.code,r.retryAfter));
 const go=m=>{setMode(m);setErr(null);setNote(null);setCode('');setPassword('');};
 const run=async fn=>{setBusy(true);setErr(null);try{await fn();}finally{setBusy(false);}};
 const signedIn=r=>{setAccount(readAccount(store()));setOn(false);setStatus(null);setEmail('');setPassword('');setCode('');setMode('signin');toast.success(t('已登录。'));};
 const checkEmail=()=>emailLooksValid(email)?true:(setErr(errorText('bad_request')),false);

 const signUp=()=>checkEmail()&&(passwordLongEnough(password)?run(async()=>{
  const r=await client.signUp(email,password);
  if(!r.ok)return fail(r);
  setMode('code');setNote(t('验证码已发到 {0}。10 分钟内有效。',[email.trim()]));
 }):setErr(errorText('weak_password')));
 const signIn=()=>checkEmail()&&run(async()=>{
  const r=await client.signIn(email,password);
  if(r.ok)return signedIn(r);
  if(r.code==='email_unverified'&&passwordLongEnough(password)){
   const s=await client.signUp(email,password);
   if(s.ok){setMode('code');setNote(t('这个邮箱还没验证，验证码已发到 {0}。',[email.trim()]));return;}
  }
  fail(r);
 });
 const verify=()=>run(async()=>{const r=await client.verify(email,code);r.ok?signedIn(r):fail(r);});
 const forgot=()=>checkEmail()&&run(async()=>{
  const r=await client.forgot(email);
  if(!r.ok)return fail(r);
  setMode('reset');setNote(t('如果这个邮箱有账号，验证码已发出。10 分钟内有效。'));
 });
 const reset=()=>passwordLongEnough(password)?run(async()=>{const r=await client.reset(email,code,password);r.ok?signedIn(r):fail(r);}):setErr(errorText('weak_password'));
 const signOut=()=>run(async()=>{await client.signOut();setAccount(null);setOn(false);setStatus(null);setPw(false);toast.success(t('已退出登录。这台设备上的钱包没有动。'));});
 const toggle=v=>{setSync(store(),v);setOn(v);setStatus(v?'syncing':null);};
 const changePw=()=>passwordLongEnough(next)?run(async()=>{
  const r=await client.changePassword(cur,next);
  if(!r.ok)return fail(r);
  setPw(false);setCur('');setNext('');toast.success(t('密码已修改，其他设备需要重新登录。'));
 }):setErr(errorText('weak_password'));
 const remove=()=>run(async()=>{
  const r=await client.deleteAccount(delPw);
  if(!r.ok&&r.code!=='unauthorized'){fail(r);return;}
  setDel(false);setDelPw('');setAccount(null);setOn(false);setStatus(null);
  toast.success(t('账号和服务器上的钱包副本已删除。这台设备上的钱包还在。'));
 });

 const alerts=<>{note&&<Alert type="info" showIcon title={note} style={{marginBottom:12}}/>}{err&&<Alert type="error" showIcon title={err} role="alert" style={{marginBottom:12}}/>}</>;
 const emailInput=<Input {...field} type="email" inputMode="email" autoComplete="email" aria-label={t('邮箱')} placeholder={t('邮箱')} value={email} onChange={e=>setEmail(e.target.value)}/>;
 const pwInput=(label,value,set,auto)=><Input.Password {...field} aria-label={label} placeholder={label} autoComplete={auto} value={value} onChange={e=>set(e.target.value)}/>;
 const codeInput=<Input {...field} maxLength={6} inputMode="numeric" autoComplete="one-time-code" aria-label={t('6 位验证码')} placeholder={t('6 位验证码')} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/>;
 const link=(label,m)=><Button type="link" style={{padding:'0 4px',minHeight:44}} onClick={()=>go(m)}>{label}</Button>;

 let body;
 if(account){
  body=<Flex vertical gap={16}>
   <div><Text type="secondary">{t('已登录')}</Text><div className="account-email" style={{wordBreak:'break-all'}}><Text strong>{account.email||t('（邮箱未记录）')}</Text></div></div>
   <div>
    <label className="account-sync-switch"><Switch aria-label={t('在设备间同步钱包')} checked={on} onChange={toggle}/><Text strong>{t('在设备间同步钱包')}</Text></label>
    <Paragraph type="secondary" style={{marginTop:8,marginBottom:0}}>{on?t('钱包的一份副本存在 Cardybara 服务器上，同一账号的其他设备会合并成同一个钱包。关闭后不再同步，服务器上的副本保留，直到你删除账号。'):t('默认关闭。开启后，钱包的一份副本会存到 Cardybara 服务器，并在登录同一账号的设备间合并。不含银行密码或登录信息。')}</Paragraph>
    {on&&syncText(status)&&<Text className="account-sync-status" type={status==='error'||status==='signed_out'?'danger':'secondary'}>{syncText(status)}</Text>}
   </div>
   {err&&!pw&&!del&&<Alert type="error" showIcon title={err} role="alert"/>}
   {pw?<Flex vertical gap={12} className="account-password">
    {alerts}{pwInput(t('当前密码'),cur,setCur,'current-password')}{pwInput(t('新密码（至少 {0} 个字符）',[PASSWORD_MIN]),next,setNext,'new-password')}
    <Flex gap={8} wrap><Button type="primary" loading={busy} onClick={changePw}>{t('修改密码')}</Button><Button onClick={()=>{setPw(false);setErr(null);}}>{t('取消')}</Button></Flex></Flex>
   :<Button onClick={()=>{setPw(true);setErr(null);}}>{t('修改密码')}</Button>}
   <Button loading={busy} onClick={signOut}>{t('退出登录')}</Button>
   <Paragraph type="secondary" style={{marginBottom:0}}>{t('退出登录只清除这台设备上的登录，钱包留在这里。')}</Paragraph>
   <Button danger onClick={()=>{setDel(true);setErr(null);}}>{t('删除账号')}</Button>
   <Modal open={del} title={t('删除账号')} onCancel={()=>{setDel(false);setErr(null);setDelPw('');}} destroyOnHidden
    footer={<Flex gap={8} justify="end" wrap><Button onClick={()=>{setDel(false);setErr(null);setDelPw('');}}>{t('取消')}</Button><Button danger type="primary" loading={busy} disabled={!delPw} onClick={remove}>{t('永久删除账号')}</Button></Flex>}>
    <Paragraph>{t('这会删除你的账号和服务器上的钱包副本，不能恢复。这台设备上的钱包不受影响，会留在这里。')}</Paragraph>
    {err&&<Alert type="error" showIcon title={err} role="alert" style={{marginBottom:12}}/>}
    {pwInput(t('输入密码确认'),delPw,setDelPw,'current-password')}
   </Modal>
  </Flex>;
 }else if(mode==='code'){
  body=<Flex vertical gap={12}>{alerts}{codeInput}<Button type="primary" loading={busy} disabled={code.length!==6} onClick={verify}>{t('验证并登录')}</Button><Flex wrap>{link(t('重新发送验证码'),'signup')}{link(t('返回'),'signin')}</Flex></Flex>;
 }else if(mode==='forgot'){
  body=<Flex vertical gap={12}>{alerts}<Paragraph type="secondary" style={{marginBottom:0}}>{t('输入注册邮箱，我们会发一个验证码来设置新密码。')}</Paragraph>{emailInput}<Button type="primary" loading={busy} onClick={forgot}>{t('发送验证码')}</Button>{link(t('返回'),'signin')}</Flex>;
 }else if(mode==='reset'){
  body=<Flex vertical gap={12}>{alerts}{codeInput}{pwInput(t('新密码（至少 {0} 个字符）',[PASSWORD_MIN]),password,setPassword,'new-password')}<Button type="primary" loading={busy} disabled={code.length!==6} onClick={reset}>{t('设置新密码并登录')}</Button>{link(t('返回'),'signin')}</Flex>;
 }else{
  const up=mode==='signup';
  body=<Flex vertical gap={12}>
   <Segmented block value={mode} onChange={go} options={[{value:'signin',label:t('登录')},{value:'signup',label:t('注册')}]} style={{minHeight:44}}/>
   {alerts}{emailInput}{pwInput(up?t('密码（至少 {0} 个字符）',[PASSWORD_MIN]):t('密码'),password,setPassword,up?'new-password':'current-password')}
   <Button type="primary" loading={busy} onClick={up?signUp:signIn}>{up?t('注册并发送验证码'):t('登录')}</Button>
   {!up&&link(t('忘记密码'),'forgot')}
  </Flex>;
 }
 return <Card className="account-settings" title={t('账号与同步')} style={{marginBottom:20}}>
  {!account&&<Paragraph type="secondary">{t('可选。不登录也能完整使用钱包，数据只在这个浏览器里。登录并开启同步后，才会把钱包副本存到服务器，在你的其他设备上使用。')}</Paragraph>}
  {body}
 </Card>;
}
