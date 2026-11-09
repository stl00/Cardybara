// Multi-turn reference golden set. Synthetic portfolio (harness.mjs PORTFOLIO), public products only; no holdings,
// amounts or account data of any person. Earlier turns are scripted: the tool calls a model would make and an answer
// written the way the assistant answers (user's language, names paraphrased or translated as models do). The last
// question refers back to something earlier; `expect` is the call that question should produce and `target` the
// referent that must still be identifiable in the model's context.
//
// kind: pronoun (这张/它/it), ordinal (第二个/the second one), ellipsis (那 Amex 呢), topic-return (switch, then back),
// long-range (referent more than six turns back), same-name (same product name in another region).
const T=(user,calls,answer)=>({user,calls,answer});
const fb=(query,extra={})=>['find_benefits',{query,...extra}];
const rules=(kind,extra={})=>['get_card_rules',{kind,...extra}];
const credits=(args={})=>['query_credits',args];
const choose=args=>['choose_card',args];
const SR='chase-us-sapphire-reserve',FU='chase-us-freedom-unlimited',GOLD='amex-us-us-american-express-gold-card',MS='amex-us-us-morgan-stanley-platinum-card',ASPIRE='amex-us-us-hilton-honors-aspire-card',PLAT_US='amex-us-us-the-platinum-card',PLAT_HK='amex-hk-hk-the-platinum-card',PLAT_CA='amex-ca-ca-platinum-card',RED='hsbc-hk-hk-red-credit-card',CATHAY='sc-hk-hk-cathay-mastercard';

