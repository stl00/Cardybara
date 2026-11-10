// A draft may be published only after testing these exact artifact bytes.
import {readFileSync} from 'node:fs';
import {basename} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {artifactBuildId,candidateSourceCommit,validateAcceptance} from './acceptance.mjs';
const [zip,evidence,confirm]=process.argv.slice(2);
if(!zip||!evidence||confirm!=='--publish'){console.error('Usage: node scripts/promote-release.mjs CANDIDATE.zip PRIVATE-ACCEPTANCE.json --publish');process.exit(1);}
const bytes=readFileSync(zip),sha256=createHash('sha256').update(bytes).digest('hex');
const result=validateAcceptance(JSON.parse(readFileSync(evidence,'utf8')),{sha256,runtimeBuild:artifactBuildId(bytes),sourceCommit:candidateSourceCommit()});
if(!result.passed){console.error(JSON.stringify(result,null,2));process.exit(1);}
const cfg=JSON.parse(readFileSync(new URL('../release.json',import.meta.url),'utf8')),repo='stl00/Cardybara',tag='v'+cfg.label;
const draft=JSON.parse(execFileSync('gh',['release','view',tag,'--repo',repo,'--json','isDraft,assets,tagName'],{encoding:'utf8'}));
if(!draft.isDraft||draft.tagName!==tag||!draft.assets.some(a=>a.name===basename(zip)&&a.digest==='sha256:'+sha256))throw Error('Draft artifact does not match tested bytes');
// CI built the draft from the tag on GitHub; a local tag can be stale, so the held-out run must match the remote one too.
const remoteCommit=execFileSync('gh',['api',`repos/${repo}/commits/${tag}`,'--jq','.sha'],{encoding:'utf8'}).trim();
if(remoteCommit!==JSON.parse(readFileSync(evidence,'utf8')).heldOutEval?.sourceCommit)throw Error('Held-out eval did not run on the commit the GitHub tag points at');
execFileSync('gh',['release','edit',tag,'--repo',repo,'--draft=false'],{stdio:'inherit'});
