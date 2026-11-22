import {searchBenefitKnowledge} from './benefitSearch.js';
import {heldCards} from './heldCards.js';
import {chooseCard,pointValueFor,PURCHASE_CATEGORIES,PURCHASE_CHANNELS,POINT_VALUE_NAMES} from './cardDecision.js';
import {matchCardProduct} from './productCatalog.js';
import {knowledgeSources,queryKnowledge,knowledgeEntities,ruleText,COVERAGE_TYPES} from './knowledge.js';
import {queryCredits,queryCreditLedger,CREDIT_USES,LEDGER_BASIS_CHOICES} from './creditQuery.js';
import {transferOptions,pointsToReach,transferProgrammes,partnerMatches} from './transferRoutes.js';
import {valuationFor,resolvePointValue} from './pointValues.js';
import {cardProgramme,poolingRules,poolingExplanation,pointsReach} from './pointsPooling.js';
import {redemptionOptions,heldProductIdsOf} from './redemptionOptions.js';
import {FIXED_REDEMPTION_PROGRAMMES} from './fixedRedemptions.js';
import {gatedJudge} from './benefitAnswerJudge.js';
export const agentTools=[
 {type:'function',function:{name:'choose_card',description:'Decide which held card to use for a purchase. Code compares every held card using earning rules, usable credits, caps, known costs and a value per point (the user\'s own, else the default market valuation), and returns the choice with the value and its basis. Answer with what the user gave: every field is optional except what you can read from the question. Do not ask first. Never guess MCC: use categorySource inferred if the user did not say the category. Read only.',parameters:{type:'object',properties:{category:{type:'string',enum:PURCHASE_CATEGORIES},categorySource:{type:'string',enum:['stated','inferred']},alternateCategory:{type:'string',enum:PURCHASE_CATEGORIES,description:'Only for a merchant that may code either way, such as a warehouse club or big-box store.'},merchant:{type:'string',minLength:1,maxLength:120},amount:{type:'number',minimum:0.01,maximum:1e8},currency:{type:'string',pattern:'^[A-Z]{3}$',description:'ISO code of a currency the user named: 美元, US dollars or USD is USD, 港币 is HKD, 日元 is JPY. A bare $ or 元 with no country named is not a currency.'},country:{type:'string',pattern:'^[A-Z]{2}$',description:'Where the purchase happens, only if the user stated it.'},channel:{type:'string',enum:PURCHASE_CHANNELS,description:'direct, portal (issuer travel portal) or wallet, only if stated.'},portal:{type:'string',minLength:2,maxLength:60,description:'The portal named by the user, such as Chase Travel or Amex Travel.'},when:{type:'string',minLength:1,maxLength:80,description:'Only the date words as the user said them, if the purchase is not today.'},nights:{type:'number',minimum:1,maximum:60,description:'Whole number of hotel or rental nights, only if the user stated it.'},pointValues:{type:'object',description:'Only values the user stated this conversation, as cents per point by programme, such as {"MR":1.5}. A bare MR or UR is the US programme; write MR HK for Hong Kong. Never supply your own: code already applies the user\'s saved values and the default market valuations, and returns which was used.'}},additionalProperties:false}}},
 {type:'function',function:{name:'find_benefits',description:'Search public benefits applicable to held cards, with official sources. Does not prove enrollment or usage. Most benefit records have the issuer\'s official text in its source language (English for current US, Hong Kong and Canadian cards) and a Simplified Chinese translation, and some have only the Chinese text; every language a record has is searched. Set the closest scenarioId or category whenever the question points to a use, even loosely, and write query as short keywords: the user\'s own words plus Simplified Chinese or English keywords, such as "rental car 租车 保障". For a whole card or all benefits, leave scenarioId and category empty, put the card in cardName and ask for its benefits. If suggestions are returned, the filters found no matching words: search one suggested scenario before saying nothing applies. If unheldProduct or unknownSubject is returned, the user\'s cards have nothing for it: say so plainly and do not search other cards or scenarios to fill the answer. Keep answering in the user\'s language.',parameters:{type:'object',properties:{query:{type:'string',minLength:1,maxLength:500,description:'Short keywords: the user\'s own words plus Simplified Chinese or English keywords; keep brand names as written.'},scenarioId:{type:'string',description:'Set whenever the question points to a scenario. Flights, bags and in-flight are travel or airport; rentals and rides are ground-transport.',enum:['travel','hotel-stay','dining','entertainment','ground-transport','airport','shopping','reward-redemption','card-ownership','fitness']},category:{type:'string',description:'Insurance and purchase protection are protection; statement credits are credit; elite status is membership.',enum:['credit','promo','membership','lounge','hotel-service','spend-unlock','protection']},programme:{type:'string',minLength:1,maxLength:80,description:'A hotel, airline or partner programme, by name or alias in any language, such as Marriott, 万豪 or Bonvoy.'},region:{type:'string',enum:['US','CA','HK'],description:'Restrict to the held card issuance region, not the travel destination. Use when user specifies a regional card.'},cardName:{type:'string',minLength:1,maxLength:160,description:'Optional exact product name or substring from list_cards to restrict this search to a particular card.'}},required:['query'],additionalProperties:false}}},
 {type:'function',function:{name:'get_card_rules',description:'Read sourced public annual fees or points-transfer relationships for held products. Published fees are not actual charges or waivers; how to get a fee waived is a benefit, so also call find_benefits for waiver questions. For transfer rates and converting a number of points, use convert_points. Null transfer ratios and account linkage remain unknown; no conversion or transfer action. Narrow by issuance region/card name if truncated.',parameters:{type:'object',properties:{kind:{type:'string',enum:['fee','transfer-relationship']},region:{type:'string',enum:['US','CA','HK']},cardName:{type:'string',minLength:1,maxLength:160,description:'Held product name or substring from list_cards; use region for same-name products.'},programme:{type:'string',minLength:1,maxLength:80,description:'Optional destination programme name substring, e.g. Hilton or Aeroplan. Use English names returned in evidence.'}},required:['kind'],additionalProperties:false}}},
 {type:'function',function:{name:'convert_points',description:'Which partners the points of held cards can transfer to, the published transfer rate for each card, and how many partner miles or points a stated number of points converts to. Code reads verified rules and does the maths, in whole transfer steps; leftover points are never rounded up. A rate is given only where a rule lists that card: rate not-published or card-not-listed means no number is known, so give none. Pass points only when the user stated a number; never a balance you assume, and never add cards together. A card row with through reaches that rate only by pooling or combining into the named card: say so. Whether points pool or combine is points_accounts. Public rules only: no award availability, no transfer is made. Read only.',parameters:{type:'object',properties:{partner:{type:'string',minLength:1,maxLength:80,description:'Optional airline or hotel programme, by name or alias in any language, such as Hyatt, 凯悦 or Asia Miles.'},points:{type:'number',minimum:1,maximum:1e9,description:'A whole number of points the user stated, to convert.'},cardName:{type:'string',minLength:1,maxLength:160,description:'Held product name or substring from list_cards.'},region:{type:'string',enum:['US','CA','HK'],description:'Card issuance region.'}},additionalProperties:false}}},
 {type:'function',function:{name:'query_credits',description:'The only source for whether credits were used, which are left, and credits for given dates. Whether a card has a credit for something, or how a credit works, is a find_benefits question (category credit); so are memberships, lounges, elite status and general benefit questions. Add this tool when status or dates also matter. If findBenefitsHint is returned, follow it. Code resolves dates, overlaps benefit cycles, reads manual marks and joins terms, returning explicit groups. Without when it reads the current cycle. Unknown means not confirmed, never unused. Read only.',parameters:{type:'object',properties:{when:{type:'string',minLength:1,maxLength:80,description:'Only the date words exactly as the user said them, such as 12月, 聖誕, Dec 20-27 or 1月, with no other words from the sentence. Do not convert them or calculate dates. Omit for the current cycle.'},reuseRememberedDates:{type:'boolean',description:'True to reuse the remembered dates when the user changes only the use, card or destination. Omit when with this.'},use:{type:'string',enum:CREDIT_USES,description:'Optional use, such as hotel. Omit to read all credits.'},cardName:{type:'string',minLength:1,maxLength:160,description:'Held product name or substring from list_cards.'},region:{type:'string',enum:['US','CA','HK'],description:'Card issuance region, not the travel destination.'},destination:{type:'string',pattern:'^[A-Z]{2}$',description:'Optional ISO country code of the travel destination, only if the user named one. Not the card region.'},yearBasis:{type:'string',enum:LEDGER_BASIS_CHOICES,description:'Set only when the user asks how much a card\'s credits returned or were used over a year: card-year for the card year (from the annual fee date), calendar-year for January to December. Returns per-card totals from the credit ledger instead of cycle groups; omit when and use with it.'}},additionalProperties:false}}},
 {type:'function',function:{name:'find_protections',description:'Which held cards list an insurance or protection benefit, such as rental car coverage, trip delay or purchase protection, from sourced public terms. For each card it returns the coverage type, primary or secondary only where the terms state it, any exclusions the terms state, whether the terms require paying with the card, and the source. A card with no record is not_found: say no record is held for it, never that it has no coverage. In the answer, say the card\'s guide to benefits controls and this is not insurance advice. Read only.',parameters:{type:'object',properties:{type:{type:'string',enum:COVERAGE_TYPES,description:'The kind of protection asked about. Omit to list every protection of the selected cards.'},cardName:{type:'string',minLength:1,maxLength:160,description:'Held product name or substring from list_cards.'},region:{type:'string',enum:['US','CA','HK'],description:'Card issuance region, not the travel destination.'}},additionalProperties:false}}},
 {type:'function',function:{name:'plan_flight',description:'Plan paying for a flight with points, cash or both, for a route and airline the user named. Code reads the published transfer path from each held card to the airline programme, works out how many points reach the award miles the user stated and the shortfall against points the user stated, reads airline credits for the dates, and lists the booking protections the held cards list for a flight (trip cancellation, trip delay, baggage, travel insurance) as protections: report them after the plan, say the card guide to benefits controls, never call a not_found card uncovered, and do not call find_protections again for the same cards. No award search is connected: award seats, award prices and their freshness are not checked, so say so. Pass numbers only when the user stated them; never a balance or award price you assume. Returns the value per point of each programme (the user\'s own, else the default market valuation) with its basis. With a stated cash fare it also returns payCash (which held card to pay that cash fare with, as choose_card ranks it for a flight; name it for the cash side and do no maths) and cashComparison: code works out, per programme, the points spent, what they are worth at that value, cents per mile against the fare and which side is cheaper; report that verdict as given and do no maths of your own. Read only.',parameters:{type:'object',properties:{airline:{type:'string',minLength:1,maxLength:80,description:'The airline or its programme, by name or alias in any language, such as Delta, 达美, ANA or Flying Blue.'},route:{type:'string',minLength:1,maxLength:80,description:'The route as the user said it, such as JFK to LAX or 纽约飞洛杉矶. Repeated back, not looked up.'},when:{type:'string',minLength:1,maxLength:80,description:'Only the date words exactly as the user said them, such as 12月 or Dec 20-27. Do not convert them. Omit if no date was named.'},milesNeeded:{type:'number',minimum:1,maximum:1e8,description:'The award price in airline miles, only if the user stated it.'},points:{type:'number',minimum:1,maximum:1e9,description:'A whole number of points the user said they have, only if stated.'},cardName:{type:'string',minLength:1,maxLength:160,description:'Held product name or substring from list_cards.'},region:{type:'string',enum:['US','CA','HK'],description:'Card issuance region, not the travel destination.'},destination:{type:'string',pattern:'^[A-Z]{2}$',description:'ISO country code of where the flight lands, only if the user named it.'},pointValues:{type:'object',description:'Only values the user stated this conversation, as cents per point by programme, such as {"MR":2}. Never supply your own: code applies the user\'s saved values and the default market valuations.'},cashFare:{type:'number',minimum:0.01,maximum:1e7,description:'The cash fare for the same trip, only if the user stated it. Never a fare you assume, look up or estimate.'},cashFareCurrency:{type:'string',pattern:'^[A-Z]{3}$',description:'ISO currency of the stated cash fare, such as USD. Required with cashFare.'},taxesAndFees:{type:'number',minimum:0,maximum:1e7,description:'Taxes and fees the user said they would pay in cash on the award ticket, in the cash fare currency. Only if stated.'}},required:['airline'],additionalProperties:false}}},
 {type:'function',function:{name:'plan_stay',description:'Plan paying for a hotel stay with the points of a hotel programme, for the programme and number of nights the user named. Code reads the published transfer path from each held card to that hotel programme, works out how many points reach the stated points per night times the nights and the shortfall against points the user stated, lists hotel credits and free-night benefits for the dates, and the booking protections the held cards list for a hotel stay. No availability or price lookup is connected: room availability, nightly award prices and cash rates are not checked, so say so. Pass pointsPerNight and points only when the user stated them; never a balance or award price you assume. Stated points are never added across programmes. Read only.',parameters:{type:'object',properties:{programme:{type:'string',minLength:1,maxLength:80,description:'The hotel programme, by name or alias in any language, such as Hyatt, 凯悦, Marriott or IHG.'},nights:{type:'number',minimum:1,maximum:60,description:'Whole number of nights the user said they will stay.'},when:{type:'string',minLength:1,maxLength:80,description:'Only the date words exactly as the user said them, such as 12月 or Dec 20-27. Do not convert them. Omit if no date was named.'},pointsPerNight:{type:'number',minimum:1,maximum:1e7,description:'The award price per night in the hotel programme\'s points, only if the user stated it.'},points:{type:'number',minimum:1,maximum:1e9,description:'A whole number of points the user said they have, only if stated.'},cardName:{type:'string',minLength:1,maxLength:160,description:'Held product name or substring from list_cards.'},region:{type:'string',enum:['US','CA','HK'],description:'Card issuance region, not the travel destination.'}},required:['programme','nights'],additionalProperties:false}}},
 {type:'function',function:{name:'points_accounts',description:'How the points accounts of held cards relate, per programme and region: one shared pool (count the balance once), one account per card (add balances up; never usable on another card), or one account per card that can be combined (add up; transfer partners are the union of the holder\'s cards). Use for whether points of several cards add up, can be combined or used together, or can reach another card\'s transfer partners, such as 我的 HK MR 能合起来用吗 or can my Freedom points go to Hyatt. Returns the rule, its caveats and sources; rules marked ownerOverride were stated by the cardholder and win over general knowledge. For US Membership Rewards and Ultimate Rewards each programme also carries the issuer\'s own redemptions (cash back, statement credit, deposit, gift cards, issuer travel): kind, value per point or varies or unknown, condition, source, and, when points is passed, the value of those points computed in code. Use it for what points are worth as cash or statement credit versus transfer. No balances are read; pass points only when the user stated a number. Read only.',parameters:{type:'object',properties:{programme:{type:'string',enum:['Membership Rewards','Ultimate Rewards','Bilt Rewards'],description:'Optional programme.'},region:{type:'string',enum:['US','HK'],description:'Card issuance region, such as HK for 香港 Amex.'},cardName:{type:'string',minLength:1,maxLength:160,description:'Held product name or substring from list_cards.'},points:{type:'number',minimum:1,maximum:1e9,description:'A whole number of points the user stated, to value at each issuer redemption. Never a balance you assume.'}},additionalProperties:false}}},
 {type:'function',function:{name:'list_cards',description:'Read held product names, region and currency. No balances, identifiers or card numbers.',parameters:{type:'object',properties:{},additionalProperties:false}}}
];
export function validateToolCall(call){
 const tool=agentTools.find(t=>t.function.name===call?.function?.name);if(!tool||typeof call.id!=='string'||!call.id.trim()||call.id.length>128||typeof call.function.arguments!=='string'||call.function.arguments.length>4000)throw Error('invalid_tool');
 // Unparseable arguments get the same code as invalid ones, so a malformed call fails the same way on every path.
 let args;try{args=JSON.parse(call.function.arguments||'{}');}catch{throw Error('invalid_arguments');}
 const schema=tool.function.parameters;
 if(!args||Array.isArray(args)||typeof args!=='object'||Object.keys(args).some(k=>!Object.hasOwn(schema.properties,k))||(schema.required||[]).some(k=>!Object.hasOwn(args,k)))throw Error('invalid_arguments');
 for(const [k,v] of Object.entries(args)){const p=schema.properties[k];if(k==='pointValues'){// Keys are programme names from a fixed list, so free text can't reach the prompt through memory.
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length>6||Object.entries(v).some(([name,cents])=>!POINT_VALUE_NAMES.has(name.normalize('NFKC').toLowerCase().trim().replace(/\s+(?:us|hk|ca)$/,''))||!Number.isFinite(cents)||cents<=0||cents>100))throw Error('invalid_arguments');continue;}if(typeof v!==p.type||p.enum&&!p.enum.includes(v)||p.minLength&&v.trim().length<p.minLength||p.maxLength&&v.length>p.maxLength||p.minimum!=null&&(!Number.isFinite(v)||v<p.minimum||v>p.maximum)||p.pattern&&!new RegExp(p.pattern).test(v))throw Error('invalid_arguments');}
 if(args.cardName!==undefined&&!/[\p{L}\p{N}]/u.test(args.cardName))throw Error('invalid_arguments');
 if(args.cashFare!==undefined&&args.cashFareCurrency===undefined||args.cashFareCurrency!==undefined&&args.cashFare===undefined||args.taxesAndFees!==undefined&&args.cashFare===undefined)throw Error('invalid_arguments');
 if(args.nights!==undefined&&!Number.isSafeInteger(args.nights)||args.pointsPerNight!==undefined&&!Number.isSafeInteger(args.pointsPerNight))throw Error('invalid_arguments');
 if(args.points!==undefined&&!Number.isSafeInteger(args.points)||args.milesNeeded!==undefined&&!Number.isSafeInteger(args.milesNeeded))throw Error('invalid_arguments');
 return {name:tool.function.name,args};
}
const normalized=s=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
// A card is found by its displayed name, the name its bank page showed, or its catalogue product's name, so any of
// these wordings, or a chat from before a language switch, reaches it.
const selectedCards=(cards,args)=>cards.filter(c=>(!args.cardName||[c.name,c.pageName,matchCardProduct(c).product?.name].some(n=>n&&normalized(n).includes(normalized(args.cardName))))&&(!args.region||c.region===args.region));
const programmeName=id=>knowledgeEntities.programmes.find(p=>p.id===id)?.name||null;
// Text in the reader's language when the rule has it; the official original always rides along, with its quotes,
// so the model can quote the terms rather than a translation of them.
function publicRule(r,cards,language){
 const {fromProgrammeId,toProgrammeId,...terms}=r.terms,text=ruleText(r,language),o=r.original;
 return {cards:cards.filter(c=>r.productIds.includes(matchCardProduct(c).product?.id)).map(c=>({name:c.name,region:c.region})),kind:r.kind,title:text.title,summary:text.summary,howToUse:text.howToUse,textLanguage:text.lang,...(text.translated?{textIsTranslation:true}:{}),...(o?{original:{lang:o.lang,...(text.lang===o.lang?{}:{title:o.title,summary:o.summary}),quotes:o.quotes.map(q=>q.text)}}:{}),terms:{...terms,...(fromProgrammeId?{fromProgramme:programmeName(fromProgrammeId)}:{}),...(toProgrammeId?{toProgramme:programmeName(toProgrammeId)}:{})},validity:r.validity,conditions:r.conditions.unparsedText,revision:r.revisionId,sources:knowledgeSources(r.evidence.sourceIds),checkedAt:r.evidence.checkedAt,assessment:r.assessment,...(r.retrieval?{retrieval:r.retrieval}:{})};
}
// Per held card: its sourced protection records, or not_found. Unknown basis or payment stays not-stated, never "no".
function protectionRecords(selected,{type,types,day,language}){
 const products=new Set(selected.map(c=>matchCardProduct(c).product?.id).filter(Boolean)),wanted=t=>type?t===type:types?types.includes(t):true;
 const rows=queryKnowledge({kind:'benefit',category:'protection',asOf:day}).rules.filter(r=>r.productIds.some(id=>products.has(id))&&wanted(r.terms.coverage?.type));
 const view=r=>{const c=r.terms.coverage||{},rule=publicRule(r,selected,language);return {...rule,coverageType:c.type||null,basis:c.basis||'not-stated',...(c.basisScope?{basisScope:c.basisScope}:{}),requiresCardPayment:c.requiresCardPayment===true?true:'not-stated',exclusions:c.exclusions?.length?c.exclusions:'none-stated'};};
 const rules=rows.map(view);
 const cards=selected.map(c=>{const id=matchCardProduct(c).product?.id,own=rules.filter((r,i)=>rows[i].productIds.includes(id));return {name:c.name,region:c.region,status:own.length?'found':'not_found',coverageTypes:[...new Set(own.map(r=>r.coverageType))],own};});
 return {rules,cards:cards.map(({own,...c})=>c),byCard:cards};
}
// #184: a travel booking also shows which compared card lists trip protections. Facts beside the choice, never scored:
// insurance has no cash value here, so the ranking is computed first and left as it is.
const BOOKING_PROTECTIONS={flight:['trip-cancellation','trip-delay','baggage-delay','lost-luggage','travel-insurance','emergency-evacuation'],hotel:['trip-cancellation','trip-delay','travel-insurance'],'vacation-rental':['trip-cancellation','trip-delay','travel-insurance'],travel:['trip-cancellation','trip-delay','baggage-delay','lost-luggage','travel-insurance','emergency-evacuation'],'car-rental':['rental-car']};
export function withBookingProtections(result,{cards,day,language}){
 const types=BOOKING_PROTECTIONS[result?.purchase?.category];
 if(!types||!result.rows?.length)return result;
 const seen=new Set(),compared=[];
 for(const row of [...result.rows,...(result.pointsAlternatives||[])]){const key=row.card+'|'+(row.cardRegion||'');if(seen.has(key))continue;seen.add(key);const held=cards.find(c=>c.name===row.card&&(!row.cardRegion||c.region===row.cardRegion));if(held)compared.push(held);}
 if(!compared.length)return result;
 const found=protectionRecords(compared,{types,day,language});
 return {...result,bookingProtections:{scored:false,coverageTypes:types,
  note:'Separate facts, not part of the ranking: no cash value is given to insurance. Name them after the choice, say the card\'s guide to benefits controls and this is not insurance advice. Coverage usually requires paying with the card where requiresCardPayment is true. A card marked not_found has no record held, which is not proof it has no coverage; never call it uncovered.',
  cards:found.byCard.map(c=>({name:c.name,region:c.region,status:c.status,coverage:c.own.map(r=>({type:r.coverageType,title:r.title,basis:r.basis,requiresCardPayment:r.requiresCardPayment,sources:r.sources}))}))}};
}
// #193: what a point of each programme on the path is worth, the user's own value first, else the default market valuation.
const REGION_CURRENCY={US:'USD',HK:'HKD',CA:'CAD'};
function flightValuation(groups,{stated,pointValues,marketDefaults}){
 const programmes=groups.map(g=>{
  const tp=transferProgrammes.find(p=>p.label===g.programme&&p.region===g.region),name=tp&&knowledgeEntities.programmes.find(p=>p.id===tp.id)?.name||g.programme;
  const entry=valuationFor({programme:name,region:g.region,currency:REGION_CURRENCY[g.region]});
  // A value said in this chat comes first, as in choose_card.
  const said=pointValueFor(name,'',g.region,stated);
  const key=g.programme+'|'+g.region;
  if(said!=null)return {group:key,...(entry?{programmeId:entry.id}:{}),programme:entry?.name||name,cents:said,currency:REGION_CURRENCY[g.region],basis:'stated'};
  const found=resolvePointValue(entry,pointValues,{marketDefaults});return found&&{group:key,...found};
 }).filter(Boolean);
 return {programmes,note:programmes.length
  ?'Value per point of each programme, in cents of its currency. Points spent times this value is what they would be worth used elsewhere; compare with a cash fare only one the user stated, and say paying cash keeps the points. basis user is the value the user set in settings; default is a published market valuation, not the user\'s view: say so and that it can be changed in settings. basis stated is the value the user said in this chat. Use no other value.'
  :'No value per point is known for these programmes. Compare points with cash only with a value the user states, and say paying cash keeps the points.'};
}
// #479: a stated cash fare against each programme's award, every number from code. The award side is the points spent at the
// programme's value per point plus stated taxes; cents per mile is what the fare yields per award mile after those taxes.
// No published rate, no award price, no value or a different currency gives no result and a note, never a guess.
const CENT=100;
export function flightCashComparison({args,programmes,valuation,credits}){
 const fare=args.cashFare,cur=args.cashFareCurrency,taxes=args.taxesAndFees||0,money=c=>Math.round(c)/CENT;
 const unused=(credits?.groups?.markedUnused||[]).filter(i=>i.publicLimit>0&&i.currency===cur);
 const creditTotal=unused.reduce((n,i)=>n+Math.round(i.publicLimit*CENT),0);
 const rows=[];
 for(const g of programmes)for(const row of g.partners){
  const base={programme:g.programme,region:g.region,partner:row.partner};
  if(args.milesNeeded==null){rows.push({...base,status:'no-award-price',note:'No award price was stated, so nothing is compared. Ask for it.'});continue;}
  if(row.rate!=='published'||row.toReachMiles?.status!=='computed'){rows.push({...base,status:'rate-not-published',note:'No published transfer rate, so the points spent are unknown and nothing is compared. Do not guess one.'});continue;}
  const point=valuation.programmes.find(v=>v.group===g.programme+'|'+g.region);
  if(!point){rows.push({...base,status:'no-point-value',note:'No value per point is known for this programme, so no cash equivalent is worked out.'});continue;}
  if(point.currency!==cur){rows.push({...base,status:'currency-mismatch',pointValueCurrency:point.currency,cashFareCurrency:cur,note:'The points are valued in '+point.currency+' and the fare is in '+cur+'. Say the currencies differ and compare nothing; do not convert.'});continue;}
  const spend=row.toReachMiles.spend,awardCents=Math.round(spend*point.cents+taxes*CENT),fareCents=Math.round(fare*CENT),taxCents=Math.round(taxes*CENT);
  const side=(cash)=>awardCents<cash?'award-cheaper':awardCents>cash?'cash-cheaper':'equal';
  const net=Math.max(fareCents-creditTotal,0);
  rows.push({...base,status:'computed',pointsSpent:spend,pointValue:{cents:point.cents,basis:point.basis},
   pointsCashEquivalent:money(Math.round(spend*point.cents)),awardTotal:money(awardCents),
   centsPerMile:fareCents>taxCents?Math.round((fareCents-taxCents)/args.milesNeeded*100)/100:null,
   cheaper:side(fareCents),
   ...(creditTotal?{withUnusedCredit:{unusedCredit:money(creditTotal),cashSide:money(net),cheaper:side(net),note:'Credits the user marked unused, netted against the cash side. Many airline credits cover fees, not fares, so this is a possible saving, not a certain one.'}}:{})});
 }
 return {status:rows.some(r=>r.status==='computed')?'computed':'not-computed',cashFare:{amount:fare,currency:cur},taxesAndFees:taxes,milesNeeded:args.milesNeeded??null,rows,
  note:'Computed in code from the fare and taxes the user stated. awardTotal is points at their value per point plus taxes; cheaper compares it with the cash fare. Say which side is cheaper as given, that points valued this way are not cash out of pocket, and that award seats and prices were not checked. Transfer fees are not included.'};
}
// #480: the hotel half of a trip. Per transfer row: the points the stated nightly award price needs, and the stated points
// against it. Pure, so each branch (rate unpublished, short, enough, no award price) can be tested on its own.
// #531: with a stated fare, which selected card to pay it with. The ranking is choose_card's own (flight, the stated amount and
// currency, the same point values); a separate fact that never changes the cashComparison verdict.
export function flightPayCash({args,cards,events,day,pointValues,marketDefaults}){
 const r=chooseCard({category:'flight',amount:args.cashFare,currency:args.cashFareCurrency,...(args.pointValues?{pointValues:args.pointValues}:{})},{cards,events,day,pointValues,marketDefaults});
 return {kind:'pay-cash-card',purchase:r.purchase,choice:r.choice,rows:r.rows,...(r.pointValues?{pointValues:r.pointValues,pointValueNote:r.pointValueNote}:{}),
  note:'What earning on this card returns if the cash fare is paid with it, from choose_card for category flight at the stated fare and currency. It is a separate fact and does not change the award-or-cash verdict in cashComparison. The fare was stated by the user, not looked up.'};
}
export function stayRows(programmes,{nights,pointsPerNight,points}){
 const total=pointsPerNight!=null?pointsPerNight*nights:null;
 return programmes.map(g=>({...g,partners:g.partners.map(({sourceIds,...row})=>{
  const sources=knowledgeSources(sourceIds);
  if(total==null)return {...row,sources,stay:{status:'no-award-price',note:'No award price per night was stated, so no points needed or shortfall can be worked out. Ask for it if the user wants it.'}};
  if(row.rate!=='published')return {...row,sources,stay:{status:'rate-not-published',note:'No published transfer rate, so the points needed are unknown. Say so and give no number.'}};
  const reach=pointsToReach(total,row);
  if(reach.status!=='computed')return {...row,sources,stay:{status:reach.status,...reach}};
  const shortfall=points!=null?{statedPoints:points,pointsShort:Math.max(reach.spend-points,0),enough:points>=reach.spend}:null;
  return {...row,sources,stay:{status:'computed',nights,pointsPerNight,totalHotelPoints:total,...reach,...(shortfall?{shortfall}:{})}};
 })}));
}
// With no match, the scenarios where the same query, or else the held cards, do have benefits. Counts, not rules: the model searches again.
function suggestScenarios(args,cards,day){
 if(!cards.length)return null;
 const dropped=['scenarioId','category','programme'].filter(k=>args[k]);
 const loose=dropped.length?searchBenefitKnowledge(args.query,cards,day,{}).rules:[];
 const pool=loose.length?loose:queryKnowledge({kind:'benefit',asOf:day}).rules.filter(r=>r.productIds.some(id=>cards.some(c=>matchCardProduct(c).product?.id===id)));
 const counts={};for(const r of pool)for(const s of r.scenarioIds)counts[s]=(counts[s]||0)+1;
 return {basis:loose.length?'same query without '+dropped.join(', '):'held cards, any query',scenarios:Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,4).map(([scenarioId,matches])=>({scenarioId,matches}))};
}
export function runWalletTool(call,ctx){return runTool(call,ctx,{});}
// Async path (#295): find_benefits may ask an answer judge (ctx.judge={question,complete,maxCalls,used}) when the search is weak. Every other tool, and a strong match, is the synchronous result.
// A judge that rejects every top rule empties the list as an unknownSubject, the shape the assistant already reads as "no held card lists this". Any judge failure keeps the rules (fail open).
export async function runWalletToolAsync(call,ctx){
 const sink={},result=runTool(call,ctx,sink),found=sink.found,judge=ctx.judge;
 if(!judge||!found||!result.rules?.length||(judge.used||0)>=(judge.maxCalls??2))return result;
 try{
  let asked=false;
  const out=await gatedJudge(judge.question||call.function&&JSON.parse(call.function.arguments||'{}').query,found.rules,async m=>{asked=true;return judge.complete(m);});
  if(asked)judge.used=(judge.used||0)+1;
  if(out.judged&&out.rules.length===0)return {...result,totalMatches:0,truncated:false,rules:[],suggestions:undefined,unknownSubject:{named:String(judge.question||'').slice(0,120),note:'No benefit record of the held cards is about this. Tell the user none of their cards lists a benefit for it; do not offer unrelated benefits.'}};
 }catch(error){if(error?.name==='AbortError'||ctx.signal?.aborted)throw error;}
 return result;
}
function runTool(call,{cards,events,day,trip,language,pointValues=[],marketDefaults=true},sink){
 cards=heldCards(cards); // a hidden card is not held: no tool sees it
 const {name,args}=validateToolCall(call);const nameOf=id=>cards.find(c=>c.id===id)?.name||'Unidentified card';
 if(name==='list_cards')return cards.map(c=>({name:c.name,region:c.region,currency:c.currency}));
 if(name==='points_accounts'){
  // Rules of the held cards' programmes; a named programme or region with no held card still gets its public rule.
  const selected=selectedCards(cards,args),reach=pointsReach(cards).filter(m=>selected.includes(m.card));
  const wanted=r=>(!args.programme||r.label===args.programme)&&(!args.region||r.region===args.region);
  const held=poolingRules.filter(r=>wanted(r)&&reach.some(m=>m.rule.id===r.id));
  const named=args.cardName?[]:poolingRules.filter(r=>wanted(r)&&!held.includes(r)&&(args.programme||args.region));
  const heldIds=heldProductIdsOf(cards),redemptions=rule=>FIXED_REDEMPTION_PROGRAMMES.includes(rule.programmeId)?{redemptions:{coverage:'The issuer\'s own fixed-value redemptions, from official pages. Quote a value per point or a dollar value only where value.status is rate-only or computed; for varies, unknown, needs-card or above-annual-cap give none. A pointsBoost.heldCards list holds "up to" ceilings stated by the held cards\' own pages: give one only as "up to" with its source and never turn it into a dollar amount for the stated points. Compare with transfers only by what convert_points returns; no value is known for a transferred point.',statedPoints:args.points??null,options:redemptionOptions(rule.programmeId,{points:args.points??null,heldProductIds:heldIds})}}:{};
  const view=(rule,isHeld)=>({...poolingExplanation(rule),held:isHeld,...redemptions(rule),...(isHeld?{cards:reach.filter(m=>m.rule.id===rule.id).map(m=>({name:m.card.name,region:m.card.region,ownTransferPartners:m.ownTransfer,...(m.ownTransfer?{}:{transfersThrough:m.via.map(c=>c.name)})}))}:{})});
  return {kind:'points-accounts',asOf:day,scope:{programme:args.programme||null,region:args.region||null,cardName:args.cardName||null,points:args.points??null},matchedCards:selected.map(c=>c.name),
   coverage:'How the cardholder\'s points accounts relate, by programme and region. Explain the rule in plain words, then each caveat with its source. No balances are read here; never invent one. Combining, linking and transfers are done by the user with the bank; nothing is done here.',
   programmes:[...held.map(r=>view(r,true)),...named.map(r=>view(r,false))],
   ...(selected.some(c=>!cardProgramme(c))?{cardsOutside:selected.filter(c=>!cardProgramme(c)).map(c=>({name:c.name,region:c.region})),outsideNote:'No pooling rule covers these cards: say whether their points pool is not recorded, rather than guessing.'}:{})};
 }
 if(name==='convert_points'){
  const selected=selectedCards(cards,args),found=transferOptions(selected,args,{asOf:day,held:cards});
  const programmes=found.programmes.map(g=>({...g,partners:g.partners.map(({sourceIds,...row})=>({...row,sources:knowledgeSources(sourceIds)}))}));
  // A card with no rate rule can still have recorded transfer partners without rates, read by get_card_rules (Amex CA,
  // #357). "No transfer record" would then be wrong, so point to that read instead.
  const relationshipProducts=new Set(queryKnowledge({kind:'transfer-relationship',asOf:day}).rules.filter(r=>partnerMatches(r.terms.toProgrammeId,args.partner)).flatMap(r=>r.productIds));
  const withRelationships=found.cardsWithoutTransferRecord.filter(w=>selected.some(c=>c.name===w.name&&c.region===w.region&&relationshipProducts.has(matchCardProduct(c).product?.id)));
  const relationshipHint=withRelationships.length?{transferRelationshipHint:{cards:withRelationships,note:'No rate rule lists these cards, but their transfer partners are recorded without rates. Before answering, call get_card_rules with kind transfer-relationship and each card\'s cardName and region (and programme, in English, if the user named one). Give no rate for them.'}}:{};
  const withoutRecord=found.cardsWithoutTransferRecord.length>withRelationships.length;
  return {kind:'transfer-options',coverage:'Published transfer rules only. Rates and minimums are public terms, not proof that an account is linked or that a transfer will succeed. No award availability or point valuation.',asOf:day,scope:{region:args.region||null,cardName:args.cardName||null,partner:args.partner||null,points:args.points??null},matchedCards:selected.map(c=>c.name),...found,programmes,
   ...(found.cardsWithoutTransferCard?{withoutTransferCardNote:'These cards earn the programme\'s points but no held card of the programme transfers them to partners, so no rate reaches them now. That is not proof the card can never transfer; points_accounts explains how the programme pools.'}:{}),...(withoutRecord?{withoutRecordNote:'No transfer rule lists these cards. That is not proof they cannot transfer: say no transfer record is held for them and give no rate.'}:{}),...relationshipHint,
   ...(found.partnerFound||withRelationships.length?{}:{partnerNote:'No transfer rule of the held cards reaches this partner. Say so; do not offer other partners as if they were it.'})};
 }
 if(name==='plan_flight'){
  // Every step from code (#82): the transfer path and its maths from verified rules, credits from query_credits,
  // and award data marked not checked rather than guessed. Stated points are never pooled across programmes.
  const selected=selectedCards(cards,args),found=transferOptions(selected,{partner:args.airline},{asOf:day,held:cards});
  // A programme with no route to this airline adds nothing to the plan.
  const reaching=found.programmes.filter(g=>g.partners.length),shared=reaching.length>1&&args.points!=null;
  const programmes=reaching.map(g=>({...g,partners:g.partners.map(({sourceIds,...row})=>{
   const reach=args.milesNeeded!=null&&row.rate==='published'?pointsToReach(args.milesNeeded,row):null;
   const shortfall=reach?.status==='computed'&&args.points!=null?{statedPoints:args.points,pointsShort:Math.max(reach.spend-args.points,0),enough:args.points>=reach.spend}:null;
   return {...row,sources:knowledgeSources(sourceIds),...(reach?{toReachMiles:{milesNeeded:args.milesNeeded,...reach}}:{}),...(shortfall?{shortfall}:{})};
  })}));
  const credits=queryCredits({use:'airline',when:args.when,destination:args.destination},{cards:selected,events,day,trip});
  const cover=protectionRecords(selected,{types:BOOKING_PROTECTIONS.flight,day,language});
  const valuation=flightValuation(reaching,{stated:args.pointValues||null,pointValues,marketDefaults});
  return {kind:'flight-plan',asOf:day,
   coverage:'Published transfer rules, verified airline credits and manual credit marks only. Award seats, award prices and taxes are not checked; no transfer or booking is made.',
   route:{stated:args.route||null,note:args.route?'Repeated as the user said it; not looked up.':'No route was named: ask for it if it matters.'},
   dates:credits.needsDates?{needsDates:true,phrase:args.when}:credits.window,
   award:{status:'not-checked',reason:'No award search is connected, so award seats, award prices and how fresh they are cannot be checked. Say so, and use only an award price the user stated.'},
   transfers:{kind:'transfer-options',airline:args.airline,matchedCards:selected.map(c=>c.name),...found,programmes,
    ...(found.partnerFound?{}:{partnerNote:'No transfer rule of the held cards reaches this airline. Say so; do not offer other airlines as if they were it.'}),
    ...(found.cardsWithoutTransferCard?{withoutTransferCardNote:'These cards earn the programme\'s points but no held card of the programme transfers them to partners, so no rate reaches them now. That is not proof the card can never transfer; points_accounts explains how the programme pools.'}:{}),...(found.cardsWithoutTransferRecord.length?{withoutRecordNote:'No transfer rule lists these cards. That is not proof they cannot transfer: say no transfer record is held for them and give no rate.'}:{}),
    ...(args.milesNeeded==null?{milesNote:'No award price was stated, so no points needed or shortfall can be worked out. Ask for the award price if the user wants it.'}:{}),
    ...(shared?{pointsNote:'The stated points were compared with each programme separately; ask which programme holds them. Never add programmes together.'}:{})},
   credits,
   valuation,
   ...(args.cashFare!=null?{cashComparison:flightCashComparison({args,programmes,valuation,credits})}:{}),
   ...(args.cashFare!=null&&args.cashFareCurrency!=null?{payCash:flightPayCash({args,cards:selected,events,day,pointValues,marketDefaults})}:{}),
   protections:{scored:false,coverageTypes:BOOKING_PROTECTIONS.flight,note:'Separate facts, never part of the transfer, credit or cash comparison. The card\'s guide to benefits controls; this is not insurance advice. A card marked not_found has no record held, which is not proof it has no coverage.',cards:cover.byCard.map(c=>({name:c.name,region:c.region,status:c.status,coverage:c.own.map(r=>({type:r.coverageType,title:r.title,basis:r.basis,requiresCardPayment:r.requiresCardPayment,sources:r.sources}))}))}};
 }
 if(name==='plan_stay'){
  // #480: same rules as plan_flight. Transfer path and maths from verified rules, hotel credits from query_credits, booking
  // protections from the records; availability and prices are marked not checked. Stated points are never pooled.
  const selected=selectedCards(cards,args),found=transferOptions(selected,{partner:args.programme},{asOf:day,held:cards});
  const reaching=found.programmes.filter(g=>g.partners.length),shared=reaching.length>1&&args.points!=null;
  const programmes=stayRows(reaching,{nights:args.nights,pointsPerNight:args.pointsPerNight,points:args.points});
  const credits=queryCredits({use:'hotel',when:args.when},{cards:selected,events,day,trip});
  const cover=protectionRecords(selected,{types:BOOKING_PROTECTIONS.hotel,day,language});
  return {kind:'stay-plan',asOf:day,
   coverage:'Published transfer rules, verified hotel credits, manual credit marks and public protection summaries only. Room availability, nightly award prices and cash rates are not checked; no transfer or booking is made.',
   stay:{programme:args.programme,nights:args.nights,note:'Repeated as the user said it; no hotel is looked up.'},
   // No date words: the credit read falls back to today, which is not a stay window, so ask for the dates instead.
   dates:credits.needsDates||!args.when?{needsDates:true,phrase:args.when||null,note:'No usable dates: ask for the stay dates before saying which hotel credits fall in them.'}:credits.window,
   availability:{status:'not-checked',reason:'No hotel search is connected, so availability, award prices per night and cash rates cannot be checked. Say so, and use only a price the user stated.'},
   transfers:{kind:'transfer-options',programme:args.programme,matchedCards:selected.map(c=>c.name),...found,programmes,
    ...(found.partnerFound?{}:{partnerNote:'No transfer rule of the held cards reaches this hotel programme. Say so; do not offer other programmes as if they were it.'}),
    ...(found.cardsWithoutTransferCard?{withoutTransferCardNote:'These cards earn the programme\'s points but no held card of the programme transfers them to partners, so no rate reaches them now.'}:{}),...(found.cardsWithoutTransferRecord.length?{withoutRecordNote:'No transfer rule lists these cards. That is not proof they cannot transfer: say no transfer record is held for them and give no rate.'}:{}),
    ...(args.pointsPerNight==null?{pointsNote:'No award price per night was stated, so no points needed or shortfall can be worked out.'}:shared?{pointsNote:'The stated points were compared with each programme separately; ask which programme holds them. Never add programmes together.'}:{})},
   credits,
   protections:{scored:false,coverageTypes:BOOKING_PROTECTIONS.hotel,note:'Separate facts. The card\'s guide to benefits controls; this is not insurance advice. A card marked not_found has no record held, which is not proof it has no coverage.',cards:cover.byCard.map(c=>({name:c.name,region:c.region,status:c.status,coverage:c.own.map(r=>({type:r.coverageType,title:r.title,basis:r.basis,requiresCardPayment:r.requiresCardPayment,sources:r.sources}))}))}};
 }
 if(name==='find_protections'){
  const selected=selectedCards(cards,args),found=protectionRecords(selected,{type:args.type,day,language}),rules=found.rules;
  return {kind:'protections',coverage:'Public summaries of protection benefits. The card\'s guide to benefits controls; this is not insurance advice. A missing record means no record is held, not that the card has no coverage.',asOf:day,scope:{type:args.type||null,region:args.region||null,cardName:args.cardName||null},matchedCards:selected.map(c=>c.name),
   cards:found.cards,
   totalMatches:rules.length,truncated:rules.length>24,rules:rules.slice(0,24),
   ...(found.cards.some(c=>c.status==='not_found')?{notFoundNote:'For cards marked not_found, say no protection record is held for them and that their guide to benefits may still list coverage. Never say they have no coverage.'}:{})};
 }
 if(name==='query_credits'){
  if(args.yearBasis)return {...queryCreditLedger({basis:args.yearBasis},{cards:selectedCards(cards,args),events,day}),scope:{region:args.region||null,cardName:args.cardName||null}};
  const selected=selectedCards(cards,args),result=queryCredits(args,{cards:selected,events,day,trip,brief:!args.use&&!args.cardName});
  // Benefit-flavoured credit questions (#131): a status listing that is empty or cut short cannot say whether a card has
  // a credit for something, so point to find_benefits rather than let the answer read as "no such credit".
  const hint=!result.needsDates&&(result.totalItems===0||result.truncated)?{findBenefitsHint:result.totalItems===0?'No credit matched here. To check whether a held card has a credit for this, call find_benefits with category credit before saying none applies.':'This listing was cut short. To check whether a held card has a credit for something specific, call find_benefits with category credit and the user\'s keywords.'}:{};
  return {...result,...hint,scope:{region:args.region||null,cardName:args.cardName||null},matchedCards:selected.map(c=>c.name)};
 }
 if(name==='find_benefits'||name==='get_card_rules'){
  const selected=selectedCards(cards,args),scope={region:args.region||null,cardName:args.cardName||null};
  if(name==='find_benefits'){
   const found=searchBenefitKnowledge(args.query,selected,day,args);sink.found=found;
   // A named product the wallet doesn't hold, or a cardName no held card has: say so, and offer no other cards' rules or searches.
   const unheld=found.unheldProduct||(args.cardName&&!selected.length?{named:args.cardName,catalogued:null}:null);
   const empty={coverage:'Public eligibility does not confirm enrollment; not an exhaustive benefit inventory.',asOf:day,scope,matchedCards:selected.map(c=>c.name),totalMatches:0,truncated:false,retrievalMethod:found.method,rules:[]};
   if(unheld)return {...empty,unheldProduct:{named:unheld.named,...(unheld.catalogued!=null?{catalogued:unheld.catalogued}:{}),note:'No held card is this product. Tell the user it is not among their cards; do not list other cards\' benefits instead. If they may mean a held card under another name, list_cards shows the names.'}};
   // Nothing in any benefit record is about the thing asked: say so rather than offer benefits that only share a word like "annual".
   if(found.unknownSubject)return {...empty,unknownSubject:{named:found.unknownSubject.named,note:'No benefit record of the held cards is about this. Tell the user none of their cards lists a benefit for it; do not offer unrelated benefits.'}};
   // No rule, or rules kept only by the filters with no word of the query in them: suggest where the query does match.
   return {coverage:'Public eligibility does not confirm enrollment; not an exhaustive benefit inventory.',asOf:day,scope,matchedCards:selected.map(c=>c.name),totalMatches:found.total,truncated:found.truncated,retrievalMethod:found.method,rules:found.rules.map(r=>publicRule(r,selected,language)),...(found.wordMatches?{}:{suggestions:suggestScenarios(args,selected,day)})};
  }
  const products=new Set(selected.map(c=>matchCardProduct(c).product?.id).filter(Boolean));
  const rows=queryKnowledge({kind:args.kind,asOf:day}).rules.filter(r=>r.productIds.some(id=>products.has(id))&&(!args.programme||String(programmeName(r.terms.toProgrammeId)||'').toLowerCase().includes(args.programme.toLowerCase().trim())));
  return {coverage:'Public product rules only; actual fees, waivers, transfer ratios and linked accounts require personal evidence. Missing records do not establish no fee or no transfer relationship.',asOf:day,scope,matchedCards:selected.map(c=>c.name),totalMatches:rows.length,truncated:rows.length>24,rules:rows.slice(0,24).map(r=>publicRule(r,selected,language))};
 }
 return withBookingProtections(chooseCard(args,{cards,events,day,pointValues,marketDefaults}),{cards,day,language});
}
