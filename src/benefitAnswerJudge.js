// Answer judge (#289): a model reads the top benefit rules and says which of them answer the question.
// Word tests cannot tell "free airport parking" (no rule) from "somewhere quiet to wait at the airport" (lounge rules):
// both match airport and leave a word no rule has. A reader of the rules can. The judge only removes rules; it never adds
// or reorders them, so it can cut no-answer noise but can only lose recall where it wrongly drops a right rule.
// The model call is injected (complete), so this file has no network code and no key.
export const JUDGE_TOP=5;
const clip=(s,n)=>{const t=String(s||'').replace(/\s+/g,' ').trim();return t.length>n?t.slice(0,n-1)+'…':t;};
const ruleLine=(r,i)=>{
 const titles=[...new Set([r.content?.title,r.original?.title].filter(Boolean))].join(' / ');
 return `${i+1}. ${clip(titles,160)} — ${clip(r.content?.summary||r.original?.summary,220)}`;
};
export function judgeMessages(question,rules){
 return [
  {role:'system',content:'You check search results for a credit-card benefits assistant. Given a question and numbered benefit rules, list the rules that help answer the question: the rule is about the thing asked (a rule about airport lounges answers "somewhere quiet to wait before my flight"; a rule about airline fees does not answer "free airport parking"). A rule that only shares a general word (hotel, airport, dining, insurance, discount, free) with the question does not answer it. Reply with JSON only: {"answers":[numbers]}, or {"answers":[]} when none does.'},
  {role:'user',content:`Question: ${clip(question,400)}\n\nRules:\n${rules.map(ruleLine).join('\n')}`},
 ];
}
// Model output → indices of rules that answer. Anything unreadable returns null, and the caller keeps the rules (fail open).
export function parseJudgement(text,count){
 const m=String(text||'').match(/\{[\s\S]*\}/);if(!m)return null;
 let v;try{v=JSON.parse(m[0]);}catch{return null;}
 if(!Array.isArray(v?.answers)||!v.answers.every(n=>Number.isInteger(n)))return null;
 return [...new Set(v.answers.filter(n=>n>=1&&n<=count).map(n=>n-1))];
}
// Keeps the full result list when at least one of the top rules answers, and returns no rules when none does.
// Only the yes/no is used: noise is about whether anything comes back, and keeping the list whole limits recall loss
// to questions the judge rejects outright.
export async function judgeTopRules(question,rules,complete,{top=JUDGE_TOP}={}){
 const shown=rules.slice(0,top);if(!shown.length)return {rules,judged:false};
 const picked=parseJudgement(await complete(judgeMessages(question,shown)),shown.length);
 if(picked==null)return {rules,judged:false,unreadable:true};
 return {rules:picked.length?rules:[],judged:true,answers:picked.length>0};
}
