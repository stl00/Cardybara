import React,{useEffect,useMemo,useState} from 'react';
import {Alert,App,Button,Card,Divider,Flex,Input,Modal,Segmented,Switch,Typography} from 'antd';
import {t,useI18n} from './i18n';
import platform from './platform';
import {maskEmail,syncState,SYNC_CHANGE_EVENT,SYNC_STATUS_EVENT,createAccountClient,emailLooksValid,passwordLongEnough,PASSWORD_MIN,readAccount,setSync,syncIsOn} from './accountClient.js';
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
 passkey_invalid:t('这个通行密钥不能用了。请用邮箱和密码登录。'),
 challenge_expired:t('验证超时了，请再试一次。'),
 passkey_unavailable:t('通行密钥暂时不可用，请用邮箱和密码登录。'),
 cancelled:t('已取消。'),
 too_large:t('钱包太大，无法同步。'),
})[code]||t('出错了，请稍后再试。');
const syncText=s=>({syncing:t('正在同步…'),synced:t('已同步'),offline:t('离线：恢复网络后会自动同步。'),signed_out:t('登录已失效，请重新登录。'),newer:t('另一台设备用了更新版本。请重新加载页面更新。'),error:t('同步没有成功，稍后会重试。')})[s]||null;

// Server-side rendering (tests) has no localStorage; the screens then read as signed out.
const noStore={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const store=()=>typeof localStorage==='undefined'?noStore:localStorage;
const field={style:{minHeight:44},maxLength:1024};
// All account state and actions, shared by the Settings card and the header entry (#500) so the sign-in flows exist once.
// `active:false` holds back the passkey probe (a gateway request) until the header's sheet or menu is opened.
export function useAccountFlow(gateway,{active=true}={}){
 useI18n();const {message:toast}=App.useApp();
 const client=useMemo(()=>createAccountClient({gateway,storage:store(),mirror:platform.account?.mirror,webSignIn:platform.account?.passkeySignIn}),[gateway]);
 const [account,setAccount]=useState(()=>readAccount(store()));
 const [on,setOn]=useState(()=>syncIsOn(store()));
 const [status,setStatus]=useState(null);
 const [mode,setMode]=useState('signin');
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState('');
 const [err,setErr]=useState(null),[note,setNote]=useState(null),[busy,setBusy]=useState(false);
 const [pw,setPw]=useState(false),[cur,setCur]=useState(''),[next,setNext]=useState('');
 const [del,setDel]=useState(false),[delPw,setDelPw]=useState('');
 const [pkOk,setPkOk]=useState(false),[pks,setPks]=useState([]);
 useEffect(()=>{const h=e=>setStatus(e.detail);window.addEventListener(SYNC_STATUS_EVENT,h);return()=>window.removeEventListener(SYNC_STATUS_EVENT,h);},[]);
 // The header entry and the Settings card are two views of one account: a sign-in, sign-out, delete or sync switch anywhere re-reads the stored state here.
 useEffect(()=>{const h=()=>{const a=readAccount(store());setAccount(a);setOn(syncIsOn(store()));if(!a)setStatus(null);};window.addEventListener(SYNC_CHANGE_EVENT,h);return()=>window.removeEventListener(SYNC_CHANGE_EVENT,h);},[]);

 // Passkeys: the controls appear only when the browser and the gateway both support them; email and password stay the fallback.
 useEffect(()=>{if(!active)return;let live=true;client.passkeysAvailable().then(v=>live&&setPkOk(v)).catch(()=>{});return()=>{live=false;};},[client,active]);
 useEffect(()=>{if(!pkOk||!account)return;let live=true;client.listPasskeys().then(r=>live&&r.ok&&setPks(r.passkeys));return()=>{live=false;};},[client,pkOk,account]);
 useEffect(()=>{
  if(!active||!pkOk||account||mode!=='signin'||platform.account?.passkeySignIn)return;
  const ac=new AbortController();
  client.signInWithPasskey({conditional:true,signal:ac.signal}).then(r=>{if(r.ok){setAccount(readAccount(store()));setOn(false);setStatus(null);toast.success(t('已登录。'));}}).catch(()=>{});
  return()=>ac.abort();
 },[client,pkOk,account,mode,active]);
 const fail=r=>setErr(errorText(r.code,r.retryAfter));
 const go=m=>{setMode(m);setErr(null);setNote(null);setCode('');setPassword('');};
 const run=async fn=>{setBusy(true);setErr(null);try{try{await platform.account?.allow(gateway);}catch{/* without the permission the request itself fails and says so */}await fn();}finally{setBusy(false);}};
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
 const passkeySignIn=()=>run(async()=>{const r=await client.signInWithPasskey();if(r.ok)return signedIn(r);if(r.code!=='cancelled')fail(r);});
 const addPk=()=>run(async()=>{
  const r=await client.addPasskey(t('通行密钥'));
  if(!r.ok){if(r.code!=='cancelled')fail(r);return;}
  const l=await client.listPasskeys();if(l.ok)setPks(l.passkeys);
  toast.success(t('已添加通行密钥。'));
 });
 const removePk=id=>run(async()=>{const r=await client.removePasskey(id);if(!r.ok)return fail(r);setPks(p=>p.filter(x=>x.id!==id));toast.success(t('已移除通行密钥。'));});
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

 return {client,toast,account,on,status,mode,email,setEmail,password,setPassword,code,setCode,err,setErr,note,busy,pw,setPw,cur,setCur,next,setNext,del,setDel,delPw,setDelPw,pkOk,pks,go,signUp,signIn,verify,forgot,reset,passkeySignIn,addPk,removePk,signOut,toggle,changePw,remove};
}
function SyncSwitch({f,compact=false}){
 const {on,status,toggle}=f;
 return <div>
  <label className="account-sync-switch"><Switch aria-label={t('在设备间同步钱包')} checked={on} onChange={toggle}/><Text strong>{t('在设备间同步钱包')}</Text></label>
  {!compact&&<Paragraph type="secondary" style={{marginTop:8,marginBottom:0}}>{on?t('钱包的一份副本存在 Cardybara 服务器上，同一账号的其他设备会合并成同一个钱包。关闭后不再同步，服务器上的副本保留，直到你删除账号。'):t('默认关闭。开启后，钱包的一份副本会存到 Cardybara 服务器，并在登录同一账号的设备间合并。不含银行密码或登录信息。')}</Paragraph>}
  {on&&syncText(status)&&<Text className="account-sync-status" type={status==='error'||status==='signed_out'?'danger':'secondary'}>{syncText(status)}</Text>}
 </div>;
}
function PasskeyList({f,compact=false}){
 const {pkOk,pks,busy,removePk,addPk}=f;
 if(!pkOk||platform.account?.passkeySignIn)return null;
 return <div className="account-passkeys">
  <Text strong>{t('通行密钥')}</Text>
  {!compact&&<Paragraph type="secondary" style={{margin:'4px 0 8px'}}>{t('用指纹、面容或设备锁登录。邮箱和密码仍然可用，丢了通行密钥也不会被锁在外面。')}</Paragraph>}
  {pks.map(k=><Flex key={k.id} gap={8} align="center" justify="space-between" wrap style={{marginBottom:8}}><Text>{k.name||t('通行密钥')}</Text><Button size="small" style={{minHeight:44}} loading={busy} onClick={()=>removePk(k.id)}>{t('移除')}</Button></Flex>)}
  <Button loading={busy} onClick={addPk}>{t('添加通行密钥')}</Button>
 </div>;
}
export function SignedOutForm({f,sheet=false}){
 const {mode,go,note,err,email,setEmail,password,setPassword,code,setCode,busy,pkOk,verify,forgot,reset,signUp,signIn,passkeySignIn}=f;
 const alerts=<>{note&&<Alert type="info" showIcon title={note} style={{marginBottom:12}}/>}{err&&<Alert type="error" showIcon title={err} role="alert" style={{marginBottom:12}}/>}</>;
 const emailInput=<Input {...field} type="email" inputMode="email" autoComplete={pkOk&&mode==='signin'?'username webauthn':'email'} aria-label={t('邮箱')} placeholder={t('邮箱')} value={email} onChange={e=>setEmail(e.target.value)}/>;
 const pwInput=(label,value,set,auto)=><Input.Password {...field} aria-label={label} placeholder={label} autoComplete={auto} value={value} onChange={e=>set(e.target.value)}/>;
 const codeInput=<Input {...field} maxLength={6} inputMode="numeric" autoComplete="one-time-code" aria-label={t('6 位验证码')} placeholder={t('6 位验证码')} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/>;
 const link=(label,m)=><Button type="link" style={{padding:'0 4px',minHeight:44}} onClick={()=>go(m)}>{label}</Button>;
 if(mode==='code')return <Flex vertical gap={12}>{alerts}{codeInput}<Button type="primary" loading={busy} disabled={code.length!==6} onClick={verify}>{t('验证并登录')}</Button><Flex wrap>{link(t('重新发送验证码'),'signup')}{link(t('返回'),'signin')}</Flex></Flex>;
 if(mode==='forgot')return <Flex vertical gap={12}>{alerts}<Paragraph type="secondary" style={{marginBottom:0}}>{t('输入注册邮箱，我们会发一个验证码来设置新密码。')}</Paragraph>{emailInput}<Button type="primary" loading={busy} onClick={forgot}>{t('发送验证码')}</Button>{link(t('返回'),'signin')}</Flex>;
 if(mode==='reset')return <Flex vertical gap={12}>{alerts}{codeInput}{pwInput(t('新密码（至少 {0} 个字符）',[PASSWORD_MIN]),password,setPassword,'new-password')}<Button type="primary" loading={busy} disabled={code.length!==6} onClick={reset}>{t('设置新密码并登录')}</Button>{link(t('返回'),'signin')}</Flex>;
 const up=mode==='signup',pkFirst=sheet&&pkOk&&!up;
 return <Flex vertical gap={12}>
  {pkFirst&&<><Button type="primary" loading={busy} onClick={passkeySignIn} className="account-passkey-signin">{t('用通行密钥登录')}</Button><Divider plain style={{margin:'4px 0'}}>{t('或用邮箱')}</Divider></>}
  <Segmented block value={mode} onChange={go} options={[{value:'signin',label:t('登录')},{value:'signup',label:t('注册')}]} style={{minHeight:44}}/>
  {alerts}{emailInput}{pwInput(up?t('密码（至少 {0} 个字符）',[PASSWORD_MIN]):t('密码'),password,setPassword,up?'new-password':'current-password')}
  <Button type={pkFirst?'default':'primary'} loading={busy} onClick={up?signUp:signIn} className="account-email-submit">{up?t('注册并发送验证码'):t('登录')}</Button>
  {!up&&link(t('忘记密码'),'forgot')}
  {!sheet&&!up&&pkOk&&<Button loading={busy} onClick={passkeySignIn} className="account-passkey-signin">{t('用通行密钥登录')}</Button>}
 </Flex>;
}
/** The signed-in actions, used by the header's popover and bottom drawer. */
export function AccountMenu({f,onSettings}){
 const {account,busy,signOut}=f;
 return <Flex vertical gap={12} className="account-menu">
  <div><Text type="secondary">{t('已登录')}</Text><div className="account-email" style={{wordBreak:'break-all'}}><Text strong>{maskEmail(account?.email)||t('（邮箱未记录）')}</Text></div></div>
  <SyncSwitch f={f} compact/>
  <PasskeyList f={f} compact/>
  <Button onClick={onSettings}>{t('账号设置')}</Button>
  <Button loading={busy} onClick={signOut} data-action="sign-out">{t('退出登录')}</Button>
 </Flex>;
}
export default function AccountSettings({gateway}){
 const f=useAccountFlow(gateway);
 const {account,busy,err,setErr,pw,setPw,cur,setCur,next,setNext,del,setDel,delPw,setDelPw,note,changePw,signOut,remove}=f;
 const alerts=<>{note&&<Alert type="info" showIcon title={note} style={{marginBottom:12}}/>}{err&&<Alert type="error" showIcon title={err} role="alert" style={{marginBottom:12}}/>}</>;
 const pwInput=(label,value,set,auto)=><Input.Password {...field} aria-label={label} placeholder={label} autoComplete={auto} value={value} onChange={e=>set(e.target.value)}/>;
 let body;
 if(account){
  body=<Flex vertical gap={16}>
   <div><Text type="secondary">{t('已登录')}</Text><div className="account-email" style={{wordBreak:'break-all'}}><Text strong>{account.email||t('（邮箱未记录）')}</Text></div></div>
   <SyncSwitch f={f}/>
   <PasskeyList f={f}/>
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
 }else body=<SignedOutForm f={f}/>;
 return <Card className="account-settings" title={t('账号与同步')} style={{marginBottom:20}}>
  {!account&&<Paragraph type="secondary">{t('可选。不登录也能完整使用钱包，数据只在这个浏览器里。登录并开启同步后，才会把钱包副本存到服务器，在你的其他设备上使用。')}</Paragraph>}
  {body}
 </Card>;
}
