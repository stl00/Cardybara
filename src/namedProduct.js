import {cardProducts,matchCardProduct} from './productCatalog.js';
import {queryKnowledge,knowledgeEntities} from './knowledge.js';
import {toSimplified} from './benefitVocabulary.js';
// A benefit question that names a card product ("Sapphire Obsidian card", "钛晶卡", "Amex Aurora") is about that
// product. If no held card is that product, the answer is that the wallet doesn't hold it: searching the other
// cards' benefits by the rest of the words would answer a question nobody asked (#157).
// A named thing that is a programme or a benefit ("Priority Pass card", "礼品卡") is not a product and searches as usual.

const norm=s=>String(s||'').normalize('NFKC').toLowerCase();
// Words that name no product: issuer filler, tiers of generality, card kinds, regions and qualifiers.
const GENERIC=new Set(('the card cards credit debit charge american express gift prepaid metal physical virtual plastic replacement additional '+
 'authorized authorised user users supplementary companion primary main member membership reward rewards travel hotel airline airlines '+
 'cashback cash back premium cobrand co-brand co-branded store bank sim key room loyalty boarding status elite lounge access benefit benefits '+
 'perk perks best good great better top ideal right favorite favourite cheapest cheap free annual fee no-fee first second current existing '+
 'other another different new old regular basic personal hk hong kong canada canadian usa us-issued visa mastercard jcb unionpay octopus '+
 'fx forex atm abroad overseas foreign international transaction contactless chip signature infinite world').split(' '));
// Function words end a name when reading back from "card".
const STOP=new Set(('a an the my your our their his her its this that these those which what any each every all both one two for with of on in at to by from '+
 'and or do does did is are was were be have has had can could will would should may might must i you we they it me use using about '+
 'how why when where who whose whether if than then so as into onto per no not without zero').split(' '));
