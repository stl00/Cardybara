// `npm run build:gateway`: the hosted gateway as one ES module, gateway/dist/worker.js, for an upload through the
// Workers scripts API (main module worker.js, no other module). `wrangler deploy --config gateway/wrangler.jsonc`
// bundles src/worker.js the same way itself and needs no build. The bundle holds the agent loop, the system prompt
// and the public knowledge from src/ (catalogue, benefit rules, transfer routes, point values, pooling rules), so a
// prompt, model or knowledge change ships by rebuilding and redeploying the Worker. It is never committed.
import {build} from 'esbuild';
import {statSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
/** Bundles the Worker into out (default gateway/dist/worker.js) and checks its inputs and size. Returns its sizes. */
export async function buildGateway(out=root+'gateway/dist/worker.js'){
 const result=await build({entryPoints:[root+'gateway/src/worker.js'],outfile:out,bundle:true,format:'esm',platform:'neutral',target:'es2022',conditions:['workerd','worker','browser'],minify:false,legalComments:'none',metafile:true,logLevel:'warning'});
 const inputs=Object.keys(result.metafile.inputs);
 // Only gateway/, src/ and the two extension modules the knowledge code shares; never a test, script or local stand-in.
 const foreign=inputs.filter(f=>!/^(gateway\/src|src|extension-next)\//.test(f)||/local\.mjs$|tests\//.test(f));
 if(foreign.length)throw Error('unexpected modules in the Worker bundle: '+foreign.join(', '));
 const bytes=statSync(out).size,gz=gzipSync(readFileSync(out)).length;
 // Workers limits a script to 3 MB gzipped on the free plan and 10 MB on paid plans.
 if(gz>3*1024*1024)throw Error(`the Worker bundle is ${gz} bytes gzipped, over the 3 MB free-plan limit`);
 return {out,bytes,gz,inputs:inputs.length};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 buildGateway().then(r=>console.log(`gateway/dist/worker.js: ${(r.bytes/1024).toFixed(0)} KiB, ${(r.gz/1024).toFixed(0)} KiB gzipped, ${r.inputs} inputs`),e=>{console.error(e.message);process.exit(1);});
}
