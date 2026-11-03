// Pure, deterministic resolver from wallet items to a local logo or category icon.
// Never fetches anything; a brand shows a logo only when its registry entry is approved.
import registry from './data/logos.json' with {type:'json'};
import entities from './data/knowledge/entities.json' with {type:'json'};
import rules from './data/knowledge/rules.json' with {type:'json'};
export const logoRegistry=registry;
const byProgramme=new Map(registry.brands.flatMap(b=>b.programmeIds.map(id=>[id,b])));
const rulesById=new Map();for(const r of rules)if(r.status==='published'&&(!rulesById.has(r.id)||rulesById.get(r.id).revision<r.revision))rulesById.set(r.id,r);
// Case-sensitive and bounded by Latin letters and digits only: "Lyft应用" matches next to CJK,
// but "Tuber" or "Resynth" never do. Ordinary-word brands (United, Apple, Clear) have no tokens.
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const compiled=key=>registry.brands.flatMap(b=>b[key].map(token=>[b,new RegExp(`(?<![A-Za-z0-9-])${escape(token)}(?![A-Za-z0-9])${(b.notBefore||[]).map(after=>`(?!${escape(after)})`).join('')}`)]));
const titlePatterns=compiled('titleTokens'),textPatterns=compiled('textTokens');
function single(found){const ids=new Set(found.map(b=>b.id));return ids.size===1?found[0]:null;}
const matches=(patterns,text)=>typeof text==='string'?patterns.filter(([,re])=>re.test(text)).map(([b])=>b):[];
// Several distinct brands on one item would make any single logo misleading, so none is chosen.
export function identifyBrand({programmeIds=[],title}={}){
 const direct=programmeIds.map(id=>byProgramme.get(id)).filter(Boolean);
 return direct.length?single(direct):single(matches(titlePatterns,title));
}
function view(brand,category){
 const approved=brand?.status==='approved'&&brand.logo?brand.logo:null;
 return {brandId:brand?.id||null,name:brand?.name||null,logo:approved,category:registry.categories[category]?category:null};
}
export function logoForRule(rule){
 if(!rule)return view(null,null);
 const override=registry.ruleOverrides[rule.id];
 if(rule.kind==='transfer-relationship'){const brand=byProgramme.get(rule.terms?.toProgrammeId);return view(brand,brand?.category||'reward');}
 if(rule.kind==='earning-rate')return logoForEarning(rule.terms?.spendCategory);
 if(rule.kind==='fee')return view(null,'fee');
 if(rule.kind==='channel-capability')return view(null,'channel');
 const brand=registry.ruleNoBrand.includes(rule.id)?null:identifyBrand({programmeIds:rule.programmeIds,title:rule.content?.title});
 const scenario=(rule.scenarioIds||[]).map(id=>registry.scenarioCategories[id]).find(Boolean);
 const fixed=rule.category==='protection'?'protection':rule.category==='lounge'?'lounge':null;
 return view(brand,override||fixed||brand?.category||scenario||registry.ruleCategories[rule.category]||null);
}
export const logoForRuleId=id=>logoForRule(rulesById.get(id));
export function logoForProgramme(key){
 const entity=entities.programmes.find(p=>p.id===key||p.name===key),brand=entity&&byProgramme.get(entity.id);
 return view(brand,brand?.category||registry.programmeKinds[entity?.kind]||null);
}
export function logoForEarning(label){return view(null,registry.earningLabels[label]||null);}
export function logoForCategory(id){return view(null,id);}
// Free text such as a saved offer name: distinctive tokens only, no guessed category,
// and nothing when the text excludes a merchant rather than names it.
const negated=/\b(?:excludes?|excluding|except|not|non)\b|不含|不包括|除外|不適用|不适用/i;
export function logoForText(text){if(typeof text==='string'&&negated.test(text))return view(null,null);const brand=single(matches(textPatterns,text));return view(brand,brand?.category||null);}
