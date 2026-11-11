// The one rule for extension-next/build-scope.js in a build: release.json's "banks" list, or null for every
// active bank. scripts/build-release.py writes the same text; tests/beta-scope.test.mjs keeps the two equal.
import {readFileSync} from 'node:fs';
export const SCOPE_FILE='build-scope.js';
export const scopeBanks=cfg=>Array.isArray(cfg?.banks)?cfg.banks:null;
export const scopeSource=cfg=>`export const BUILD_BANKS=${JSON.stringify(scopeBanks(cfg))};\n`;
export const releaseConfig=root=>JSON.parse(readFileSync(new URL('release.json',root),'utf8'));
// Vite: the wallet bundle gets the same scope as the packaged worker. CARDYBARA_ALL_BANKS=1 keeps every bank
// for a local dev server or dev extension that a bank workstream needs; a release package never reads it.
export function buildScopePlugin(root,{all=process.env.CARDYBARA_ALL_BANKS==='1'}={}){
 return {name:'cardybara-build-scope',enforce:'pre',transform(code,id){
  if(!id.split('?')[0].endsWith('/extension-next/'+SCOPE_FILE))return null;
  return {code:all?scopeSource(null):scopeSource(releaseConfig(root)),map:null};
 }};
}
