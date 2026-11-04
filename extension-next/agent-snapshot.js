// Injected isolated-world function. Reads rendered text only, never form values or network bodies.
export async function capturePage(bank,cards,contextIds=[]){
 // Injected, so this cannot import the scope from mvp.js. tests/coverage.test.mjs fails if they differ.
 const requiredAmexReward=new RegExp('\\bMembership Rewards\\b|\\bMR\\b|美國運通積分|美国运通积分|會員積分|会员积分','i');
 // Wait for the financial SPA body to settle, rather than reading initial zero placeholders.
 const settleStart=Date.now(),settleEnd=settleStart+6000;let previous="",stable=0;while(Date.now()<settleEnd){const text=document.querySelector("main")?.innerText||document.body?.innerText||"";if(text===previous&&text.length>120){if(++stable>=3&&Date.now()-settleStart>=1500)break;}else stable=0;previous=text;await new Promise(r=>setTimeout(r,250));}
 if(bank==='Chase'&&self.CardyReader?.chaseSnapshot)return self.CardyReader.chaseSnapshot(cards,contextIds);
 const visible=e=>!!e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const roots=[document];for(let n=0;n<roots.length&&n<200;n++)for(const el of roots[n].querySelectorAll('*'))if(el.shadowRoot)roots.push(el.shadowRoot);
 const query=selector=>roots.flatMap(root=>[...root.querySelectorAll(selector)]);
 if(query('input[type=password]').some(visible))return {error:'needs_login'};
 if(bank==='HSBC HK'&&/^\/[a-z]{2}-[a-z]{2}\/?$/.test(location.pathname))return {error:'needs_login'};
 if(bank==='HSBC HK'&&/^\/security(?:\/|$)/.test(location.pathname)){if(document.title==='Security code | Log on | HSBC')return {error:'needs_confirmation'};if(/^(?:Username|Password) \| Log on \| HSBC$/.test(document.title))return {error:'needs_login'};}
 const redact=t=>String(t).replace(/https?:\/\/\S+/gi,'[link]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[email]').replace(/(?:\d[ -]?){8,19}/g,value=>{const date=value.trim();return /^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date?value:'[number]';}).replace(/\b(?:Welcome|Hello|Hi|Dear)\s+[^\n,]{2,60}/gi,'[greeting]').replace(/(?:歡迎|欢迎|您好)[^\n，,]{0,60}/g,'[greeting]');
 const body=[document.body?.innerText||'',...roots.slice(1).flatMap(root=>[...root.children].filter(visible).map(e=>e.innerText||''))].join('\n');
 let selectedCardId=null;let matches=cards.filter(c=>new RegExp('(?:^|[^0-9])'+c.tail+'(?:[^0-9]|$)').test(body));
 if(bank.startsWith('Amex ')){const selected=query('button[aria-label=\"open_title\"],[role=\"combobox\"][aria-label=\"Open to manage your other accounts\"]').filter(visible).map(e=>e.innerText||'').join('\n');const scoped=cards.filter(c=>new RegExp('(?:^|[^0-9])'+c.tail+'(?:[^0-9]|$)').test(selected));if(scoped.length===1){matches=scoped;selectedCardId=scoped[0].id;}}
 // HSBC repeats some ids on a hidden copy, so only the shown one counts.
 const hsbcById=id=>[...document.querySelectorAll(`[id="${id}"]`)].find(visible)||null;
 // A full number identifies a card by its last group only.
 const hsbcIdentity=()=>{const text=hsbcById('account-number-value')?.innerText||hsbcMetadata();return text.match(/(?<!\d)\d{4}[- ]\d{4}[- ]\d{4}[- ](\d{4})(?!\d)/)?.[1]||text;};
 const hsbcMetadata=()=>{const h=hsbcById('account-summary-name');const root=h?.closest('.account-summary-title-detail');return root?[...root.children].filter(e=>e.classList.contains('account-detail-row')).map(e=>e.innerText||'').join('\n'):'';};
 // After a switch the previous card stays on screen, then amounts fill in. Wait for this card's own number and amounts; a card that never shows them reads as what it shows.
 if(bank==='HSBC HK'&&hsbcById('account-summary-name')){
  const want=cards.filter(c=>contextIds.includes(c.id)),amounts=()=>['ledger-account-amount','credit-card-amount-due-value','credit-card-total-minimum-payment-amount-value'].map(id=>hsbcById(id)?.innerText||''),ready=()=>(want.length!==1||hsbcIdentity()===want[0].tail)&&amounts().every(t=>/\d/.test(t))&&!query('#loading-spinner').some(visible);
  const until=Date.now()+12000;let held='',since=0;
  // Amounts can change just after the number does, so they must also hold still briefly.
  while(Date.now()<until){const now=amounts().join('|');if(!ready()||now!==held){held=now;since=Date.now();}else if(Date.now()-since>=800)break;await new Promise(r=>setTimeout(r,200));}
 }
 if(bank==='HSBC HK'&&hsbcById('account-summary-name')){const selected=hsbcIdentity();const scoped=cards.filter(c=>new RegExp('(?:^|[^0-9])'+c.tail+'(?:[^0-9]|$)').test(selected));if(scoped.length!==1)return {error:'card_not_identified'};matches=scoped;selectedCardId=scoped[0].id;}
 // Citi card dashboard: the card's own "Name - tail" line sits directly above its Current Balance. A wait covers the previous card still on screen.
 let citiBlock=null;
 if(bank==='Citi US'&&/^\/US\/ag\/dashboard\/credit-card\/?$/.test(location.pathname)){
  const find=()=>{const lines=(document.body?.innerText||'').split('\n').map(t=>t.trim()).filter(Boolean),at=lines.findIndex((l,i)=>/\s-\s\d{4,5}$/.test(l)&&/^current balance$/i.test(lines[i+1]||''));if(at<0)return null;const stop=lines.findIndex((l,i)=>i>at&&/^make payment$/i.test(l));return {tail:lines[at].match(/(\d{4,5})$/)[1],heading:lines[at],block:lines.slice(at,stop>at?stop:at+24)};};
  const wanted=contextIds.length===1?cards.find(c=>c.id===contextIds[0])?.tail:null,until=Date.now()+10000;citiBlock=find();while((!citiBlock||(wanted&&citiBlock.tail!==wanted))&&Date.now()<until){await new Promise(r=>setTimeout(r,200));citiBlock=find();}
  const card=citiBlock&&cards.find(c=>c.tail===citiBlock.tail);if(!card)return {error:'card_not_identified'};matches=[card];selectedCardId=card.id;
 }
 let scPage=null;
 if(bank==='SC HK'&&/\/card_details\.htm$/.test(location.pathname)&&self.CardyReader?.scDetails){scPage=self.CardyReader.scDetails(cards);if(!scPage?.card)return {error:'card_not_identified'};matches=[scPage.card];selectedCardId=scPage.card.id;}
 // BOA account details: the page's own heading names the card, outside any link or button.
 let boaHeading='',boaHeadingsNow=()=>'';
 if(bank==='BOA'&&/^\/myaccounts\//.test(location.pathname)){const headings=boaHeadingsNow=()=>[...document.querySelectorAll('span,h1,h2')].filter(e=>visible(e)&&!e.closest('a,button')&&/\s-\s\d{4,5}$/.test((e.innerText||'').trim())&&(e.innerText||'').length<120).map(e=>e.innerText.trim()).join('\n');const until=Date.now()+8000;boaHeading=headings();while(!boaHeading&&Date.now()<until){await new Promise(r=>setTimeout(r,200));boaHeading=headings();}const scoped=cards.filter(c=>new RegExp('\\s-\\s'+c.tail+'$','m').test(boaHeading));if(scoped.length!==1)return {error:'card_not_identified'};matches=scoped;selectedCardId=scoped[0].id;}
 if(selectedCardId&&contextIds.length===1&&selectedCardId!==contextIds[0])return {error:'document_changed'};
 if(bank==='Amex HK'&&selectedCardId&&/^\/(?:dashboard|overview|rewards)\/?$/.test(location.pathname)){const titles=query('h1,h2,h3,h4').filter(visible).filter(h=>!h.closest('header,footer,nav')).map(h=>h.innerText||'').join('\n');const scoped=cards.filter(c=>new RegExp('(?:[•*]{2,}\\s*|-\\s*)'+c.tail+'(?![0-9])').test(titles));if(scoped.length!==1||scoped[0].id!==selectedCardId)return {error:scoped.length?'document_changed':'load_error'};}
 if(!matches.length&&/[•*xX]{2,}\s*\d{4,5}(?!\d)/.test(body))return {error:'card_not_identified'};
 if(!matches.length&&contextIds.length===1)matches=cards.filter(c=>c.id===contextIds[0]);
 if(!matches.length)return {error:'card_not_identified'};
 const aliases=matches.map((c,i)=>({id:'C'+(i+1),cardId:c.id,currency:c.currency}));
 const privateNames=bank==='Amex HK'?query('table').filter(t=>[...t.querySelectorAll('th')].some(h=>/^會員$/.test(h.innerText.trim()))).flatMap(t=>[...t.querySelectorAll('tbody tr')].map(r=>r.querySelector('td')?.innerText.trim()).filter(n=>n&&n!=='總額')):[];
 const replace=t=>{let out=redact(t);for(const name of privateNames)out=out.split(name).join('[cardholder]');matches.forEach((c,i)=>{out=out.replace(new RegExp('(^|[^0-9])'+c.tail+'(?=[^0-9]|$)','g'),'$1[C'+(i+1)+']');});return out;};
 const scopedText=t=>{const hits=cards.filter(c=>new RegExp('(?:^|[^0-9])'+c.tail+'(?:[^0-9]|$)').test(t));if(hits.length>1||hits.some(c=>!matches.some(m=>m.id===c.id)))return '';const id=hits.length===1?aliases.find(a=>a.cardId===hits[0].id)?.id:selectedCardId?aliases.find(a=>a.cardId===selectedCardId)?.id:null;return (id?'['+id+']\n':'')+replace(t);};
 const financial=/積分計劃|积分计划|points|rewards|RewardCash|offers|benefit|transaction|balance|statement|credit|purchase|payment|積分|积分|獎賞|奖赏|優惠|优惠|福利|交易|結欠|结欠|餘額|余额|月結|月结|抵扣/i;
 const blocks=[],seen=new Set(),observations=[];let size=0;
 let sourceBody=body;
 if(bank==='HSBC HK'&&selectedCardId){
  const h=hsbcById('account-summary-name'),ledger=hsbcById('ledger-account-amount'),overlay=hsbcById('account-details-overlay');
  const bits=[h?.innerText||'',hsbcMetadata(),ledger?.innerText||''];
  for(const [label,id]of [['Current amount due','credit-card-amount-due-value'],['Total minimum payment amount','credit-card-total-minimum-payment-amount-value']]){const e=hsbcById(id);if(e)bits.push(label+'\n'+e.innerText);}
  const pageLines=(document.body?.innerText||'').split('\n').map(t=>t.trim()).filter(Boolean),dueLabels=pageLines.flatMap((t,i)=>/^(?:Payment due date|付款到期日)\s*[:：]?$/i.test(t)&&pageLines[i+1]?[pageLines[i+1]]:[]);if(new Set(dueLabels).size===1)bits.push('Payment due date\n'+dueLabels[0]);
  if(visible(overlay))bits.push(overlay.innerText);
  const content=bits.join('\n'),lines=content.split('\n').map(t=>t.trim()).filter(Boolean),add=item=>{blocks.push({id:'B'+(blocks.length+1),text:item.evidence});observations.push(item);size+=item.evidence.length;};
  const parsed=self.CardyReader?.read(bank,matches,['en-HK','zh-HK','zh-CN']);
  const fields=parsed?.patches?.find(p=>p.id===selectedCardId)?.fields||{};
  const labels={creditLimit:/^(?:Credit limit|信用限額|信用限额)\s*[:：]?$/i,balance:/^(?:Account balance|戶口結餘|户口结余)\s*[:：]?$/i,statement:/^Current amount due:?$/i,minimum:/^Total minimum payment amount:?$/i,available:/^(?:Available credit limit|可用信用限額|可用信用限额)\s*[:：]?$/i};
  for(const [key,value]of Object.entries(fields)){const at=lines.findIndex(t=>labels[key]?.test(t));if(at>=0)add({kind:'card',cardId:'C1',key,title:lines[at],value,currency:aliases[0].currency,date:'',status:'unknown',evidence:'[C1]\n'+replace(lines.slice(at,at+4).join('\n'))});}
  const rewardAt=lines.findIndex(t=>/^RewardCash balance:?$/i.test(t));if(rewardAt>=0&&/^\d[\d,]*$/.test(lines[rewardAt+1]||'')){const value=Number(lines[rewardAt+1].replaceAll(',',''));if(Number.isSafeInteger(value)&&value<=1e9)add({kind:'reward',cardId:'C1',key:'RewardCash',title:'RewardCash',value,currency:'points',date:'',status:'unknown',evidence:'[C1]\n'+replace(lines.slice(rewardAt,rewardAt+2).join('\n'))});}
  // A full printed date is required; the current date never supplies its year.
  const dueAt=lines.findIndex(t=>/^Payment due date:?$/i.test(t));const zhDue=dueAt>=0?lines[dueAt+1]?.match(/^(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日$/):null;if(zhDue)add({kind:'billing',cardId:'C1',key:'due',title:'Payment due date',value:null,currency:aliases[0].currency,date:zhDue[1]+'-'+zhDue[2].padStart(2,'0')+'-'+zhDue[3].padStart(2,'0'),status:'unknown',evidence:'[C1]\n'+replace(lines.slice(dueAt,dueAt+2).join('\n'))});const due=dueAt>=0?lines[dueAt+1]?.match(/^(\d{1,2}) ([A-Za-z]+) (20\d{2})$/):null;if(due){const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(due[2].slice(0,3).toLowerCase())+1;if(month)add({kind:'billing',cardId:'C1',key:'due',title:'Payment due date',value:null,currency:aliases[0].currency,date:due[3]+'-'+String(month).padStart(2,'0')+'-'+due[1].padStart(2,'0'),status:'unknown',evidence:'[C1]\n'+replace(lines.slice(dueAt,dueAt+2).join('\n'))});}
  const transactions=document.getElementById('allTransactionsPanel');sourceBody=content+'\n'+(visible(transactions)?transactions.innerText:'');
  const table=visible(transactions)?transactions.querySelector('table'):null,tableRows=visible(table)?[...table.querySelectorAll('tr')]:[],headers=[...tableRows[0]?.querySelectorAll('td,th')||[]].map(e=>e.innerText.replace(/[\uE000-\uF8FF]/g,'').replace(/\s+/g,' ').trim().toLowerCase()),positions=['transaction date','card','description','amount in','amount out'].map(h=>headers.indexOf(h));
  if(positions.every(i=>i>=0)&&self.CardyReader?.hsbcTransactionRows){const rows=tableRows.slice(1).map(tr=>{const cells=[...tr.querySelectorAll('td')].map(e=>e.innerText.trim());return {date:cells[positions[0]],tail:cells[positions[1]]?.match(/Card ending in (\d{4,5})/i)?.[1],description:cells[positions[2]],amountIn:cells[positions[3]],amountOut:cells[positions[4]]};});const parsed=self.CardyReader.hsbcTransactionRows(rows,matches[0]);for(const item of parsed.items)add({...item,key:redact(item.key),title:replace(item.title),evidence:replace(item.evidence)});}

 }
 if(bank==='Amex US'&&selectedCardId&&self.CardyReader?.issuerDue&&/^\/(?:dashboard|overview)\/?$/.test(location.pathname)){
  for(const item of self.CardyReader.issuerDue(body.split('\n').map(t=>t.trim()).filter(Boolean),bank,matches.find(c=>c.id===selectedCardId))){const evidence='[C1]\n'+replace(item.evidence);blocks.push({id:'B'+(blocks.length+1),text:evidence});observations.push({...item,evidence});size+=evidence.length;}
 }
 if(citiBlock){
  for(const item of self.CardyReader.issuerBilling(citiBlock.block.join('\n'),bank,matches[0])){const evidence='[C1]\n'+replace(item.evidence);blocks.push({id:'B'+(blocks.length+1),text:evidence});observations.push({...item,evidence});size+=evidence.length;}
 }else if(scPage?.text){
  for(const item of self.CardyReader.issuerBilling(scPage.text,bank,scPage.card)){const evidence='[C1]\n'+replace(item.evidence);blocks.push({id:'B'+(blocks.length+1),text:evidence});observations.push({...item,evidence});size+=evidence.length;}
  // Nothing else from this page leaves it: it prints the full card number, in forms redaction may not catch.
  return {pageHref:location.href,empty:[],coverage:[],notCollected:[],observations,blocks,aliases,links:[],capturedAt:new Date().toISOString(),rulesComplete:true};
 }else if(boaHeading&&self.CardyReader?.issuerBilling){
  // The billing block runs from the current balance to the payment control. Below it are transactions.
  const lines=(document.body?.innerText||'').split('\n').map(t=>t.trim()).filter(Boolean),from=lines.findIndex(t=>/^current balance:?$/i.test(t)),to=lines.findIndex((t,i)=>i>from&&/^make payment$/i.test(t)),block=from<0?[]:lines.slice(from,to>from?to:from+40);
  for(const item of self.CardyReader.issuerBilling(boaHeading+'\n'+block.join('\n'),bank,matches[0])){const evidence='[C1]\n'+replace(item.evidence);blocks.push({id:'B'+(blocks.length+1),text:evidence});observations.push({...item,evidence});size+=evidence.length;}
 }else if(['BOA','SC HK'].includes(bank)&&self.CardyReader?.issuerBilling){
  for(const alias of aliases){
   const card=matches.find(c=>c.id===alias.cardId),others=cards.filter(c=>c.id!==card.id).map(c=>c.tail),items=self.CardyReader.issuerBilling(self.CardyReader.issuerScope(card.tail,others),bank,card,others,alias.id);
   for(const item of items){const evidence='['+alias.id+']\n'+replace(item.evidence);blocks.push({id:'B'+(blocks.length+1),text:evidence});observations.push({...item,evidence});size+=evidence.length;}
  }
 }
 if(bank==='Amex HK'&&selectedCardId&&self.CardyReader?.amexHkMvp){
  const path=location.pathname,page=/^\/(dashboard|overview)\/?$/.test(path)?'overview':/^\/rewards\/?$/.test(path)?'rewards':'billing';
  const text=document.querySelector('main')?.innerText||body;
  for(const item of self.CardyReader.amexHkMvp(text,matches[0],page)){
   const evidence='[C1]\n'+replace(item.evidence);blocks.push({id:'B'+(blocks.length+1),text:evidence});observations.push({...item,evidence});size+=evidence.length;
  }
 }
 if(bank.startsWith('Amex ')&&selectedCardId){const line=body.split('\n').map(t=>t.trim()).find(t=>/^AutoPay (?:On|Off)$/i.test(t));if(line){const evidence='[C1]\n'+line;blocks.push({id:'B'+(blocks.length+1),text:evidence});observations.push({kind:'billing',cardId:'C1',key:'autopay',title:'AutoPay',value:null,currency:aliases[0].currency,date:'',status:/Off$/i.test(line)?'off':'on',evidence});}}
 const period=bank.startsWith('Amex ')&&location.pathname.startsWith('/activity')?body.split('\n').map(s=>s.trim()).find(s=>/^\d{1,2}\s+[A-Za-z]+(?:\s+20\d{2})?\s*[-–]\s*\d{1,2}\s+[A-Za-z]+\s+20\d{2}$/.test(s)):null;
 // A displayed programme heading followed by a single printed integer is a
 // card observation, never proof that two cards share a rewards account.
 if(bank.startsWith('Amex ')&&matches.length===1){
  for(const h of query('h1,h2,h3,h4')){
   const title=(h.innerText||'').replace(/\s+/g,' ').trim();if(!visible(h)||!/^(?:Membership Rewards\s*[®™]?|美國運通積分計劃|美国运通积分计划)$/i.test(title))continue;
   let parent=h;for(let depth=0;depth<3&&parent.parentElement;depth++){
    parent=parent.parentElement;const text=(parent.innerText||'').trim();if(text.length>800)break;
    const lines=text.split('\n').map(s=>s.trim()).filter(s=>s&&!/^[®™]$/.test(s));const index=lines.findIndex(s=>s.replace(/[®™]/g,'').trim()===title.replace(/[®™]/g,'').trim());const line=lines[index+1];
    if(index<0||!line||!/^\d[\d, ]*$/.test(line))continue;const value=Number(line.replace(/[ ,]/g,''));if(!Number.isSafeInteger(value)||value>1e9)break;
    const evidence='[C1]\n'+replace(text);blocks.push({id:'B'+(blocks.length+1),text:evidence});size+=evidence.length;
    observations.push({kind:'reward',cardId:'C1',key:title,title,value,currency:'points',date:'',status:'unknown',evidence});break;
   }
  }
 }
 if(bank==='Amex HK'&&selectedCardId&&/^\/activity\/statement$/.test(location.pathname)&&self.CardyReader?.amexHkTransactionRows){
  const end=new URL(location.href).searchParams.get('end'),periods=[...document.querySelectorAll('a[href]')].filter(visible).filter(a=>{try{return new URL(a.href).searchParams.get('end')===end&&/^20\d{2}年\d{1,2}月\d{1,2}日\s*至\s*20\d{2}年\d{1,2}月\d{1,2}日$/.test(a.innerText.trim());}catch{return false;}}).map(a=>a.innerText.trim());
  const period=[...new Set(periods)].length===1?periods[0]:'';
  for(const table of query('table').filter(visible)){
   const headers=[...table.querySelectorAll('th')].map(e=>e.innerText.trim());if(!['日期','狀態','描述','金額'].every(h=>headers.includes(h)))continue;
   const rows=[...table.querySelectorAll('tbody tr')].filter(visible).map(tr=>{const cells=[...tr.querySelectorAll('td')];return {date:cells[0]?.innerText.match(/(?:(?:20\d{2})年)?\d{1,2}月\d{1,2}日/)?.[0],status:cells[1]?.innerText.trim(),description:cells[2]?.innerText.trim(),amount:cells.at(-1)?.querySelector('p')?.innerText.trim()||cells.at(-1)?.innerText.split('\n')[0].trim()};});
   const parsed=self.CardyReader.amexHkTransactionRows(rows,matches[0],period);for(const i of parsed.items){const evidence=replace(i.evidence);blocks.push({id:'B'+(blocks.length+1),text:evidence});observations.push({...i,key:redact(i.key),title:replace(i.title),evidence});size+=evidence.length;}
  }
 }
 if(bank==='Amex HK'&&selectedCardId&&/^\/(?:rewards|card-benefits\/view-all)\/?$/.test(location.pathname)){
  const add=item=>{blocks.push({id:'B'+(blocks.length+1),text:item.evidence});observations.push(item);size+=item.evidence.length;};
  for(const group of query('[role="group"]').filter(visible)){
   const title=group.querySelector('h3')?.innerText.trim(),text=replace(group.innerText||'').trim();if(!title||text.length>1400)continue;
   const spend=text.match(/HK\$\s*([\d,]+(?:\.\d{2})?)\s*已簽賬|已簽賬\s*HK\$\s*([\d,]+(?:\.\d{2})?)/);if(spend){const value=Number((spend[1]||spend[2]).replaceAll(',',''));if(Number.isFinite(value)&&value>=0&&value<=1e9)add({kind:'benefit',cardId:'C1',key:'spend_progress',title,value,currency:matches[0].currency,date:'',status:'unknown',evidence:'[C1]\n'+text});}
  }
  if(location.pathname==='/card-benefits/view-all'){
   const titles=new Set();for(const h of query('h4').filter(visible)){const title=h.innerText.replace(/\s+/g,' ').trim();if(!title||title.length>300||titles.has(title)||h.closest('header,footer'))continue;titles.add(title);add({kind:'benefit',cardId:'C1',key:'entitlement',title,value:null,currency:matches[0].currency,date:'',status:'unknown',evidence:'[C1]\n'+title});}
  }
 }
 const offerLabel=e=>(e.innerText||e.getAttribute('aria-label')||(e.id?document.querySelector('label[for="'+CSS.escape(e.id)+'"]')?.innerText:'')||'').trim();
 const findOfferView=()=>[...document.querySelectorAll('[role=radio][aria-checked=true],input[type=radio]:checked,[role=tab][aria-selected=true]')].find(e=>visible(e)&&/^(?:Available|可用|已儲存至卡中|Added to Card|Registered to Card)(?:\s*\(\d+\))?$/i.test(offerLabel(e)));
 let selectedOffer=findOfferView();let offerView=selectedOffer?(/^(?:Available|可用)/i.test(offerLabel(selectedOffer))?'available':'added'):null;
 const offerNodeShown=e=>{for(let n=e;n;n=n.parentElement){const style=getComputedStyle(n);if(n.hidden||n.getAttribute('aria-hidden')==='true'||['SCRIPT','STYLE','TEMPLATE'].includes(n.tagName)||style.display==='none'||style.visibility==='hidden')return false;if(n.getAttribute('aria-label')==='offer info')break;}return true;};
 const offerContent=e=>{const paragraphs=[...e.querySelectorAll('p')].filter(offerNodeShown).map(p=>(p.innerText||p.textContent||'').trim());const leaves=[...e.querySelectorAll('*')].filter(n=>!n.children.length&&offerNodeShown(n)).map(n=>(n.textContent||'').trim()).filter(Boolean);return {paragraphs,text:[...new Set([...paragraphs,...leaves])].join('\n')};};
 // The Amex offer-info region supplies merchant, terms, expiry and an explicit
 // Add-to-card control. Read its label; never invoke that control.
 if(bank.startsWith('Amex ')&&matches.length===1&&location.pathname.startsWith('/offers')){
  const initialY=window.scrollY,offerRegionsSeen=new Set();let expected=null,stableEnd=0;
  if(initialY){window.scrollTo({top:0,behavior:'instant'});await new Promise(r=>setTimeout(r,200));}
  for(let pass=0;pass<12;pass++){
  selectedOffer=findOfferView();offerView=selectedOffer?(/^(?:Available|可用)/i.test(offerLabel(selectedOffer))?'available':'added'):null;const counter=selectedOffer&&offerLabel(selectedOffer).match(/\((\d+)\)/);expected=counter?Number(counter[1]):null;
  const beforeCount=observations.filter(o=>o.kind==='offer').length;
  for(const region of document.querySelectorAll('[aria-label="offer info"]')){
   if(!visible(region)||observations.length>=500||size>400000)continue;const control=region.querySelector('button[aria-label^="Add to card offer:"]'),saved=offerView==='added';if(!control&&!saved)continue;
   const content=offerContent(region),title=control?control.getAttribute('aria-label').replace(/^Add to card offer:\s*/,'').trim():(content.paragraphs[1]||region.querySelector('img[alt]')?.getAttribute('alt')||'').trim(),text=replace(content.text).trim();
   if(!title||!text.includes(title)||text.length>1400)continue;
   const regionKey=region.id||title+'|'+text;if(offerRegionsSeen.has(regionKey))continue;offerRegionsSeen.add(regionKey);
   const evidence='[C1]\n'+text;blocks.push({id:'B'+(blocks.length+1),text:evidence});seen.add(text);size+=evidence.length;
   const iso=text.match(/(?:^|[^0-9])(20\d{2}-\d{2}-\d{2})(?!\d)/),date=text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
   observations.push({kind:'offer',cardId:'C1',key:'',title,value:null,currency:matches[0].currency,date:iso?iso[1]:date?`${date[3]}-${date[1].padStart(2,'0')}-${date[2].padStart(2,'0')}`:'',status:saved?'added':'available',evidence});
  }
  const count=observations.filter(o=>o.kind==='offer').length;
  if((expected>0&&count>=expected)||count>=500||size>400000)break;
  const atEnd=window.scrollY+window.innerHeight>=document.documentElement.scrollHeight-4;
  stableEnd=atEnd&&count===beforeCount?stableEnd+1:0;if(stableEnd>=2&&count>0)break;
  window.scrollBy({top:Math.max(300,window.innerHeight*.8),behavior:'instant'});await new Promise(r=>setTimeout(r,250));
  }
  window.scrollTo({top:initialY,behavior:'instant'});
 }

 for(const el of query('tr,[role=row],li,[role=listitem],section,article,p,dl')){
  if(!visible(el)||el.closest('form,[id="cardybara-bank-guide"],nav,header,footer,select-account-dropdown'))continue;
  const rowText=scopedText(el.innerText||'').trim();const text=period&&el.tagName==='TR'&&el.querySelector('td')?(selectedCardId?'[C1]\n':'')+'Statement Period:\n'+period+'\nTransaction:\n'+rowText:rowText;
  if(text.length<5||text.length>1400||!(financial.test(text)||(/^(TR|LI)$/.test(el.tagName)&&/[0-9]/.test(text)))||seen.has(text)||size+text.length>18000)continue;
  if(/password|one.time|verification code|security code|密碼|密码|驗證碼|验证码|username|用戶名|用户名/i.test(text))continue;
  seen.add(text);blocks.push({id:'B'+(blocks.length+1),text});size+=text.length;if(blocks.length>=60)break;
 }
 // Balance/reward widgets often use divs even when marketing paragraphs exist.
 // Always include bounded windows around visible financial headings.
 for(const heading of query('h1,h2,h3,h4')){if(!visible(heading)||heading.closest('select-account-dropdown,nav,header,footer,[id="cardybara-bank-guide"]')||!financial.test(heading.innerText||''))continue;let el=heading;for(let n=0;n<4&&el.parentElement;n++){el=el.parentElement;const rowText=scopedText(el.innerText||'').trim();const text=period&&el.tagName==='TR'&&el.querySelector('td')?(selectedCardId?'[C1]\n':'')+'Statement Period:\n'+period+'\nTransaction:\n'+rowText:rowText;if(text.length>1400)break;if(text.length>15&&!seen.has(text)&&size+text.length<=22000){seen.add(text);blocks.unshift({id:'B'+(blocks.length+1),text});size+=text.length;}}}
 // Some bank SPAs use divs exclusively. Keep bounded windows around financial labels.
 {const lines=sourceBody.split('\n').map(s=>s.trim()).filter(Boolean);for(let i=0;i<lines.length&&blocks.length<30;i++){if(!financial.test(lines[i]))continue;const text=scopedText(lines.slice(Math.max(0,i-1),i+5).join('\n'));if(!text)continue;if(text.length>1400||/password|verification|security code|密碼|密码|驗證碼|验证码/i.test(text))continue;blocks.push({id:'B'+(blocks.length+1),text});}}
 const links=[];
 for(const a of query('a[href]')){if(!visible(a)||a.closest('footer,header,nav,[id=\"cardybara-bank-guide\"]'))continue;let label=replace(a.innerText||'').trim();if(/\/offers(?:\?|$)/.test(a.href))label='優惠 · '+label;if(/\/(?:activity(?:\/(?:recent|transactions))?|transactions)\/?(?:[?#]|$)/.test(a.href))label='交易 · '+label;if(label&&label.length<100)links.push({label,href:a.href});if(links.length>=150)break;}
 const empty=[];if(matches.length===1){const id=matches[0].id;const area=document.querySelector('main')?.innerText||'';if(/^\/activity(?:\/(?:recent|transactions|statement))?$/.test(location.pathname)&&/(?:您在此賬單週期內沒有賬項[。.]?|您在此账单周期内没有账项[。.]?|沒有最近交易|没有最近交易|No recent transactions|No transactions (?:to display|found)|You don.t have any transactions since your last statement\.)/i.test(area))empty.push({kind:'transaction',cardId:id})}
 if(selectedCardId){const currentHeader=citiBlock?citiBlock.heading:boaHeading?boaHeadingsNow():(bank==='HSBC HK'?hsbcIdentity():query('button[aria-label="open_title"],[role="combobox"][aria-label="Open to manage your other accounts"]').filter(visible).map(e=>e.innerText||'').join('\n'));const selected=cards.find(c=>c.id===selectedCardId);if(!new RegExp('(?:^|[^0-9])'+selected.tail+'(?:[^0-9]|$)').test(currentHeader))return {error:'document_changed'};}
 if(bank==='HSBC HK'&&selectedCardId){const area=query('.cc-transaction-history-container p.zero-transaction').find(visible);if(area&&/^There are no transactions to display\.$/i.test(area.innerText.trim())&&!query('#loading-spinner').some(visible))empty.push({kind:'transaction',cardId:selectedCardId});}
 const coverage=[];
 if(bank.startsWith('Amex ')&&matches.length===1&&location.pathname.startsWith('/offers')&&selectedOffer){const counter=offerLabel(selectedOffer).match(/\((\d+)\)/);if(counter)coverage.push({kind:'offer',cardId:matches[0].id,view:offerView,expected:Number(counter[1]),confirmedEmpty:/(?:No offers (?:are )?available|You have no (?:available|registered) offers|暫時未有(?:可用)?優惠|暂时没有(?:可用)?优惠)/i.test(document.querySelector('main')?.innerText||body)});}
 // A named programme this version does not collect is reported, so its card is not left partial.
 const notCollected=bank.startsWith('Amex ')&&selectedCardId&&self.CardyReader?.otherRewardLabels?self.CardyReader.otherRewardLabels(body.split('\n').map(t=>t.replace(/[®™]/g,'').trim()).filter(Boolean),t=>requiredAmexReward.test(t)).map(programme=>({cardId:'C1',programme})):[];
 return {pageHref:location.href,empty,coverage,notCollected,observations,blocks:blocks.slice(0,600).map((b,i)=>({...b,id:'B'+(i+1)})),aliases,links,capturedAt:new Date().toISOString()};
}
