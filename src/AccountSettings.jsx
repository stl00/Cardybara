import React,{useEffect,useMemo,useState} from 'react';
import {Alert,App,Button,Card,Flex,Input,Modal,Segmented,Switch,Typography} from 'antd';
import {t,useI18n} from './i18n';
import platform from './platform';
import {CapybaraMark} from './NavIcon.jsx';
import {syncLine} from './syncStatus.js';
import InfoTip from './InfoTip.jsx';
import RightOutlined from '@ant-design/icons/es/icons/RightOutlined';
import {readSyncState} from './walletSync.js';
import {ACCOUNT_CHANGE_EVENT,SYNC_CHANGE_EVENT,SYNC_STATUS_EVENT,createAccountClient,emailLooksValid,passwordLongEnough,PASSWORD_MIN,readAccount,setSync,syncIsOn} from './accountClient.js';
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

// The sync line under the switch (#580): the time of the last finished sync instead of an endless "Syncing…", and a plain
// sentence when this device is signed in but not uploading. `when` is the time in the viewer's own locale.
const when=at=>new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(at));
const lineText=({kind,at})=>({
 off:()=>t('这台设备没有上传钱包，其他设备看不到它读到的银行数据。打开上面的开关即可。'),
 syncing:()=>t('正在同步…'),
 syncing_since:()=>t('正在同步…上次成功同步 {0}',[when(at)]),
 synced:()=>at!=null?t('已同步 · {0}',[when(at)]):t('已同步'),
 error:()=>at!=null?t('同步没有成功，稍后会重试。上次成功同步 {0}',[when(at)]):t('同步没有成功，稍后会重试。'),
 offline:()=>t('离线：恢复网络后会自动同步。'),
 signed_out:()=>t('登录已失效，请重新登录。'),
 newer:()=>t('另一台设备用了更新版本。请重新加载页面更新。'),
})[kind]();

