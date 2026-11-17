// Claims that an action is already done. The assistant is read-only: it can't pay, transfer points, enrol, activate,
// book or mark anything, and it can't see whether the user did. So any answer saying such a thing happened is ungrounded,
// whoever it names as the doer (I, for you, passive, no subject) and however "done" is said (#157).
// "将/將" hedges only as a future ("将于", "将会"); as an object marker ("替你将积分兑换为…") it does not (#301).
// The test is per clause: a clause that is conditional, a question, a negation, an instruction or a future
// ("if you enrolled", "你可以去登记", "to transfer, go to…") describes the action without claiming it.

// Verbs for the actions, and the subset that changes the user's enrolment or activation status.
const ZH_ENROL='登记|登記|注册|註冊|报名|報名|激活|启用|啟用|开通|開通|绑定|綁定|关联|關聯';
const ZH_ACTION='转点|轉點|转分|轉分|转[到入出移换好]|轉[到入出移換好]|转过去|轉過去|兑换|兌換|换成|換成|付款|支付|缴付|繳付|缴清|繳清|还清|還清|还款|還款|转账|转帐|轉帳|轉賬|预订|預訂|订好|訂好|领取|領取|申请|申請|抵扣|抵銷|抵销|折抵|冲抵|沖抵|抵用|兑付|兌付|核销|核銷|付掉';
// Marking a credit is something the user does in the wallet (query_credits returns those marks), and a benefit can be
// cancelled by its issuer: these count only when the assistant says it did them.
const ZH_AGENT_ONLY='标记|標記|取消';
const ZH_DONE='完成|成功|完毕|完畢|好了|妥了|搞定|到账|到賬';
const ZH_AGENT=/我|[帮幫为為替给給代]你/;
const ZH_HEDGE=/如果|若|假如|假设|假設|一旦|是否|有没有|有沒有|[吗嗎呢][？?。！!]?$|[？?]|[成功完]后|[成功完]後|之后|之後|以后|以後|之前|以前|(?<![刚剛])才|需要|必须|必須|须|須|要先|请|請|可以|可|能否|无法|無法|不能|没办法|沒辦法|不会|不會|未|没有|沒有|没|沒|不代表|无法确认|確認一下|确认一下|的话|的話|记得|記得|建议|建議|[将將](?=[会會于於在要可能])|即将|即將|会自动|會自動/;
// The gap allows a long object before the verb ("已經替你把 Membership Rewards 點數兌換成…", #301).
const zhCompletedStrict=new RegExp(`已(?:经|經)?[^，,。；;！!？?\\n]{0,40}?(${ZH_ENROL}|${ZH_ACTION})(?!的)|(${ZH_ENROL}|${ZH_ACTION})已?(?:${ZH_DONE})`);
// Without an agent in the clause, wordings that only describe a requirement are not claims (#362):
// - a requirement word between 已 and the verb: "已包含 Marriott Gold 會籍但需登記", "官網已列明需登記";
// - the verb used as a noun or an attribute: "登記資格", "登記步驟", "已登記嘅白金卡";
// - 已 inside an instrument phrase: "用已關聯 Amex 嘅 Airbnb 帳戶預訂", "通过已关联 Amex 账户的…";
// - "完成即/就…", a condition: "登記同關聯完成即享 Gold Elite".
const ZH_NOUN_AFTER='[的嘅]|资格|資格|入口|方法|方式|条件|條件|要求|手续|手續|流程|步骤|步驟|页面|頁面|链接|連結|网址|網址|截止|期限';
const ZH_INSTRUMENT='用|以|使用|通过|通過|透过|透過|凭|憑|持';
const zhCompleted=new RegExp(`(?<!(?:${ZH_INSTRUMENT})\\s*)已(?:经|經)?(?:(?![需要])[^，,。；;！!？?\\n]){0,40}?(${ZH_ENROL}|${ZH_ACTION})(?!${ZH_NOUN_AFTER})|(${ZH_ENROL}|${ZH_ACTION})已?(?:${ZH_DONE})(?![即就便])`);
// Activation the terms say is automatic ("Priority Pass Select … automatically activated"), said as "已自動啟用".
// It counts as grounded only when the evidence has such a record (answerGrounding passes autoActivation, #362).
const zhAutoActivated=/自[动動](?:地)?(?:激活|启用|啟用|开通|開通|生效)$/;
const zhAgentDid=new RegExp(`(?:我|[帮幫为為替给給代]你)[^，,。；;！!？?\\n]{0,16}?(?:${ZH_AGENT_ONLY})`);
const zhStatus=/(?:已经|已經|已|现在|現在)(?:是|成为|成為)[^，,。；;]{0,12}(?:会员|會員|会籍|會籍)/;
// A membership or status said to be in effect or upgraded (#301). Only status nouns count: a credit or offer can be
// "已生效" because its dates say so, which the wallet knows.
const ZH_STATUS='会籍|會籍|会员|會員|等级|等級|级别|級別|身份|状态|狀態|升级|升級';
const zhStatusActive=new RegExp(`(?:${ZH_STATUS})[^，,。；;！!？?\\n]{0,16}?(?:已(?:经|經)?|现在|現在)(?:正式|成功)?(?:生效|升级|升級|啟用|启用)(?!的)|(?:已(?:经|經)?|现在|現在)(?:成功)?(?:升级|升級)(?:为|為|到|成)`);
// A status said to show on or be added to the account (#314): "会籍已显示在你的账户上", "身份已添加到账户". Needs a status noun and "已"/"现在".
const ZH_ACCOUNT='账户|賬戶|帳戶|账号|賬號|帳號|户口|戶口';
const zhStatusShown=new RegExp(`(?:${ZH_STATUS})[^，,。；;！!？?\\n]{0,16}?(?:已(?:经|經)?|现在|現在)[^，,。；;！!？?\\n]{0,6}?(?:显示|顯示|出现|出現|添加|加入|记入|記入|列入)[^，,。；;！!？?\\n]{0,8}?(?:${ZH_ACCOUNT})`);
// "I used points to cover/pay for…" (#333): the assistant says it spent points on something. Needs an agent subject, a points
// word and a covering verb finished with 了/已, so "你可以用积分来抵扣" (advice) and "你用积分抵扣了" (the user did it) stay clear.
const zhUsedPoints=new RegExp(`(?:我|[帮幫为為替给給代]你)[^，,。；;！!？?\\n]{0,12}?(?:用|使用|动用|動用|花|花掉|拿)[^，,。；;！!？?\\n]{0,24}?(?:积分|積分|点数|點數|里程|miles|points)[^，,。；;！!？?\\n]{0,12}?(?:支付|抵扣|抵銷|抵销|折抵|冲抵|沖抵|冲销|沖銷|抵用|抵|冲|沖|付掉|付|覆盖|覆蓋|cover|pay)[^，,。；;！!？?\\n]{0,10}?(?:了|掉|已|好)`);
// "我把 2 萬點積分拿去沖掉這張機票的帳單" (#336): the points come first (把…), then 拿去/用来 and a covering verb finished with 了/掉.
const zhUsedPointsBa=new RegExp(`(?:我|[帮幫为為替给給代]你)[^，,。；;！!？?\\n]{0,12}?[把将將][^，,。；;！!？?\\n]{0,24}?(?:积分|積分|点数|點數|里程|miles|points)[^，,。；;！!？?\\n]{0,6}?(?:拿去|拿来|拿來|用来|用來|拿|用)[^，,。；;！!？?\\n]{0,12}?(?:支付|抵扣|抵銷|抵销|折抵|冲抵|沖抵|冲销|沖銷|抵用|抵|冲|沖|付掉|付|覆盖|覆蓋)[^，,。；;！!？?\\n]{0,10}?(?:了|掉|已|好)`);
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
// A status said to show on, appear on or be added to the account (#314). Needs a status noun, as above.
const enStatusShown=/\b(?:(?:now|already)\s+)?(?:shows?|showing|appears?|appearing|displays?|displaying|listed|reflected|reflects?)\s+(?:up\s+)?(?:on|in)\s+your\b|\b(?:is|are|'s|'re|has been|have been)\s+(?:now\s+|already\s+)?(?:added|attached|applied|showing)\s+(?:to|on)\s+your\s+(?:\w+\s+)?(?:account|profile)\b/i;
const enYouUpgraded=/\byou(?:'re| are|'ve been| have been)\s+(?:(?:now|already|officially|successfully)\s+)*upgraded\b/i;
const enYouStatus=new RegExp(`\\byou(?:'re| are|'ve| have)\\s+${ADV}(?:been\\s+)?(${EN_ENROL})\\b`,'i');
// "I used 40,000 points to cover…", "I've spent my points on…" (#333): spending points is an action, not advice.
const enUsedPoints=new RegExp(`\\bI(?:'ve|'d| have| had)?\\s+${ADV}(?:used|spent|applied|put|redeemed)\\b[^.;!?,]{0,50}\\b(?:points|miles|rewards|credits?)\\b[^.;!?,]{0,40}\\b(?:to\\s+(?:cover|pay(?:\\s+for|\\s+off)?|offset|settle|clear|wipe)|towards?|against|on)\\b`,'i');
const enPointsUsed=new RegExp(`\\b(?:points|miles|rewards)\\b[^.;!?,]{0,30}\\b(?:were|was|have been|has been|got)\\s+${ADV}(?:used|spent|applied)\\b[^.;!?,]{0,30}\\b(?:to\\s+(?:cover|pay|offset|settle)|towards?|against)\\b`,'i');
const enNounDone=/\b(transfer|enrollment|enrolment|registration|activation|payment|booking|redemption)s?\b(?:[^.;!?]{0,40}?\b(?:is|was|has been|have been)\s+(?:now\s+)?|\s+)(?:complete|completed|done|confirmed|successful|processed|finished)\b/i;
const enForYou=/\b(?:done|taken care of|handled|went through|gone through|marked|cancell?ed)\b[^.;!?]{0,30}\bfor you\b|\bwent through\b/i;
const isEnrol=word=>new RegExp(`^(?:${ZH_ENROL}|${EN_ENROL}|enrollment|enrolment|registration|activation)$`,'i').test(word);

