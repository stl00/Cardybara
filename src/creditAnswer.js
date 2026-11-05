// The last resort when a model answer about credits fails its checks twice: code writes the answer from the tool's groups.
// Plainer than a model answer, but it can only say what the tool returned.
const WORDS={
 'zh-CN':{dates:'按 {0} 至 {1} 查询',assumed:'（日期是推定的）',status:'状态只来自你的手动标记；公开额度不代表剩余额度。',limit:'公开额度',until:'周期至',reason:'原因',
  markedUnused:'你标记为未用或部分已用',unknownStatus:'没有标记，不确定是否用过',markedUsed:'你标记为已用或本期不用',noFixedCycle:'没有固定周期，状态未确认',cycleUnknown:'周期无法确定，状态未确认',outsideDates:'不适用于这些日期',more:'结果较多，只列出一部分。',none:'没有找到相关 Credit。',note:'这是根据查询结果自动整理的摘要。'},
 'zh-TW':{dates:'依 {0} 至 {1} 查詢',assumed:'（日期是推定的）',status:'狀態只來自你的手動標記；公開額度不代表剩餘額度。',limit:'公開額度',until:'週期至',reason:'原因',
  markedUnused:'你標記為未用或部分已用',unknownStatus:'沒有標記，不確定是否用過',markedUsed:'你標記為已用或本期不用',noFixedCycle:'沒有固定週期，狀態未確認',cycleUnknown:'週期無法確定，狀態未確認',outsideDates:'不適用於這些日期',more:'結果較多，只列出一部分。',none:'沒有找到相關 Credit。',note:'這是根據查詢結果自動整理的摘要。'},
 en:{dates:'Checked {0} to {1}',assumed:' (assumed dates)',status:'Status comes only from your manual marks. A public limit is not a remaining balance.',limit:'public limit',until:'cycle ends',reason:'reason',
  markedUnused:'You marked these unused or partly used',unknownStatus:'No mark, so not confirmed either way',markedUsed:'You marked these used or skipped',noFixedCycle:'No fixed cycle, status not confirmed',cycleUnknown:'Cycle cannot be determined, status not confirmed',outsideDates:'Do not apply to these dates',more:'Showing part of a longer list.',none:'No matching credits found.',note:'This is an automatic summary of the lookup.'}
};
const REASONS={
 'anniversary-date-unknown':{'zh-CN':'账户周年日未知','zh-TW':'帳戶週年日未知',en:'account anniversary unknown'},
 'account-version-unverified':{'zh-CN':'账户版本未核实','zh-TW':'帳戶版本未核實',en:'account version unverified'},
 'product-variant-unconfirmed':{'zh-CN':'卡片版本未确认','zh-TW':'卡片版本未確認',en:'card version unconfirmed'},
 'current-cycle-ends-before-dates':{'zh-CN':'当前周期在这些日期前结束','zh-TW':'目前週期在這些日期前結束',en:'current cycle ends before these dates'},
 'rule-expired':{'zh-CN':'规则已到期','zh-TW':'規則已到期',en:'rule has ended'},
 'rule-not-started':{'zh-CN':'规则尚未生效','zh-TW':'規則尚未生效',en:'rule has not started'},
};
export function answerLanguage(question){
 if(!/[㐀-鿿]/.test(question))return 'en';
 return /[還沒飯聖誕麼額週裡這個訂帳餘標確認]/.test(question)?'zh-TW':'zh-CN';
}
const GROUPS=['markedUnused','unknownStatus','markedUsed','noFixedCycle','cycleUnknown','outsideDates'];
export function renderCreditAnswer(result,question){
 const lang=answerLanguage(question),w=WORDS[lang],lines=[];
 const assumed=result.window.assumptions.length?w.assumed:'';
 lines.push(w.dates.replace('{0}',result.window.start).replace('{1}',result.window.end)+assumed+(lang==='en'?'. ':'。')+w.status);
 const titleOf=i=>lang==='en'?i.titles?.en||i.title:lang==='zh-TW'?i.titles?.['zh-TW']||i.title:i.title;
 for(const group of GROUPS){
  if(!result.groups[group].length)continue;
  lines.push('','**'+w[group]+'**');
  for(const i of result.groups[group]){
   const reason=i.reason?REASONS[i.reason]?.[lang]||i.reason:null;
   const parts=[i.publicLimit==null?null:`${w.limit} ${i.currency} ${i.publicLimit}`,i.cycle?`${w.until} ${i.cycle.end}`:null,reason?`${w.reason}: ${reason}`:null].filter(Boolean);
   lines.push(`- ${i.card} · ${titleOf(i)}${parts.length?' ('+parts.join('; ')+')':''}`);
  }
 }
 if(!GROUPS.some(g=>result.groups[g].length))lines.push('',w.none);
 if(result.truncated)lines.push('',w.more);
 lines.push('',w.note);
 return lines.join('\n');
}
