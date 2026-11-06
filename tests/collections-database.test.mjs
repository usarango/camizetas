import assert from 'node:assert/strict';
import { test,before,after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner='70000000-0000-4000-8000-000000000001';
const otherOwner='70000000-0000-4000-8000-000000000002';
const buyer='70000000-0000-4000-8000-000000000003';
const store='80000000-0000-4000-8000-000000000001';
const privateStore='80000000-0000-4000-8000-000000000002';
const foreignStore='80000000-0000-4000-8000-000000000003';
let db,migration,liveProduct,secondProduct,inactiveProduct,privateProduct,foreignProduct,fixtureSnapshot;
let liveCollection,draftCollection,privateCollection;
async function asUser(id,callback,role='authenticated'){
 await db.exec('begin');
 try{await db.exec(`set local role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id||'']);const result=await callback();await db.exec('commit');return result}
 catch(error){await db.exec('rollback');throw error}
}
async function save(collection,productIds=[],storeId=store,userId=owner){
 return asUser(userId,async()=>(await db.query('select public.save_collection($1,$2::jsonb,$3::uuid[]) as value',[storeId,JSON.stringify(collection),productIds])).rows[0].value);
}
async function makeProduct(storeId,userId,name,active=true){
 return asUser(userId,async()=>(await db.query('select public.save_product($1,$2::jsonb,$3::jsonb) as value',[storeId,JSON.stringify({name,price_cents:8990,active}),JSON.stringify([{size:'M',color:'Preto',on_hand:10}])])).rows[0].value);
}
const form=(name,slug,extra={})=>({name,slug,description:'Peças selecionadas para esta coleção.',image_url:'',active:false,featured:false,sort_order:0,...extra});
async function businessSnapshot(){
 return Object.fromEntries(await Promise.all(['stores','products','variants','orders','order_items','inventory_movements','order_events'].map(async table=>[table,(await db.query(`select to_jsonb(t) as row from public.${table} t order by id`)).rows])));
}
before(async()=>{
 db=new PGlite();await db.waitReady;
 await db.exec(`
 create role anon nologin;create role authenticated nologin;create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;$$;
 grant usage on schema auth,public to anon,authenticated;
 grant execute on function auth.uid() to anon,authenticated;
 `);
 await db.query('insert into auth.users(id) values($1),($2),($3)',[owner,otherOwner,buyer]);
 await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
 await db.query("insert into public.stores(id,owner_id,name,slug,published) values($1,$2,'Marca Pública','marca-publica',true),($3,$2,'Marca Privada','marca-privada',false),($4,$5,'Outra Marca','outra-marca',true)",[store,owner,privateStore,foreignStore,otherOwner]);
 liveProduct=await makeProduct(store,owner,'Camiseta Essencial');
 secondProduct=await makeProduct(store,owner,'Moletom Essencial');
 inactiveProduct=await makeProduct(store,owner,'Peça Arquivada',false);
 privateProduct=await makeProduct(privateStore,owner,'Peça Privada');
 foreignProduct=await makeProduct(foreignStore,otherOwner,'Peça de Outra Loja');
 const customer={name:'Cliente Exemplo',phone:'11999999999',address:{street:'Rua Exemplo',number:'10',city:'São Paulo',state:'SP',postal_code:'01001000'}};
 await asUser(buyer,()=>db.query('select public.place_order($1,$2::jsonb,$3::jsonb,$4)',[store,JSON.stringify([{variant_id:liveProduct.variants[0].id,quantity:2}]),JSON.stringify(customer),'90000000-0000-4000-8000-000000000001']));
 fixtureSnapshot=await businessSnapshot();
 migration=await readFile(new URL('../database/collections.sql',import.meta.url),'utf8');
 await db.exec(migration);
});
after(async()=>{if(db)await db.close()});

test('additive collections migration preserves stores, products, order snapshots and stock',async()=>{
 assert.deepEqual(await businessSnapshot(),fixtureSnapshot);
 const tables=(await db.query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname in ('collections','collection_products')")).rows;
 assert.equal(tables.length,2);assert.ok(tables.every(row=>row.relrowsecurity));
 const source=migration.replace(/--[^\n]*/g,'');
 assert.doesNotMatch(source,/\b(?:drop\s+(?:table|column|policy)|truncate\b)/i);
 assert.doesNotMatch(source,/delete\s+from\s+public\.(?:products|orders|variants|stores)\b/i);
});

test('owner RPC creates ordered collections, normalizes duplicate product IDs and returns row JSON',async()=>{
 liveCollection=await save(form('Essenciais','essenciais',{active:true,featured:true,sort_order:3}),[secondProduct.product.id,liveProduct.product.id,secondProduct.product.id,inactiveProduct.product.id]);
 assert.equal(liveCollection.store_id,store);assert.equal(liveCollection.active,true);assert.equal(liveCollection.featured,true);assert.equal(liveCollection.sort_order,3);
 assert.deepEqual(liveCollection.product_ids,[secondProduct.product.id,liveProduct.product.id,inactiveProduct.product.id]);
 const items=(await db.query('select product_id,sort_order from public.collection_products where collection_id=$1 order by sort_order',[liveCollection.id])).rows;
 assert.deepEqual(items,[{product_id:secondProduct.product.id,sort_order:0},{product_id:liveProduct.product.id,sort_order:1},{product_id:inactiveProduct.product.id,sort_order:2}]);
 draftCollection=await save(form('Próxima coleção','proxima-colecao'),[liveProduct.product.id]);
 privateCollection=await save(form('Coleção privada','colecao-privada',{active:true}),[privateProduct.product.id],privateStore);
});

test('anonymous catalog hides inactive/private collections and inactive-product membership; owner reads all',async()=>{
 for(const [identity,role] of [[null,'anon'],[buyer,'authenticated'],[otherOwner,'authenticated']]){
  await asUser(identity,async()=>{
   const rows=(await db.query('select id from public.collections where store_id=any($1::uuid[]) order by id',[[store,privateStore]])).rows;
   assert.deepEqual(rows,[{id:liveCollection.id}]);
   const items=(await db.query('select product_id from public.collection_products where collection_id=$1 order by sort_order',[liveCollection.id])).rows;
   assert.deepEqual(items,[{product_id:secondProduct.product.id},{product_id:liveProduct.product.id}]);
   assert.equal((await db.query('select product_id from public.collection_products where collection_id=$1',[draftCollection.id])).rows.length,0);
   assert.equal((await db.query('select product_id from public.collection_products where collection_id=$1',[privateCollection.id])).rows.length,0);
  },role);
 }
 await asUser(owner,async()=>{
  assert.equal((await db.query('select id from public.collections where store_id=any($1::uuid[])',[[store,privateStore]])).rows.length,3);
  assert.equal((await db.query('select product_id from public.collection_products where collection_id=$1',[liveCollection.id])).rows.length,3);
 });
});

test('all direct client writes and unauthorized RPCs are denied; composite foreign keys prevent cross-store links',async()=>{
 await assert.rejects(asUser(owner,()=>db.query("update public.collections set name='Bypass' where id=$1",[liveCollection.id])),/permission denied/);
 await assert.rejects(asUser(owner,()=>db.query('delete from public.collection_products where collection_id=$1',[liveCollection.id])),/permission denied/);
 await assert.rejects(asUser(owner,()=>db.query('insert into public.collection_products(collection_id,product_id,store_id) values($1,$2,$3)',[draftCollection.id,secondProduct.product.id,store])),/permission denied/);
 await assert.rejects(save({...liveCollection,name:'Spoofed'},[liveProduct.product.id],store,otherOwner),/não administra/);
 await assert.rejects(save({...liveCollection,store_id:foreignStore},[foreignProduct.product.id],foreignStore,otherOwner),/não encontrada/);
 await assert.rejects(asUser(null,()=>db.query("select public.save_collection($1,'{}','{}')",[store]),'anon'),/permission denied/);
 await assert.rejects(save(form('No identity','no-identity'),[],store,null),/Entre na sua conta/);
 await assert.rejects(db.query('insert into public.collection_products(collection_id,product_id,store_id) values($1,$2,$3)',[draftCollection.id,foreignProduct.product.id,store]),/foreign key constraint/);
 const permissions=(await db.query("select has_function_privilege('anon','public.save_collection(uuid,jsonb,uuid[])','execute') as anon_execute,has_function_privilege('authenticated','public.save_collection(uuid,jsonb,uuid[])','execute') as auth_execute")).rows[0];
 assert.deepEqual(permissions,{anon_execute:false,auth_execute:true});
 const funcs=(await db.query("select n.nspname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='save_collection' order by n.nspname")).rows;
 assert.equal(funcs.find(f=>f.nspname==='private').prosecdef,true);assert.equal(funcs.find(f=>f.nspname==='public').prosecdef,false);assert.ok(funcs.every(f=>f.proconfig.some(s=>s.startsWith('search_path='))));
});

test('invalid product IDs roll back metadata and memberships atomically before any mutation',async()=>{
 const beforeCollection=(await db.query('select * from public.collections where id=$1',[liveCollection.id])).rows;
 const beforeItems=(await db.query('select * from public.collection_products where collection_id=$1 order by sort_order',[liveCollection.id])).rows;
 await assert.rejects(save({...liveCollection,name:'Must not persist'},[liveProduct.product.id,foreignProduct.product.id]),/não pertence/);
 assert.deepEqual((await db.query('select * from public.collections where id=$1',[liveCollection.id])).rows,beforeCollection);
 assert.deepEqual((await db.query('select * from public.collection_products where collection_id=$1 order by sort_order',[liveCollection.id])).rows,beforeItems);
 await assert.rejects(save(form('Invalid insert','invalid-insert'),[foreignProduct.product.id]),/não pertence/);
 assert.equal((await db.query("select id from public.collections where slug='invalid-insert'")).rows.length,0);
 const changed=await save({...liveCollection,store_id:foreignStore,name:'Essenciais atualizados'},[liveProduct.product.id]);
 assert.equal(changed.store_id,store);assert.equal(changed.name,'Essenciais atualizados');
 liveCollection=changed;
});

test('slugs are unique only within a store and full form validates size, URL, order and product limits',async()=>{
 await assert.rejects(save(form('Mesmo slug','essenciais'),[]),error=>error.code==='23505');
 const another=await save(form('Mesmo slug em outra loja','essenciais'),[foreignProduct.product.id],foreignStore,otherOwner);
 assert.equal(another.store_id,foreignStore);
 for(const invalid of [
  form('X','short-name'),form('Válida','ab'),form('Válida','Uppercase'),form('Válida','a'.repeat(81)),
  form('Válida','invalid-order',{sort_order:-1}),form('Válida','invalid-order',{sort_order:10000}),
  form('Válida','invalid-image',{image_url:'http://example.com/a.jpg'}),
  form('Válida','invalid-image',{image_url:'javascript:alert(1)'}),
  form('Válida','invalid-description',{description:'x'.repeat(3001)}),
 ])await assert.rejects(save(invalid,[]));
 await assert.rejects(save(form('Muitos produtos','muitos-produtos'),Array(501).fill(liveProduct.product.id)),/até 500/);
 await assert.rejects(save(form('Produto nulo','produto-nulo'),[null]),/até 500/);
 const blank=await save(form('Imagem vazia','imagem-vazia',{image_url:null}),[]);
 assert.equal(blank.image_url,'');assert.deepEqual(blank.product_ids,[]);
});

test('membership replacement and archiving do not remove products, orders, items or stock',async()=>{
 const before=await businessSnapshot();
 const cleared=await save({...liveCollection,active:false},[]);
 assert.deepEqual(cleared.product_ids,[]);assert.equal(cleared.active,false);
 assert.equal((await db.query('select product_id from public.collection_products where collection_id=$1',[liveCollection.id])).rows.length,0);
 await asUser(null,async()=>assert.equal((await db.query('select id from public.collections where id=$1',[liveCollection.id])).rows.length,0),'anon');
 assert.deepEqual(await businessSnapshot(),before);
});

test('idempotent additive rerun preserves collection data, memberships, policies and business fixtures',async()=>{
 const beforeCollections=(await db.query('select * from public.collections order by id')).rows;
 const beforeItems=(await db.query('select * from public.collection_products order by collection_id,sort_order')).rows;
 const beforeBusiness=await businessSnapshot();
 await db.exec(migration);
 assert.deepEqual((await db.query('select * from public.collections order by id')).rows,beforeCollections);
 assert.deepEqual((await db.query('select * from public.collection_products order by collection_id,sort_order')).rows,beforeItems);
 assert.deepEqual(await businessSnapshot(),beforeBusiness);
 assert.equal((await db.query("select count(*)::integer as n from pg_policies where schemaname='public' and tablename in ('collections','collection_products')")).rows[0].n,2);
 assert.equal((await db.query("select count(*)::integer as n from pg_trigger where tgrelid='public.collections'::regclass and not tgisinternal")).rows[0].n,1);
 const saved=await save(form('Após reaplicar','apos-reaplicar'),[liveProduct.product.id]);assert.ok(saved.id);
});
