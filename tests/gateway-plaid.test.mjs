// Gateway Plaid routes (PLAID_PLAN.md): Link session -> page -> exchange -> first sync and liabilities; the access token
// stored only encrypted and never answered; duplicate Items refused before the exchange; update mode without an exchange;
// /transactions/sync paging, removals and the mutation restart; webhooks verified (ES256 JWT, body hash, age) and acted on;
// /item/remove on disconnect and on account deletion; log lines free of tokens. Plaid is a fake API in this file; synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {localGateway,memoryD1,memoryMail} from '../gateway/src/local.mjs';
import {ROUTES} from '../gateway/src/gateway.js';
import {TABLES} from '../gateway/src/accounts.js';
import {clearWebhookKeys,openToken,plaidConfigured,REFRESH_COOLDOWN_SECONDS} from '../gateway/src/plaid.js';

const ORIGIN='chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const GW='https://gateway.test';
const MIGRATION=['0001_accounts','0002_passkeys','0003_plaid'].map(f=>readFileSync(new URL(`../gateway/migrations/${f}.sql`,import.meta.url),'utf8')).join('\n');
const EMAIL='synthetic.user@example.test',PASSWORD='synthetic-pass-0001';
const T0=Date.parse('2026-11-16T12:00:00Z');
const ACCESS='access-sandbox-synthetic-0001',PUBLIC='public-sandbox-synthetic-0001',ITEM='item_synthetic_0001';
const PLAID_VARS={PLAID_ENV:'sandbox',PLAID_CLIENT_ID:'synthetic-client-id',PLAID_SECRET:'synthetic-plaid-secret'};

const txn=(id,date,amount,extra={})=>({transaction_id:id,account_id:'acc_card_1',date,amount,iso_currency_code:'USD',merchant_name:'Synthetic Merchant',name:'SYNTHETIC MERCHANT',pending:false,pending_transaction_id:null,personal_finance_category:{primary:'GENERAL_MERCHANDISE',detailed:'GENERAL_MERCHANDISE_OTHER',confidence_level:'HIGH'},...extra});
const ACCOUNTS=[
 {account_id:'acc_card_1',name:'Synthetic Credit Card',official_name:'Synthetic Rewards Card',mask:'3333',type:'credit',subtype:'credit card',balances:{current:410.5,available:1589.5,limit:2000,iso_currency_code:'USD',unofficial_currency_code:null}},
 {account_id:'acc_chk_1',name:'Synthetic Checking',official_name:null,mask:'0000',type:'depository',subtype:'checking',balances:{current:100,available:100,limit:null,iso_currency_code:'USD',unofficial_currency_code:null}},
];
const CREDIT=[{account_id:'acc_card_1',aprs:[{apr_type:'purchase_apr',apr_percentage:24.99,balance_subject_to_apr:400,interest_charge_amount:8.1},{apr_type:'cash_apr',apr_percentage:29.99,balance_subject_to_apr:null,interest_charge_amount:null}],
 is_overdue:false,last_payment_amount:120,last_payment_date:'2026-10-20',last_statement_issue_date:'2026-11-01',last_statement_balance:390.25,minimum_payment_amount:35,next_payment_due_date:'2026-11-26'}];