// Earlier answers reused across dialogues.
const srLoungesHans=T('我的 Sapphire Reserve 有哪些休息室权益？',[fb('休息室',{cardName:'Sapphire Reserve'})],'Chase Sapphire Reserve 和休息室相关的公开权益有：\n1. 加拿大航空休息室\n2. Priority Pass 休息室\n3. Chase Sapphire 休息室\n另外还有 Global Entry／TSA／NEXUS 抵扣。准入凭证和携客条件以条款为准。');
const srLoungesHant=T('我的 Sapphire Reserve 有哪些貴賓室權益？',[fb('休息室',{cardName:'Sapphire Reserve'})],'Chase Sapphire Reserve 的貴賓室相關權益：\n1. 加拿大航空休息室\n2. Priority Pass 休息室\n3. Chase Sapphire 休息室\n另有 Global Entry／TSA／NEXUS 抵扣。實際准入以條款為準。');
const srLoungesEn=T('Which lounge benefits does my Sapphire Reserve have?',[fb('lounge',{cardName:'Sapphire Reserve'})],'Your Chase Sapphire Reserve has these lounge-related benefits:\n1. Air Canada lounges\n2. Priority Pass lounges\n3. Chase Sapphire Lounges\nIt also has a Global Entry / TSA PreCheck / NEXUS credit. Access rules and guest limits are in the terms.');
const aspireHotelHans=T('Hilton Aspire 有什么酒店福利？',[fb('酒店',{cardName:'Aspire'})],'你的希尔顿 Aspire 卡和酒店有关的公开权益：\n1. 消费解锁免房晚\n2. 年度免房晚\n3. Waldorf／Conrad 住宿待遇\n4. Hilton Diamond 会籍\n5. Hilton Resort 抵扣\n会籍和抵扣的使用条件请看条款。');
const aspireHotelEn=T('What hotel perks come with the Hilton Aspire?',[fb('hotel',{cardName:'Aspire'})],'Your Hilton Aspire card has these hotel benefits:\n1. A free night unlocked by spending\n2. An annual free night\n3. Waldorf Astoria / Conrad property benefits\n4. Hilton Diamond status\n5. A Hilton resort credit\nCheck the terms for how each one applies.');
const goldDiningHans=T('运通金卡有什么吃饭的抵扣？',[fb('餐饮',{cardName:'Gold Card'})],'美国运通金卡的餐饮相关抵扣有：\n1. 每月餐饮抵扣\n2. Resy 餐饮抵扣\n3. Dunkin 抵扣\n4. Uber Cash\n这些是公开规则，是否已登记、本期是否用过，系统无法确认。');
const goldDiningEn=T('What dining credits does the Amex Gold have?',[fb('dining',{cardName:'Gold Card'})],'The Amex Gold has these dining credits:\n1. Monthly dining credit\n2. Resy dining credit\n3. Dunkin credit\n4. Uber Cash\nThese are public rules; enrolment and use this period are not known.');
const hkPlatHotelHant=T('香港白金卡有咩酒店禮遇？',[fb('酒店',{cardName:'The Platinum Card',region:'HK'})],'你張香港美國運通白金卡嘅酒店相關禮遇：\n1. Fine Hotels + Resorts\n2. Hilton Gold 會籍\n3. Marriott Gold 會籍\n4. Radisson Premium 會籍\n5. The Hotel Collection\n6. Platinum Vacation Credits\n7. Accor 會籍登記\n會籍通常要自行登記，以條款為準。');
const hkPlatHotelHans=T('香港那张白金卡有哪些酒店礼遇？',[fb('酒店',{cardName:'The Platinum Card',region:'HK'})],'香港美国运通白金卡的酒店相关礼遇：\n1. Fine Hotels + Resorts\n2. Hilton Gold 会籍\n3. Marriott Gold 会籍\n4. Radisson Premium 会籍\n5. The Hotel Collection\n6. Platinum Vacation Credits\n7. Accor 会籍登记\n会籍类一般需要自行登记。');
const msPerksHans=T('摩根士丹利白金卡都有什么权益？',[fb('权益',{cardName:'Morgan Stanley'})],'Morgan Stanley Platinum Card 的公开权益比较多，主要有：\n1. 航司杂费抵扣\n2. CashPlus Engagement Bonus\n3. CLEAR+ 会员抵扣\n4. 数码娱乐抵扣\n5. 住宿预订抵扣\n6. Global Lounge Collection\n7. lululemon 抵扣\n8. Oura Ring 抵扣\n9. Resy 餐饮抵扣\n10. Uber Cash\n11. Uber One 会员抵扣\n12. Walmart+ 月费抵扣\n多数抵扣要先登记，结果里可能还有更多条目。');
const caPlatTransferHans=T('加拿大白金卡可以转哪些计划？不要猜比例。',[rules('transfer-relationship',{cardName:'Platinum Card',region:'CA'})],'加拿大美国运通白金卡记录到的转点伙伴有：\n1. Air Canada Aeroplan\n2. Air France KLM Flying Blue\n3. Cathay Asia Miles\n4. Delta SkyMiles\n5. Etihad Guest\n6. Hilton Honors\n7. Marriott Bonvoy\n8. The British Airways Club\n转换比例没有记录，不能据此计算。');
const srTransferEn=T('Where can I transfer Sapphire Reserve points? Don\'t guess ratios.',[rules('transfer-relationship',{cardName:'Sapphire Reserve'})],'Chase Sapphire Reserve points have these recorded transfer partners: Aer Lingus AerClub, Air Canada Aeroplan, Air France KLM Flying Blue, Iberia Club, IHG One Rewards, JetBlue TrueBlue, Marriott Bonvoy, Singapore Airlines KrisFlyer, Southwest Rapid Rewards, The British Airways Club, United MileagePlus, Virgin Atlantic Flying Club, World of Hyatt and Wyndham Rewards. Ratios are not recorded here, so I can\'t calculate a conversion.');
const goldTransferHant=T('運通 Gold Card 可以轉去邊啲計劃？',[rules('transfer-relationship',{cardName:'Gold Card'})],'美國運通 Gold 卡記錄到的轉點夥伴有：Aer Lingus AerClub、Aeromexico Rewards、Air Canada Aeroplan、Air France KLM Flying Blue、ANA Mileage Club、avianca lifemiles 同 Cathay Asia Miles。比例未有記錄，唔可以用嚟計算。');
const diningChoiceHans=T('在美国餐厅吃饭用哪张卡？',[choose({category:'dining',categorySource:'stated',country:'US'})],'Freedom Unlimited 是这次的选择：餐饮按现金回赠计，前提是商户按餐饮类别入账。积分卡方面，Sapphire Reserve、运通金卡和 Hilton Aspire 赚的是积分，要你给出每分价值才能比较。');
const diningChoiceEn=T('Which card for a restaurant in the US?',[choose({category:'dining',categorySource:'stated',country:'US'})],'Freedom Unlimited is the pick here: dining earns cash back, as long as the merchant codes as dining. Sapphire Reserve, the Amex Gold and the Hilton Aspire earn points instead, which I can only compare if you tell me what a point is worth to you.');
const hotelCreditsHans=T('我还有哪些酒店 credit？',[credits({use:'hotel'})],'和酒店相关的抵扣如下，状态都只来自你的手动标记：\n- 未确认是否用过：Sapphire Reserve 的 The Edit 酒店抵扣、2026 指定酒店抵扣；Morgan Stanley 白金卡的住宿预订抵扣；Hilton Aspire 的 Hilton Resort 抵扣。\n- 没有固定周期：香港白金卡的 Platinum Vacation Credits，Hilton Aspire 的 Waldorf／Conrad 住宿待遇。\n- 周期未知：Sapphire Reserve 的旅行消费抵扣和加拿大白金卡的年度旅行额度，因为开卡周年日未知。\n预订渠道和最少晚数等要求请看条款。');
const hotelCreditsEn=T('Which hotel credits do I have?',[credits({use:'hotel'})],'Hotel-related credits, with status only from your own marks:\n- Not confirmed either way: the Sapphire Reserve The Edit hotel credit and selected hotels credit; the Morgan Stanley Platinum lodging credit; the Hilton Aspire resort credit.\n- No fixed cycle: the HK Platinum vacation credits and the Aspire Waldorf / Conrad benefit.\n- Cycle unknown: the Sapphire Reserve travel credit and the Canadian Platinum annual travel credit, because the card anniversary is unknown.\nBooking channel and minimum nights are in the terms.');
const redFeeHant=T('滙豐 Red 卡年費幾多？',[rules('fee',{cardName:'Red Credit Card'})],'滙豐 Red Credit Card 嘅公布年費喺記錄入面有，主卡同附屬卡分開列。公布年費唔代表你實際被收取或者獲豁免。');
const cathayLinkHans=T('渣打国泰卡要怎么关联 Asia Miles？',[fb('Asia Miles',{cardName:'Cathay'})],'渣打国泰 Mastercard 有一条「Asia Miles 账户关联」的规则：需要把信用卡和 Asia Miles 会员账户关联，里数才会入账。具体步骤和条件以条款为准。');
const fillerThanks={'zh-Hans':T('好的，谢谢',[],'不客气，还有什么想查的随时问我。'),'zh-Hant':T('好，多謝',[],'唔使客氣，有咩想查隨時問我。'),en:T('ok thanks',[],'You\'re welcome. Ask me anything else about your cards.')};
// Turns in between that never name the cards the long-range questions refer to.
const fillers={
 'zh-Hans':[
  T('汇丰 Red 卡年费多少？',[rules('fee',{cardName:'Red Credit Card'})],'汇丰 Red Credit Card 的公布年费有记录，主卡和附属卡分开列。公布年费不代表你实际被收取或获豁免。'),
  T('渣打国泰卡要怎么关联 Asia Miles？',[fb('Asia Miles',{cardName:'Cathay'})],'渣打国泰 Mastercard 有一条「Asia Miles 账户关联」规则：卡要和 Asia Miles 会员账户关联，里数才会入账。'),
  T('Morgan Stanley 白金卡有 Walmart+ 吗？',[fb('Walmart+',{cardName:'Morgan Stanley'})],'有，Morgan Stanley Platinum Card 有 Walmart+ 月费抵扣，需要用这张卡付 Walmart+ 月费。'),
  T('Freedom Unlimited 有年费吗？',[rules('fee',{cardName:'Freedom Unlimited'})],'Freedom Unlimited 的公布年费有记录，主卡和附属卡分开列。'),
  T('Morgan Stanley 那张有 CLEAR 吗？',[fb('CLEAR',{cardName:'Morgan Stanley'})],'有，Morgan Stanley Platinum Card 有 CLEAR+ 会员抵扣，一般要用这张卡支付 CLEAR+ 会费。'),
  T('好的，谢谢',[],'不客气，还有什么想查的随时问我。'),
 ],
 'zh-Hant':[
  T('滙豐 Red 卡年費幾多？',[rules('fee',{cardName:'Red Credit Card'})],'滙豐 Red Credit Card 嘅公布年費有記錄，主卡同附屬卡分開列。公布年費唔代表實際收費。'),
  T('渣打國泰卡點樣連 Asia Miles？',[fb('Asia Miles',{cardName:'Cathay'})],'渣打國泰 Mastercard 有「Asia Miles 賬戶關聯」規則：要將卡同 Asia Miles 會員賬戶關聯，里數先會入賬。'),
  T('Morgan Stanley 白金卡有冇 Walmart+？',[fb('Walmart+',{cardName:'Morgan Stanley'})],'有，Morgan Stanley Platinum Card 有 Walmart+ 月費抵扣，要用呢張卡俾 Walmart+ 月費。'),
  T('Freedom Unlimited 使唔使年費？',[rules('fee',{cardName:'Freedom Unlimited'})],'Freedom Unlimited 嘅公布年費有記錄，主卡同附屬卡分開列。'),
  T('Morgan Stanley 嗰張有冇 CLEAR？',[fb('CLEAR',{cardName:'Morgan Stanley'})],'有，Morgan Stanley Platinum Card 有 CLEAR+ 會員抵扣。'),
  T('好，多謝',[],'唔使客氣，有咩想查隨時問我。'),
 ],
 en:[
  T('What is the fee on the HSBC Red card?',[rules('fee',{cardName:'Red Credit Card'})],'The HSBC Red Credit Card has a published primary and additional card fee on record. That does not show what you were actually charged.'),
  T('How do I link the Cathay card to Asia Miles?',[fb('Asia Miles',{cardName:'Cathay'})],'The Standard Chartered Cathay Mastercard has an Asia Miles account linking rule: miles post only once the card is linked to your Asia Miles membership.'),
  T('Does the Morgan Stanley Platinum cover Walmart+?',[fb('Walmart+',{cardName:'Morgan Stanley'})],'Yes, the Morgan Stanley Platinum Card has a Walmart+ monthly membership credit when you pay for Walmart+ with it.'),
  T('Does Freedom Unlimited have an annual fee?',[rules('fee',{cardName:'Freedom Unlimited'})],'Freedom Unlimited has a published fee record, with primary and additional cards listed separately.'),
  T('Does the Morgan Stanley one have CLEAR?',[fb('CLEAR',{cardName:'Morgan Stanley'})],'Yes, the Morgan Stanley Platinum Card has a CLEAR+ membership credit.'),
  T('ok thanks',[],'You\'re welcome. Ask me anything else about your cards.'),
 ],
};
const muMarriottEn=T('Which cards give Marriott status?',[fb('Marriott')],'Both the Canadian and the Hong Kong Platinum cards list Marriott Gold status, usually after enrolment.');
const muMarriottHant=T('邊張卡有萬豪會籍？',[fb('Marriott')],'加拿大白金卡同香港白金卡都有 Marriott Gold 會籍，一般要登記。');
const muUber=T('哪些卡有 Uber 的抵扣？',[fb('Uber')],'有 Uber 相关权益的是：运通金卡的 Uber Cash，以及 Morgan Stanley 白金卡的 Uber Cash 和 Uber One 会员抵扣。一般需要把卡加到 Uber 账户里。');
const muUberHant=T('邊張卡有 Uber 回贈？',[fb('Uber')],'運通 Gold 卡有 Uber Cash；Morgan Stanley 白金卡有 Uber Cash 同 Uber One 會員抵扣。');
const middle=fillers;

