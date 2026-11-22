// In-memory stand-ins for the Worker's KV namespace and Durable Object binding, so the unit tests and the
// packaged-extension E2E run the gateway's own code in Node. Never imported by the Worker itself.
import {handle,UsageLedger} from './gateway.js';

export function memoryKV({now=Date.now}={}){
 const data=new Map(),meta=new Map(),expires=new Map();
 const live=key=>{const e=expires.get(key);if(e!=null&&e<=now()/1000){data.delete(key);meta.delete(key);expires.delete(key);}return data.has(key);};
 const read=(key,options)=>{if(!live(key))return null;const v=data.get(key);return options?.type==='json'||options==='json'?JSON.parse(v):v;};
 return {data,meta,
  async get(key,options){return read(key,options);},
  async getWithMetadata(key,options){return {value:read(key,options),metadata:live(key)?meta.get(key)??null:null};},
  async put(key,value,options={}){
   data.set(key,String(value));meta.delete(key);expires.delete(key);
   if(options.metadata!==undefined)meta.set(key,structuredClone(options.metadata));
   if(Number.isInteger(options.expiration))expires.set(key,options.expiration);else if(Number.isInteger(options.expirationTtl))expires.set(key,Math.floor(now()/1000)+options.expirationTtl);
  },
  async delete(key){data.delete(key);meta.delete(key);expires.delete(key);},
  // A string prefix gives the key names (the tests' own helper); an options object gives KV's {keys,list_complete,cursor}.
  async list(arg=''){
   const prefix=typeof arg==='string'?arg:arg.prefix||'';
   const names=[...data.keys()].filter(k=>k.startsWith(prefix)&&live(k));
   if(typeof arg==='string')return names;
   return {keys:names.map(name=>({name,...(meta.has(name)?{metadata:structuredClone(meta.get(name))}:{})})),list_complete:true};
  }};
}
// Storage that yields between every call, the way real storage I/O does, so a ledger without its queue
// would interleave under parallel requests.
export function memoryStorage(){
 const data=new Map(),tick=()=>new Promise(r=>setTimeout(r,1));
 return {data,
  async get(key){await tick();return data.has(key)?structuredClone(data.get(key)):undefined;},
  async put(key,value){await tick();if(typeof key==='object')for(const [k,v] of Object.entries(key))data.set(k,structuredClone(v));else data.set(key,structuredClone(value));},
  async delete(key){await tick();if(Array.isArray(key))return key.filter(k=>data.delete(k)).length;return data.delete(key);},
  async list({prefix=''}={}){await tick();return new Map([...data.entries()].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]));},
 };
}
export function memoryDurableObject(Class=UsageLedger){
 const instances=new Map();
 return {instances,idFromName:name=>name,get(id){if(!instances.has(id))instances.set(id,new Class({storage:memoryStorage()}));const obj=instances.get(id);return {fetch:(url,init)=>obj.fetch(new Request(url,init))};}};
}
/** A gateway on in-memory bindings. vars override the defaults; fetch is the upstream provider. */
// bindings: extra bindings such as {DB:memoryD1(), EMAIL:memoryMail()} for the account routes.
export function localGateway({vars={},bindings={},fetch,log=()=>{},now,observe,waitUntil}={}){
 // A rate limiter that always allows; tests pass their own, or null to check the gateway refuses to run without one.
 // LOCAL_DEV: no CF-Connecting-IP is needed and the client-id salt falls back to the provider key, as in wrangler dev.
 const env={PROVIDER_KEY:'synthetic-provider-key-not-real',ALLOWED_MODELS:'deepseek-flash',LOCAL_DEV:'1',RATE_LIMITER:{limit:async()=>({success:true})},...vars,INVITES:memoryKV({now:now||Date.now}),USAGE:memoryDurableObject(),...bindings};
 return {env,handle:request=>handle(request,env,{fetch,log,now,observe,waitUntil})};
}

/**
 * An in-memory stand-in for a D1 database, enough for the statements gateway/src/accounts.js makes: CREATE TABLE
 * (column PRIMARY KEY / UNIQUE / NOT NULL / DEFAULT, table PRIMARY KEY (a, b)), INSERT [OR IGNORE | OR REPLACE] with
 * ? or literal values, SELECT columns, UPDATE ... SET col = value, DELETE, with WHERE conditions joined by AND
 * (=, !=, <, >, <=, >=). Anything else throws, so a statement the real D1 would need is noticed in the tests.
 * `exec(sql)` runs a migration file. `tables` is the data, for tests that count rows.
 */
