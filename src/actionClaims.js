// Claims that an action is already done. The assistant is read-only: it can't pay, transfer points, enrol, activate,
// book or mark anything, and it can't see whether the user did. So any answer saying such a thing happened is ungrounded,
// whoever it names as the doer (I, for you, passive, no subject) and however "done" is said (#157).
// "将/將" hedges only as a future ("将于", "将会"); as an object marker ("替你将积分兑换为…") it does not (#301).
// The test is per clause: a clause that is conditional, a question, a negation, an instruction or a future
// ("if you enrolled", "你可以去登记", "to transfer, go to…") describes the action without claiming it.

// Verbs for the actions, and the subset that changes the user's enrolment or activation status.
const ZH_ENROL='登记|登記|注册|註冊|报名|報名|激活|启用|啟用|开通|開通|绑定|綁定|关联|關聯';
const ZH_ACTION='转点|轉點|转分|轉分|转[到入出移换好]|轉[到入出移換好]|转过去|轉過去|兑换|兌換|换成|換成|付款|支付|缴付|繳付|缴清|繳清|还清|還清|还款|還款|转账|转帐|轉帳|轉賬|预订|預訂|订好|訂好|领取|領取|申请|申請';
// Marking a credit is something the user does in the wallet (query_credits returns those marks), and a benefit can be
// cancelled by its issuer: these count only when the assistant says it did them.
const ZH_AGENT_ONLY='标记|標記|取消';
const ZH_DONE='完成|成功|完毕|完畢|好了|妥了|搞定|到账|到賬';
const ZH_AGENT=/我|[帮幫为為替给給代]你/;
const ZH_HEDGE=/如果|若|假如|假设|假設|一旦|是否|有没有|有沒有|[吗嗎呢][？?。！!]?$|[？?]|[成功完]后|[成功完]後|之后|之後|以后|以後|之前|以前|才|需要|必须|必須|须|須|要先|请|請|可以|可|能否|无法|無法|不能|没办法|沒辦法|不会|不會|未|没有|沒有|没|沒|不代表|无法确认|確認一下|确认一下|的话|的話|记得|記得|建议|建議|[将將](?=[会會于於在要可能])|即将|即將|会自动|會自動/;
// The gap allows a long object before the verb ("已經替你把 Membership Rewards 點數兌換成…", #301).
const zhCompleted=new RegExp(`已(?:经|經)?[^，,。；;！!？?\\n]{0,40}?(${ZH_ENROL}|${ZH_ACTION})(?!的)|(${ZH_ENROL}|${ZH_ACTION})已?(?:${ZH_DONE})`);
const zhAgentDid=new RegExp(`(?:我|[帮幫为為替给給代]你)[^，,。；;！!？?\\n]{0,16}?(?:${ZH_AGENT_ONLY})`);
const zhStatus=/(?:已经|已經|已|现在|現在)(?:是|成为|成為)[^，,。；;]{0,12}(?:会员|會員|会籍|會籍)/;
// A membership or status said to be in effect or upgraded (#301). Only status nouns count: a credit or offer can be
// "已生效" because its dates say so, which the wallet knows.
const ZH_STATUS='会籍|會籍|会员|會員|等级|等級|级别|級別|身份|状态|狀態|升级|升級';
const zhStatusActive=new RegExp(`(?:${ZH_STATUS})[^，,。；;！!？?\\n]{0,16}?(?:已(?:经|經)?|现在|現在)(?:正式|成功)?(?:生效|升级|升級|啟用|启用)(?!的)|(?:已(?:经|經)?|现在|現在)(?:成功)?(?:升级|升級)(?:为|為|到|成)`);
const zhHandled=/[帮幫为為替给給代]你(?:都)?(?:搞定|办好|辦好|弄好|处理好|處理好|操作好)/;