/** A fake Plaid API: records every call, answers from `state`, and serves the webhook verification key. */
function fakePlaid(){
 const calls=[],state={pages:[{added:[txn('t1','2026-11-10',12.5),txn('t2','2026-11-11',40)],modified:[],removed:[],has_more:true,next_cursor:'c1'},
  {added:[txn('t3','2026-11-12',7.25)],modified:[],removed:[],has_more:false,next_cursor:'c2',transactions_update_status:'HISTORICAL_UPDATE_COMPLETE'}],
  mutateOnce:false,liabilitiesError:null,removeError:null,exchanges:0,key:null};
 const ok=body=>new Response(JSON.stringify({request_id:'req-'+calls.length,...body}),{status:200,headers:{'Content-Type':'application/json'}});
 const err=(code,type='ITEM_ERROR',status=400)=>new Response(JSON.stringify({error_type:type,error_code:code,error_message:'synthetic',display_message:null,request_id:'req-err-'+calls.length}),{status});
 async function fetch(url,init){
  const u=new URL(url);
  assert.equal(u.origin,'https://sandbox.plaid.com','only the configured environment host is called');
  const body=JSON.parse(init.body);
  assert.equal(init.headers['Plaid-Version'],'2020-09-14');
  assert.equal(body.client_id,'synthetic-client-id');assert.equal(body.secret,'synthetic-plaid-secret');
  calls.push({path:u.pathname,body});
  switch(u.pathname){
   case '/link/token/create':if(state.linkFieldError)return new Response(JSON.stringify({error_type:'INVALID_REQUEST',error_code:'INVALID_FIELD',error_message:state.linkFieldError,display_message:null,request_id:'req-field-1'}),{status:400});
    if(state.linkError)return err(state.linkError,'RATE_LIMIT_EXCEEDED',429);return ok({link_token:'link-sandbox-synthetic-'+calls.length,expiration:'2026-11-16T16:00:00Z'});
   case '/item/public_token/exchange':state.exchanges++;return body.public_token===PUBLIC?ok({access_token:ACCESS,item_id:ITEM}):err('INVALID_PUBLIC_TOKEN','INVALID_INPUT');
   case '/institutions/get_by_id':return ok({institution:{institution_id:body.institution_id,name:'Synthetic Platypus Bank'}});
   case '/transactions/sync':{
    if(state.syncError)return err(state.syncError);
    if(state.mutateOnce&&body.cursor==='c1'){state.mutateOnce=false;return err('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION','TRANSACTIONS_ERROR');}
    const i=!body.cursor?0:body.cursor==='c1'?1:2;
    return ok(state.pages[i]||{added:[],modified:[],removed:[],has_more:false,next_cursor:body.cursor});
   }
   case '/liabilities/get':return state.liabilitiesError?err(state.liabilitiesError):ok({accounts:ACCOUNTS,liabilities:{credit:CREDIT,mortgage:null,student:null},item:{item_id:ITEM}});
   case '/item/remove':return state.removeError?err(state.removeError):ok({});
   case '/webhook_verification_key/get':return state.key&&body.key_id===state.key.kid?ok({key:state.key}):err('INVALID_WEBHOOK_VERIFICATION_KEY_ID','INVALID_INPUT');
   default:return err('UNKNOWN','INVALID_REQUEST',404);
  }
 }
 return {calls,state,fetch,count:p=>calls.filter(c=>c.path===p).length};
}

