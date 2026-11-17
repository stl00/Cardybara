// The Plaid Link page the Worker serves at GET /v2/plaid/link (plaid.js, PLAID_PLAN.md). A Manifest V3 extension may
// not load remote script, so Link runs here, on the gateway's own origin, in a normal browser tab the extension opens.
// It is also the OAuth redirect_uri: Plaid sends the user back to this exact URL with ?oauth_state_id=..., and the page
// resumes Link with the same link_token and receivedRedirectUri.
//
// The page knows the user only by the one-time link-session handle in its URL fragment (#s=pls_...), which it moves
// into localStorage at once and strips from the address bar; the handle names the user and the link_token on the
// server, never anything else. Tokens are never logged or shown. CSP: scripts only from this page (nonce) and
// cdn.plaid.com, frames only cdn.plaid.com, network only this origin and Plaid.
const LINK_SCRIPT='https://cdn.plaid.com/link/v2/stable/link-initialize.js';

const nonce=()=>{const b=crypto.getRandomValues(new Uint8Array(16));let s='';for(const x of b)s+=String.fromCharCode(x);return btoa(s);};

// Plain script, no build step: it must run as written in any current browser. Copy is in English and Chinese.
const SCRIPT=`(()=>{
const KEY='cardybara-plaid-link-v1',MAX_AGE=60*60*1000;
const zh=/^zh/i.test(navigator.language||'');
const T=zh?{
 title:'添加信用卡',lead:'通过 Plaid 安全连接你的美国信用卡。卡疲扒拉只读取余额、账单、还款日、APR 和交易，不能动钱；你的银行密码只交给银行和 Plaid。',
 only:'只会显示信用卡账户。',open:'添加信用卡',loading:'正在准备…',done:'已连接。可以关闭这个标签页，回到卡疲扒拉点「同步」。',
 repaired:'已重新连接。可以关闭这个标签页。',duplicate:'这张卡所在的登录已经连接过了，没有再次添加。可以关闭这个标签页。',
 expired:'这个连接链接已失效。请回到卡疲扒拉重新点「添加信用卡」。',cancelled:'已取消。需要时可以再试一次。',
 failed:'连接没有完成。',retry:'重试',unavailable:'连接服务暂时不可用，请稍后再试。'
}:{
 title:'Add a credit card',lead:'Connect your US credit card securely through Plaid. Cardybara reads balances, statements, due dates, APRs and transactions only and cannot move money; your bank password goes only to your bank and Plaid.',
 only:'Only credit card accounts are shown.',open:'Add a credit card',loading:'Getting ready…',done:'Connected. You can close this tab and press Sync in Cardybara.',
 repaired:'Reconnected. You can close this tab.',duplicate:'This login is already connected, so nothing was added. You can close this tab.',
 expired:'This link has expired. Go back to Cardybara and press Add a credit card again.',cancelled:'Cancelled. You can try again any time.',
 failed:'The connection did not finish.',retry:'Try again',unavailable:'The connection service is unavailable. Please try again later.'
};
const $=id=>document.getElementById(id);
document.documentElement.lang=zh?'zh':'en';
$('title').textContent=T.title;$('lead').textContent=T.lead;$('only').textContent=T.only;
const button=$('open'),status=$('status');
const say=(text,kind)=>{status.textContent=text;status.className=kind||'';};
// The handle: from the fragment on first load (then only in localStorage), from localStorage on the OAuth return.
let handle=null;
const m=/[#&]s=(pls_[A-Za-z0-9_-]{43})/.exec(location.hash);
try{
 if(m){handle=m[1];localStorage.setItem(KEY,JSON.stringify({handle,at:Date.now()}));}
 else{const v=JSON.parse(localStorage.getItem(KEY)||'null');if(v&&Date.now()-v.at<MAX_AGE)handle=v.handle;}
}catch{if(m)handle=m[1];}
if(m)history.replaceState(null,'',location.pathname+location.search);
const forget=()=>{try{localStorage.removeItem(KEY);}catch{}};
const oauthReturn=new URLSearchParams(location.search).has('oauth_state_id');
const post=async(path,body)=>{
 const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',credentials:'omit'});
 let data=null;try{data=await r.json();}catch{}
 return {ok:r.ok,status:r.status,data};
};
let handler=null,mode='new';
async function start(){
 button.disabled=true;say(T.loading);
 if(!handle){say(T.expired,'error');return;}
 let r;
 try{r=await post('/v2/plaid/link/token',{handle});}catch{say(T.unavailable,'error');return;}
 if(!r.ok){if(r.data?.error?.code==='link_expired'){forget();say(T.expired,'error');}else say(T.unavailable,'error');return;}
 mode=r.data.mode;
 if(handler){try{handler.destroy();}catch{}}
 handler=Plaid.create({
  token:r.data.linkToken,
  ...(oauthReturn?{receivedRedirectUri:location.href}:{}),
  onLoad:()=>{if(oauthReturn)handler.open();else{button.disabled=false;say('');}},
  onSuccess:async(publicToken,meta)=>{
   button.disabled=true;say(T.loading);
   const metadata={institution:meta?.institution?{institution_id:meta.institution.institution_id}:null,
    accounts:(meta?.accounts||[]).map(a=>({mask:a.mask,subtype:a.subtype})),link_session_id:meta?.link_session_id||null};
   let c;
   try{c=await post('/v2/plaid/link/complete',mode==='update'?{handle,metadata}:{handle,publicToken,metadata});}catch{say(T.unavailable,'error');return;}
   forget();
   if(c.ok&&c.data?.status==='linked')say(T.done,'ok');
   else if(c.ok&&c.data?.status==='repaired')say(T.repaired,'ok');
   else if(c.ok&&c.data?.status==='duplicate')say(T.duplicate,'ok');
   else if(c.data?.error?.code==='link_expired')say(T.expired,'error');
   else say(T.failed,'error');
   if(oauthReturn)history.replaceState(null,'',location.pathname);
  },
  onExit:async(err,meta)=>{
   // User abandonment (no error) needs nothing; an error is shown with Plaid's display message when it has one.
   try{await post('/v2/plaid/link/exit',{handle,error:err?{error_type:err.error_type||null,error_code:err.error_code||null}:null,linkSessionId:meta?.link_session_id||null,status:meta?.status||null});}catch{}
   if(err){say((err.display_message||T.failed),'error');button.textContent=T.retry;}
   else say(T.cancelled);
   button.disabled=false;
  }
 });
}
button.textContent=T.open;
button.addEventListener('click',()=>{if(handler)handler.open();});
start();
})();`;

