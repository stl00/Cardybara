import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const REQUIRED_CASES=['install','coldStart','manualAdd','bankDiscovery','bankReadback','restartPersistence','exportRecovery','cancel','expiredSession','upgradePersistence'];
export const REQUIRED_BANKS=['Amex US','Amex HK','Chase','BOA','HSBC HK','SC HK'];
export function validateAcceptance(report,{sha256,runtimeBuild,now=Date.now()}){
 const errors=[];const need=(ok,why)=>{if(!ok)errors.push(why);};
 need(report?.schema===1,'invalid schema');need(report?.artifactSha256===sha256,'artifact changed or not tested');
 need(report?.runtimeBuild===runtimeBuild,'executing worker build not verified');
 const env=report?.environment||{};need(env.freshChromeProfile===true,'fresh Chrome profile not verified');
 need(env.oldBackupImported===false,'old wallet backup was used');need(env.developerServicesRequired===false,'depends on developer services');
 need(/^[a-p]{32}$/.test(env.extensionId||''),'installed extension ID missing');
 const date=Date.parse(report?.verifiedAt);need(Number.isFinite(date)&&date<=now+60000&&now-date<7*86400000,'acceptance date missing or stale');
 for(const name of REQUIRED_CASES){const c=report?.cases?.[name];need(c?.status==='passed'&&c?.mode==='real-chrome'&&typeof c?.evidence==='string'&&c.evidence.trim().length>5,`${name}: real Chrome evidence required`);}
 for(const bank of REQUIRED_BANKS){
  const b=report?.banks?.[bank];need(b?.status==='passed'&&Number.isInteger(b?.cardCount)&&b.cardCount>0&&b.runtimeBuild===runtimeBuild,`${bank}: real bank acceptance missing`);
  const captured=Date.parse(b?.capturedAt);need(Number.isFinite(captured)&&captured<=now+60000&&now-captured<7*86400000,`${bank}: current readback date missing`);
  need(Array.isArray(b?.cards)&&b.cards.length===b.cardCount&&b.visibleCardCount===b.cardCount,`${bank}: per-card coverage missing`);
  for(const [index,card] of (Array.isArray(b?.cards)?b.cards:[]).entries())for(const field of ['reward','balance','statement','minimum','due']){
   const f=card?.fields?.[field];need(f?.status==='observed'||f?.status==='explicit_not_applicable'&&typeof f.reason==='string'&&f.reason.length>5,`${bank} card ${index+1}: ${field} not verified`);
   const at=Date.parse(f?.capturedAt);need(Number.isFinite(at)&&at<=now+60000&&now-at<7*86400000,`${bank} card ${index+1}: ${field} date missing or stale`);
  }
 }
 return {passed:errors.length===0,errors};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [zip,evidence,build]=process.argv.slice(2);if(!zip||!evidence||!build){console.error('Usage: node scripts/acceptance.mjs CANDIDATE.zip PRIVATE-ACCEPTANCE.json RUNTIME-BUILD');process.exit(1);}
 const result=validateAcceptance(JSON.parse(readFileSync(evidence,'utf8')),{sha256:createHash('sha256').update(readFileSync(zip)).digest('hex'),runtimeBuild:build});
 console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
}