async function setup({vars={}}={}){
 clearWebhookKeys();
 const db=memoryD1();await db.exec(MIGRATION);
 const mail=memoryMail(),logs=[],plaid=fakePlaid(),pending=[];let clock=T0;
 const g=localGateway({vars:{ALLOWED_ORIGINS:ORIGIN,ACCOUNT_EMAIL_FROM:'Cardybara <no-reply@mail.cardybara.test>',...PLAID_VARS,...vars},bindings:{DB:db,EMAIL:mail},log:l=>logs.push(l),now:()=>clock,fetch:plaid.fetch,waitUntil:p=>pending.push(p)});
 const call=(method,path,body,{token,origin=ORIGIN,headers={}}={})=>g.handle(new Request(GW+path,{method,headers:{...(origin?{Origin:origin}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}));
 const page=(path,body)=>call('POST',path,body,{origin:GW});
 const settle=async()=>{while(pending.length)await pending.shift();};
 const advance=s=>{clock+=s*1000;};
 return {g,db,mail,logs,plaid,call,page,settle,advance,now:()=>clock};
}
const json=async r=>({status:r.status,body:await r.json()});
async function signIn(t){
 assert.equal((await t.call('POST',ROUTES.signUp,{email:EMAIL,password:PASSWORD})).status,202);
 const code=/\b(\d{6})\b/.exec(t.mail.sent.at(-1).text)[1];
 return (await json(await t.call('POST',ROUTES.verify,{email:EMAIL,code}))).body.token;
}
const META={institution:{institution_id:'ins_109508'},accounts:[{mask:'3333',subtype:'credit card'}],link_session_id:'link-session-synthetic-1'};
async function link(t,token){
 const s=await json(await t.call('POST',ROUTES.plaidLink,{},{token}));
 assert.equal(s.status,200);
 const handle=/#s=(pls_[A-Za-z0-9_-]{43})$/.exec(s.body.url)[1];
 return {start:s.body,handle};
}

test('the migration creates exactly the tables accounts.js knows, Plaid included',async()=>{
 const db=memoryD1();await db.exec(MIGRATION);
 assert.deepEqual([...db.tables.keys()].sort(),[...TABLES].sort());
});

test('Plaid routes answer 503 plaid_unavailable until the keys and environment are set',async()=>{
 const t=await setup({vars:{PLAID_ENV:'development'}});
 const token=await signIn(t);
 assert.equal(plaidConfigured(t.g.env),false,'only sandbox and production exist');
 const r=await json(await t.call('POST',ROUTES.plaidLink,{},{token}));
 assert.deepEqual(r,{status:503,body:{error:{code:'plaid_unavailable'}}});
 assert.equal((await t.call('GET',ROUTES.plaidLink,undefined,{origin:null})).status,503);
 assert.equal(t.plaid.calls.length,0);
});

test('link: session -> page token -> exchange -> first sync and liabilities; the access token is stored only encrypted',async()=>{
 const t=await setup();const token=await signIn(t);
 const {start,handle}=await link(t,token);
 assert.equal(start.url.split('#')[0],GW+'/v2/plaid/link');assert.equal(start.mode,'new');
 const create=t.plaid.calls.find(c=>c.path==='/link/token/create').body;
 assert.deepEqual(create.products,['transactions']);
 assert.deepEqual(create.additional_consented_products,['liabilities']);
 assert.deepEqual(create.country_codes,['US']);
 assert.deepEqual(create.account_filters,{credit:{account_subtypes:['credit card']}});
 assert.equal(create.webhook,GW+'/v2/plaid/webhook','https gateway: the webhook URL is set at Link time');
 assert.match(create.user.client_user_id,/^u_/);assert.equal(create.redirect_uri,undefined,'no redirect URI until one is configured');
 // The page is public (no Origin) and carries its own CSP.
 const p=await t.call('GET',ROUTES.plaidLink,undefined,{origin:null});
 assert.equal(p.status,200);
 const csp=p.headers.get('Content-Security-Policy');
 assert.match(csp,/script-src 'nonce-[^']+' https:\/\/cdn\.plaid\.com/);assert.match(csp,/frame-ancestors 'none'/);
 assert.match(await p.text(),/https:\/\/cdn\.plaid\.com\/link\/v2\/stable\/link-initialize\.js/);
 // The page's own calls must come from its own origin.
 assert.equal((await t.call('POST',ROUTES.plaidLinkToken,{handle},{origin:'https://evil.example'})).status,403);
 const lt=await json(await t.page(ROUTES.plaidLinkToken,{handle}));
 assert.equal(lt.status,200);assert.match(lt.body.linkToken,/^link-sandbox-/);
 assert.equal((await json(await t.page(ROUTES.plaidLinkToken,{handle}))).body.linkToken,lt.body.linkToken,'the same link_token after an OAuth redirect');
 const c=await json(await t.page(ROUTES.plaidLinkComplete,{handle,publicToken:PUBLIC,metadata:META}));
 assert.deepEqual(c,{status:200,body:{status:'linked',itemId:ITEM,sync:{transactions:'ok',liabilities:'ok'}}});
 assert.equal((await t.page(ROUTES.plaidLinkToken,{handle})).status,410,'the handle is single use');
 // Stored: the encrypted token only, never the token itself; it decrypts to the exchanged one.
 const row=t.db.tables.get('plaid_items')[0];
 assert.match(row.access_token_enc,/^v1\./);
 assert.ok(!JSON.stringify([...t.db.tables.values()]).includes(ACCESS),'no plaintext access token anywhere in D1');
 assert.equal(await openToken(t.g.env,ITEM,row.access_token_enc),ACCESS);
 await assert.rejects(openToken(t.g.env,'item_other',row.access_token_enc),'bound to its Item id');
 assert.equal(row.institution_name,'Synthetic Platypus Bank');assert.equal(row.cursor,'c2');assert.equal(row.historical_complete,1);
 // Order: exchange, institution, then sync (every page) before liabilities; never in parallel.
 assert.deepEqual(t.plaid.calls.map(c=>c.path).slice(-5),['/item/public_token/exchange','/institutions/get_by_id','/transactions/sync','/transactions/sync','/liabilities/get']);
 assert.equal(t.plaid.calls.filter(c=>c.path==='/transactions/sync')[0].body.count,500);
 // The extension's view: the credit card with its billing-cycle fields; no checking account; no token.
 const cards=await json(await t.call('GET',ROUTES.plaidCards,undefined,{token}));
 assert.equal(cards.status,200);
 assert.equal(cards.body.cards.length,1);
 const card=cards.body.cards[0];
 assert.deepEqual({mask:card.mask,balance:card.balance,limit:card.limit,statementBalance:card.statementBalance,minimumPayment:card.minimumPayment,dueDate:card.dueDate,statementDate:card.statementDate},
  {mask:'3333',balance:410.5,limit:2000,statementBalance:390.25,minimumPayment:35,dueDate:'2026-11-26',statementDate:'2026-11-01'});
 assert.deepEqual(card.aprs.map(a=>[a.type,a.percentage]),[['purchase_apr',24.99],['cash_apr',29.99]]);
 assert.equal(cards.body.items[0].status,'ok');
 const tx=await json(await t.call('GET',ROUTES.plaidTransactions,undefined,{token}));
 assert.deepEqual(tx.body.transactions.map(x=>[x.id,x.date,x.amount]),[['t3','2026-11-12',7.25],['t2','2026-11-11',40],['t1','2026-11-10',12.5]]);
 assert.equal(tx.body.transactions[0].category.primary,'GENERAL_MERCHANDISE');
 // Nothing answered or logged carries a token or secret.
 const everything=JSON.stringify([cards.body,tx.body,c.body,t.logs]);
 for(const secret of [ACCESS,PUBLIC,'synthetic-plaid-secret',lt.body.linkToken,handle])assert.ok(!everything.includes(secret),'leaked '+secret.slice(0,8));
 const exch=t.logs.map(l=>JSON.parse(l)).find(l=>l.route==='plaid_link_complete');
 assert.equal(exch.linkSessionId,'link-session-synthetic-1');assert.ok(exch.plaid.some(p=>p.requestId),'request_ids are logged');
});

test('a second Link of the same login at the same institution is refused before the exchange',async()=>{
 const t=await setup();const token=await signIn(t);
 let {handle}=await link(t,token);
 await t.page(ROUTES.plaidLinkComplete,{handle,publicToken:PUBLIC,metadata:META});
 ({handle}=await link(t,token));
 const r=await json(await t.page(ROUTES.plaidLinkComplete,{handle,publicToken:PUBLIC,metadata:META}));
 assert.deepEqual(r.body,{status:'duplicate',itemId:ITEM});
 assert.equal(t.plaid.state.exchanges,1,'no second exchange');
});

test('update mode: access token and no products in the link token, no exchange, the Item marked repaired',async()=>{
 const t=await setup();const token=await signIn(t);
 let {handle}=await link(t,token);
 await t.page(ROUTES.plaidLinkComplete,{handle,publicToken:PUBLIC,metadata:META});
 t.plaid.state.liabilitiesError='ITEM_LOGIN_REQUIRED';t.advance(REFRESH_COOLDOWN_SECONDS+1);
 await t.call('POST',ROUTES.plaidRefresh,{},{token});
 assert.equal(t.db.tables.get('plaid_items')[0].status,'login_required');
 t.plaid.state.liabilitiesError=null;
 const s=await json(await t.call('POST',ROUTES.plaidLink,{itemId:ITEM},{token}));
 assert.equal(s.body.mode,'update');
 const create=t.plaid.calls.filter(c=>c.path==='/link/token/create').at(-1).body;
 assert.equal(create.access_token,ACCESS);assert.equal(create.products,undefined);assert.equal(create.additional_consented_products,undefined);
 handle=/#s=(pls_[A-Za-z0-9_-]{43})$/.exec(s.body.url)[1];
 const r=await json(await t.page(ROUTES.plaidLinkComplete,{handle,metadata:META}));
 assert.equal(r.body.status,'repaired');
 assert.equal(t.plaid.state.exchanges,1,'update mode never exchanges');
 assert.equal(t.db.tables.get('plaid_items')[0].status,'ok');
 // Another user cannot repair, refresh or remove this Item.
 const other=await (async()=>{await t.call('POST',ROUTES.signUp,{email:'other.user@example.test',password:PASSWORD});const code=/\b(\d{6})\b/.exec(t.mail.sent.at(-1).text)[1];return (await json(await t.call('POST',ROUTES.verify,{email:'other.user@example.test',code}))).body.token;})();
 assert.equal((await t.call('POST',ROUTES.plaidLink,{itemId:ITEM},{token:other})).status,404);
 assert.equal((await t.call('DELETE',ROUTES.plaidItem,{itemId:ITEM},{token:other})).status,404);
 assert.deepEqual((await json(await t.call('GET',ROUTES.plaidCards,undefined,{token:other}))).body,{items:[],cards:[]});
});

test('sync: a mutation during pagination restarts from the starting cursor; removals delete; cursor saved only at the end',async()=>{
 const t=await setup();const token=await signIn(t);
 t.plaid.state.mutateOnce=true;
 const {handle}=await link(t,token);
 await t.page(ROUTES.plaidLinkComplete,{handle,publicToken:PUBLIC,metadata:META});
 const syncs=t.plaid.calls.filter(c=>c.path==='/transactions/sync').map(c=>c.body.cursor??'');
 assert.deepEqual(syncs,['','c1','','c1'],'restarted from the empty starting cursor');
 assert.equal(t.db.tables.get('plaid_transactions').length,3);
 // Pending -> posted arrives as a removal plus an addition with a new id.
 t.plaid.state.pages[2]={added:[txn('t4','2026-11-12',7.25,{pending_transaction_id:'t3'})],modified:[txn('t1','2026-11-10',13)],removed:[{transaction_id:'t3',account_id:'acc_card_1'}],has_more:false,next_cursor:'c3'};
 t.advance(REFRESH_COOLDOWN_SECONDS+1);
 const r=await json(await t.call('POST',ROUTES.plaidRefresh,{},{token}));
 assert.equal(r.status,200);assert.deepEqual(r.body.results[ITEM],{transactions:'ok',liabilities:'ok'});
 const tx=(await json(await t.call('GET',ROUTES.plaidTransactions,undefined,{token}))).body.transactions;
 assert.deepEqual(tx.map(x=>[x.id,x.amount,x.pendingTransactionId]).sort(),[['t1',13,null],['t2',40,null],['t4',7.25,'t3']]);
 assert.equal(t.db.tables.get('plaid_items')[0].cursor,'c3');
 // A failing sync leaves the cursor alone.
 t.plaid.state.syncError='INTERNAL_SERVER_ERROR';t.advance(REFRESH_COOLDOWN_SECONDS+1);
 await t.call('POST',ROUTES.plaidRefresh,{},{token});
 assert.equal(t.db.tables.get('plaid_items')[0].cursor,'c3');
 // The refresh cooldown: a second press within a minute calls nothing.
 const before=t.plaid.calls.length;
 const again=await json(await t.call('POST',ROUTES.plaidRefresh,{},{token}));
 assert.deepEqual(again.body.results[ITEM],{skipped:'cooldown'});assert.equal(t.plaid.calls.length,before);
});

async function signer(t){
 const {publicKey,privateKey}=await generateKeyPair('ES256',{extractable:true});
 const jwk=await exportJWK(publicKey);
 t.plaid.state.key={...jwk,alg:'ES256',kid:'kid-synthetic-1',use:'sig',created_at:Math.floor(T0/1000)-100,expired_at:null};
 return async(body,{iat=Math.floor(t.now()/1000),alg='ES256',key=privateKey,hashOf=body}={})=>{
  const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(hashOf))).toString('hex');
  return new SignJWT({request_body_sha256:digest}).setProtectedHeader({alg,kid:'kid-synthetic-1',typ:'JWT'}).setIssuedAt(iat).sign(key);
 };
}
const hook=(t,body,jwt)=>t.call('POST',ROUTES.plaidWebhook,body,{origin:null,headers:jwt?{'Plaid-Verification':jwt}:{}});

