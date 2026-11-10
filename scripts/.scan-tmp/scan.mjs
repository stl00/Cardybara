import {queryKnowledge} from '../../src/knowledge.js';
const all=queryKnowledge({kind:'benefit',asOf:'2026-11-09'}).rules;
const seen=new Set();
for(const r of all){const key=r.id.split('.').at(-1)+'|'+(r.original?.title||'');if(seen.has(key))continue;seen.add(key);
 console.log(r.id.split('.').at(-1).padEnd(22),r.category.padEnd(13),r.scenarioIds.join('/').padEnd(22),'|',r.content.title,'|',(r.original?.title||'').slice(0,60));}