// Issuers that lead a product name. Discover, Capital One and Wells Fargo are left out: their words are also common English.
const BANKS=new Set(['amex','chase','citi','citibank','hsbc','boa']);
const latin=s=>(norm(s).replace(/'s\b/g,'').match(/[a-z0-9][a-z0-9+-]*/g)||[]).filter(w=>/[a-z]/.test(w)&&w.length>=2);
const nameWords=s=>latin(s).filter(w=>!GENERIC.has(w)&&!STOP.has(w));
// Chinese card words with an English equivalent in product names, and issuers by their Chinese names.
const ZH_TERMS=[[/白金|铂金|鉑金/g,'platinum'],[/蓝宝石|藍寶石/g,'sapphire'],[/商务|商務/g,'business'],[/公司/g,'corporate'],[/金/g,'gold'],
 [/运通|運通/g,'amex'],[/大通/g,'chase'],[/花旗/g,'citi'],[/汇丰|滙豐|匯豐/g,'hsbc'],[/美银|美銀/g,'boa']];
// Programmes by their Chinese aliases, named by their shortest Latin alias (希尔顿 → hilton).
const ZH_PROGRAMMES=knowledgeEntities.programmes.flatMap(p=>{const names=[p.name,...(p.aliases||[])],en=names.filter(n=>/^[\x20-\x7e]+$/.test(n)).sort((a,b)=>a.length-b.length)[0]||p.name;return (p.aliases||[]).filter(a=>/[㐀-鿿]/.test(a)).map(a=>[toSimplified(a),nameWords(en)]);}).sort((a,b)=>b[0].length-a[0].length);
// Chinese words that are part of how a card is referred to, not its name.
const ZH_GENERIC=/万事达|萬事達|银联|銀聯|我的|这张|這張|那张|那張|哪张|哪張|每张|每張|一张|一張|两张|兩張|信用|联名|聯名|附属|附屬|实体|實體|虚拟|虛擬|金属|金屬|美国|美國|美版|香港|港版|加拿大|加国|加國|银行|銀行|[张張主副新旧舊]/g;
// Chinese words that describe a kind of card (charge, miles, student, currency, tier) rather than name a product.
const ZH_DESCRIPTOR=/签账|簽賬|签帐|簽帳|扣账|扣賬|提款|里数|里數|哩数|哩數|飞行|飛行|旅游|旅遊|网购|網購|签名|簽名|无限|無限|钛金|鈦金|黑金|钻石|鑽石|现金回赠|現金回贈|回赠|回贈|学生|學生|双币|雙幣|多币|多幣|港币|港幣|美元|人民币|人民幣|外币|外幣|海外|境外|出国|出國|留学|留學|航空|里程|返现|返現|黑/g;
// A Chinese "…卡" that is a benefit or another kind of card, never a credit-card product.
const ZH_ARTIFACT=/储蓄|儲蓄|礼品|禮品|会员|會員|储值|儲值|借记|借記|扣账|扣賬|八达通|八達通|交通|房|门|門|登机|登機|身份|电话|電話|手机|手機|优惠|優惠|积分|積分|现金|現金|会籍|會籍|贵宾|貴賓|休息室|停车|停車|加油|购物|購物|礼|禮|健身|片|券/;
const ZH_BEFORE_CARD=/[碌签簽拍嘟插拎续續办辦开開申换換补補销銷持刷用绑綁收寄拿发發下批养養停挂掛退领領张張此该該本同各整首一两兩几幾多]/;
// Reading back from 卡 stops at these, Cantonese function words (喺, 嘅, 咗, 唔…) included: they end the name.
const ZH_BOUNDARY=/[喺嘅啲咗唔冇係俾畀佢乜點邊嚟去碌的用刷拿和与與或跟及在这這那哪每有把对對给給问問我你您是个個些么麼吗嗎呢]/;

const productNames=p=>[p.name,...(p.aliases||[]),p.bank];
const cardNames=c=>{const p=matchCardProduct(c).product;return [c.name,c.pageName,c.bank,...(p?productNames(p):[])].filter(Boolean);};
// Initials of each name (Sapphire Reserve → sr, Chase Sapphire Reserve → csr) are short names people use for the card.
const initials=name=>{const w=latin(name).filter(x=>!STOP.has(x)&&!['card','credit'].includes(x));return w.length>=2?[w.map(x=>x[0]).join('')]:[];};
const profile=names=>({words:new Set(names.flatMap(nameWords)),short:new Set(names.flatMap(initials)),han:toSimplified(names.join(' '))});
// A name word fits a card word when it is the word, the start of it (plat → platinum) or the card's initials (sr).
const fits=(p,w)=>p.words.has(w)||p.short.has(w)||w.length>=3&&[...p.words].some(x=>x.startsWith(w));
const catalogue=cardProducts.map(p=>({id:p.id,...profile(productNames(p))}));
const PRODUCT_WORDS=new Set(catalogue.flatMap(p=>[...p.words]));
const PROGRAMME_WORDS=new Set(knowledgeEntities.programmes.flatMap(p=>[p.name,...(p.aliases||[])].flatMap(latin)));
// Every English word in benefit rule text: a word found there is benefit vocabulary, not an unknown product name.
let ruleWords=null;
const benefitWords=asOf=>ruleWords||=new Set(queryKnowledge({kind:'benefit',asOf,includeInactive:true}).rules.flatMap(r=>[r.content,r.original,...Object.values(r.translations||{})].filter(Boolean).flatMap(t=>[t.title,t.summary,...(t.howToUse||[])].flatMap(latin))));

// Every Chinese character in rule text, card names and programme aliases. A name with a character outside them
// (钛晶, 火星) is one the knowledge base has never seen; descriptions of cards (海外签账) are made of known characters.
let hanChars=null;
function knownHan(asOf){
 if(hanChars)return hanChars;
 const texts=queryKnowledge({kind:'benefit',asOf,includeInactive:true}).rules.flatMap(r=>[r.content,r.original,...Object.values(r.translations||{})].filter(Boolean).flatMap(t=>[t.title,t.summary,...(t.howToUse||[])]));
 texts.push(...catalogue.map(p=>p.han),...knowledgeEntities.programmes.flatMap(p=>p.aliases||[]));
 hanChars=new Set(texts.flatMap(t=>[...String(t)+toSimplified(t)].filter(ch=>/[\u3400-\u9fff]/.test(ch))));
 return hanChars;
}
const unknownHan=(han,asOf)=>{const chars=knownHan(asOf);return [...han].some(ch=>!chars.has(ch)&&!chars.has(toSimplified(ch)));};

// A word or its singular is in the benefit vocabulary.
const known=(vocab,w)=>vocab.has(w)||vocab.has(w.replace(/(?:es|s)$/,''))||vocab.has(w.replace(/s$/,''));
// English: "<name words> card(s)", read back from the word card; and "<issuer> <name words>" with no card word.
function englishMentions(question,vocab){
 const out=[],benefitWord=w=>!PRODUCT_WORDS.has(w)&&(known(vocab,w)||PROGRAMME_WORDS.has(w));
 for(const segment of norm(question).split(/[^a-z0-9+'\s-]+/)){
  const tokens=latin(segment);
  tokens.forEach((t,i)=>{
   if(t==='card'||t==='cards'){const words=[];for(let j=i-1;j>=0&&words.length<6;j--){const w=tokens[j];if(STOP.has(w)||w==='card'||w==='cards'||!GENERIC.has(w)&&benefitWord(w))break;words.unshift(w);}const named=words.filter(w=>!GENERIC.has(w));if(named.length)out.push({text:words.join(' '),words:named,han:''});}
   else if(BANKS.has(t)&&tokens[i+1]!=='card'&&tokens[i+1]!=='cards'){
    const words=[t];for(let j=i+1;j<tokens.length&&words.length<4;j++){const w=tokens[j];if(STOP.has(w)||GENERIC.has(w)||benefitWord(w))break;words.push(w);}
    if(words.length>1)out.push({text:words.join(' '),words,han:''});
   }
  });
 }
 return out;
}
// A Chinese name, with programme and card words turned into English and generic words removed.
function chineseName(name){
 const words=nameWords(name);let han=name.replace(/[a-z0-9+ -]+/g,'').replace(ZH_GENERIC,'').replace(ZH_DESCRIPTOR,'');const original=han;
 for(const [alias,en] of ZH_PROGRAMMES)if(han.includes(alias)){words.push(...en);han=han.replaceAll(alias,'');}
 for(const [re,en] of ZH_TERMS){const rest=han.replace(re,'');if(rest!==han){words.push(en);han=rest;}}
 return words.length||han?{text:name,words:[...new Set(words)],han,original}:null;
}
const lastPart=name=>{const cut=[...name].map((ch,i)=>ZH_BOUNDARY.test(ch)?i:-1).filter(i=>i>=0).pop();return (cut!=null?name.slice(cut+1):name).trim();};
// Chinese: the characters before 卡, back to the nearest boundary.
function chineseMentions(question){
 const out=[],text=toSimplified(norm(question));
 for(const m of text.matchAll(/([\u3400-\u9fffa-z0-9+ ]{1,12})卡(?!片|券)/g)){
  // 续卡, 办卡, 刷卡, 碌卡, 持卡人, 信用卡, 每张卡: a verb, measure word or 信用 right before 卡 makes it an action or a generic card, not a name.
  if(ZH_BEFORE_CARD.test(m[1].trim().slice(-1)))continue;
  const name=lastPart(m[1]);if(!name||ZH_ARTIFACT.test(name))continue;
  const mention=chineseName(name);if(mention)out.push(mention);
 }
 return out;
}
const covers=(p,{words,han,original})=>words.every(w=>fits(p,w))&&[...han].every(ch=>p.han.includes(ch))
 ||!!original&&[...original].every(ch=>p.han.includes(ch))&&words.every(w=>fits(p,w)||ZH_TERMS.some(([,en])=>en===w)||ZH_PROGRAMMES.some(([,en])=>en.includes(w)));

// The first card product the question names that no held card is. Null when every named product is held, or none is named.
export function unheldProduct(question,cards,asOf){
 const vocab=benefitWords(asOf),held=cards.map(c=>profile(cardNames(c))),heldIds=new Set(cards.map(c=>matchCardProduct(c).product?.id).filter(Boolean));
 for(const mention of [...englishMentions(question,vocab),...chineseMentions(question)]){
  if(held.some(p=>covers(p,mention)))continue;
  const product=catalogue.find(p=>!heldIds.has(p.id)&&mention.words.some(w=>PRODUCT_WORDS.has(w)||BANKS.has(w))&&covers(p,mention));
  if(product)return {named:mention.text,catalogued:true};
  const unknown=mention.words.some(w=>!PRODUCT_WORDS.has(w)&&!PROGRAMME_WORDS.has(w)&&!known(vocab,w))||unknownHan(mention.han,asOf);
  if(unknown)return {named:mention.text,catalogued:false};
 }
 return null;
}
