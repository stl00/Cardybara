// The one rule for extension-next/build-scope.js in a build: release.json's "banks" list, or null for every
// active bank. scripts/build-release.py writes the same text; tests/beta-scope.test.mjs keeps the two equal.
import {readFileSync} from 'node:fs';
export const SCOPE_FILE='build-scope.js';
export const scopeBanks=cfg=>Array.isArray(cfg?.banks)?cfg.banks:null;
// BUILD_SCOPE is a marker the package audit looks for in the wallet bundle: unlike the bank list, no other code has it.
export const scopeMarker=cfg=>'cardybara-scope:'+(scopeBanks(cfg)?.join(',')??'all');
export const scopeSource=cfg=>`export const BUILD_BANKS=${JSON.stringify(scopeBanks(cfg))};\nexport const BUILD_SCOPE=${JSON.stringify(scopeMarker(cfg))};\n`;
export const releaseConfig=root=>JSON.parse(readFileSync(new URL('release.json',root),'utf8'));
// Vite build: the wallet bundle gets the same scope as the packaged worker. The dev server (npm run dev) is not
// scoped, like the Node dev collector. CARDYBARA_ALL_BANKS=1 keeps every bank in a dev extension build for a bank
// workstream; build-release.py refuses to package with it set.
export function buildScopePlugin(root,{all=process.env.CARDYBARA_ALL_BANKS==='1'}={}){
 return {name:'cardybara-build-scope',enforce:'pre',apply:'build',transform(code,id){
  if(!id.split('?')[0].endsWith('/extension-next/'+SCOPE_FILE))return null;
  return {code:all?scopeSource(null):scopeSource(releaseConfig(root)),map:null};
 }};
}
