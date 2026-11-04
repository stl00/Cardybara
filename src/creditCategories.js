// One set of use categories for credits and promos, read by the wallet UI and the assistant.
// Rules keep their broad scenario tags; a rule gets its scenario's default unless it has an override,
// so a new rule is categorized on arrival and rules.json keeps its format.
import data from './data/credit-categories.json' with {type:'json'};
import rules from './data/knowledge/rules.json' with {type:'json'};

export const CREDIT_CATEGORIES=data.categories;
const known=new Set(data.categories.map(c=>c.id));
const byId=new Map();
for(const rule of rules)if(!byId.has(rule.id)||byId.get(rule.id).revision<rule.revision)byId.set(rule.id,rule);

/** Every use of a rule, in display order. An uncategorized rule returns [] rather than a guess. */
export function creditCategoriesForRule(rule){
 if(!rule)return [];
 const ids=data.ruleOverrides[rule.id]||(rule.scenarioIds||[]).flatMap(id=>data.scenarioDefaults[id]||[]);
 return data.categories.map(c=>c.id).filter(id=>ids.includes(id)&&known.has(id));
}
export function creditCategoriesForRuleId(id){return creditCategoriesForRule(byId.get(id));}
export function creditCategoryLabel(id){return data.categories.find(c=>c.id===id)?.label||null;}
