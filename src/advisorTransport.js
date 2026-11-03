// Protocol compatibility during a coordinated frontend/backend rollout.
export async function requestAdvisor(base,payload,signal,fetcher=fetch){
 const send=body=>fetcher(base+'/api/advisor/chat',{method:'POST',headers:{'Content-Type':'application/json','X-Cardybara-Client':'extension'},body:JSON.stringify(body),signal});
 let response=await send(payload);
 if(response.status===400&&payload.memory){const legacy={...payload};delete legacy.memory;response=await send(legacy);}
 if(!response.ok)throw Error('chat_failed');return response.json();
}
