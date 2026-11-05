// The last resort when a model answer about a purchase fails its checks twice: code writes it from the decision.
import {answerLanguage} from './creditAnswer.js';
const WORDS={
 'zh-CN':{use:'用 {0}。',depends:'这笔没有现金返现的卡可比；积分卡之间要看你给每点的估值。',currency:'你的卡用不同货币结算，要看在哪里、用什么货币付：',none:'没有找到能比较的卡。',value:'按记录的规则约得 {0} {1}。',rate:'{0}% 返现（没有可比金额，只比较比例）。',valuedRate:'按你给的每点 {0} 分，{1} 倍积分约合消费的 {2}%（没有可比金额，只比较比例）。',conditional:'这是有条件的结果：商户编码、剩余上限和登记状态都未确认。',confirmed:'规则没有附加条件，但实际入账仍以银行为准。',points:'积分方案',over:'你给每点估值超过 {0} {1}分时，这张卡更划算',rate2:'每单位消费 {0}',mile:'每 {0} 港币 1 里',foreign:'外币手续费没有记录，不代表没有。',note:'这是根据比较结果自动整理的摘要。'},
 'zh-TW':{use:'用 {0}。',depends:'這筆沒有現金回饋的卡可比；積分卡之間要看你給每點的估值。',currency:'你的卡用不同貨幣結算，要看在哪裡、用什麼貨幣付：',none:'沒有找到能比較的卡。',value:'按記錄的規則約得 {0} {1}。',rate:'{0}% 回饋（沒有可比金額，只比較比例）。',valuedRate:'按你給的每點 {0} 分，{1} 倍積分約合消費的 {2}%（沒有可比金額，只比較比例）。',conditional:'這是有條件的結果：商戶編碼、剩餘上限和登記狀態都未確認。',confirmed:'規則沒有附加條件，但實際入帳仍以銀行為準。',points:'積分方案',over:'你給每點估值超過 {0} {1}分時，這張卡更划算',rate2:'每單位消費 {0}',mile:'每 {0} 港幣 1 里',foreign:'外幣手續費沒有記錄，不代表沒有。',note:'這是根據比較結果自動整理的摘要。'},
 en:{use:'Use {0}.',depends:'No cash-back card applies here. Among points cards, it depends on what you value a point at.',currency:'Your cards bill in different currencies, so it depends on where and in which currency you pay:',none:'No card could be compared.',value:'About {0} {1} on the recorded rules.',rate:'{0}% cash back (no comparable amount, so rates are compared).',valuedRate:'At your {0} cents a point, {1}x points are worth about {2}% of spend (no comparable amount, so rates are compared).',conditional:'This is conditional: merchant coding, remaining caps and enrollment are not confirmed.',confirmed:'The rule has no added condition, though the bank decides what posts.',points:'Points options',over:'better once you value a point above {0} {1} cents',rate2:'{0} per unit of spend',mile:'1 mile per HKD {0}',foreign:'Foreign transaction fees are not recorded, which does not mean there are none.',note:'This is an automatic summary of the comparison.'}
};
const fill=(text,...args)=>args.reduce((t,a,i)=>t.replace('{'+i+'}',a),text);
export function renderChoiceAnswer(result,question){
 const lang=answerLanguage(question),w=WORDS[lang],lines=[],{choice}=result;
 if(choice.kind==='none')return [w.none,w.note].join('\n\n');
 if(choice.kind==='depends-on-currency')return [w.currency,...choice.options.map(o=>`- ${o.currency}: ${o.card||'—'}`),'',w.note].join('\n');
 if(choice.kind==='use-card'){
  lines.push(fill(w.use,choice.card));
  const lead=result.rows.find(r=>r.card===choice.card);
  lines.push(choice.basis==='money'?fill(w.value,choice.currency,choice.value):choice.basis==='rate-at-your-point-value'?fill(w.valuedRate,lead.centsPerPoint,lead.earn.rate,lead.percentAtYourPointValue):fill(w.rate,lead.earn.rate));
  lines.push(choice.certainty==='confirmed'?w.confirmed:w.conditional);
  if(lead.foreign)lines.push(w.foreign);
 }else lines.push(w.depends);
 if(result.pointsAlternatives.length){
  lines.push('','**'+w.points+'**');
  for(const p of result.pointsAlternatives)lines.push(`- ${p.card}${p.programme?' · '+p.programme:''}: ${p.points!=null?p.points:p.unit==='HKD-per-mile'?fill(w.mile,p.rate):fill(w.rate2,p.rate)}${p.breakEvenCentsPerPoint!=null?' ('+fill(w.over,p.breakEvenCentsPerPoint,result.purchase.currency||'')+')':''}`);
 }
 lines.push('',w.note);
 return lines.join('\n');
}
