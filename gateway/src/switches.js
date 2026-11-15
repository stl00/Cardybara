// KV switches (stl00/Cardybara#259): the owner changes the assistant's behaviour without a deploy. They live in the
// KV key `settings` next to the caps: {disabledTools:[name], forceModel:"name", assistantOff:true}. Each request reads
// them through a short cache. A value of the wrong shape is ignored and logged by key name (never its content), and
// the assistant then behaves as if the switch were unset. docs/GATEWAY.md ("Alerts and switches") describes them.

export const SWITCH_KEYS=['disabledTools','forceModel','assistantOff'];
export const SWITCH_CACHE_MS=30000;
const TOOL_NAME=/^[a-z][a-z0-9_]{0,47}$/;
const MODEL_NAME=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

/** The valid switches of a settings object, plus the keys whose value was ignored. models: ALLOWED_MODELS. */
export function parseSwitches(settings,models=[]){
 const out={disabledTools:[],forceModel:null,assistantOff:false},invalid=[];
 if(!settings||typeof settings!=='object'||Array.isArray(settings))return {switches:out,invalid};
 if('disabledTools' in settings){
  const v=settings.disabledTools;
  if(Array.isArray(v)&&v.length<=64&&v.every(n=>typeof n==='string'&&TOOL_NAME.test(n)))out.disabledTools=[...new Set(v)];else invalid.push('disabledTools');
 }
 if('forceModel' in settings){
  const v=settings.forceModel;
  if(typeof v==='string'&&MODEL_NAME.test(v)&&models.includes(v))out.forceModel=v;else invalid.push('forceModel');
 }
 if('assistantOff' in settings){
  if(typeof settings.assistantOff==='boolean')out.assistantOff=settings.assistantOff;else invalid.push('assistantOff');
 }
 return {switches:out,invalid};
}

const cache=new WeakMap();
/**
 * The switches now, read from KV at most once per SWITCH_CACHE_MS per namespace binding. A KV failure keeps the last
 * good value (or none); it never turns anything on.
 */
export async function readSwitches({env,config,now=Date.now,log=()=>{}}){
 const kv=env.INVITES;if(!kv)return parseSwitches(null).switches;
 const hit=cache.get(kv),at=now();
 if(hit&&at-hit.at<SWITCH_CACHE_MS&&at>=hit.at)return hit.switches;
 let settings=null,failed=false;
 try{settings=await kv.get('settings',{type:'json'});}catch{failed=true;}
 if(failed)return hit?.switches||parseSwitches(null).switches;
 const {switches,invalid}=parseSwitches(settings,config?.models||[]);
 for(const key of invalid)log(JSON.stringify({switch:key,ignored:'invalid_value'}));
 cache.set(kv,{at,switches});
 return switches;
}

/** Removes disabled tools from a tool list (and a tool_choice that names one); no tools left means none sent. */
export function withoutDisabledTools(request,disabled){
 if(!disabled?.length||!Array.isArray(request.tools))return request;
 const off=new Set(disabled),tools=request.tools.filter(t=>!off.has(t?.function?.name));
 const out={...request,tools};
 const choice=request.tool_choice;
 if(choice&&typeof choice==='object'&&off.has(choice.function?.name))out.tool_choice='auto';
 if(!tools.length){delete out.tools;delete out.tool_choice;}
 return out;
}

/** The "temporarily unavailable" text for the wallet's language (zh-CN, zh-TW, en-US). */
export const UNAVAILABLE={
 'zh-CN':'助手暂时不可用，请稍后再试。',
 'zh-TW':'助理暫時無法使用，請稍後再試。',
 'en-US':'The assistant is temporarily unavailable. Please try again later.',
};
export const unavailableText=language=>UNAVAILABLE[language]||UNAVAILABLE['en-US'];
