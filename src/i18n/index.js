// The translation catalog, split by area so parallel changes do not edit the same file.
// Keys are the zh-CN source text; each file maps them per language ({"en-US":{…},"zh-TW":{…}}).
// Put a new string in the file for its feature. A new file also needs a line below;
// scripts/i18n-catalog.mjs fails the build when a file is missing here or a key appears in two files.
import app from './app.json' with {type:'json'};
import assistant from './assistant.json' with {type:'json'};
import banks from './banks.json' with {type:'json'};
import benefits from './benefits.json' with {type:'json'};
import cards from './cards.json' with {type:'json'};
import common from './common.json' with {type:'json'};
import extension from './extension.json' with {type:'json'};
import knowledge from './knowledge.json' with {type:'json'};
import knowledgeRules from './knowledge-rules.json' with {type:'json'};
import onboarding from './onboarding.json' with {type:'json'};
import payments from './payments.json' with {type:'json'};
import purchase from './purchase.json' with {type:'json'};
import rewards from './rewards.json' with {type:'json'};

export const catalogFiles = {app, assistant, banks, benefits, cards, common, extension, knowledge, 'knowledge-rules': knowledgeRules, onboarding, payments, purchase, rewards};

export function mergeCatalog(files) {
  const merged = {};
  for (const file of Object.values(files)) for (const [language, entries] of Object.entries(file)) Object.assign(merged[language] ??= {}, entries);
  return merged;
}

export const translations = mergeCatalog(catalogFiles);
export default translations;