const EN_ENROL='enrolled|registered|activated|signed (?:you )?up';
const EN_ACTION='transferred|moved|converted|sent|paid|booked|reserved|redeemed|submitted|linked|applied|added|unlocked';
// As in Chinese, marking and cancelling count only when the assistant says it did them.
const EN_AGENT_ONLY='marked|cancell?ed';
const EN_HEDGE=/\b(?:if|whether|once|after|before|when|unless|until|can|could|may|might|need|needs|must|should|would|will|cannot|not|never|please|check|make sure|required|requires|how)\b|n't\b|\bto (?:enrol|enroll|register|activate|transfer|pay|book|redeem|link|move|convert)\b|\?/i;
const ADV='(?:(?:already|just|now|successfully|officially|all|gone ahead and|went ahead and)\\s+)*';
const enAgent=new RegExp(`\\bI(?:'ve|'d| have| had)?\\s+${ADV}(${EN_ENROL}|${EN_ACTION}|${EN_AGENT_ONLY})\\b`,'i');
const enPerfectPassive=new RegExp(`\\b(?:has|have|had|'ve|'s)\\s+${ADV}been\\s+${ADV}(${EN_ENROL}|${EN_ACTION})\\b`,'i');
// "was/were" also describes history ("this credit was added in 2025"), so only the narrower set counts there.
const enPastPassive=new RegExp(`\\b(?:was|were)\\s+${ADV}(${EN_ENROL}|transferred|moved|converted|sent|paid|booked|redeemed)\\b`,'i');
const enNowState=new RegExp(`\\b(?:is|are|'s|'re)\\s+(?:now|already|successfully|officially|all)\\s+${ADV}(${EN_ENROL}|${EN_ACTION}|done|complete|completed|confirmed)\\b`,'i');
// A passive with "now" after it ("are converted to Asia Miles now"), and "got converted" (#301).
const enStateNow=new RegExp(`\\b(?:is|are|'s|'re)\\s+(${EN_ENROL}|transferred|moved|converted|sent|paid|booked|redeemed)\\b[^.;!?,]{0,40}\\bnow\\b`,'i');
const enGot=new RegExp(`\\bgot\\s+${ADV}(${EN_ENROL}|transferred|moved|converted|sent|paid|booked|redeemed)\\b`,'i');
// A status said to be active, live or upgraded now (#301). Only with a status noun in the clause: a credit or offer can be
// "active now" because its dates say so.
const EN_STATUS=/\b(?:status|upgrade|membership|tier|elite|enrol(?:l)?ment|registration)\b/i;
const enStatusActive=/\b(?:is|are|'s|'re)\s+(?:(?:now|already|officially)\s+)?(?:active|live|in effect|upgraded)\s+now\b|\b(?:is|are|'s|'re)\s+(?:now|already|officially)\s+(?:active|live|in effect|upgraded)\b|\b(?:now|already)\s+upgraded\b/i;
const enYouUpgraded=/\byou(?:'re| are|'ve been| have been)\s+(?:(?:now|already|officially|successfully)\s+)*upgraded\b/i;
const enYouStatus=new RegExp(`\\byou(?:'re| are|'ve| have)\\s+${ADV}(?:been\\s+)?(${EN_ENROL})\\b`,'i');
const enNounDone=/\b(transfer|enrollment|enrolment|registration|activation|payment|booking|redemption)s?\b(?:[^.;!?]{0,40}?\b(?:is|was|has been|have been)\s+(?:now\s+)?|\s+)(?:complete|completed|done|confirmed|successful|processed|finished)\b/i;
const enForYou=/\b(?:done|taken care of|handled|went through|gone through|marked|cancell?ed)\b[^.;!?]{0,30}\bfor you\b|\bwent through\b/i;
const isEnrol=word=>new RegExp(`^(?:${ZH_ENROL}|${EN_ENROL}|enrollment|enrolment|registration|activation)$`,'i').test(word);

// A sentence that restates what the user said ("你说积分已经兑换了", "You said your points were converted") reports their
// statement rather than claiming the action (#301).
const REPORTED=/^\s*(?:你(?:刚才|剛才|之前)?(?:说|說|提到|表示|讲|講|告诉我|告訴我)|据你|據你|根据你|根據你|按你|照你|(?:you|you've)\s+(?:said|mentioned|told me|say|noted)\b|according to you\b|as you (?:said|mentioned)\b)/i;

export function actionClaimIssues(answer){
 const codes=new Set();
 const sentences=String(answer||'').split(/(?<=[。！？!?\n])|(?<=\.)\s+/).filter(s=>!REPORTED.test(s));
 const clauses=sentences.flatMap(s=>s.split(/(?<=[。！？!?；;，,：:\n—–])|(?<=\.)\s+/));
 for(const clause of clauses){
  const zh=/[㐀-鿿]/.test(clause);
  if(zh&&!ZH_HEDGE.test(clause)){
   const m=clause.match(zhCompleted);
   if(m){const verb=m[1]||m[2];if(isEnrol(verb)){codes.add('unverified_enrollment');if(ZH_AGENT.test(clause))codes.add('unauthorized_action_claim');}else codes.add('unauthorized_action_claim');}
   if(zhStatus.test(clause)||zhStatusActive.test(clause))codes.add('unverified_enrollment');
   if(zhHandled.test(clause)||zhAgentDid.test(clause))codes.add('unauthorized_action_claim');
  }
  if(/[a-z]/i.test(clause)&&!EN_HEDGE.test(clause)){
   const agent=clause.match(enAgent);
   if(agent){codes.add('unauthorized_action_claim');if(isEnrol(agent[1]))codes.add('unverified_enrollment');}
   for(const re of [enPerfectPassive,enPastPassive,enNowState,enStateNow,enGot]){const m=clause.match(re);if(m)codes.add(isEnrol(m[1])?'unverified_enrollment':'unauthorized_action_claim');}
   if(enYouStatus.test(clause)||enYouUpgraded.test(clause)||(EN_STATUS.test(clause)&&enStatusActive.test(clause)))codes.add('unverified_enrollment');
   const noun=clause.match(enNounDone);if(noun)codes.add(isEnrol(noun[1])?'unverified_enrollment':'unauthorized_action_claim');
   if(enForYou.test(clause))codes.add('unauthorized_action_claim');
  }
 }
 return [...codes].map(code=>({code}));
}
