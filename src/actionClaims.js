// Claims that an action is already done. The assistant is read-only: it can't pay, transfer points, enrol, activate,
// book or mark anything, and it can't see whether the user did. So any answer saying such a thing happened is ungrounded,
// whoever it names as the doer (I, for you, passive, no subject) and however "done" is said (#157).
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
const ZH_HEDGE=/如果|若|假如|假设|假設|一旦|是否|有没有|有沒有|[吗嗎呢][？?。！!]?$|[？?]|[成功完]后|[成功完]後|之后|之後|以后|以後|之前|以前|才|需要|必须|必須|须|須|要先|请|請|可以|可|能否|无法|無法|不能|没办法|沒辦法|不会|不會|未|没有|沒有|没|沒|不代表|无法确认|確認一下|确认一下|的话|的話|记得|記得|建议|建議|将|將|会自动|會自動/;
const zhCompleted=new RegExp(`已(?:经|經)?[^，,。；;！!？?\\n]{0,16}?(${ZH_ENROL}|${ZH_ACTION})(?!的)|(${ZH_ENROL}|${ZH_ACTION})已?(?:${ZH_DONE})`);
const zhAgentDid=new RegExp(`(?:我|[帮幫为為替给給代]你)[^，,。；;！!？?\\n]{0,16}?(?:${ZH_AGENT_ONLY})`);
const zhStatus=/(?:已经|已經|已|现在|現在)(?:是|成为|成為)[^，,。；;]{0,12}(?:会员|會員|会籍|會籍)/;
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
const enYouStatus=new RegExp(`\\byou(?:'re| are|'ve| have)\\s+${ADV}(?:been\\s+)?(${EN_ENROL})\\b`,'i');
const enNounDone=/\b(transfer|enrollment|enrolment|registration|activation|payment|booking|redemption)s?\b(?:[^.;!?]{0,40}?\b(?:is|was|has been|have been)\s+(?:now\s+)?|\s+)(?:complete|completed|done|confirmed|successful|processed|finished)\b/i;
const enForYou=/\b(?:done|taken care of|handled|went through|gone through)\b[^.;!?]{0,30}\bfor you\b|\bwent through\b/i;
const isEnrol=word=>new RegExp(`^(?:${ZH_ENROL}|${EN_ENROL}|enrollment|enrolment|registration|activation)$`,'i').test(word);

export function actionClaimIssues(answer){
 const codes=new Set();
 const clauses=String(answer||'').split(/(?<=[。！？!?；;，,：:\n—–])|(?<=\.)\s+/);
 for(const clause of clauses){
  const zh=/[㐀-鿿]/.test(clause);
  if(zh&&!ZH_HEDGE.test(clause)){
   const m=clause.match(zhCompleted);
   if(m){const verb=m[1]||m[2];if(isEnrol(verb)){codes.add('unverified_enrollment');if(ZH_AGENT.test(clause))codes.add('unauthorized_action_claim');}else codes.add('unauthorized_action_claim');}
   if(zhStatus.test(clause))codes.add('unverified_enrollment');
   if(zhHandled.test(clause)||zhAgentDid.test(clause))codes.add('unauthorized_action_claim');
  }
  if(/[a-z]/i.test(clause)&&!EN_HEDGE.test(clause)){
   const agent=clause.match(enAgent);
   if(agent){codes.add('unauthorized_action_claim');if(isEnrol(agent[1]))codes.add('unverified_enrollment');}
   for(const re of [enPerfectPassive,enPastPassive,enNowState]){const m=clause.match(re);if(m)codes.add(isEnrol(m[1])?'unverified_enrollment':'unauthorized_action_claim');}
   if(enYouStatus.test(clause))codes.add('unverified_enrollment');
   const noun=clause.match(enNounDone);if(noun)codes.add(isEnrol(noun[1])?'unverified_enrollment':'unauthorized_action_claim');
   if(enForYou.test(clause))codes.add('unauthorized_action_claim');
  }
 }
 return [...codes].map(code=>({code}));
}
