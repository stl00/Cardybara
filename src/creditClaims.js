// Heuristic checks on what an answer says about credit use. They catch the common shapes of "unknown stated as unused"; they are not a semantic proof.
const UNUSED_CLAIM=/(?<!用)(?:(?:没用|沒用|未用|没有用|沒有用)(?![足完尽盡])|没使用|沒使用|没有使用|沒有使用|未使用|未被使用|尚未使用|闲置|閒置|还能用|還能用|还能使用|還能使用|还可以用|還可以用|还可以使用|還可以使用|还可用|還可用|还可以领|還可以領|还没领|還沒領|还剩|還剩)|\b(?:unused|not (?:yet )?(?:been )?used|haven'?t (?:yet )?(?:been )?used|hasn'?t (?:yet )?(?:been )?used|have not (?:yet )?(?:been )?used|has not (?:yet )?(?:been )?used|didn'?t use|did not use|never used|yet to be used|can still use|still (?:have|available|open)|left to use)\b/i;
// Clauses that decline to claim, or that only ask, are not claims of non-use.
const HEDGE=/[?？]\s*$|未确认|未確認|无法|無法|不能确认|不能確認|没有任何|沒有任何|没有.{0,10}标记|沒有.{0,10}標記|不确定|不確定|核实|核實|核对|核對|不知道|不清楚|未知|不代表|不等于|不等於|不能算|不能说|不能說|不能当|不能當|不能视为|不能視為|不算|并非|並非|未标记|未標記|没有标记|沒有標記|没标记|沒標記|未手动|未手動|待确认|待確認|是否|有没有|有沒有|可能|not been marked|not tracked|unknown|unconfirmed|unmarked|not marked|no mark|none of|\bno\b.{0,40}\bmark|unable to|not confirmed|cannot (?:confirm|tell)|can't (?:confirm|tell)|can not (?:confirm|tell)|not sure|don'?t know|do not know|whether|doesn'?t mean|does not mean|not the same/i;
// A condition must come before the claim: "if you haven't used it" hedges, "it's unused if you book FHR" does not.
const CONDITION=/如果|若|假如|要是|\bif\b/i;
// Rule wording about what happens to unused value, not a statement about this user's use.
const RULE_WORDING=/(?:未使用|未用|unused)[^。.!?]{0,30}(?:不会|不會|不结转|不結轉|结转|結轉|作废|作廢|roll|carry|forfeit|expire|lost)|(?:还剩|還剩)\s*\d+\s*(?:天|日)|still have (?:until|to\b|\d+\s*days?)|not used for|(?:还|還)(?:可以|能)(?:用|使用)(?:于|於|在)/i;
const CREDIT_WORD=/credit|cash|coupon|抵扣|额度|額度|福利|优惠|優惠|券|benefit/i;
const UNIVERSAL=/都|全部|所有|两项|兩項|\ball\b|\bboth\b|\bevery\b/i;
const GENERIC_CARD_WORDS=new Set(['the','card','credit','visa','signature','infinite','american','express','amex','chase','bank','america','hsbc','mastercard','rewards','honors','and']);
const norm=s=>String(s||'').normalize('NFKC').toLowerCase();
function titleAnchors(item){
 const titles=[item.title,item.titles?.['zh-TW'],item.titles?.en].filter(Boolean).map(norm);
 // A partial brand phrase such as "The Edit" still names the item in a reworded answer.
 const brands=titles.flatMap(t=>t.match(/[a-z][a-z+&' -]{2,}[a-z]/g)||[]).map(t=>t.replace(/^the /,'').replace(/ (?:credit|credits|hotel|hotels)$/,'').trim()).filter(t=>t.length>=4&&!['credit','lodging','travel','hotel','hotels'].includes(t));
 return [...new Set([...titles,...brands])];
}
const cardAnchors=item=>norm(item.card).split(/[^a-z0-9]+/).filter(w=>w.length>=3&&!GENERIC_CARD_WORDS.has(w));
// Latin anchors match whole words: "credit" contains "edit".
const escaped=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const mentions=(text,anchors)=>anchors.some(a=>/^[\x00-\x7f]+$/.test(a)?new RegExp('(?<![a-z0-9])'+escaped(a)+'(?![a-z0-9])').test(text):text.includes(a));
export const planResults=evidence=>evidence.filter(x=>x?.tool==='query_credits'&&x.groups);
function statusItems(evidence){
 const plans=planResults(evidence);
 // A card decision carries the same marks for the credits it considered.
 const decided=evidence.filter(x=>x?.tool==='choose_card'&&x.rows).flatMap(d=>d.rows.flatMap(r=>(r.credits||[]).map(c=>({...c,card:r.card}))));
 const open=[...plans.flatMap(p=>p.groups.markedUnused),...decided.filter(c=>['unused','partial'].includes(c.status))];
 const closed=[...plans.flatMap(p=>[...p.groups.unknownStatus,...p.groups.cycleUnknown,...p.groups.noFixedCycle,...p.groups.markedUsed,...(p.groups.dismissedByUser||[])]),...decided.filter(c=>!['unused','partial'].includes(c.status))];
 return {open,closed,any:plans.length>0||evidence.some(x=>x?.tool==='choose_card'&&x.rows)};
}
/** Yields each sentence with an unhedged claim of non-use, plus the list items a heading claim introduces. */
function isClaim(clause){
 if(RULE_WORDING.test(clause))return false;
 const hit=clause.match(UNUSED_CLAIM);
 return !!hit&&!HEDGE.test(clause)&&!CONDITION.test(clause.slice(0,hit.index));
}
function claimScopes(answer,anchors){
 const scopes=[];let heading=null;
 for(const raw of answer.split('\n')){
  const line=raw.trim(),listItem=/^(?:[-*•]|\d+[.)、]|\|)/.test(line);
  if(heading&&listItem){heading.text+=' '+line;}
  else if(!listItem&&line)heading=null;
  for(const sentence of line.split(/(?<=[。！？!?；;])|(?<=\.)\s+/)){
   // A hedge carries across commas ("not sure whether used, or unused") but not across "but".
   // A clause that itself names a credit stands alone, so a hedge about another credit can't excuse it.
   const namedClaims=sentence.split(/[，,；;]/).filter(c=>isClaim(c)&&mentions(norm(c),anchors));
   const clauses=namedClaims.length?namedClaims:sentence.split(/\b(?:and|but)\b|但是?/i).filter(isClaim);
   if(!clauses.length)continue;
   const scope={text:clauses.join(' '),sentence};scopes.push(scope);
   if(!listItem&&/[:：]\s*(?:\*\*)?\s*$|^#{1,6}\s|^\*\*.*\*\*$/.test(line))heading=scope;
  }
 }
 return scopes.map(s=>({text:norm(s.text),sentence:norm(s.sentence)}));
}
export function creditClaimIssues(answer,evidence,creditNames=[]){
 const issues=[],{open,closed:returned,any}=statusItems(evidence);
 // A held credit the lookup didn't return, or no lookup at all, has no mark in evidence either.
 const closed=[...returned,...creditNames.filter(n=>!returned.some(r=>r.title===n.title))];
 for(const scope of claimScopes(answer,[...closed,...open].flatMap(titleAnchors))){
  // Prefer the claiming clause; only a clause naming nothing falls back to its sentence.
  const allAnchors=[...closed,...open].flatMap(titleAnchors),text=mentions(scope.text,allAnchors)?scope.text:scope.sentence;
  // The same credit can be marked unused in one cycle and unknown in the next, so a name shared with a marked item is not proof.
  const openTitles=new Set(open.map(i=>i.title));
  const bad=closed.filter(item=>!openTitles.has(item.title)&&mentions(text,titleAnchors(item)));
  // "All of them are unused" is false whenever one is not confirmed unused.
  if(!bad.length&&returned.length&&UNIVERSAL.test(text)){issues.push({code:'unknown_treated_as_unused',sentence:text.slice(0,160)});continue;}
  if(bad.length){for(const item of bad)issues.push({code:any?'unknown_treated_as_unused':'unused_claim_without_evidence',value:item.title,sentence:text.slice(0,160)});continue;}
  if(mentions(text,open.flatMap(titleAnchors)))continue;
  // Nothing is confirmed unused, so a general claim of non-use cannot be true.
  if(any&&!open.length)issues.push({code:'unknown_treated_as_unused',sentence:text.slice(0,160)});
  if(!any&&CREDIT_WORD.test(text))issues.push({code:'unused_claim_without_evidence'});
 }
 const counted=/(?:你|还有|還有|剩余|剩餘|有)\s*\d+\s*(?:项|項)(?:(?!标记|標記).){0,8}(?:未用|没用|沒用|未使用)/.test(answer);
 const unknownPlanned=planResults(evidence).some(p=>p.groups.unknownStatus.length||p.groups.cycleUnknown.length);
 if(counted&&unknownPlanned)issues.push({code:'unknown_treated_as_unused'});
 return issues;
}
const MAX_REQUIRED_ITEMS=15;
const MONTH_NAMES=['january','february','march','april','may','june','july','august','september','october','november','december'];
function statesWindow(answer,start){
 const text=norm(answer),[y,m]=start.split('-'),month=String(Number(m)),name=MONTH_NAMES[Number(m)-1];
 return text.includes(start)||new RegExp(`${y}\\s*[年/.-]\\s*0?${month}(?!\\d)`).test(text)||new RegExp(`(?<!\\d)0?${month}\\s*/\\s*${y}`).test(text)||new RegExp(`\\b(?:${name}|${name.slice(0,3)})\\.?\\s*[\\d\\s,–—~-]*(?:(?:st|nd|rd|th|to)[\\d\\s,–—~-]*)*${y}`).test(text)||new RegExp(`(?<!\\d)0?${month}/\\d{1,2}/${y}`).test(text);
}
/** The answer must state the dates it assumed and must not drop credits the tool found. */
export function planCoverageIssues(answer,evidence){
 const plans=planResults(evidence);if(!plans.length)return [];
 const issues=[],latest=plans.at(-1),text=norm(answer);
 if(latest.window.precision!=='current-cycle'&&!statesWindow(answer,latest.window.start))issues.push({code:'plan_dates_not_stated',value:latest.window.start});
 // A broad listing may be summarised. A focused one must keep every credit with a known cycle, the ones the question is about.
 for(const plan of plans.filter(p=>!p.truncated))for(const item of [plan.groups.markedUnused,plan.groups.unknownStatus].flat().filter((_,i,all)=>all.length<=MAX_REQUIRED_ITEMS))
  if(!mentions(text,[...titleAnchors(item),...cardAnchors(item)]))issues.push({code:'plan_item_omitted',value:item.title});
 return issues;
}
const GLOBAL_BEST=/全局最优|全局最優|最优的卡|最優的卡|最好的卡|最强的卡|最強的卡|所有信用卡(?:里|裡|中)?最|市场上最|市場上最|best card overall|the best card|best overall|globally (?:best|optimal)|always the best|top card on the market|best (?:card )?on the market/i;
// Best among the user's own cards is what the tool computes.
const HELD_SCOPE=/你持有|你的卡|你手上|你手頭|你手头|among (?:the )?(?:cards )?you (?:hold|have)|of your cards|among your cards|your cards/i;
// A point value only ever comes from the user, so an answer can't price points on its own.
const POINT_PRICE=/(?:每点|每點|每分|积分|積分|点数|點數|里程|里数|里數|\bMR\b|\bUR\b|miles?|points?)[^。.!?\n]{0,24}(?:价值|價值|相当于|相當於|约值|約值|大约|大約|约|約|等于|等於|折合|worth|equals?|roughly|about|around|≈)\s*[^。.!?\n]{0,8}(?:\d|\$|美元|美分|港币|港幣|cents?)/i;
// Only a condition on the user's own valuation makes a price hypothetical.
// Repeating the user's own value is not inventing one.
const USER_VALUE=/按你|你说|你說|你给|你給|你认为|你認為|你觉得|你覺得|your (?:value|valuation)|you (?:said|gave|value)|at your/i;
const CONDITIONAL_PRICE=/(?:如果|若|假如|要是)你|(?:如果|若)每[点點]|if you(?:'d)? value|once you value|if (?:a|each|one) (?:point|mile)|超过|超過|above|\bover\b|盈亏|盈虧|打平|保本|break-?even/i;
export function choiceIssues(answer,evidence){
 const decisions=evidence.filter(x=>x?.tool==='choose_card'&&x.choice);if(!decisions.length)return [];
 const issues=[],latest=decisions.at(-1),text=norm(answer);
 // Saying it is not a global best is the honest version, so a negated phrase passes.
 if(answer.split(/\n|(?<=[。！？!?；;])/).some(line=>{const hit=line.match(GLOBAL_BEST);return hit&&!HELD_SCOPE.test(line)&&!/不是|并非|並非|不代表|不等于|不等於|\bnot\b|\bno\b|isn't|never|非/i.test(line.slice(Math.max(0,hit.index-12),hit.index));}))issues.push({code:'global_best_claim'});
 if(latest.choice.kind==='use-card'){
  const anchors=cardAnchors({card:latest.choice.card});
  if(anchors.length&&!mentions(text.slice(0,240),anchors))issues.push({code:'choice_not_first',value:latest.choice.card});
 }
 // Pricing is allowed only on a line about a card the user gave a value for.
 const valued=decisions.flatMap(d=>(d.rows||[]).filter(r=>r.centsPerPoint!=null)).flatMap(r=>cardAnchors({card:r.card}));
 for(const line of answer.split(/\n|(?<=[。！？!?])/))if(POINT_PRICE.test(line)&&!CONDITIONAL_PRICE.test(line)&&!(valued.length&&(mentions(norm(line),valued)||USER_VALUE.test(line))))issues.push({code:'unstated_point_value',sentence:line.slice(0,160)});
 return issues;
}