test('webhooks: only a valid, fresh ES256 signature over the exact body is acted on',async()=>{
 const t=await setup();const token=await signIn(t);
 const {handle}=await link(t,token);
 await t.page(ROUTES.plaidLinkComplete,{handle,publicToken:PUBLIC,metadata:META});
 const sign=await signer(t);
 const body=JSON.stringify({webhook_type:'TRANSACTIONS',webhook_code:'SYNC_UPDATES_AVAILABLE',item_id:ITEM,initial_update_complete:true,historical_update_complete:true,environment:'sandbox'});
 const syncs=()=>t.plaid.count('/transactions/sync');
 const n0=syncs();
 assert.equal((await hook(t,body)).status,401,'no signature');
 assert.equal((await hook(t,body,await sign(body,{hashOf:body+' '}))).status,401,'body hash mismatch');
 assert.equal((await hook(t,body,await sign(body,{iat:Math.floor(t.now()/1000)-6*60}))).status,401,'older than 5 minutes');
 const other=await generateKeyPair('ES256');
 assert.equal((await hook(t,body,await sign(body,{key:other.privateKey}))).status,401,'wrong key');
 const hs=await new SignJWT({request_body_sha256:'x'}).setProtectedHeader({alg:'HS256',kid:'kid-synthetic-1'}).setIssuedAt().sign(new TextEncoder().encode('k'.repeat(32)));
 assert.equal((await hook(t,body,hs)).status,401,'alg must be ES256');
 assert.equal(syncs(),n0,'nothing ran on a bad webhook');
 const r=await hook(t,body,await sign(body));
 assert.equal(r.status,200);await t.settle();
 assert.equal(syncs(),n0+1,'SYNC_UPDATES_AVAILABLE runs /transactions/sync');
 assert.equal(t.plaid.count('/webhook_verification_key/get'),1,'the key is cached by kid');
 // Liabilities and Item webhooks.
 const lb=JSON.stringify({webhook_type:'LIABILITIES',webhook_code:'DEFAULT_UPDATE',item_id:ITEM,account_ids_with_new_liabilities:[],account_ids_with_updated_liabilities:{acc_card_1:['minimum_payment_amount']}});
 const l0=t.plaid.count('/liabilities/get');
 assert.equal((await hook(t,lb,await sign(lb))).status,200);await t.settle();
 assert.equal(t.plaid.count('/liabilities/get'),l0+1);
 const status=async(code,extra={})=>{const b=JSON.stringify({webhook_type:'ITEM',webhook_code:code,item_id:ITEM,...extra});assert.equal((await hook(t,b,await sign(b))).status,200);await t.settle();return t.db.tables.get('plaid_items')[0]?.status;};
 assert.equal(await status('ERROR',{error:{error_code:'ITEM_LOGIN_REQUIRED'}}),'login_required');
 assert.equal(await status('LOGIN_REPAIRED'),'ok');
 assert.equal(await status('PENDING_DISCONNECT'),'pending_disconnect');
 assert.equal(await status('USER_PERMISSION_REVOKED'),'revoked');
 // An unknown Item is acknowledged and ignored.
 const u=JSON.stringify({webhook_type:'TRANSACTIONS',webhook_code:'SYNC_UPDATES_AVAILABLE',item_id:'item_unknown'});
 assert.equal((await hook(t,u,await sign(u))).status,200);
 // The log line has the webhook type and request ids, no body content.
 const lines=t.logs.map(l=>JSON.parse(l)).filter(l=>l.route==='plaid_webhook');
 assert.ok(lines.some(l=>l.webhook==='TRANSACTIONS:SYNC_UPDATES_AVAILABLE'&&l.status===200));
 assert.ok(!JSON.stringify(lines).includes('acc_card_1'));
});