export function memoryD1(){
 const tables=new Map(),schemas=new Map();
 const ident=/^[a-z_][a-z0-9_]*$/i;
 const create=sql=>{
  const m=/^CREATE TABLE(?: IF NOT EXISTS)? ([a-z_]+) \(([\s\S]*)\)$/i.exec(sql.trim());
  if(!m)throw Error('memoryD1: unsupported '+sql.slice(0,40));
  const [,name,inner]=m,columns=[],unique=[];
  for(const part of inner.split(/,(?![^(]*\))/).map(p=>p.trim()).filter(Boolean)){
   const pk=/^PRIMARY KEY \(([^)]+)\)$/i.exec(part);
   if(pk){unique.push(pk[1].split(',').map(s=>s.trim()));continue;}
   const [col,...rest]=part.split(/\s+/),words=rest.join(' ').toUpperCase();
   const def=/DEFAULT (-?\d+)/.exec(words);
   columns.push({name:col,notNull:/NOT NULL|PRIMARY KEY/.test(words),def:def?Number(def[1]):null});
   if(/PRIMARY KEY|UNIQUE/.test(words))unique.push([col]);
  }
  if(!tables.has(name))tables.set(name,[]);
  schemas.set(name,{columns,unique});
 };
 const table=name=>{if(!tables.has(name))throw Error('memoryD1: no such table '+name);return tables.get(name);};
 const value=(token,args)=>{
  token=token.trim();
  if(token==='?'){if(!args.length)throw Error('memoryD1: too few bindings');return args.shift();}
  if(/^-?\d+$/.test(token))return Number(token);
  const q=/^'(.*)'$/.exec(token);if(q)return q[1];
  throw Error('memoryD1: unsupported value '+token);
 };
 const where=(text,args)=>{
  if(!text)return ()=>true;
  const conds=text.split(/\s+AND\s+/i).map(c=>{
   const m=/^([a-z_]+)\s*(=|!=|<=|>=|<|>)\s*(\S+)$/i.exec(c.trim());
   if(!m)throw Error('memoryD1: unsupported condition '+c);
   return {col:m[1],op:m[2],v:value(m[3],args)};
  });
  return row=>conds.every(({col,op,v})=>{const x=row[col];return op==='='?x===v:op==='!='?x!==v:op==='<'?x<v:op==='>'?x>v:op==='<='?x<=v:x>=v;});
 };
 const clash=(name,row,except)=>schemas.get(name).unique.some(cols=>table(name).some(r=>r!==except&&cols.every(c=>r[c]===row[c])));
 const execute=(sql,bound)=>{
  const args=[...bound],s=sql.trim().replace(/\s+/g,' ');let m;
  if((m=/^INSERT(?: OR (IGNORE|REPLACE))? INTO ([a-z_]+) \(([^)]+)\) VALUES \((.+)\)$/i.exec(s))){
   const [,mode,name,cols,vals]=m,schema=schemas.get(name);table(name);
   const names=cols.split(',').map(c=>c.trim()),values=vals.split(',').map(v=>value(v,args));
   if(names.length!==values.length||!names.every(n=>ident.test(n)&&schema.columns.some(c=>c.name===n)))throw Error('memoryD1: bad insert');
   const row=Object.fromEntries(schema.columns.map(c=>[c.name,c.def]));
   names.forEach((n,i)=>{row[n]=values[i]===undefined?null:values[i];});
   for(const c of schema.columns)if(c.notNull&&row[c.name]==null)throw Error('NOT NULL constraint failed: '+name+'.'+c.name);
   if(clash(name,row)){
    if(mode?.toUpperCase()==='IGNORE')return {results:[],changes:0};
    if(mode?.toUpperCase()!=='REPLACE')throw Error('UNIQUE constraint failed: '+name);
    tables.set(name,table(name).filter(r=>!schema.unique.some(cols=>cols.every(c=>r[c]===row[c]))));
   }
   table(name).push(row);return {results:[],changes:1};
  }
  if((m=/^SELECT (.+?) FROM ([a-z_]+)(?: WHERE (.+))?$/i.exec(s))){
   const [,cols,name,cond]=m,test=where(cond,args),rows=table(name).filter(test);
   const pick=cols.trim()==='*'?r=>({...r}):r=>Object.fromEntries(cols.split(',').map(c=>c.trim()).map(c=>[c,r[c]]));
   return {results:rows.map(pick),changes:0};
  }
  if((m=/^UPDATE ([a-z_]+) SET (.+?)(?: WHERE (.+))?$/i.exec(s))){
   const [,name,sets,cond]=m;
   const assign=sets.split(',').map(p=>{const [c,v]=p.split('=');return [c.trim(),value(v,args)];});
   const rows=table(name).filter(where(cond,args));
   for(const r of rows)for(const [c,v] of assign)r[c]=v;
   return {results:[],changes:rows.length};
  }
  if((m=/^DELETE FROM ([a-z_]+)(?: WHERE (.+))?$/i.exec(s))){
   const [,name,cond]=m,test=where(cond,args),before=table(name).length;
   tables.set(name,table(name).filter(r=>!test(r)));
   return {results:[],changes:before-tables.get(name).length};
  }
  throw Error('memoryD1: unsupported statement '+s.slice(0,40));
 };
 const statement=(sql,args=[])=>({
  bind:(...a)=>statement(sql,a),
  async first(){await null;return execute(sql,args).results[0]??null;},
  async all(){await null;const r=execute(sql,args);return {results:r.results,success:true,meta:{changes:r.changes}};},
  async run(){await null;const r=execute(sql,args);return {results:[],success:true,meta:{changes:r.changes}};},
 });
 return {tables,
  prepare:sql=>statement(sql),
  // D1 runs a batch as one transaction: all or nothing.
  async batch(list){const saved=new Map([...tables].map(([k,v])=>[k,v.map(r=>({...r}))]));try{return await Promise.all(list.map(st=>st.run()));}catch(e){for(const [k,v] of saved)tables.set(k,v);throw e;}},
  async exec(sql){
   for(const part of sql.replace(/--.*$/gm,'').split(';').map(p=>p.trim()).filter(Boolean)){
    if(/^CREATE INDEX/i.test(part))continue;
    create(part);
   }
  }};
}

