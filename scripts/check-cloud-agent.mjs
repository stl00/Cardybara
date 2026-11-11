// `npm run check:agent:cloud`: the agent suites and the multi-turn eval again, against the hosted agent
// (stl00/Cardybara#210): each turn goes through the extension's client to the gateway's /v1/chat route with a
// scripted streaming provider (tests/helpers/agent-target.mjs). The suites are the test files that import that
// helper, so a new agent test that uses it runs in both modes without a list edit.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {allTests} from './run-tests.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const suites=allTests(root).filter(f=>/from '\.\/helpers\/agent-target\.mjs'/.test(readFileSync(new URL('../'+f,import.meta.url),'utf8')));
if(suites.length<5){console.error('expected the agent suites to import tests/helpers/agent-target.mjs, found '+suites.length);process.exit(1);}
const env={...process.env,CARDYBARA_AGENT:'cloud'};
for(const args of [['--test',...suites],['scripts/eval-multiturn.mjs','--min=0.9']]){
 const r=spawnSync(process.execPath,args,{cwd:root,env,stdio:'inherit'});
 if(r.status!==0)process.exit(r.status||1);
}
console.log(`cloud agent: ${suites.length} suites and the multi-turn eval passed against /v1/chat`);