test('disconnect and account deletion call /item/remove and leave 0 Plaid rows',async()=>{
 const t=await setup();const token=await signIn(t);
 let {handle}=await link(t,token);
 await t.page(ROUTES.plaidLinkComplete,{handle,publicToken:PUBLIC,metadata:META});
 assert.deepEqual((await json(await t.call('DELETE',ROUTES.plaidItem,{itemId:ITEM},{token}))).body,{status:'removed'});
 assert.equal(t.plaid.calls.filter(c=>c.path==='/item/remove').at(-1).body.access_token,ACCESS);
 for(const name of ['plaid_items','plaid_transactions','plaid_link_sessions'])assert.equal(t.db.tables.get(name).length,0,name);
 // Link again, then delete the account: /item/remove first, then every row.
 ({handle}=await link(t,token));
 await t.page(ROUTES.plaidLinkComplete,{handle,publicToken:PUBLIC,metadata:META});
 await link(t,token);// an unused link session too
 const removes=t.plaid.count('/item/remove');
 const exp=await json(await t.call('GET',ROUTES.export,undefined,{token}));
 assert.equal(exp.body.plaid.items.length,1);assert.equal(exp.body.plaid.transactions.length,3);
 assert.ok(!JSON.stringify(exp.body).includes(ACCESS),'export names the token, never shows it');
 assert.equal((await t.call('DELETE',ROUTES.account,{password:PASSWORD},{token})).status,200);
 assert.equal(t.plaid.count('/item/remove'),removes+1);
 for(const name of TABLES)assert.equal(t.db.tables.get(name).length,0,name+' is empty');
});

