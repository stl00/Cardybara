import {knowledgeEntities} from './knowledge.js';
// Benefit rule text is written in Simplified Chinese. These tables bridge a question's words to it:
// a general glossary, not a list of eval questions. Brand names come from entity aliases in the knowledge base.

// Traditional characters common in card and travel questions, mapped to Simplified. One-to-one only:
// characters whose Simplified form depends on the word (such as 乾/幹) are left out.
const T2S=Object.fromEntries('機机 場场 貴贵 賓宾 險险 車车 費费 飯饭 廳厅 訂订 閱阅 會会 員员 積积 優优 惠惠 電电 劇剧 運运 動动 購购 買买 賬账 單单 換换 錢钱 續续 還还 張张 點点 樣样 這这 們们 時时 間间 門门 價价 務务 額额 遊游 護护 體体 萬万 達达 聯联 國国 際际 華华 爾尔 區区 後后 發发 麼么 種种 處处 稅税 實实 現现 銀银 網网 樂乐 藝艺 證证 對对 開开 關关 說说 話话 進进 過过 選选 擇择 專专 賞赏 獎奖 勵励 灣湾 東东 氣气 條条 連连 與与 當当 級级 雙双 幣币 類类 標标 準准 廣广 飛飞 戲戏 館馆 滿满 轉转 結结 帳帐 號号 碼码 簽签 紀纪 錄录 節节 週周 為为 讓让 並并 減减 產产 嗎吗 啟启 權权 紅红 鑽钻 禮礼 寶宝 線线 傳传 臺台 統统 營营 業业 廠厂 鐵铁 筆笔 齊齐 衛卫 視视 頻频 冇没 睇看 攞拿 慳省'.split(' ').map(p=>[p[0],p[1]]));
export const toSimplified=s=>Array.from(String(s||''),c=>T2S[c]||c).join('');

// Question words → words that appear in rule titles and summaries. Expansions are appended, never substituted.
const GLOSSARY=[
 [/insur|coverage|covered|protect|保险|保障|理赔|理賠|赔吗|賠/i,'保障 保险'],
 [/rental car|car rental|rent(?:ing)? a car|租车|租車/i,'租车 保障'],
 [/roadside|break ?down|抛锚|拋錨|死火/i,'道路救援'],
 [/delay|late flight|flight is late|延误|延誤/i,'延误'],
 [/baggage|luggage|\bbags?\b|行李/i,'行李'],
 [/checked bag|托运|托運|寄艙/i,'托运行李'],
 [/airline|airfare|flights?\b|plane|机票|機票|航空/i,'航空 机票'],
 [/in-?flight|on ?board|wi-?fi|飞机上|飛機上|机上/i,'机上'],
 [/evacuat|撤离|撤離/i,'紧急撤离'],
 [/purchase protection|broken|damaged|stolen|坏了|壞咗|坏掉/i,'购物保护'],
 [/\breturn(?:s|ed)?\b|take (?:it )?back|退货|退貨/i,'退货保护'],
 [/annual fee|年费|年廢|年废/i,'年费'],
 [/waive|免年费|免年費|豁免/i,'豁免'],
 [/\bmiles?\b|mileage|里程|哩数/i,'里程'],
 [/anniversary|every year|yearly|每年|周年|週年/i,'周年'],
 [/fourth night|4th night|第四晚/i,'第四晚'],
 [/hk ?express|香港快运/i,'HK Express'],
 [/mobile pay|手机付款|扫码|二维码|支付宝|微信支付/i,'流动支付'],
 [/free night|night certificate|免房|房券|房晚/i,'免房晚'],
 [/grocer|supermarket|杂货|雜貨|超市|买菜|買餸/i,'杂货 非餐饮'],
 [/meal kit|食材包|半成品|做饭|煮飯/i,'订餐 Home Chef'],
 [/deliver|takeout|take-out|外卖|外賣|叫外/i,'外卖 DoorDash'],
 [/\bmovies?\b|cinema|\bfilm|电影|看戏|戏票/i,'电影'],
 [/concert|\btickets?\b|演唱会|门票|票务/i,'购票 门票'],
 [/\bstream|追剧|剧集/i,'流媒体 订阅'],
 [/\bworking out\b|\bworkouts?\b|\bexercis|健身房|做运动/i,'健身'],
 [/chauffeur|car service|专车|接送机|接机|送机/i,'专车 Blacklane'],
 [/\brides?\b|叫车|打的|的士|taxi|\bcab\b/i,'打车 rideshare'],
 [/\bfood\b|\beat(?:ing)?\b|吃饭|食饭|餐厅|餐馆|餐饮|用餐|restaurant/i,'餐饮'],
 [/breakfast|早餐/i,'早餐'],
 [/first[- ]year|首年|第一年/i,'首年'],
 [/foreign (?:transaction )?fee|fx fee|手续费|外币|外幣/i,'外币手续费'],
 [/points? (?:boost|multiplier|accelerat)|加速|多啲分|倍积分/i,'积分加速'],
 [/lounge|贵宾|貴賓|候机室/i,'休息室 贵宾室'],
 [/\bstatus\b|\belite\b|\btier\b|会籍|会员身份/i,'会籍'],
];

const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// Each programme alias adds the programme's name, so 万豪 finds rules filed under Marriott Bonvoy.
// Longest first, and a matched alias is blanked out, so 阿拉斯加航空 cannot also match a shorter alias inside it.
// English aliases need word boundaries, and United is not United States or United Kingdom.
const ALIASES=knowledgeEntities.programmes.flatMap(p=>(p.aliases||[]).map(a=>({a,name:p.name}))).sort((x,y)=>y.a.length-x.a.length)
 .map(({a,name})=>[new RegExp(/^[\x20-\x7e]+$/.test(a)?`\\b${escape(a)}\\b(?!\\s+(?:states|kingdom|nations|arab))`:escape(toSimplified(a)),'gi'),name]);

// The words as asked: the question plus its Simplified form. Strict filters such as a named partner use only these.
export const askedText=text=>{const raw=String(text||''),simple=toSimplified(raw);return simple===raw?raw:raw+' '+simple;};
// The asked words, then glossary and alias expansions. Expansions are appended, never substituted.
export function expandQuery(text){
 const both=askedText(text),extra=GLOSSARY.filter(([re])=>re.test(both)).map(([,w])=>w);
 let rest=both;for(const [re,name] of ALIASES){if(re.test(rest)){extra.push(name);rest=rest.replace(re,' ');}re.lastIndex=0;}
 return [both,...new Set(extra)].join(' ');
}
