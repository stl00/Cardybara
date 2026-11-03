import {mergeRecords} from './agent-core.js';
import {request,validateRead} from './protocol.js';
import {normalizeDiscoveredCards} from './discovery.js';
// All mutations are serialized, persisted before acknowledgement, and generation scoped.
// Worker restart ends unfinished runs explicitly; it never silently repeats bank actions.
export const STATE_KEY='cardybara-state-v2';
const pending=j=>['queued','opening','navigating','capturing'].includes(j.status);
const blank=()=>({schema:2,revision:0,run:null,records:{},disabled:[]});
function savePatches(s,j,patches){for(const p of patches){const old=s.records[j.bank]?.[p.id]||{},fields={...old};for(const [k,v]of Object.entries(p.fields))if(!old[k]||Date.parse(v.capturedAt)>=Date.parse(old[k].capturedAt))fields[k]=v;(s.records[j.bank]??={})[p.id]=fields;}}
export class Engine{
 constructor(io){this.io=io;this.tail=Promise.resolve();}
 serial(fn){const p=this.tail.then(fn);this.tail=p.catch(()=>{});return p;}
 approve(items){return this.serial(async()=>{const s=await this.load();if(items.some(i=>s.disabled.includes(i.bank)))throw Error('bank_disabled');const merged=mergeRecords(s.agentRecords||[],items);if(JSON.stringify(merged).length>2000000)throw Error('agent_storage_limit');s.agentRecords=merged;return this.save(s);});}
 async load(){const s=await this.io.load();if(!s)return blank();if(s.schema!==2)throw Error('unsupported_storage_version');return structuredClone(s);}
 async save(s){s.revision++;await this.io.save(s);return s;}
 recover(){return this.serial(async()=>{const s=await this.load();let migrated=false;for(const j of s.run?.jobs||[])if(j.sections?.reward?.status==='updated'&&!Number.isInteger(j.sections.reward.readCards)){j.sections.reward.status='partial';migrated=true;}if(migrated)await this.save(s);if(s.run?.status==='running'){for(const j of s.run.jobs)if(pending(j))j.status='interrupted';s.run.status='interrupted';await this.save(s);}return s;});}
 start(input,owner){return this.serial(async()=>{
  const m=request(input),s=await this.load();if(s.run?.status==='running')throw Error('busy');
  if(m.banks.some(b=>s.disabled.includes(b)))throw Error('bank_disabled');
  for(const previous of s.run?.jobs||[])if(!pending(previous))(s.lastBankJobs??={})[previous.bank]=structuredClone(previous);
  s.run={id:m.requestId,generation:this.io.uuid(),owner,status:'running',startedAt:this.io.now(),jobs:m.banks.map(bank=>({bank,cards:m.cards.filter(c=>c.bank===bank&&m.cards.filter(x=>x.bank===bank&&x.tail===c.tail).length===1),...(m.cardId?{cardId:m.cardId}:{}),attemptId:this.io.uuid(),status:'queued',tabId:null,owned:false,navigation:0}))};
  await this.save(s);return s;
 });}
 claim(){return this.serial(async()=>{const s=await this.load();if(s.run?.status!=='running'||s.run.jobs.some(j=>pending(j)&&j.status!=='queued'))return null;const j=s.run.jobs.find(j=>j.status==='queued');if(!j)return null;j.status='opening';j.startedAt=this.io.now();j.deadline=j.startedAt+60000;await this.save(s);return {runId:s.run.id,generation:s.run.generation,...j};});}
 mutate(ctx,fn){return this.serial(async()=>{const s=await this.load(),r=s.run,j=r?.jobs.find(j=>j.attemptId===ctx.attemptId);if(r?.status!=='running'||r.generation!==ctx.generation||!j||!pending(j)||(ctx.navigation!==undefined&&j.navigation!==ctx.navigation))return null;await fn(j,s);if(r.jobs.every(j=>!pending(j)))r.status='complete';await this.save(s);return s;});}
 bind(ctx,tabId,owned){return this.mutate(ctx,j=>{if(j.status!=='opening')throw Error('invalid_phase');j.tabId=tabId;j.owned=owned;j.guideExpiresAt=this.io.now()+900000;j.status='navigating';j.loadStarted=false;});}
 loading(ctx){return this.mutate(ctx,j=>{if(j.status==='capturing'){j.navigation++;j.status='navigating';}if(j.status==='navigating')j.loadStarted=true;});}
 capture(ctx){return this.serial(async()=>{const s=await this.load(),r=s.run,j=r?.jobs.find(j=>j.attemptId===ctx.attemptId);if(r?.status!=='running'||r.generation!==ctx.generation||j?.status!=='navigating'||j.navigation!==ctx.navigation||!j.loadStarted)return null;j.status='capturing';j.navigation++;return this.save(s);});}
 current(ctx){return this.load().then(s=>s.run?.status==='running'&&s.run.generation===ctx.generation&&s.run.jobs.some(j=>j.attemptId===ctx.attemptId&&j.navigation===ctx.navigation&&pending(j)));}
 progress(ctx,phase,sections){return this.mutate(ctx,j=>{j.enriching=true;j.phase=phase;j.sections=sections;j.enrichmentStartedAt??=this.io.now();j.deadline=j.enrichmentStartedAt+600000;});}
 discover(ctx,rows){return this.mutate(ctx,(j,s)=>{
  const cards=normalizeDiscoveredCards(j.bank,rows);s.discoveredCards??=[];
  for(const c of cards){
   if(j.cards.some(old=>old.tail===c.tail))continue;
   const old=s.discoveredCards.find(old=>old.bank===c.bank&&old.tail===c.tail);
   const card=old||c;if(s.discoveredCards.length>=40&&!old)throw Error('discovery_limit');
   if(!old)s.discoveredCards.push(card);j.cards.push(card);
  }
 });}
 checkpointRead(ctx,raw){return this.mutate(ctx,(j,s)=>{const result=validateRead(raw,j,this.io.now());savePatches(s,j,result.patches);j.received=result.patches.length;});}
 checkpoint(ctx,items,sections){return this.mutate(ctx,(j,s)=>{if(items.some(i=>i.bank!==j.bank||!j.cards.some(c=>c.id===i.cardId)||Date.parse(i.capturedAt)<j.startedAt-5000||Date.parse(i.capturedAt)>this.io.now()+60000))throw Error('invalid_agent_scope');const merged=mergeRecords(s.agentRecords||[],items);if(JSON.stringify(merged).length>2000000)throw Error('agent_storage_limit');s.agentRecords=merged;j.sections=sections;});}
 finish(ctx,raw,enrichment=null){return this.mutate(ctx,(j,s)=>{
  if(j.status!=='capturing'||j.navigation!==ctx.navigation||j.tabId!==ctx.tabId)return;
  if(this.io.now()>j.deadline){j.status='timeout';j.finishedAt=this.io.now();return;}
  const result=validateRead(raw,j,this.io.now());j.status=result.status;if(enrichment){j.sections=enrichment.sections;j.phase='complete';j.pages=enrichment.pages||0;j.rejected=enrichment.rejected||0;j.rejectReasons=enrichment.rejectReasons||{};if(enrichment.error)j.readError=enrichment.error;else delete j.readError;delete j.enriching;if(enrichment.items?.length||result.patches.length)j.status=Object.values(j.sections).every(s=>['updated','checked_empty'].includes(s.status))?'updated':'partial';}j.finishedAt=this.io.now();j.received=new Set([...result.patches.map(p=>p.id),...(enrichment?.items||[]).filter(i=>i.kind==='card').map(i=>i.cardId)]).size;
  savePatches(s,j,result.patches);
 });}
 fail(ctx,status,diagnostic){if(!['interrupted','timeout','navigation_changed','tab_closed','load_error'].includes(status))throw Error('invalid_status');return this.mutate(ctx,j=>{j.status=status;j.finishedAt=this.io.now();j.phase='complete';delete j.enriching;if(diagnostic&&['stage','code'].every(k=>typeof diagnostic[k]==='string'&&/^[a-z_]{1,40}$/.test(diagnostic[k])))j.diagnostic=diagnostic;for(const section of Object.values(j.sections||{}))if(section.status==='reading')section.status=status;});}
 guide(ref,tabId,action){return this.serial(async()=>{
  const s=await this.load(),r=s.run,j=r?.jobs.find(j=>j.attemptId===ref.attemptId);
  if(!r||['cancelled','interrupted'].includes(r.status)||r.id!==ref.runId||!j||j.tabId!==tabId||s.disabled.includes(j.bank))throw Error('guide_scope');
  if(['cancelled','interrupted','cleared','disconnected','tab_closed'].includes(j.status))throw Error('guide_ended');
  if(action==='stop'){j.status='cancelled';j.navigation++;j.finishedAt=this.io.now();if(r.jobs.every(j=>!pending(j)))r.status='complete';return this.save(s);}
  if(action!=='read')return s;
  if(r.jobs.some(x=>pending(x)))throw Error('busy');
  if(this.io.now()>(j.guideExpiresAt||r.startedAt+900000))throw Error('guide_expired');
  j.guideExpiresAt=j.guideExpiresAt||r.startedAt+900000;j.attemptId=this.io.uuid();j.navigation++;j.status='navigating';j.loadStarted=true;
  j.startedAt=this.io.now();j.deadline=j.startedAt+60000;for(const key of ['finishedAt','received','enriching','enrichmentStartedAt','phase','sections','pages','rejected','rejectReasons','diagnostic'])delete j[key];r.status='running';
  return this.save(s);
 });}
 cancel(owner){return this.serial(async()=>{const s=await this.load();if(s.run?.status==='running'){if(s.run.owner!==owner)throw Error('not_run_owner');for(const j of s.run.jobs)if(pending(j))j.status='cancelled';s.run.status='cancelled';await this.save(s);}return s;});}
 bank(bank,action,owner){return this.serial(async()=>{const s=await this.load();if(s.run?.status==='running'&&s.run.owner!==owner)throw Error('not_run_owner');if(action==='disconnect'){s.disabled=[...new Set([...s.disabled,bank])];for(const j of s.run?.jobs||[])if(j.bank===bank&&pending(j))j.status='cancelled';}if(action==='connect')s.disabled=s.disabled.filter(b=>b!==bank);if(['disconnect','clear'].includes(action)){delete s.records[bank];s.agentRecords=(s.agentRecords||[]).filter(i=>i.bank!==bank);for(const j of s.run?.jobs||[])if(j.bank===bank){j.status=action==='disconnect'?'disconnected':'cleared';j.received=0;}}if(s.run?.status==='running'&&s.run.jobs.every(j=>!pending(j)))s.run.status='complete';return this.save(s);});}
}