test('ITEM_NOT_FOUND forgets the Item; a link session expires',async()=>{
 const t=await setup();const token=await signIn(t);
 let {handle}=await link(t,token);
 await t.page(ROUTES.plaidLinkComplete,{handle,publicToken:PUBLIC,metadata:META});
 t.plaid.state.syncError='ITEM_NOT_FOUND';t.advance(REFRESH_COOLDOWN_SECONDS+1);
 await t.call('POST',ROUTES.plaidRefresh,{},{token});
 assert.equal(t.db.tables.get('plaid_items').length,0);assert.equal(t.db.tables.get('plaid_transactions').length,0);
 ({handle}=await link(t,token));
 t.advance(61*60);
 assert.deepEqual(await json(await t.page(ROUTES.plaidLinkToken,{handle})),{status:410,body:{error:{code:'link_expired'}}});
});

test('PWA: a listed web origin links and is sent back only there; other pages are refused; a used-up plan answers plaid_limit',async()=>{
 const WEB='https://app.cardybara.test';
 const t=await setup({vars:{ALLOWED_ORIGINS:ORIGIN+','+WEB}});
 const token=await signIn(t);
 // The bearer request from the PWA origin is admitted (CORS echoes exactly that origin), and the URL names it to go back to.
 const r=await t.call('POST',ROUTES.plaidLink,{},{token,origin:WEB});
 assert.equal(r.status,200);assert.equal(r.headers.get('Access-Control-Allow-Origin'),WEB);
 const {url}=await r.json();
 assert.match(url,/^https:\/\/gateway\.test\/v2\/plaid\/link#s=pls_[A-Za-z0-9_-]{43}&r=https%3A%2F%2Fapp\.cardybara\.test$/);
 // From the extension there is nothing to go back to.
 assert.doesNotMatch((await json(await t.call('POST',ROUTES.plaidLink,{},{token}))).body.url,/&r=/);
 // Any other web page is refused before the session is looked at, preflight included.
 for(const evil of ['https://evil.example','http://app.cardybara.test','https://app.cardybara.test.evil.example']){
  assert.equal((await t.call('POST',ROUTES.plaidLink,{},{token,origin:evil})).status,403);
  assert.equal((await t.call('OPTIONS',ROUTES.plaidLink,undefined,{origin:evil})).status,403);
 }
 assert.equal((await t.call('OPTIONS',ROUTES.plaidLink,undefined,{origin:WEB})).status,204);
 // The page embeds only the listed web origins as places to go back to (never an extension origin, never the fragment's).
 const html=await (await t.call('GET',ROUTES.plaidLink,undefined,{origin:null})).text();
 assert.match(html,/RETURN_ORIGINS=\["https:\/\/app\.cardybara\.test"\]/);
 // The Trial plan's connection cap: one call (no retry), 429 plaid_limit, no link session.
 t.plaid.state.linkError='TRIAL_CONNECTION_LIMIT';
 const before=t.plaid.count('/link/token/create');
 const capped=await json(await t.call('POST',ROUTES.plaidLink,{},{token,origin:WEB}));
 assert.equal(capped.status,429);assert.equal(capped.body.error.code,'plaid_limit');
 assert.equal(t.plaid.count('/link/token/create'),before+1);
 // A malformed request (INVALID_FIELD): 502 plaid_error, and the log line says which field and keeps the request_id.
 t.plaid.state.linkError=null;t.plaid.state.linkFieldError='redirect_uri must be configured in the developer dashboard';
 const bad=await json(await t.call('POST',ROUTES.plaidLink,{},{token,origin:WEB}));
 assert.deepEqual(bad,{status:502,body:{error:{code:'plaid_error',plaidCode:'INVALID_FIELD'}}});
 const line=t.logs.map(l=>JSON.parse(l)).filter(l=>l.route==='plaid_link_start').at(-1);
 assert.deepEqual(line.plaid,[{call:'/link/token/create',requestId:'req-field-1',error:'INVALID_FIELD',message:'redirect_uri must be configured in the developer dashboard'}]);
 assert.equal(line.error,'plaid_error');
 // Item errors keep only the code: their message is not ours to fix and is not logged.
 assert.ok(!JSON.stringify(t.logs).includes('synthetic"'),'no message on an item error');
});

test('local runs may list an exact http://127.0.0.1 or localhost origin; production never admits http',async()=>{
 const {originAllowed}=await import('../gateway/src/gateway.js');
 const L='http://127.0.0.1:8766';
 assert.equal(originAllowed(L,[L],{local:true}),true);
 assert.equal(originAllowed('http://localhost:8766',['http://localhost:8766'],{local:true}),true);
 assert.equal(originAllowed(L,[L]),false);
 assert.equal(originAllowed('http://127.0.0.1:9999',[L],{local:true}),false);
 assert.equal(originAllowed('http://evil.example',['http://evil.example'],{local:true}),false);
});