export const dialogues=[
 // ---- pronoun ----
 {id:'pron-aspire-fee-hans',lang:'zh-Hans',kind:'pronoun',turns:[aspireHotelHans],question:'这张卡年费多少？',expect:{tool:'get_card_rules',args:{kind:'fee',cardName:'Aspire'}},target:{card:ASPIRE}},
 {id:'pron-gold-fee-hans',lang:'zh-Hans',kind:'pronoun',turns:[goldDiningHans],question:'它的年费呢？',expect:{tool:'get_card_rules',args:{kind:'fee',cardName:'Gold Card'}},target:{card:GOLD}},
 {id:'pron-gold-transfer-en',lang:'en',kind:'pronoun',turns:[goldDiningEn],question:'Can its points go to Asia Miles?',expect:{tool:'get_card_rules',args:{kind:'transfer-relationship',cardName:'Gold Card',programme:'Asia Miles'}},target:{card:GOLD}},
 {id:'pron-hkplat-lounge-hant',lang:'zh-Hant',kind:'pronoun',turns:[hkPlatHotelHant],question:'呢張卡有冇貴賓室？',expect:{tool:'find_benefits',args:{query:'貴賓室',cardName:'The Platinum Card',region:'HK'}},target:{card:PLAT_HK}},
 {id:'pron-ms-credits-hans',lang:'zh-Hans',kind:'pronoun',turns:[msPerksHans],question:'这张卡的抵扣我这期用了哪些？',expect:{tool:'query_credits',args:{cardName:'Morgan Stanley'}},target:{card:MS}},
 {id:'pron-sr-fee-en',lang:'en',kind:'pronoun',turns:[srLoungesEn],question:'What is the annual fee on that card?',expect:{tool:'get_card_rules',args:{kind:'fee',cardName:'Sapphire Reserve'}},target:{card:SR}},
 {id:'pron-cathay-fee-hans',lang:'zh-Hans',kind:'pronoun',turns:[cathayLinkHans],question:'那这张卡年费是多少？',expect:{tool:'get_card_rules',args:{kind:'fee',cardName:'Cathay'}},target:{card:CATHAY}},
 {id:'pron-red-benefits-hant',lang:'zh-Hant',kind:'pronoun',turns:[redFeeHant],question:'佢有咩其他優惠？',expect:{tool:'find_benefits',args:{query:'優惠',cardName:'Red Credit Card'}},target:{card:RED}},
 {id:'pron-choice-card-fee-en',lang:'en',kind:'pronoun',turns:[diningChoiceEn],question:'Does that card have an annual fee?',expect:{tool:'get_card_rules',args:{kind:'fee',cardName:'Freedom Unlimited'}},target:{card:FU}},
 {id:'pron-caplat-hilton-hans',lang:'zh-Hans',kind:'pronoun',turns:[caPlatTransferHans],question:'它转 Hilton 的规则再详细说说',expect:{tool:'get_card_rules',args:{kind:'transfer-relationship',cardName:'Platinum Card',region:'CA',programme:'Hilton'}},target:{card:PLAT_CA}},

 // ---- ordinal ----
 {id:'ord-sr-lounge-2-hans',lang:'zh-Hans',kind:'ordinal',turns:[srLoungesHans],question:'第二个怎么用？',expect:{tool:'find_benefits',args:{query:'Priority Pass',cardName:'Sapphire Reserve'}},target:{card:SR,ordinal:{index:2,list:[['加拿大航空休息室','Air Canada'],['Priority Pass 休息室','Priority Pass'],['Chase Sapphire 休息室','Chase Sapphire Lounge']]}}},
 {id:'ord-sr-lounge-3-hant',lang:'zh-Hant',kind:'ordinal',turns:[srLoungesHant],question:'第三個有冇條件？',expect:{tool:'find_benefits',args:{query:'Chase Sapphire 休息室',cardName:'Sapphire Reserve'}},target:{card:SR,ordinal:{index:3,list:[['加拿大航空休息室','Air Canada'],['Priority Pass 休息室','Priority Pass'],['Chase Sapphire 休息室','Chase Sapphire Lounge']]}}},
 {id:'ord-sr-lounge-1-en',lang:'en',kind:'ordinal',turns:[srLoungesEn],question:'How does the first one work?',expect:{tool:'find_benefits',args:{query:'Air Canada lounge',cardName:'Sapphire Reserve'}},target:{card:SR,ordinal:{index:1,list:[['加拿大航空休息室','Air Canada'],['Priority Pass 休息室','Priority Pass'],['Chase Sapphire 休息室','Chase Sapphire Lounge']]}}},
 {id:'ord-aspire-4-hans',lang:'zh-Hans',kind:'ordinal',turns:[aspireHotelHans],question:'第四个要怎么拿到？',expect:{tool:'find_benefits',args:{query:'Hilton Diamond',cardName:'Aspire'}},target:{card:ASPIRE,ordinal:{index:4,list:[['消费解锁免房晚','spending'],['年度免房晚','annual free night'],['Waldorf／Conrad 住宿待遇','Waldorf'],['Hilton Diamond 会籍','Hilton Diamond']]}}},
 {id:'ord-aspire-2-en',lang:'en',kind:'ordinal',turns:[aspireHotelEn],question:'Tell me more about the second one.',expect:{tool:'find_benefits',args:{query:'年度免房晚',cardName:'Aspire'}},target:{card:ASPIRE,ordinal:{index:2,list:[['消费解锁免房晚','unlocked by spending'],['年度免房晚','annual free night'],['Waldorf／Conrad 住宿待遇','Waldorf'],['Hilton Diamond 会籍','Hilton Diamond']]}}},
 {id:'ord-gold-3-hans',lang:'zh-Hans',kind:'ordinal',turns:[goldDiningHans],question:'第三个在哪里能用？',expect:{tool:'find_benefits',args:{query:'Dunkin',cardName:'Gold Card'}},target:{card:GOLD,ordinal:{index:3,list:[['每月餐饮抵扣','Monthly dining'],['Resy 餐饮抵扣','Resy'],['Dunkin 抵扣','Dunkin']]}}},
 {id:'ord-gold-2-en',lang:'en',kind:'ordinal',turns:[goldDiningEn],question:'Did I use the second one this month?',expect:{tool:'query_credits',args:{cardName:'Gold Card',use:'dining'}},target:{card:GOLD,ordinal:{index:2,list:[['每月餐饮抵扣','Monthly dining'],['Resy 餐饮抵扣','Resy'],['Dunkin 抵扣','Dunkin']]}}},
 {id:'ord-hkplat-4-hant',lang:'zh-Hant',kind:'ordinal',turns:[hkPlatHotelHant],question:'第四個點登記？',expect:{tool:'find_benefits',args:{query:'Radisson',cardName:'The Platinum Card',region:'HK'}},target:{card:PLAT_HK,ordinal:{index:4,list:[['Fine Hotels + Resorts'],['Hilton Gold 会籍','Hilton Gold 會籍','Hilton Gold'],['Marriott Gold 会籍','Marriott Gold 會籍','Marriott Gold'],['Radisson Premium 会籍','Radisson Premium 會籍','Radisson']]}}},
 {id:'ord-ms-5-hans',lang:'zh-Hans',kind:'ordinal',turns:[msPerksHans],question:'第五个具体怎么抵扣？',expect:{tool:'find_benefits',args:{query:'住宿预订抵扣',cardName:'Morgan Stanley'}},target:{card:MS,ordinal:{index:5,list:[['航司杂费抵扣'],['CashPlus Engagement Bonus'],['CLEAR+ 会员抵扣','CLEAR'],['数码娱乐抵扣'],['住宿预订抵扣']]}}},
 {id:'ord-ms-11-hans',lang:'zh-Hans',kind:'ordinal',turns:[msPerksHans,fillerThanks['zh-Hans']],question:'刚才列表里倒数第二个是什么条件？',expect:{tool:'find_benefits',args:{query:'Uber One',cardName:'Morgan Stanley'}},target:{card:MS,item:['Uber One 会员抵扣','Uber One']}},
 {id:'ord-caplat-6-hans',lang:'zh-Hans',kind:'ordinal',turns:[caPlatTransferHans],question:'第六个转过去能拿会籍吗？',expect:{tool:'get_card_rules',args:{kind:'transfer-relationship',cardName:'Platinum Card',region:'CA',programme:'Hilton'}},target:{card:PLAT_CA,programme:['Hilton Honors'],ordinal:{index:6,list:[['Air Canada Aeroplan'],['Air France KLM Flying Blue'],['Cathay Asia Miles'],['Delta SkyMiles'],['Etihad Guest'],['Hilton Honors']]}}},
 {id:'ord-hotelcredits-hans',lang:'zh-Hans',kind:'ordinal',turns:[hotelCreditsHans],question:'第一个要怎么订才算？',expect:{tool:'find_benefits',args:{query:'The Edit',cardName:'Sapphire Reserve'}},target:{card:SR,item:['The Edit 酒店抵扣','The Edit']}},

 // ---- ellipsis ----
 {id:'ell-amex-transfer-en',lang:'en',kind:'ellipsis',turns:[srTransferEn],question:'What about the Amex Gold?',expect:{tool:'get_card_rules',args:{kind:'transfer-relationship',cardName:'Gold Card'}},target:{item:['transfer']}},
 {id:'ell-hk-fee-hans',lang:'zh-Hans',kind:'ellipsis',turns:[T('加拿大白金卡公布年费是多少？',[rules('fee',{cardName:'Platinum Card',region:'CA'})],'加拿大美国运通白金卡的公布主卡年费和附属卡年费都有记录。公布年费不代表你实际被收取的金额。')],question:'那香港的呢？',regionInQuestion:true,expect:{tool:'get_card_rules',args:{kind:'fee',cardName:'The Platinum Card',region:'HK'}},target:{card:PLAT_HK,item:['年费','annual fee']}},
 {id:'ell-ms-uber-hans',lang:'zh-Hans',kind:'ellipsis',turns:[goldDiningHans],question:'那摩根士丹利那张呢？',expect:{tool:'find_benefits',args:{query:'餐饮',cardName:'Morgan Stanley'}},target:{item:['餐饮','dining']}},
 {id:'ell-lounge-hk-hant',lang:'zh-Hant',kind:'ellipsis',turns:[srLoungesHant],question:'咁香港白金卡呢？',regionInQuestion:true,expect:{tool:'find_benefits',args:{query:'貴賓室',cardName:'The Platinum Card',region:'HK'}},target:{item:['休息室','貴賓室','lounge']}},
 {id:'ell-choice-hk-hans',lang:'zh-Hans',kind:'ellipsis',turns:[diningChoiceHans],question:'那在香港呢？',expect:{tool:'choose_card',args:{category:'dining',country:'HK'}},target:{item:['餐饮','dining','"category":"dining"']}},
 {id:'ell-credits-dining-en',lang:'en',kind:'ellipsis',turns:[hotelCreditsEn],question:'And dining?',expect:{tool:'query_credits',args:{use:'dining'}},target:{item:['credit']}},
 {id:'ell-transfer-ca-hans',lang:'zh-Hans',kind:'ellipsis',turns:[T('香港白金卡能转 Asia Miles 吗？',[rules('transfer-relationship',{cardName:'The Platinum Card',region:'HK',programme:'Asia Miles'})],'可以，香港美国运通白金卡记录有到 Cathay Asia Miles 的转点关系。比例没有记录，我不能替你换算。')],question:'加拿大那张呢？',regionInQuestion:true,expect:{tool:'get_card_rules',args:{kind:'transfer-relationship',cardName:'Platinum Card',region:'CA',programme:'Asia Miles'}},target:{programme:['Asia Miles']}},
 {id:'ell-fee-aspire-en',lang:'en',kind:'ellipsis',turns:[T('What is the annual fee on the Amex Gold?',[rules('fee',{cardName:'Gold Card'})],'The Amex Gold has a published primary card fee and a separate additional card fee on record. A published fee does not show what you were actually charged.')],question:'And the Aspire?',expect:{tool:'get_card_rules',args:{kind:'fee',cardName:'Aspire'}},target:{item:['fee']}},

 // ---- topic return ----
 {id:'ret-sr-after-uber-hans',lang:'zh-Hans',kind:'topic-return',turns:[srLoungesHans,muUber],question:'回到刚才那张卡，第二个休息室要带什么凭证？',expect:{tool:'find_benefits',args:{query:'Priority Pass',cardName:'Sapphire Reserve'}},target:{card:SR,ordinal:{index:2,list:[['加拿大航空休息室','Air Canada'],['Priority Pass 休息室','Priority Pass'],['Chase Sapphire 休息室','Chase Sapphire Lounge']]}}},
 {id:'ret-aspire-after-choice-en',lang:'en',kind:'topic-return',turns:[aspireHotelEn,diningChoiceEn],question:'Back to the hotel card: how do I get the resort credit?',expect:{tool:'find_benefits',args:{query:'resort credit',cardName:'Aspire'}},target:{card:ASPIRE}},
 {id:'ret-hkplat-after-red-hant',lang:'zh-Hant',kind:'topic-return',turns:[hkPlatHotelHant,redFeeHant],question:'返返去頭先張白金卡，Fine Hotels 點用？',expect:{tool:'find_benefits',args:{query:'Fine Hotels + Resorts',cardName:'The Platinum Card',region:'HK'}},target:{card:PLAT_HK}},
 {id:'ret-gold-after-hotel-hans',lang:'zh-Hans',kind:'topic-return',turns:[goldDiningHans,hotelCreditsHans],question:'再说回那张吃饭的卡，Resy 那个怎么用？',expect:{tool:'find_benefits',args:{query:'Resy',cardName:'Gold Card'}},target:{card:GOLD}},
 {id:'ret-caplat-after-gold-hans',lang:'zh-Hans',kind:'topic-return',turns:[caPlatTransferHans,goldDiningHans],question:'刚才那张能转 Marriott 的卡，Marriott 那条有什么限制？',expect:{tool:'get_card_rules',args:{kind:'transfer-relationship',cardName:'Platinum Card',region:'CA',programme:'Marriott'}},target:{card:PLAT_CA}},
 {id:'ret-ms-after-fee-en',lang:'en',kind:'topic-return',turns:[T('What perks does the Morgan Stanley Platinum have?',[fb('benefits',{cardName:'Morgan Stanley'})],'The Morgan Stanley Platinum has a long list: an airline incidental credit, a CashPlus engagement bonus, a CLEAR+ credit, a digital entertainment credit, a lodging credit, Global Lounge Collection access, lululemon and Oura Ring credits, a Resy credit, Uber Cash, an Uber One credit and a Walmart+ credit. Most credits need enrolment.'),T('What is the fee on the Sapphire Reserve?',[rules('fee',{cardName:'Sapphire Reserve'})],'The Sapphire Reserve has a published primary and additional card fee on record; that does not show what you were charged.')],question:'Going back to the first card, how does the CLEAR one work?',expect:{tool:'find_benefits',args:{query:'CLEAR',cardName:'Morgan Stanley'}},target:{card:MS}},
 {id:'ret-cathay-after-uber-hant',lang:'zh-Hant',kind:'topic-return',turns:[T('渣打國泰卡點樣連 Asia Miles？',[fb('Asia Miles',{cardName:'Cathay'})],'渣打國泰 Mastercard 有「Asia Miles 賬戶關聯」規則：要將信用卡同 Asia Miles 會員賬戶關聯，里數先會入賬。'),muUberHant],question:'返去國泰嗰張，年費幾多？',expect:{tool:'get_card_rules',args:{kind:'fee',cardName:'Cathay'}},target:{card:CATHAY}},

 // ---- long range: the referent is more than six turns back ----
 ...['zh-Hans','zh-Hant','en'].flatMap(lang=>{
  const fill=middle[lang],open={'zh-Hans':srLoungesHans,'zh-Hant':srLoungesHant,en:srLoungesEn}[lang];
  const q={'zh-Hans':['最开始问的那张卡年费多少？','最早那个列表里的第二个怎么用？'],'zh-Hant':['一開始問嗰張卡年費幾多？','最早嗰個列表第二個點用？'],en:['What was the fee on the card I asked about first?','How do I use the second one from the very first list?']}[lang];
  return [
   {id:'long-sr-fee-'+lang,lang,kind:'long-range',turns:[open,...fill],question:q[0],expect:{tool:'get_card_rules',args:{kind:'fee',cardName:'Sapphire Reserve'}},target:{card:SR}},
   {id:'long-sr-ord-'+lang,lang,kind:'long-range',turns:[open,...fill],question:q[1],expect:{tool:'find_benefits',args:{query:'Priority Pass',cardName:'Sapphire Reserve'}},target:{card:SR,ordinal:{index:2,list:[['加拿大航空休息室','Air Canada'],['Priority Pass 休息室','Priority Pass'],['Chase Sapphire 休息室','Chase Sapphire Lounge']]}}},
  ];
 }),
 {id:'long-hkplat-hans',lang:'zh-Hans',kind:'long-range',turns:[hkPlatHotelHans,...middle['zh-Hans']],question:'一开始说的那张香港卡，Accor 那个怎么登记？',regionInQuestion:true,expect:{tool:'find_benefits',args:{query:'Accor',cardName:'The Platinum Card',region:'HK'}},target:{card:PLAT_HK}},
 {id:'long-aspire-en',lang:'en',kind:'long-range',turns:[aspireHotelEn,...middle.en],question:'For the hotel card from the start, what is the annual fee?',expect:{tool:'get_card_rules',args:{kind:'fee',cardName:'Aspire'}},target:{card:ASPIRE}},
 {id:'long-caplat-hans',lang:'zh-Hans',kind:'long-range',turns:[caPlatTransferHans,...middle['zh-Hans']],question:'最开始那张卡转 Etihad 有什么条件？',expect:{tool:'get_card_rules',args:{kind:'transfer-relationship',cardName:'Platinum Card',region:'CA',programme:'Etihad'}},target:{card:PLAT_CA}},
 {id:'long-gold-hant',lang:'zh-Hant',kind:'long-range',turns:[goldTransferHant,...middle['zh-Hant']],question:'最早問嗰張卡，可唔可以轉 ANA？',expect:{tool:'get_card_rules',args:{kind:'transfer-relationship',cardName:'Gold Card',programme:'ANA'}},target:{card:GOLD}},

 // ---- same product name in different regions ----
 {id:'same-hk-after-us-hans',lang:'zh-Hans',kind:'same-name',turns:[hkPlatHotelHans,T('美国那张白金卡呢？',[fb('酒店',{cardName:'The Platinum Card',region:'US'})],'美国 The Platinum Card 在知识库里没有找到酒店权益记录，这不代表它没有，只是还没收录。')],question:'回到有酒店礼遇的那张，Hilton 会籍怎么拿？',expect:{tool:'find_benefits',args:{query:'Hilton Gold',cardName:'The Platinum Card',region:'HK'}},target:{card:PLAT_HK}},
 {id:'same-hk-fee-hant',lang:'zh-Hant',kind:'same-name',turns:[hkPlatHotelHant],question:'呢張年費幾多？',expect:{tool:'get_card_rules',args:{kind:'fee',cardName:'The Platinum Card',region:'HK'}},target:{card:PLAT_HK}},
 {id:'same-ca-hilton-en',lang:'en',kind:'same-name',turns:[T('Which of my cards can transfer to Hilton?',[rules('transfer-relationship',{programme:'Hilton'})],'Only your Canadian Amex Platinum has a recorded transfer relationship to Hilton Honors. The ratio is not recorded.')],question:'What is the annual fee on that one?',expect:{tool:'get_card_rules',args:{kind:'fee',cardName:'Platinum Card',region:'CA'}},target:{card:PLAT_CA}},
 {id:'same-ca-hilton-hans',lang:'zh-Hans',kind:'same-name',turns:[T('哪张卡能转点到 Hilton？',[rules('transfer-relationship',{programme:'Hilton'})],'只有你的加拿大运通白金卡有到 Hilton Honors 的转点记录，比例没有记录。')],question:'那张卡还有什么旅行权益？',expect:{tool:'find_benefits',args:{query:'旅行',cardName:'Platinum Card',region:'CA'}},target:{card:PLAT_CA}},
 {id:'same-asia-miles-hk-hans',lang:'zh-Hans',kind:'same-name',turns:[T('哪些卡能转 Asia Miles？',[rules('transfer-relationship',{programme:'Asia Miles'})],'能转 Cathay Asia Miles 的有四张：加拿大白金卡、香港白金卡、美国运通金卡和 Morgan Stanley 白金卡。比例都没有记录。')],question:'香港那张还能转哪些？',regionInQuestion:true,expect:{tool:'get_card_rules',args:{kind:'transfer-relationship',cardName:'The Platinum Card',region:'HK'}},target:{card:PLAT_HK}},
 {id:'same-marriott-ca-en',lang:'en',kind:'same-name',turns:[muMarriottEn],question:'How do I enrol on the Canadian one?',regionInQuestion:true,expect:{tool:'find_benefits',args:{query:'Marriott Gold',cardName:'Platinum Card',region:'CA'}},target:{card:PLAT_CA}},
 {id:'same-marriott-hk-hant',lang:'zh-Hant',kind:'same-name',turns:[muMarriottHant],question:'香港嗰張點登記？',regionInQuestion:true,expect:{tool:'find_benefits',args:{query:'Marriott Gold',cardName:'The Platinum Card',region:'HK'}},target:{card:PLAT_HK}},
 {id:'same-lounge-hk-vs-ms-hans',lang:'zh-Hans',kind:'same-name',turns:[T('哪些卡有 Global Lounge Collection？',[fb('Global Lounge Collection')],'Global Lounge Collection 出现在两张卡上：香港白金卡和 Morgan Stanley 白金卡。')],question:'美国那张的条件是什么？',regionInQuestion:true,expect:{tool:'find_benefits',args:{query:'Global Lounge Collection',cardName:'Morgan Stanley'}},target:{card:MS}},
];
