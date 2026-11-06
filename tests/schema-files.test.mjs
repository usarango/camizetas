import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
test('CLI-generated migrations match tested schema sources and have unique versions',async()=>{
 const directory=new URL('../supabase/migrations/',import.meta.url),files=(await readdir(directory)).filter(n=>n.endsWith('.sql'));
 assert.equal(new Set(files.map(f=>f.split('_')[0])).size,files.length);
 for(const [suffix,source] of [['camizetas_commerce','schema.sql'],['camizetas_product_images','storage.sql'],['creative_store_design','design.sql']]){
  const matches=files.filter(f=>f.endsWith('_'+suffix+'.sql'));assert.equal(matches.length,1);
  assert.equal(await readFile(new URL(matches[0],directory),'utf8'),await readFile(new URL('../database/'+source,import.meta.url),'utf8'));
 }
});