// Server-side rendering (tests) has no localStorage; the screens then read as signed out.
const noStore={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const store=()=>typeof localStorage==='undefined'?noStore:localStorage;
const field={style:{minHeight:44},maxLength:1024};
// `sy•••@example.com`: enough to recognise the account in a header popover without showing the whole address.
export const maskEmail=email=>{const [user,domain]=String(email||'').split('@');if(!domain)return email||'';return user.slice(0,Math.min(2,Math.max(1,user.length-1)))+'•••@'+domain;};
// `variant="card"` is the full Settings card. `variant="sheet"` is the header's sign-in sheet / account popover (#500): the same
// flows and error texts, with the passkey first; signed in it shows only the status and a link to the account page (#679).
// `variant="row"` is the one summary row on Settings; it opens the account page, where the full card is.
// One state-dependent sentence under the sync switch (#600): when sync is off, the sentence that says it syncs must not show.
export const syncCopy=on=>on?t('你的钱包会在你登录的设备间同步。银行密码永远不会上传。'):t('同步已关闭，这台设备的钱包没有上传。再次登录会重新开启；也可以随时在这里打开。');
export default function AccountSettings({gateway,variant='card',onSettings}){
 const sheet=variant==='sheet',row=variant==='row';
 useI18n();const {message:toast}=App.useApp();
 const client=useMemo(()=>createAccountClient({gateway,storage:store(),mirror:platform.account?.mirror,webSignIn:platform.account?.passkeySignIn}),[gateway]);
 const [account,setAccount]=useState(()=>readAccount(store()));
 const [on,setOn]=useState(()=>syncIsOn(store()));
 const [status,setStatus]=useState(null);
 const [syncedAt,setSyncedAt]=useState(()=>readSyncState(store()).syncedAt??null);
 const [mode,setMode]=useState('signin');
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState('');
 const [err,setErr]=useState(null),[note,setNote]=useState(null),[busy,setBusy]=useState(false);
 const [pw,setPw]=useState(false),[cur,setCur]=useState(''),[next,setNext]=useState('');
 const [del,setDel]=useState(false),[delPw,setDelPw]=useState('');
 const [pkOk,setPkOk]=useState(false),[pks,setPks]=useState([]);
 useEffect(()=>{const h=e=>{setStatus(e.detail);setSyncedAt(readSyncState(store()).syncedAt??null);};window.addEventListener(SYNC_STATUS_EVENT,h);return()=>window.removeEventListener(SYNC_STATUS_EVENT,h);},[]);
 // Another view (the header or Settings) signed in or out, or turned sync on or off.
 useEffect(()=>{const a=()=>setAccount(readAccount(store())),o=()=>setOn(syncIsOn(store()));window.addEventListener(ACCOUNT_CHANGE_EVENT,a);window.addEventListener(SYNC_CHANGE_EVENT,o);return()=>{window.removeEventListener(ACCOUNT_CHANGE_EVENT,a);window.removeEventListener(SYNC_CHANGE_EVENT,o);};},[]);

 // Passkeys: the controls appear only when the browser and the gateway both support them; email and password stay the fallback.
 useEffect(()=>{if(row)return;let live=true;client.passkeysAvailable().then(v=>live&&setPkOk(v)).catch(()=>{});return()=>{live=false;};},[client]);
 useEffect(()=>{if(sheet||!pkOk||!account)return;let live=true;client.listPasskeys().then(r=>live&&r.ok&&setPks(r.passkeys));return()=>{live=false;};},[client,pkOk,account]);
 useEffect(()=>{
  if(sheet||!pkOk||account||mode!=='signin'||platform.account?.passkeySignIn)return;
  const ac=new AbortController();
  client.signInWithPasskey({conditional:true,signal:ac.signal}).then(r=>{if(r.ok){setAccount(readAccount(store()));setOn(true);setStatus('syncing');toast.success(t('已登录。'));}}).catch(()=>{});
  return()=>ac.abort();
 },[client,pkOk,account,mode]);
 const fail=r=>setErr(errorText(r.code,r.retryAfter));
 const go=m=>{setMode(m);setErr(null);setNote(null);setCode('');setPassword('');};
 const run=async fn=>{setBusy(true);setErr(null);try{try{await platform.account?.allow(gateway);}catch{/* without the permission the request itself fails and says so */}await fn();}finally{setBusy(false);}};
 const signedIn=r=>{setAccount(readAccount(store()));setOn(true);setStatus('syncing');setEmail('');setPassword('');setCode('');setMode('signin');toast.success(t('已登录。'));};
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
 const toggle=v=>{setSync(store(),v);setOn(v);setStatus(v?'syncing':null);setSyncedAt(readSyncState(store()).syncedAt??null);};
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
 const emailInput=<Input {...field} type="email" inputMode="email" autoComplete={pkOk&&mode==='signin'?'username webauthn':'email'} aria-label={t('邮箱')} placeholder={t('邮箱')} value={email} onChange={e=>setEmail(e.target.value)}/>;
 const pwInput=(label,value,set,auto)=><Input.Password {...field} aria-label={label} placeholder={label} autoComplete={auto} value={value} onChange={e=>set(e.target.value)}/>;
 const codeInput=<Input {...field} maxLength={6} inputMode="numeric" autoComplete="one-time-code" aria-label={t('6 位验证码')} placeholder={t('6 位验证码')} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/>;
 const link=(label,m)=><Button type="link" style={{padding:'0 4px',minHeight:44}} onClick={()=>go(m)}>{label}</Button>;

 let body;
 if(row){
  const line=account&&(on?lineText(syncLine({on,status,syncedAt})):t('同步已关闭'));
  return <Card className="account-row-card" style={{marginBottom:20}} styles={{body:{padding:0}}}>
   <button type="button" className="settings-row account-row" onClick={onSettings}>
    <span className="settings-row-main"><strong>{account?t('账号与同步'):t('登录')}</strong>
     <span className="settings-row-sub">{account?<><span className="account-email">{account.email||t('（邮箱未记录）')}</span> · <span className={'account-sync-status'+(!on||status==='error'||status==='signed_out'?' is-warning':'')}>{line}</span></>:t('账号与同步')}</span></span>
    <RightOutlined aria-hidden="true"/>
   </button>
  </Card>;
 }
 if(account&&sheet){
  body=<Flex vertical gap={12} className="account-sheet-signed-in">
   <div><Text type="secondary">{t('已登录')}</Text><div className="account-email"><Text strong>{maskEmail(account.email)||t('（邮箱未记录）')}</Text></div></div>
   <Text className="account-sync-status" type={on&&(status==='error'||status==='signed_out')?'danger':'secondary'}>{on?lineText(syncLine({on,status,syncedAt})):t('同步已关闭')}</Text>
   <Button onClick={onSettings} className="account-open-settings">{t('账号设置')}</Button>
  </Flex>;
 }else if(account){
  body=<Flex vertical gap={16}>
   <div><Text type="secondary">{t('已登录')}</Text><div className="account-email" style={{wordBreak:'break-all'}}><Text strong>{account.email||t('（邮箱未记录）')}</Text></div></div>
   <div>
    <label className="account-sync-switch"><Switch aria-label={t('在设备间同步钱包')} checked={on} onChange={toggle}/><Text strong>{t('在设备间同步钱包')}</Text>{on&&<InfoTip title={t('钱包的一份副本存在 Cardybara 服务器上，同一账号的其他设备会合并成同一个钱包。关闭后不再同步，服务器上的副本保留，直到你删除账号。')}/>}</label>
    <Paragraph type="secondary" className="account-sync-copy" style={{marginTop:8,marginBottom:0}}>{syncCopy(on)}</Paragraph>
    {!on&&<Text className="account-sync-status" type="warning">{lineText(syncLine({on,status,syncedAt}))}</Text>}
    {on&&<Text className="account-sync-status" type={status==='error'||status==='signed_out'?'danger':'secondary'}>{lineText(syncLine({on,status,syncedAt}))}</Text>}
   </div>
   {pkOk&&!platform.account?.passkeySignIn&&<div className="account-passkeys">
    <div className="settings-title" style={{marginBottom:8}}><Text strong>{t('通行密钥')}</Text><InfoTip title={t('用指纹、面容或设备锁登录。邮箱和密码仍然可用，丢了通行密钥也不会被锁在外面。')}/></div>
    {pks.map(k=><Flex key={k.id} gap={8} align="center" justify="space-between" wrap style={{marginBottom:8}}><Text>{k.name||t('通行密钥')}</Text><Button size="small" style={{minHeight:44}} loading={busy} onClick={()=>removePk(k.id)}>{t('移除')}</Button></Flex>)}
    <Button loading={busy} onClick={addPk}>{t('添加通行密钥')}</Button>
   </div>}
   {err&&!pw&&!del&&<Alert type="error" showIcon title={err} role="alert"/>}
   {pw?<Flex vertical gap={12} className="account-password">
    {alerts}{pwInput(t('当前密码'),cur,setCur,'current-password')}{pwInput(t('新密码（至少 {0} 个字符）',[PASSWORD_MIN]),next,setNext,'new-password')}
    <Flex gap={8} wrap><Button type="primary" loading={busy} onClick={changePw}>{t('修改密码')}</Button><Button onClick={()=>{setPw(false);setErr(null);}}>{t('取消')}</Button></Flex></Flex>
   :<Button onClick={()=>{setPw(true);setErr(null);}}>{t('修改密码')}</Button>}
   <Flex align="center" gap={4}><Button loading={busy} onClick={signOut} className="account-signout" style={{flex:1}}>{t('退出登录')}</Button><InfoTip title={t('退出登录只清除这台设备上的登录，钱包留在这里。')}/></Flex>
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
  const passkeyFirst=sheet&&pkOk&&!up;
  body=<Flex vertical gap={12}>
   {passkeyFirst&&<><Button type="primary" loading={busy} onClick={passkeySignIn} className="account-passkey-signin">{t('用通行密钥登录')}</Button><Text type="secondary" className="account-or">{t('或用邮箱')}</Text></>}
   <Segmented block value={mode} onChange={go} options={[{value:'signin',label:t('登录')},{value:'signup',label:t('注册')}]} style={{minHeight:44}}/>
   {alerts}{emailInput}{pwInput(up?t('密码（至少 {0} 个字符）',[PASSWORD_MIN]):t('密码'),password,setPassword,up?'new-password':'current-password')}
   <Button type={passkeyFirst?'default':'primary'} loading={busy} onClick={up?signUp:signIn} className="account-email-submit">{up?t('注册并发送验证码'):t('登录')}</Button>
   {!up&&link(t('忘记密码'),'forgot')}
   {!up&&pkOk&&!sheet&&<Button loading={busy} onClick={passkeySignIn} className="account-passkey-signin">{t('用通行密钥登录')}</Button>}
  </Flex>;
 }
 if(sheet)return <div className="account-sheet">
  {!account&&<div className="account-sheet-head"><CapybaraMark size={48}/><Typography.Title level={4}>{t('登录卡疲扒拉')}</Typography.Title><Paragraph type="secondary">{t('同一个钱包，在手机和电脑上都能用。')}</Paragraph></div>}
  {body}
  {!account&&mode==='signin'&&<Paragraph type="secondary" className="account-sheet-privacy">{t('不登录也能完整使用钱包；登录后同步默认开启，钱包副本才会存到服务器。')}</Paragraph>}
 </div>;
 return <Card className="account-settings" style={{marginBottom:20}} title={<span className="settings-title">{t('账号与同步')}{!account&&<InfoTip title={t('可选。不登录也能完整使用钱包，数据只在这个浏览器里。登录后同步默认开启，钱包副本会存到服务器，在你的其他设备上使用；可随时关闭。')}/>}</span>}>
  {body}
 </Card>;
}
