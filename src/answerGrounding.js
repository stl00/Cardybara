import {creditClaimIssues,planCoverageIssues,choiceIssues} from './creditClaims.js';
const cleanUrl=url=>url.replace(/[.,，。；;]+$/,'').replace(/\/$/,'');
export function answerGrounding(answer,evidence=[],{contextText='',creditNames=[]}={}){
 const urls=new Set(),numbers=new Set();
 // A citation is grounded only by a source record's url field. A link inside other text, such as a card name read
 // from a bank page or the model's own tool arguments, is data that could carry an injected destination.
 const scan=(value,key)=>{if(Array.isArray(value)){numbers.add(value.length);value.forEach(v=>scan(v,key))}else if(value&&typeof value==='object'){Object.entries(value).forEach(([k,v])=>scan(v,k))}else if(typeof value==='number'&&Number.isFinite(value))numbers.add(value);else if(typeof value==='string'){if(key==='url'&&/^https:\/\/[^\s)\]"<>]+$/.test(value.trim()))urls.add(cleanUrl(value.trim()));for(const n of value.replace(/https:\/\/[^\s)\]"<>]+/g,'').match(/\d+(?:,\d{3})*(?:\.\d+)?/g)||[])numbers.add(Number(n.replaceAll(',','')))}};
 evidence.forEach(v=>scan(v));
 // User-stated amounts may be repeated during clarification; they are not reward evidence.
 for(const n of contextText.match(/\d+(?:,\d{3})*(?:\.\d+)?/g)||[])numbers.add(Number(n.replaceAll(',','')));
 const issues=[];
 const transfers=evidence.flatMap(value=>value?.rules||[]).filter(rule=>rule.kind==='transfer-relationship');
 // A revision number or list length must not accidentally ground a fabricated 1:1 ratio.
 if(transfers.length&&transfers.every(rule=>rule.terms?.ratio==null)&&/\d+(?:\.\d+)?\s*[:：]\s*\d+(?:\.\d+)?/.test(answer))issues.push({code:'unsupported_transfer_ratio'});
 for(const url of answer.match(/https?:\/\/[^\s)\]"<>]+/g)||[])if(!urls.has(cleanUrl(url)))issues.push({code:'unsupported_citation',value:url});
 if(/(?:我已(?:为你|為你)?|已为你|已為你|已经帮你|已經幫你)(?:付款|支付|转账|轉帳|激活|啟用|登记|登記|标记|標記)|\bI (?:have |successfully )?(?:paid|transferred|enrolled|activated|marked)\b/i.test(answer))issues.push({code:'unauthorized_action_claim'});
 const enrollmentText=answer.replace(/(?:不代表|无法确认|無法確認|不能确认|不能確認|未核实|未核實)[^。！？\n]{0,20}你(?:已|已经|已經)(?:登记|登記|激活|啟用)/g,'').replace(/(?:cannot confirm|can't confirm|does not mean|don't know whether)\s+(?:that\s+)?you (?:are|have) (?:already )?(?:enrolled|activated)/gi,'');
 if(/你(?:已|已经|已經)(?:登记|登記|激活|啟用)|you (?:are|have) (?:already )?(?:enrolled|activated)/i.test(enrollmentText))issues.push({code:'unverified_enrollment'});
 issues.push(...creditClaimIssues(answer,evidence,creditNames),...planCoverageIssues(answer,evidence),...choiceIssues(answer,evidence));
 // Also check answers that skipped tools; absence of evidence is not permission to invent.
 const content=answer.replace(/https?:\/\/[^\s)\]"<>]+/g,'').replace(/^\s*\d+[.)、]\s/gm,'');
 for(const n of content.match(/\d+(?:,\d{3})*(?:\.\d+)?/g)||[])if(!numbers.has(Number(n.replaceAll(',',''))))issues.push({code:'unsupported_number',value:n});
 return {passed:issues.length===0,issues:[...new Map(issues.map(i=>[JSON.stringify(i),i])).values()]};
}
