import {build} from 'esbuild';
import {readFile,writeFile,access,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
let existing={};try{existing=JSON.parse(await readFile('.openai/app-public.json','utf8'))}catch{}
const supabaseUrl=process.env.SUPABASE_URL||existing.supabaseUrl||'';
const supabaseKey=process.env.SUPABASE_PUBLISHABLE_KEY||existing.supabaseKey||'';
if(supabaseUrl&&!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(supabaseUrl))throw new Error('SUPABASE_URL must be a Supabase HTTPS project URL.');
if(supabaseKey){
 if(supabaseKey.startsWith('sb_secret_'))throw new Error('Never bundle a secret Supabase API key.');
 if(!supabaseKey.startsWith('sb_publishable_')){let claims;try{claims=JSON.parse(Buffer.from(supabaseKey.split('.')[1],'base64url').toString())}catch{}if(claims?.role!=='anon')throw new Error('Only a publishable or legacy anon key can enter the browser config.')}
}
await writeFile('dist/config.js',`globalThis.CAMIZETAS_CONFIG = ${JSON.stringify({supabaseUrl,supabaseKey})};\n`);
const entryPoints={};for(const name of ['painel','shops','storefront','landing-creative']){await access(path.join(root,'src',name+'.js'));entryPoints[name]=path.join(root,'src',name+'.js')}
await build({entryPoints,outdir:'dist',bundle:true,format:'esm',platform:'browser',target:['es2022'],minify:true,sourcemap:false,legalComments:'none'});
await mkdir('dist/database',{recursive:true});await copyFile('database/design.sql','dist/database/design.sql');await copyFile('database/collections.sql','dist/database/collections.sql');
console.log(`Built storefront, directory and seller dashboard. Database ${supabaseUrl?'configured':'awaiting free-project configuration'}.`);
