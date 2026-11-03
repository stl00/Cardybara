import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {REQUIRED_CASES,REQUIRED_BANKS} from './acceptance.mjs';
const [zip,output]=process.argv.slice(2);
if(!zip||!output){console.error('Usage: node scripts/new-acceptance.mjs CANDIDATE.zip PRIVATE-REPORT.json');process.exit(1);}
const report={schema:1,artifactSha256:createHash('sha256').update(readFileSync(zip)).digest('hex'),runtimeBuild:null,verifiedAt:null,environment:{freshChromeProfile:null,oldBackupImported:null,developerServicesRequired:null,extensionId:null},cases:Object.fromEntries(REQUIRED_CASES.map(name=>[name,{status:'pending',mode:null,evidence:''}])),banks:Object.fromEntries(REQUIRED_BANKS.map(bank=>[bank,{status:'pending',cardCount:0,visibleCardCount:null,runtimeBuild:null,capturedAt:null,cards:[]}]))};
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
