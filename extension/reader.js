// Runs in the bank tab's isolated world. Reads visible text, never input values.
function cardybaraParseText(text, bank, cards, capturedAt) {
  const lines=text.replace(/\u00a0/g,' ').split(/\n/).map(s=>s.trim()).filter(Boolean);
  const money=s=>{
    if(!/^[-−(]?\s*(?:(?:HK|CA|US|CN)?\$|HKD|CAD|USD|CNY|RMB|¥|￥)?\s*[-−]?\s*\d[\d,]*(?:\.\d{2})?\s*\)?\s*(?:CR|DR)?$/i.test(s))return null;
    if(!/\.\d{2}|\$|HKD|CAD|USD|CNY|RMB|¥|￥/.test(s)&&s!=='0')return null;
    const n=Number(s.replace(/[^\d.]/g,''));
    if(!Number.isFinite(n)||n>1e9)return null;
    return /[-−(]|CR\b/i.test(s)?-n:n;
  };
  const labels={balance:/^(?:current balance|total balance|outstanding balance|目前結欠|現時結欠|現時結餘|目前結餘|当前余额|結欠|結餘)(?:\s*\([^)]*\))?\s*:?[：]?$/i, available:/^(?:available credit|available credit limit|可用信貸額|可用信貸額度|可用信用額度|可用額度)\s*:?[：]?$/i,statement:/^(?:statement balance|last statement balance|賬單結欠|月結單結欠|結單結欠|月結單結餘)\s*:?[：]?$/i,minimum:/^(?:minimum payment due|minimum payment|minimum amount due|最低還款額|最低付款額)\s*:?[：]?$/i};
  const out=[];
  for(const card of cards){
    const hits=lines.map((s,i)=>new RegExp(`(?:^|[^0-9])${card.tail}(?:[^0-9]|$)`).test(s)?i:-1).filter(i=>i>=0);
    // Each read must have a single, identified account context. Never guess across cards.
    if(!hits.length)continue;
    const fields={};
    for(const [key,label]of Object.entries(labels)){
      const values=[];
      for(let i=0;i<lines.length;i++){
        const near=hits.some(h=>Math.abs(h-i)<=100);if(!near)continue;
        const inline=lines[i].match(/^(.*?)\s+((?:[-−(]|(?:HK|CA|US|CN)?\$|HKD|CAD|USD|CNY|RMB|¥|￥).*)$/i);
        if(inline&&label.test(inline[1].trim())){const value=money(inline[2].trim());if(value!==null)values.push(value);}
        if(!label.test(lines[i]))continue;
        let v=null;for(let j=i+1;j<=Math.min(i+2,lines.length-1);j++){v=money(lines[j]);if(v!==null)break;}
        if(v!==null)values.push(v);
      }
      const unique=[...new Set(values)];if(unique.length===1)fields[key]=unique[0];
    }
    // HSBC's signed raw balance is the inverse of the dashboard debt convention.
    if(bank==='HSBC HK')delete fields.statement;
    if(bank==='HSBC HK'&&fields.balance!==undefined){fields.bankRawBalance=fields.balance;fields.balance=-fields.balance;}
    if(Object.keys(fields).length)out.push({id:card.id,fields,capturedAt});
  }
  return out;
}
function cardybaraReadDocument(document,bank,cards) {
  const visible=el=>!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
  const body=document.body?.innerText||'';
  if(document.querySelector('input[type="password"]')&&visible(document.querySelector('input[type="password"]')))return {status:'needs_login',patches:[]};
  const auth=/approve.*(?:app|mobile)|check your (?:phone|mobile)|push notification|one.time (?:code|passcode)|verification code|手機.*確認|流動保安編碼|保安編碼|認證碼|驗證碼/i.test(body);
  if(auth)return {status:'needs_confirmation',patches:[]};
  const capturedAt=new Date().toISOString(),patches=[];
  const tails=cards.map(c=>c.tail).filter(Boolean);
  const matchesTail=(text,tail)=>new RegExp(`(?:^|[^0-9])${tail}(?:[^0-9]|$)`).test(text);
  for(const card of cards){
    const candidates=[];
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const n=walker.currentNode;if(!matchesTail(n.textContent,card.tail))continue;
      let el=n.parentElement;
      for(let depth=0;el&&depth<9;depth++,el=el.parentElement){
        if(!visible(el))continue;
        const t=el.innerText||'';if(t.length>14000)break;
        if(tails.filter(tail=>matchesTail(t,tail)).length!==1)break;
        const parsed=cardybaraParseText(t,bank,[card],capturedAt);
        if(parsed.length)candidates.push(parsed[0]);
      }
    }
    // Select the richest safe single-account container.
    candidates.sort((a,b)=>Object.keys(b.fields).length-Object.keys(a.fields).length);
    if(candidates.length)patches.push(candidates[0]);
  }
  return {status:patches.length?'updated':/unable to load|temporarily unavailable|information.*unavailable|暫時未能|暫時無法/i.test(body)?'load_error':'no_data',patches,capturedAt};
}

function cardybaraReadBank(bank,cards) {
  const documents=[document];
  for(let i=0;i<documents.length&&i<12;i++){
    for(const frame of documents[i].querySelectorAll('iframe,frame')){
      if(!frame.getClientRects().length)continue;
      try{const doc=frame.contentDocument;if(doc?.body&&!documents.includes(doc))documents.push(doc);}catch{}
    }
  }
  const results=documents.map(doc=>cardybaraReadDocument(doc,bank,cards));
  const merged=new Map(),conflicts=new Map();
  for(const result of results)for(const patch of result.patches||[]){
    if(!merged.has(patch.id)){merged.set(patch.id,{...patch,fields:{...patch.fields}});continue;}
    const current=merged.get(patch.id),blocked=conflicts.get(patch.id)||new Set();
    for(const [key,value]of Object.entries(patch.fields)){
      if(blocked.has(key))continue;
      if(Object.hasOwn(current.fields,key)&&current.fields[key]!==value){delete current.fields[key];blocked.add(key);}else current.fields[key]=value;
    }
    conflicts.set(patch.id,blocked);
  }
  const patches=[...merged.values()].filter(p=>Object.keys(p.fields).length);
  const status=patches.length?'updated':['needs_confirmation','needs_login','load_error'].find(s=>results.some(r=>r.status===s))||'no_data';
  return {status,patches,capturedAt:new Date().toISOString()};
}
