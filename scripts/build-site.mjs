// Builds the static product site (stl00/Cardybara#239) into dist/site for Cloudflare Pages project `cardybara`.
// Only site/index.html, site/assets and the rendered share images are copied; templates, the capture script and the
// synthetic fixture stay in the repository. Deploying is a separate, manual step (see site/README.md).
import {cp,mkdir,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url)),site=join(root,'site'),out=join(root,'dist/site');
await rm(out,{recursive:true,force:true});await mkdir(join(out,'share'),{recursive:true});
await cp(join(site,'index.html'),join(out,'index.html'));
await cp(join(site,'assets'),join(out,'assets'),{recursive:true});
for(const f of await readdir(join(site,'share/out')))if(f.endsWith('.png'))await cp(join(site,'share/out',f),join(out,'share',f));
await cp(join(site,'_headers'),join(out,'_headers'));
// The page must stay self-contained: no third-party scripts, styles, fonts, trackers or forms.
const html=await readFile(join(out,'index.html'),'utf8');
const external=[...html.matchAll(/<(script|link|img|source|iframe)\b[^>]*(?:src|href|srcset)="(https?:)?\/\//gi)].map(m=>m[0]);
if(external.length)throw Error('site/index.html loads a third-party resource: '+external.join(' | '));
if(/<form\b|<input\b|gtag\(|googletagmanager|analytics|plausible|umami/i.test(html.replace(/no usage analytics|no cookies, analytics/gi,'')))throw Error('site/index.html must not collect data (form, input or analytics found)');
const missing=[...html.matchAll(/(?:src|srcset|href)="((?:assets|share)\/[^"]+)"/g)].map(m=>m[1]).filter(p=>!p.startsWith('share/'));
for(const p of missing)await readFile(join(out,p)).catch(()=>{throw Error('missing site file: '+p)});
await writeFile(join(out,'robots.txt'),'User-agent: *\nAllow: /\n');
console.log('Built dist/site');