// A sentence that restates what the user said ("你说积分已经兑换了", "You said your points were converted") reports their
// statement rather than claiming the action (#301).
const REPORTED=/^\s*(?:你(?:刚才|剛才|之前)?(?:说|說|提到|表示|讲|講|告诉我|告訴我)|据你|據你|根据你|根據你|按你|照你|(?:you|you've)\s+(?:said|mentioned|told me|say|noted)\b|according to you\b|as you (?:said|mentioned)\b)/i;

// autoActivation: the evidence has a record whose terms say it is activated automatically, with no enrolment.
export function actionClaimIssues(answer,{autoActivation=false}={}){
 const codes=new Set();
 const sentences=String(answer||'').replace(/(\d),(?=\d{3}\b)/g,'$1').split(/(?<=[。！？!?\n])|(?<=\.)\s+/).filter(s=>!REPORTED.test(s));
 const clauses=sentences.flatMap(s=>s.split(/(?<=[。！？!?；;，,：:\n—–])|(?<=\.)\s+/));
 for(const clause of clauses){
  const zh=/[㐀-鿿]/.test(clause);
  if(zh&&!ZH_HEDGE.test(clause)){
   const agent=ZH_AGENT.test(clause);
   const m=clause.match(agent?zhCompletedStrict:zhCompleted);
   if(m&&!(autoActivation&&!agent&&zhAutoActivated.test(m[0]))){const verb=m[1]||m[2];if(isEnrol(verb)){codes.add('unverified_enrollment');if(ZH_AGENT.test(clause))codes.add('unauthorized_action_claim');}else codes.add('unauthorized_action_claim');}
   if(zhStatus.test(clause)||zhStatusActive.test(clause)||zhStatusShown.test(clause))codes.add('unverified_enrollment');
   if(zhHandled.test(clause)||zhAgentDid.test(clause)||zhUsedPoints.test(clause)||zhUsedPointsBa.test(clause))codes.add('unauthorized_action_claim');
  }
  // "to pay for" is part of the claim here, not an instruction, so it is taken out before the hedge test (#333).
  if(/[a-z]/i.test(clause)&&!EN_HEDGE.test(clause.replace(/\bto\s+pay\b/gi,'to cover'))&&(enUsedPoints.test(clause)||enPointsUsed.test(clause)))codes.add('unauthorized_action_claim');
  if(/[a-z]/i.test(clause)&&!EN_HEDGE.test(clause)){
   const agent=clause.match(enAgent);
   if(agent){codes.add('unauthorized_action_claim');if(isEnrol(agent[1]))codes.add('unverified_enrollment');}
   for(const re of [enPerfectPassive,enPastPassive,enNowState,enStateNow,enGot]){const m=clause.match(re);if(m)codes.add(isEnrol(m[1])?'unverified_enrollment':'unauthorized_action_claim');}
   if(enYouStatus.test(clause)||enYouUpgraded.test(clause)||(EN_STATUS.test(clause)&&(enStatusActive.test(clause)||enStatusShown.test(clause))))codes.add('unverified_enrollment');
   const noun=clause.match(enNounDone);if(noun)codes.add(isEnrol(noun[1])?'unverified_enrollment':'unauthorized_action_claim');
   if(enForYou.test(clause))codes.add('unauthorized_action_claim');
  }
 }
 return [...codes].map(code=>({code}));
}
