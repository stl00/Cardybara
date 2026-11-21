import {defineConfig} from 'vite';
import {createWalletHandler} from './scripts/dev-server.mjs';
import {collectorPlugin} from './scripts/dev-collector/vite-plugin.mjs';
import {i18nCatalogPlugin} from './scripts/i18n-catalog.mjs';
import {buildScopePlugin} from './scripts/build-scope.mjs';
import {webAppPlugin,WEB_OUT} from './scripts/web-build.mjs';

// Development and the packaged wallet share src/ and the same parser/agent APIs.
// Only the runtime adapter differs. This plugin does not enter extension bundles.
// `vite build --mode web` (npm run build:web) makes the installable web app in dist/web; every other command is unchanged.
export default defineConfig(({mode})=>{
 const root=new URL('./',import.meta.url);
 return {
 server:{host:'127.0.0.1',port:8776,strictPort:true,watch:{ignored:['**/.debug/**']},fs:{deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.debug/**']}},
 ...(mode==='web'?{publicDir:false,build:{outDir:WEB_OUT,emptyOutDir:true}}:{}),
 plugins:[buildScopePlugin(root),...(mode==='web'?[webAppPlugin({root})]:[]),i18nCatalogPlugin(),collectorPlugin(),{
  name:'cardybara-local-api',
  configureServer(server){
   const api=createWalletHandler({port:server.config.server.port,staticFiles:false});
   server.middlewares.use((req,res,next)=>req.url?.startsWith('/api/')?api(req,res):next());
  }
 }]
};
});
