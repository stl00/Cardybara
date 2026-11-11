import {actionClaimIssues} from './actionClaims.js';
import {creditClaimIssues,planCoverageIssues,choiceIssues,flightPlanIssues} from './creditClaims.js';
const cleanUrl=url=>url.replace(/[.,，。；;]+$/,'').replace(/\/$/,'');
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
 issues.push(...actionClaimIssues(answer));
 issues.push(...creditClaimIssues(answer,evidence,creditNames),...planCoverageIssues(answer,evidence),...choiceIssues(answer,evidence),...flightPlanIssues(answer,evidence));
 // Also check answers that skipped tools; absence of evidence is not permission to invent.
 const content=answer.replace(/https?:\/\/[^\s)\]"<>]+/g,'').replace(/^\s*\d+[.)、]\s/gm,'');
 for(const n of content.match(/\d+(?:,\d{3})*(?:\.\d+)?/g)||[])if(!numbers.has(Number(n.replaceAll(',',''))))issues.push({code:'unsupported_number',value:n});
 return {passed:issues.length===0,issues:[...new Map(issues.map(i=>[JSON.stringify(i),i])).values()]};
}
