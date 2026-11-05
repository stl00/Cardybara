import {searchBenefitKnowledge} from './benefitSearch.js';
import {recommendCards,validateIntent} from './spendAdvisor.js';
import {matchCardProduct} from './productCatalog.js';
import {knowledgeSources,queryKnowledge,knowledgeEntities} from './knowledge.js';
import {queryCredits,CREDIT_USES} from './creditQuery.js';
export const agentTools=[
 {type:'function',function:{name:'compare_cards',description:'Calculate reviewed rewards for held cards. Ask user for missing category, country, currency or amount; do not guess merchant MCC. Raw point programmes cannot be ranked against money.',parameters:{type:'object',properties:{category:{type:'string',enum:['dining','supermarket','gas','online-retail','drugstore','flight','hotel','other']},country:{type:'string',enum:['US','CA','HK']},currency:{type:'string',enum:['USD','CAD','HKD']},amount:{type:'number',minimum:0.01,maximum:1e8}},required:['category','country','currency','amount'],additionalProperties:false}}},
 {type:'function',function:{name:'find_benefits',description:'Search public benefits applicable to held cards, with official sources. Does not prove enrollment or usage.',parameters:{type:'object',properties:{query:{type:'string',minLength:1,maxLength:500},scenarioId:{type:'string',enum:['travel','hotel-stay','dining','entertainment','ground-transport','airport','shopping','reward-redemption','card-ownership','fitness']},category:{type:'string',enum:['credit','promo','membership','lounge','hotel-service','spend-unlock','protection']},programme:{type:'string',minLength:1,maxLength:80},region:{type:'string',enum:['US','CA','HK'],description:'Restrict to the held card issuance region, not the travel destination. Use when user specifies a regional card.'},cardName:{type:'string',minLength:1,maxLength:160,description:'Optional exact product name or substring from list_cards to restrict this search to a particular card.'}},required:['query'],additionalProperties:false}}},
 {type:'function',function:{name:'get_card_rules',description:'Read sourced public annual fees or points-transfer relationships for held products. Published fees are not actual charges or waivers. Null transfer ratios and account linkage remain unknown; no conversion or transfer action. Narrow by issuance region/card name if truncated.',parameters:{type:'object',properties:{kind:{type:'string',enum:['fee','transfer-relationship']},region:{type:'string',enum:['US','CA','HK']},cardName:{type:'string',minLength:1,maxLength:160,description:'Held product name or substring from list_cards; use region for same-name products.'},programme:{type:'string',minLength:1,maxLength:80,description:'Optional destination programme name substring, e.g. Hilton or Aeroplan. Use English names returned in evidence.'}},required:['kind'],additionalProperties:false}}},
 {type:'function',function:{name:'query_credits',description:'The only source for dollar credits and whether they were used. For memberships, lounges, elite status or general benefit questions use find_benefits, adding this tool when credits also matter. Code resolves dates, overlaps benefit cycles, reads manual marks and joins terms, returning explicit groups. Without when it reads the current cycle. Unknown means not confirmed, never unused. Read only.',parameters:{type:'object',properties:{when:{type:'string',minLength:1,maxLength:80,description:'The date phrase exactly as the user said it, such as 12月, 聖誕, Dec 20-27 or 1月. Do not convert it or calculate dates. Omit for the current cycle.'},reuseRememberedDates:{type:'boolean',description:'True to reuse the remembered dates when the user changes only the use, card or destination. Omit when with this.'},use:{type:'string',enum:CREDIT_USES,description:'Optional use, such as hotel. Omit to read all credits.'},cardName:{type:'string',minLength:1,maxLength:160,description:'Held product name or substring from list_cards.'},region:{type:'string',enum:['US','CA','HK'],description:'Card issuance region, not the travel destination.'},destination:{type:'string',pattern:'^[A-Z]{2}$',description:'Optional ISO country code of the travel destination, only if the user named one. Not the card region.'}},additionalProperties:false}}},
 {type:'function',function:{name:'list_cards',description:'Read held product names, region and currency. No balances, identifiers or card numbers.',parameters:{type:'object',properties:{},additionalProperties:false}}}
];
export function validateToolCall(call){
 const tool=agentTools.find(t=>t.function.name===call?.function?.name);if(!tool||typeof call.id!=='string'||!call.id.trim()||call.id.length>128||typeof call.function.arguments!=='string'||call.function.arguments.length>4000)throw Error('invalid_tool');
 const args=JSON.parse(call.function.arguments||'{}'),schema=tool.function.parameters;
 if(!args||Array.isArray(args)||typeof args!=='object'||Object.keys(args).some(k=>!Object.hasOwn(schema.properties,k))||(schema.required||[]).some(k=>!Object.hasOwn(args,k)))throw Error('invalid_arguments');
 for(const [k,v] of Object.entries(args)){const p=schema.properties[k];if(typeof v!==p.type||p.enum&&!p.enum.includes(v)||p.minLength&&v.trim().length<p.minLength||p.maxLength&&v.length>p.maxLength||p.minimum!=null&&(!Number.isFinite(v)||v<p.minimum||v>p.maximum)||p.pattern&&!new RegExp(p.pattern).test(v))throw Error('invalid_arguments');}
 if(args.cardName!==undefined&&!/[\p{L}\p{N}]/u.test(args.cardName))throw Error('invalid_arguments');
 return {name:tool.function.name,args};
}
const normalized=s=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const selectedCards=(cards,args)=>cards.filter(c=>(!args.cardName||normalized(c.name).includes(normalized(args.cardName)))&&(!args.region||c.region===args.region));
const programmeName=id=>knowledgeEntities.programmes.find(p=>p.id===id)?.name||null;
function publicRule(r,cards){
 const {fromProgrammeId,toProgrammeId,...terms}=r.terms;
 return {cards:cards.filter(c=>r.productIds.includes(matchCardProduct(c).product?.id)).map(c=>({name:c.name,region:c.region})),kind:r.kind,title:r.content.title,summary:r.content.summary,howToUse:r.content.howToUse,terms:{...terms,...(fromProgrammeId?{fromProgramme:programmeName(fromProgrammeId)}:{}),...(toProgrammeId?{toProgramme:programmeName(toProgrammeId)}:{})},validity:r.validity,conditions:r.conditions.unparsedText,revision:r.revisionId,sources:knowledgeSources(r.evidence.sourceIds),checkedAt:r.evidence.checkedAt,assessment:r.assessment,...(r.retrieval?{retrieval:r.retrieval}:{})};
}
export function runWalletTool(call,{cards,events,day,trip}){
 const {name,args}=validateToolCall(call);const nameOf=id=>cards.find(c=>c.id===id)?.name||'Unidentified card';
 if(name==='list_cards')return cards.map(c=>({name:c.name,region:c.region,currency:c.currency}));
 if(name==='query_credits'){const selected=selectedCards(cards,args);return {...queryCredits(args,{cards:selected,events,day,trip,brief:!args.use&&!args.cardName}),scope:{region:args.region||null,cardName:args.cardName||null},matchedCards:selected.map(c=>c.name)};}
 if(name==='find_benefits'||name==='get_card_rules'){
  const selected=selectedCards(cards,args),scope={region:args.region||null,cardName:args.cardName||null};
  if(name==='find_benefits'){
   const found=searchBenefitKnowledge(args.query,selected,day,args);
   return {coverage:'Public eligibility does not confirm enrollment; not an exhaustive benefit inventory.',asOf:day,scope,matchedCards:selected.map(c=>c.name),totalMatches:found.total,truncated:found.truncated,retrievalMethod:found.method,rules:found.rules.map(r=>publicRule(r,selected))};
  }
  const products=new Set(selected.map(c=>matchCardProduct(c).product?.id).filter(Boolean));
  const rows=queryKnowledge({kind:args.kind,asOf:day}).rules.filter(r=>r.productIds.some(id=>products.has(id))&&(!args.programme||String(programmeName(r.terms.toProgrammeId)||'').toLowerCase().includes(args.programme.toLowerCase().trim())));
  return {coverage:'Public product rules only; actual fees, waivers, transfer ratios and linked accounts require personal evidence. Missing records do not establish no fee or no transfer relationship.',asOf:day,scope,matchedCards:selected.map(c=>c.name),totalMatches:rows.length,truncated:rows.length>24,rules:rows.slice(0,24).map(r=>publicRule(r,selected))};
 }
 const result=recommendCards(cards,validateIntent({...args,intent:'recommend'}),{asOf:day});
 return {...result,intent:args,winner:result.winner?{name:result.winner.name,reward:result.winner.reward,currency:args.currency,scope:'reviewed unconditional cashback only'}:null,cash:undefined,candidates:result.candidates.map(({cardId,productId,...c})=>c),excluded:result.excluded.map(c=>({name:nameOf(c.cardId),reason:c.reason}))};
}