const STYLE=`:root{color-scheme:light dark;--bg:#f7f7f5;--fg:#1f1f1f;--muted:#5c5c5c;--accent:#1677ff;--ok:#237804;--err:#a8071a;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#f0f0f0;--muted:#a6a6a6;--card:#1f1f1f;--ok:#73d13d;--err:#ff7875}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:520px;margin:12vh auto;padding:28px 24px;background:var(--card);border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:22px;margin:0 0 12px}p{margin:0 0 12px;color:var(--muted)}
button{font:inherit;padding:10px 18px;border:0;border-radius:8px;background:var(--accent);color:#fff;cursor:pointer;margin-top:8px}
button:disabled{opacity:.5;cursor:default}#status{margin-top:16px;min-height:1.5em;color:var(--fg)}#status.ok{color:var(--ok)}#status.error{color:var(--err)}
@media (max-width:560px){main{margin:16px;padding:20px 16px}}`;

/** The Link page as a Response with its own strict CSP. */
export function linkPage(){
 const n=nonce();
 const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Cardybara · Plaid</title><style nonce="${n}">${STYLE}</style></head>
<body><main><h1 id="title"></h1><p id="lead"></p><p id="only"></p><button id="open" type="button" disabled></button><div id="status" role="status" aria-live="polite"></div></main>
<script nonce="${n}" src="${LINK_SCRIPT}"></script><script nonce="${n}">${SCRIPT}</script></body></html>`;
 const csp=[`default-src 'none'`,`script-src 'nonce-${n}' https://cdn.plaid.com`,`style-src 'nonce-${n}'`,`style-src-attr 'unsafe-inline'`,`frame-src https://cdn.plaid.com`,
  `connect-src 'self' https://*.plaid.com`,`img-src 'self' data: https://*.plaid.com`,`base-uri 'none'`,`form-action 'none'`,`frame-ancestors 'none'`].join('; ');
 return new Response(html,{status:200,headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp,'Cache-Control':'no-store',
  'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});
}
