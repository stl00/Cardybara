// Server side of the card type suggestion. It receives only a bank, a region and the name a bank page
// showed, and the model may only answer with a catalogue product for that bank and region, or none.
import {SUGGEST_LIMITS,scopedProducts,validateSuggestRequest,suggestionMessages} from '../src/productSuggestProtocol.js';
import {cleanCardName} from '../src/productSuggestion.js';
export {SUGGEST_LIMITS,scopedProducts,validateSuggestRequest,suggestionMessages,cleanCardName};
/** Returns a product id from the catalogue for that bank and region, or null. Anything else is discarded. */
export async function suggestProduct(env,payload,fetcher=fetch){
 const request=validateSuggestRequest(payload);
 if(!env.DEEPSEEK_API_KEY)throw Error('model_not_configured');
 if(env.DEEPSEEK_BASE_URL&&env.DEEPSEEK_BASE_URL.replace(/\/$/,'')!=='https://api.deepseek.com')throw Error('unexpected_model_destination');
 const r=await fetcher('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.DEEPSEEK_API_KEY},redirect:'error',signal:AbortSignal.timeout(24000),body:JSON.stringify({model:env.DEEPSEEK_MODEL||'deepseek-flash',messages:suggestionMessages(request),response_format:{type:'json_object'},max_tokens:200,temperature:0})});
 if(!r.ok)throw Error('model_unavailable');
 let id=null;try{const content=(await r.json()).choices?.[0]?.message?.content;if(typeof content==='string'&&content.length<2000)id=JSON.parse(content)?.productId??null;}catch{id=null;}
 return {productId:typeof id==='string'&&scopedProducts(request.bank,request.region).some(p=>p.id===id)?id:null};
}
