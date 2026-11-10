import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {confirmedOtherProgramme,requiredReward} from '../extension-next/mvp.js';
import {readZipEntry} from './read-zip.mjs';
const HOLDOUT=JSON.parse(readFileSync(new URL('../evals/holdout/manifest.json',import.meta.url),'utf8'));
export const REQUIRED_CASES=['install','coldStart','manualAdd','bankDiscovery','bankReadback','restartPersistence','exportRecovery','cancel','expiredSession','upgradePersistence'];
export const REQUIRED_BANKS=['Amex US','Amex HK','Chase','BOA','HSBC HK','SC HK','Citi US'];
const BILLING_FIELDS=['balance','statement','minimum','due'];
// An observed due date needs a real calendar date and the printed text its year came from; a yearless date is display-only.
export function dueYearEvidenced(f){
 const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof f?.date==='string'?f.date:'');if(!m)return false;
 const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));
 return d.toISOString().slice(0,10)===f.date&&typeof f.yearEvidence==='string'&&new RegExp(`(?<!\\d)${m[1]}(?!\\d)`).test(f.yearEvidence);
}
// The build that shipped in the artifact, read from the packaged file so a checkout can never vouch for a ZIP.
export function artifactBuildId(zipBytes){
 const match=/\bBUILD_ID\s*=\s*['"]([^'"]+)['"]/.exec(readZipEntry(zipBytes,'build-info.js').toString('utf8'));
 if(!match)throw Error('Artifact does not declare a build');
 return match[1];
}
export function validateAcceptance(report,{sha256,runtimeBuild,now=Date.now()}){
 const errors=[];const need=(ok,why)=>{if(!ok)errors.push(why);};
 need(report?.schema===1,'invalid schema');need(report?.artifactSha256===sha256,'artifact changed or not tested');
 need(typeof runtimeBuild==='string'&&runtimeBuild!==''&&report?.runtimeBuild===runtimeBuild,'executing worker build not verified');
 const env=report?.environment||{};need(env.freshChromeProfile===true,'fresh Chrome profile not verified');
 need(env.oldBackupImported===false,'old wallet backup was used');need(env.developerServicesRequired===false,'depends on developer services');
 need(/^[a-p]{32}$/.test(env.extensionId||''),'installed extension ID missing');
 const date=Date.parse(report?.verifiedAt);need(Number.isFinite(date)&&date<=now+60000&&now-date<7*86400000,'acceptance date missing or stale');
 // The frozen held-out assistant eval must have run on this candidate, on the frozen dataset, and met its pass rate.
 const h=report?.heldOutEval;
 need(h?.dataset===HOLDOUT.dataset&&h?.datasetSha256===HOLDOUT.sha256,'held-out assistant eval: not run on the frozen dataset');
 need(h?.artifactSha256===sha256&&h?.runtimeBuild===runtimeBuild,'held-out assistant eval: not run on this candidate');
 const ran=Date.parse(h?.ranAt);need(Number.isFinite(ran)&&ran<=now+60000&&now-ran<7*86400000,'held-out assistant eval: run date missing or stale');
 need(Number.isInteger(h?.passed)&&h?.total===HOLDOUT.caseCount&&h.passed>=0&&h.passed<=h.total&&h.passed/h.total>=HOLDOUT.minPassRate,'held-out assistant eval: below the pass rate');
 for(const name of REQUIRED_CASES){const c=report?.cases?.[name];need(c?.status==='passed'&&c?.mode==='real-chrome'&&typeof c?.evidence==='string'&&c.evidence.trim().length>5,`${name}: real Chrome evidence required`);}
 for(const bank of REQUIRED_BANKS){
  const b=report?.banks?.[bank];need(b?.status==='passed'&&Number.isInteger(b?.cardCount)&&b.cardCount>0&&b.runtimeBuild===runtimeBuild,`${bank}: real bank acceptance missing`);
  const captured=Date.parse(b?.capturedAt);need(Number.isFinite(captured)&&captured<=now+60000&&now-captured<7*86400000,`${bank}: current readback date missing`);
  need(Array.isArray(b?.cards)&&b.cards.length===b.cardCount&&b.visibleCardCount===b.cardCount,`${bank}: per-card coverage missing`);
  for(const [index,card] of (Array.isArray(b?.cards)?b.cards:[]).entries())for(const field of ['reward',...BILLING_FIELDS]){
   const f=card?.fields?.[field],explained=typeof f?.reason==='string'&&f.reason.trim().length>5,named=typeof f?.programme==='string'&&/\p{L}{2}/u.test(f.programme)&&!/^\s*(?:points?|miles?|rewards?|cash ?back|n\/?a|none|unknown|積分|积分|獎賞|奖赏)\s*$/i.test(f.programme);
   // Rewards are required for Membership Rewards and Ultimate Rewards only. Any other programme must be named as not collected; a required one never can be.
   const notCollected=field==='reward'&&f?.status==='not_collected'&&explained&&named&&!requiredReward(bank,f.programme)&&confirmedOtherProgramme(bank,f.programme,card?.name);
   // Only a payment field may be satisfied by the bank's statement that no payment is due.
   need(f?.status==='observed'||notCollected||['minimum','due'].includes(field)&&f?.status==='explicit_not_applicable'&&explained,`${bank} card ${index+1}: ${field} not verified`);
   if(field==='due'&&f?.status==='observed')need(dueYearEvidenced(f),`${bank} card ${index+1}: due date has no year evidence`);
   const at=Date.parse(f?.capturedAt);need(Number.isFinite(at)&&at<=now+60000&&now-at<7*86400000,`${bank} card ${index+1}: ${field} date missing or stale`);
  }
 }
 return {passed:errors.length===0,errors};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [zip,evidence,build]=process.argv.slice(2);if(!zip||!evidence||!build){console.error('Usage: node scripts/acceptance.mjs CANDIDATE.zip PRIVATE-ACCEPTANCE.json RUNTIME-BUILD');process.exit(1);}
 const bytes=readFileSync(zip),result=validateAcceptance(JSON.parse(readFileSync(evidence,'utf8')),{sha256:createHash('sha256').update(bytes).digest('hex'),runtimeBuild:build});
 if(artifactBuildId(bytes)!==build){result.passed=false;result.errors.push('runtime build is not the build in this artifact');}
 console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
}
