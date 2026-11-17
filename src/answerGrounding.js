import {actionClaimIssues} from './actionClaims.js';
import {creditClaimIssues,planCoverageIssues,choiceIssues,flightPlanIssues} from './creditClaims.js';
const cleanUrl=url=>url.replace(/[.,，。；;]+$/,'').replace(/\/$/,'');
/**
 * A bare link written straight before Chinese text or full-width punctuation ("…/platinum-card/）" or "…/card/。詳情")
 * would be read as one link running into that text, both by the checker and by the chat's link renderer (#357). A
 * space is put where the link's ASCII ends, so the checker and the renderer see the same, real address. Nothing is
 * removed, and a link that was not grounded stays not grounded.
 */
export const separateLinks=text=>text.replace(/(https?:\/\/[^\s)\]"<>\u{80}-\u{10FFFF}]+)(?=[^\s)\]"<>\x00-\x7f])/gu,'$1 ');
const CJK_DIGITS={零:0,〇:0,一:1,二:2,两:2,兩:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
const cjkNumber=s=>{if(!s.includes('十'))return s.length===1?CJK_DIGITS[s]:null;const [tens,ones]=s.split('十');return (tens?CJK_DIGITS[tens]??NaN:1)*10+(ones?CJK_DIGITS[ones]??NaN:0);};
const ORDINAL_WORDS=['first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth','eleventh','twelfth','thirteenth','fourteenth','fifteenth','sixteenth','seventeenth','eighteenth','nineteenth','twentieth'];
/**
 * The positions a question names in words ("第四個", "the fifth one"), as digits. Repeating the user's own ordinal
 * as "第4項" is not a new fact (#357), just as repeating a stated amount is not.
 */
export function statedOrdinals(question){
 const out=[];
 for(const [,n] of question.matchAll(/第\s*([零〇一二两兩三四五六七八九十]{1,3})/g)){const v=cjkNumber(n);if(Number.isInteger(v)&&v>0)out.push(v);}
 for(const [w] of question.toLowerCase().matchAll(/\b[a-z]+(?:st|nd|rd|th)\b/g)){const i=ORDINAL_WORDS.indexOf(w);if(i>=0)out.push(i+1);}
 return [...new Set(out)];
}
export function answerGrounding(answer,evidence=[],{contextText='',creditNames=[]}={}){
 const urls=new Set(),numbers=new Set(),ratios=new Set();
 const ratioKey=(from,to)=>String(to/from);
 // A citation is grounded only by a source record's url field. A link inside other text, such as a card name read
 // from a bank page or the model's own tool arguments, is data that could carry an injected destination.
 // Search suggestions are counts of records, not facts an answer may cite.
 const scan=(value,key)=>{if(Array.isArray(value)){numbers.add(value.length);value.forEach(v=>scan(v,key))}else if(value&&typeof value==='object'){Object.entries(value).forEach(([k,v])=>k==='suggestions'||scan(v,k))}else if(typeof value==='number'&&Number.isFinite(value))numbers.add(value);else if(typeof value==='string'){if(key==='url'&&/^https:\/\/[^\s)\]"<>]+$/.test(value.trim()))urls.add(cleanUrl(value.trim()));for(const n of value.replace(/https:\/\/[^\s)\]"<>]+/g,'').match(/\d+(?:,\d{3})*(?:\.\d+)?/g)||[])numbers.add(Number(n.replaceAll(',','')))}};
 evidence.forEach(v=>scan(v));
 // Rates come only from a rule's own ratio or convert_points rows, each a rule that lists the card; a programme-wide phrase is not one.
 for(const v of evidence)if(v?.kind==='transfer-options')for(const g of v.programmes||[])for(const p of g.partners||[])if(p.ratio?.from>0&&Number.isFinite(p.ratio.to))ratios.add(ratioKey(p.ratio.from,p.ratio.to));
 // User-stated amounts may be repeated during clarification; they are not reward evidence.
 for(const n of contextText.match(/\d+(?:,\d{3})*(?:\.\d+)?/g)||[])numbers.add(Number(n.replaceAll(',','')));
 const issues=[];
 const transfers=evidence.flatMap(value=>value?.rules||[]).filter(rule=>rule.kind==='transfer-relationship');
 for(const rule of transfers)if(rule.terms?.ratio?.from>0&&Number.isFinite(rule.terms.ratio.to))ratios.add(ratioKey(rule.terms.ratio.from,rule.terms.ratio.to));
 // A revision number or list length must not accidentally ground a fabricated 1:1 ratio: with transfer evidence, a
 // from:to ratio in the answer must equal a rate the evidence states (convert_points' ratio, from:to).
 if(transfers.length||evidence.some(value=>value?.kind==='transfer-options'))for(const [text,from,to] of answer.matchAll(/(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)/g))if(!(Number(from)>0&&ratios.has(ratioKey(Number(from),Number(to)))))issues.push({code:'unsupported_transfer_ratio',value:text});
 for(const url of answer.match(/https?:\/\/[^\s)\]"<>]+/g)||[])if(!urls.has(cleanUrl(url)))issues.push({code:'unsupported_citation',value:url});
 // The assistant takes no action and can't see one taken: a claim that one is done, in any wording, is ungrounded.
 // Only a record whose terms need no enrolment and whose official text says it is activated automatically grounds "已自動啟用" (#362).
 const autoActivation=evidence.some(value=>(value?.rules||[]).some(rule=>rule?.terms?.requiresEnrollment===false&&/\bautomatically activated\b|\bactivated automatically\b/i.test([rule.original?.summary,...(rule.original?.quotes||[])].join(' '))));
 issues.push(...actionClaimIssues(answer,{autoActivation}));
 issues.push(...creditClaimIssues(answer,evidence,creditNames),...planCoverageIssues(answer,evidence),...choiceIssues(answer,evidence),...flightPlanIssues(answer,evidence));
 // Also check answers that skipped tools; absence of evidence is not permission to invent.
 const content=answer.replace(/https?:\/\/[^\s)\]"<>]+/g,'').replace(/^\s*\d+[.)、]\s/gm,'');
 for(const n of content.match(/\d+(?:,\d{3})*(?:\.\d+)?/g)||[])if(!numbers.has(Number(n.replaceAll(',',''))))issues.push({code:'unsupported_number',value:n});
 return {passed:issues.length===0,issues:[...new Map(issues.map(i=>[JSON.stringify(i),i])).values()]};
}
