import {defineConfig} from 'vite';
import {createWalletHandler} from './scripts/dev-server.mjs';
import {collectorPlugin} from './scripts/dev-collector/vite-plugin.mjs';
import {i18nCatalogPlugin} from './scripts/i18n-catalog.mjs';

// Development and the packaged wallet share src/ and the same parser/agent APIs.
// Only the runtime adapter differs. This plugin does not enter extension bundles.
export default defineConfig({
 server:{host:'127.0.0.1',port:8766,strictPort:true,watch:{ignored:['**/.debug/**']},fs:{deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.debug/**']}},
 plugins:[i18nCatalogPlugin(),collectorPlugin(),{
  name:'cardybara-local-api',
  configureServer(server){
   const api=createWalletHandler({port:server.config.server.port,staticFiles:false});
   server.middlewares.use((req,res,next)=>req.url?.startsWith('/api/')?api(req,res):next());
  }
 }]
});
