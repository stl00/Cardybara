// Server-only SDK adapter. Keys never enter browser code or eval reports.
import OpenAI from 'openai';
export function createDeepSeekClient(env,{fetcher=fetch}={}){
 if(!env.DEEPSEEK_API_KEY)throw Error('model_not_configured');
 if(env.DEEPSEEK_BASE_URL&&env.DEEPSEEK_BASE_URL.replace(/\/$/,'')!=='https://api.deepseek.com')throw Error('unexpected_model_destination');
 return new OpenAI({apiKey:env.DEEPSEEK_API_KEY,baseURL:'https://api.deepseek.com',timeout:45000,maxRetries:0,fetch:async(url,options)=>{
  // Disallow redirects before credentials are ever sent to a different destination.
  const result=await fetcher(String(url),{...options,redirect:'error'});
  if(result instanceof Response)return result;
  // Also supports the existing lightweight transport doubles in offline tests.
  return new Response(JSON.stringify(await result.json()),{status:result.ok?200:result.status||502,headers:{'Content-Type':'application/json'}});
 }});
}
