#!/usr/bin/env node
// Builds the local dev extension: the release code plus extension-dev/, outside the repository, at a path that
// survives worktrees. Never a release candidate: only a CI artifact can be one.
import {statSync} from 'node:fs';
import {cp,mkdir,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {structureReport,redactStructureText} from './dev-collector/structure-report.js';
const root=join(dirname(fileURLToPath(import.meta.url)),'..'),target=process.env.CARDYBARA_DEV_EXTENSION_DIR||join(homedir(),'.cardybara','dev-extension'),work=target+'.building';
if(!process.argv.includes('--no-wallet')&&!process.argv.includes('--reuse-wallet')){const r=spawnSync('npx',['vite','build'],{cwd:root,stdio:'inherit'});if(r.status)process.exit(r.status);}
// Never replace a folder this script didn't build, such as a mistyped path.
const existing=await readdir(target).catch(()=>[]);if(existing.length&&!existing.includes('build-stamp.json')){console.error('Refusing to replace a folder that is not a dev extension: '+target);process.exit(1);}
await rm(work,{recursive:true,force:true});await mkdir(work,{recursive:true});
// The same files build-release.py takes, so the dev build holds nothing the package doesn't.
const sourceFile=/\.(?:js|json|html|css|svg|png|txt|md)$/,walletFile=/\.(?:js|css|svg|png|jpg|jpeg|webp|ico|json)$/,isDir=p=>statSync(p).isDirectory();
await cp(join(root,'extension-next'),work,{recursive:true,filter:p=>{const rel=relative(join(root,'extension-next'),p);return !rel.split('/').some(x=>x.startsWith('.'))&&rel!=='CHECKSUMS.json'&&(isDir(p)||sourceFile.test(p));}});
await cp(join(root,'extension-dev'),work,{recursive:true});
if(!process.argv.includes('--no-wallet'))for(const name of ['index.html','cardybara.svg','assets','brand'])await cp(join(root,'dist',name),join(work,name),{recursive:true,filter:p=>{const rel=relative(join(root,'dist'),p);return !rel.split('/').includes('archive')&&(isDir(p)||rel===name||walletFile.test(p));}});
await cp(join(root,'public/data.example.json'),join(work,'data.json'));
await rm(join(work,'dashboard.js'),{force:true});
// A file injected as is, so a strict page CSP cannot block it. Its last expression is the report.
await writeFile(join(work,'dev-structure-report.js'),'('+structureReport+')('+redactStructureText+');\n');
const manifest=JSON.parse(await readFile(join(work,'manifest.json'),'utf8'));
manifest.name='Cardybara Dev';manifest.background={service_worker:'background-dev.js',type:'module'};manifest.action.default_popup='dev-popup.html';manifest.action.default_title='Cardybara Dev';manifest.permissions=[...manifest.permissions,'idle'];manifest.optional_permissions=[...new Set([...(manifest.optional_permissions||[]),'notifications'])];
delete manifest.content_scripts;
// A page on localhost can't reach the extension: no content script and no external connections. This permission only lets the report be sent.
manifest.host_permissions=[...manifest.host_permissions.filter(h=>!h.startsWith('http:')),'http://127.0.0.1:8766/*'];manifest.optional_host_permissions=(manifest.optional_host_permissions||[]).filter(h=>!h.startsWith('http:'));
await writeFile(join(work,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const walk=async dir=>(await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]))).flat();
const hash=createHash('sha256');for(const file of (await walk(work)).sort()){hash.update(relative(work,file));hash.update(await readFile(file));}
const stamp=hash.digest('hex').slice(0,16);
await writeFile(join(work,'dev-build-info.js'),`export const DEV_STAMP='${stamp}';\n`);
await writeFile(join(work,'build-stamp.json'),JSON.stringify({stamp})+'\n');
// Same path every time, so Chrome keeps the installed extension and only needs its files replaced.
await mkdir(dirname(target),{recursive:true});await rm(target+'.old',{recursive:true,force:true});await rename(target,target+'.old').catch(()=>{});await rename(work,target);await rm(target+'.old',{recursive:true,force:true});
console.log(JSON.stringify({extensionDir:target,stamp}));