/** An Email Sending binding that keeps what it was asked to send, for the tests. `fail` makes the next send throw. */
export function memoryMail(){
 const sent=[];
 return {sent,fail:false,async send(message){if(this.fail)throw Object.assign(Error('send failed'),{code:'E_TEST'});sent.push(structuredClone(message));return {messageId:'m'+sent.length};}};
}

/**
 * An in-memory stand-in for a D1 database, enough for the statements gateway/src/accounts.js makes: CREATE TABLE
 * (column PRIMARY KEY / UNIQUE / NOT NULL / DEFAULT, table PRIMARY KEY (a, b)), INSERT [OR IGNORE | OR REPLACE] with
 * ? or literal values, SELECT columns, UPDATE ... SET col = value, DELETE, with WHERE conditions joined by AND
 * (=, !=, <, >, <=, >=). Anything else throws, so a statement the real D1 would need is noticed in the tests.
 * `exec(sql)` runs a migration file. `tables` is the data, for tests that count rows.
 */
export function memoryD1(){
 const tables=new Map(),schemas=new Map();
 const ident=/^[a-z_][a-z0-9_]*$/i;
 const create=sql=>{
  const m=/^CREATE TABLE(?: IF NOT EXISTS)? ([a-z_]+) \(([\s\S]*)\)$/i.exec(sql.trim());
  if(!m)throw Error('memoryD1: unsupported '+sql.slice(0,40));
  const [,name,inner]=m,columns=[],unique=[];
  for(const part of inner.split(/,(?![^(]*\))/).map(p=>p.trim()).filter(Boolean)){
   const pk=/^PRIMARY KEY \(([^)]+)\)$/i.exec(part);
   if(pk){unique.push(pk[1].split(',').map(s=>s.trim()));continue;}
   const [col,...rest]=part.split(/\s+/),words=rest.join(' ').toUpperCase();
   const def=/DEFAULT (-?\d+)/.exec(words);
   columns.push({name:col,notNull:/NOT NULL|PRIMARY KEY/.test(words),def:def?Number(def[1]):null});
   if(/PRIMARY KEY|UNIQUE/.test(words))unique.push([col]);
  }
  if(!tables.has(name))tables.set(name,[]);
  schemas.set(name,{columns,unique});
 };
 const table=name=>{if(!tables.has(name))throw Error('memoryD1: no such table '+name);return tables.get(name);};
 const value=(token,args)=>{
  token=token.trim();
  if(token==='?'){if(!args.length)throw Error('memoryD1: too few bindings');return args.shift();}
  if(/^-?\d+$/.test(token))return Number(token);
  const q=/^'(.*)'$/.exec(token);if(q)return q[1];
  throw Error('memoryD1: unsupported value '+token);
 };
 const where=(text,args)=>{
  if(!text)return ()=>true;
  const conds=text.split(/\s+AND\s+/i).map(c=>{
   const m=/^([a-z_]+)\s*(=|!=|<=|>=|<|>)\s*(\S+)$/i.exec(c.trim());
   if(!m)throw Error('memoryD1: unsupported condition '+c);
   return {col:m[1],op:m[2],v:value(m[3],args)};
  });
  return row=>conds.every(({col,op,v})=>{const x=row[col];return op==='='?x===v:op==='!='?x!==v:op==='<'?x<v:op==='>'?x>v:op==='<='?x<=v:x>=v;});
 };
 const clash=(name,row,except)=>schemas.get(name).unique.some(cols=>table(name).some(r=>r!==except&&cols.every(c=>r[c]===row[c])));
 const execute=(sql,bound)=>{
  const args=[...bound],s=sql.trim().replace(/\s+/g,' ');let m;
  if((m=/^INSERT(?: OR (IGNORE|REPLACE))? INTO ([a-z_]+) \(([^)]+)\) VALUES \((.+)\)$/i.exec(s))){
   const [,mode,name,cols,vals]=m,schema=schemas.get(name);table(name);
   const names=cols.split(',').map(c=>c.trim()),values=vals.split(',').map(v=>value(v,args));
   if(names.length!==values.length||!names.every(n=>ident.test(n)&&schema.columns.some(c=>c.name===n)))throw Error('memoryD1: bad insert');
   const row=Object.fromEntries(schema.columns.map(c=>[c.name,c.def]));
   names.forEach((n,i)=>{row[n]=values[i]===undefined?null:values[i];});
   for(const c of schema.columns)if(c.notNull&&row[c.name]==null)throw Error('NOT NULL constraint failed: '+name+'.'+c.name);
   if(clash(name,row)){
    if(mode?.toUpperCase()==='IGNORE')return {results:[],changes:0};
    if(mode?.toUpperCase()!=='REPLACE')throw Error('UNIQUE constraint failed: '+name);
    tables.set(name,table(name).filter(r=>!schema.unique.some(cols=>cols.every(c=>r[c]===row[c]))));
   }
   table(name).push(row);return {results:[],changes:1};
  }
  if((m=/^SELECT (.+?) FROM ([a-z_]+)(?: WHERE (.+))?$/i.exec(s))){
   const [,cols,name,cond]=m,test=where(cond,args),rows=table(name).filter(test);
   const pick=cols.trim()==='*'?r=>({...r}):r=>Object.fromEntries(cols.split(',').map(c=>c.trim()).map(c=>[c,r[c]]));
   return {results:rows.map(pick),changes:0};
  }
  if((m=/^UPDATE ([a-z_]+) SET (.+?)(?: WHERE (.+))?$/i.exec(s))){
   const [,name,sets,cond]=m;
   const assign=sets.split(',').map(p=>{const [c,v]=p.split('=');return [c.trim(),value(v,args)];});
   const rows=table(name).filter(where(cond,args));
   for(const r of rows)for(const [c,v] of assign)r[c]=v;
   return {results:[],changes:rows.length};
  }
  if((m=/^DELETE FROM ([a-z_]+)(?: WHERE (.+))?$/i.exec(s))){
   const [,name,cond]=m,test=where(cond,args),before=table(name).length;
   tables.set(name,table(name).filter(r=>!test(r)));
   return {results:[],changes:before-tables.get(name).length};
  }
  throw Error('memoryD1: unsupported statement '+s.slice(0,40));
 };
 const statement=(sql,args=[])=>({
  bind:(...a)=>statement(sql,a),
  async first(){await null;return execute(sql,args).results[0]??null;},
  async all(){await null;const r=execute(sql,args);return {results:r.results,success:true,meta:{changes:r.changes}};},
  async run(){await null;const r=execute(sql,args);return {results:[],success:true,meta:{changes:r.changes}};},
 });
 return {tables,
  prepare:sql=>statement(sql),
  // D1 runs a batch as one transaction: all or nothing.
  async batch(list){const saved=new Map([...tables].map(([k,v])=>[k,v.map(r=>({...r}))]));try{return await Promise.all(list.map(st=>st.run()));}catch(e){for(const [k,v] of saved)tables.set(k,v);throw e;}},
  async exec(sql){
   for(const part of sql.replace(/--.*$/gm,'').split(';').map(p=>p.trim()).filter(Boolean)){
    if(/^CREATE INDEX/i.test(part))continue;
    create(part);
   }
  }};
}

/** An Email Sending binding that keeps what it was asked to send, for the tests. `fail` makes the next send throw. */
export function memoryMail(){
 const sent=[];
 return {sent,fail:false,async send(message){if(this.fail)throw Object.assign(Error('send failed'),{code:'E_TEST'});sent.push(structuredClone(message));return {messageId:'m'+sent.length};}};
}
