import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const owner='a1000000-0000-4000-8000-000000000001';
const otherOwner='a1000000-0000-4000-8000-000000000002';
const buyer='a1000000-0000-4000-8000-000000000003';
const stranger='a1000000-0000-4000-8000-000000000004';
const secondBuyer='a1000000-0000-4000-8000-000000000005';
const store='a2000000-0000-4000-8000-000000000001';
const otherStore='a2000000-0000-4000-8000-000000000002';
const photoA='https://images.example.test/front.jpg',photoB='https://images.example.test/back.jpg',photoC='https://images.example.test/detail.jpg';
const body='O tecido é muito confortável e a peça chegou como nas fotos.';
let db,migration,product,otherProduct,initialBusiness,reviewId;
async function asUser(id,callback,role='authenticated'){
 await db.exec('begin');
 try{await db.exec(`set local role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id||'']);const result=await callback();await db.exec('commit');return result}
 catch(error){await db.exec('rollback');throw error}
}
async function saveProduct(patch,variants=product.variants.map(v=>({id:v.id,size:v.size,color:v.color,sku:v.sku})),identity=owner,storeId=store){
 const fields={id:product.product.id,name:'Camiseta Essencial',price_cents:8990,...patch};
 return asUser(identity,async()=>(await db.query('select public.save_product($1,$2::jsonb,$3::jsonb) as value',[storeId,JSON.stringify(fields),JSON.stringify(variants)])).rows[0].value);
}
async function context(identity=buyer,productId=product.product.id){return asUser(identity,async()=>(await db.query('select public.product_review_context($1) as value',[productId])).rows[0].value)}
async function review(identity=buyer,patch={},productId=product.product.id){return asUser(identity,async()=>(await db.query('select public.save_product_review($1,$2,$3,$4,$5) as value',[productId,patch.rating??5,patch.title??'Gostei muito',patch.body??body,patch.author_name??'Cliente Camizetas'])).rows[0].value)}
async function makeOrder(identity=buyer,completed=true,key='a3000000-0000-4000-8000-000000000001'){
 const customer={name:'Cliente Exemplo',phone:'11999999999',address:{street:'Rua Exemplo',number:'10',city:'São Paulo',state:'SP',postal_code:'01001000'}};
 const order=await asUser(identity,async()=>(await db.query('select public.place_order($1,$2::jsonb,$3::jsonb,$4) as value',[store,JSON.stringify([{variant_id:product.variants[0].id,quantity:1}]),JSON.stringify(customer),key])).rows[0].value);
 if(completed)for(const status of ['confirmed','packing','shipped','completed'])await asUser(owner,()=>db.query('select public.transition_order($1,$2,null)',[order.id,status]));
 return order;
}
async function businessSnapshot(){
 const result={};
 for(const table of ['stores','products','variants','orders','order_items','inventory_movements','order_events'])result[table]=(await db.query(`select to_jsonb(t) as row from public.${table} t order by id`)).rows.map(({row})=>{delete row.image_urls;delete row.reviews_enabled;return row});
 return result;
}
before(async()=>{
 db=new PGlite();await db.waitReady;
 await db.exec(`create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;$$;
 grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 for(const identity of [owner,otherOwner,buyer,stranger,secondBuyer])await db.query('insert into auth.users(id) values($1)',[identity]);
 await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
 await db.query("insert into public.stores(id,owner_id,name,slug,published) values($1,$2,'Marca Autoral','marca-autoral',true),($3,$4,'Outra Marca','outra-marca',true)",[store,owner,otherStore,otherOwner]);
 product=await asUser(owner,async()=>(await db.query('select public.save_product($1,$2::jsonb,$3::jsonb) as value',[store,JSON.stringify({name:'Camiseta Essencial',price_cents:8990,image_url:photoA}),JSON.stringify([{size:'M',color:'Preto',on_hand:20}])])).rows[0].value);
 otherProduct=await asUser(otherOwner,async()=>(await db.query('select public.save_product($1,$2::jsonb,$3::jsonb) as value',[otherStore,JSON.stringify({name:'Peça de Outra Marca',price_cents:12990}),JSON.stringify([{size:'G',color:'Azul',on_hand:10}])])).rows[0].value);
 await makeOrder();
 await makeOrder(stranger,false,'a3000000-0000-4000-8000-000000000002');
 initialBusiness=await businessSnapshot();
 migration=await readFile(new URL('../database/product-pages.sql',import.meta.url),'utf8');await db.exec(migration);
});
after(async()=>{if(db)await db.close()});

test('product upgrade adds empty galleries and disabled reviews without changing commerce records',async()=>{
 assert.deepEqual(await businessSnapshot(),initialBusiness);
 assert.deepEqual((await db.query('select image_urls from public.products where id=$1',[product.product.id])).rows[0].image_urls,[]);
 assert.equal((await db.query('select reviews_enabled from public.stores where id=$1',[store])).rows[0].reviews_enabled,false);
 assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.product_reviews'::regclass")).rows[0].relrowsecurity,true);
 assert.doesNotMatch(migration,/\b(?:drop\s+(?:table|column|schema)|truncate)\b/i);
});

test('gallery save round-trips ordered deduplicated photos, authoritative cover, empty gallery and legacy cover edits',async()=>{
 let saved=await saveProduct({image_urls:[photoB,photoA,photoB,photoC],image_url:'https://ignored.example.test/cover.jpg'});
 assert.deepEqual(saved.product.image_urls,[photoB,photoA,photoC]);assert.equal(saved.product.image_url,photoB);
 saved=await saveProduct({});assert.deepEqual(saved.product.image_urls,[photoB,photoA,photoC]);assert.equal(saved.product.image_url,photoB);
 saved=await saveProduct({image_url:photoA});assert.deepEqual(saved.product.image_urls,[photoA,photoC]);assert.equal(saved.product.image_url,photoA);
 saved=await saveProduct({image_urls:[]});assert.deepEqual(saved.product.image_urls,[]);assert.equal(saved.product.image_url,'');
 saved=await saveProduct({image_url:photoA});assert.deepEqual(saved.product.image_urls,[photoA]);
 const variants=(await db.query('select on_hand from public.variants where product_id=$1',[product.product.id])).rows;
 assert.equal(variants[0].on_hand,18);
});

test('gallery validation and foreign product saves roll back atomically without touching stock or order snapshots',async()=>{
 const before=await businessSnapshot();
 const beforeProduct=(await db.query('select * from public.products where id=$1',[product.product.id])).rows[0];
 for(const invalid of [null,{},[null],[4],['http://example.test/a.jpg'],['javascript:alert(1)'],['https://bad url'],[''],Array(11).fill(photoA)])await assert.rejects(saveProduct({name:'Must roll back',image_urls:invalid}));
 await assert.rejects(saveProduct({id:otherProduct.product.id,image_urls:[photoC]}),/não encontrado/);
 await assert.rejects(saveProduct({image_urls:[photoC]},undefined,otherOwner),/não administra/);
 await assert.rejects(saveProduct({image_urls:[photoC]},[{...product.variants[0],on_hand:200}]),/ajuste de estoque/);
 assert.deepEqual(await businessSnapshot(),before);
 assert.deepEqual((await db.query('select * from public.products where id=$1',[product.product.id])).rows[0],beforeProduct);
});

test('reviews require shop activation and a completed purchase; owner, stranger, pending buyer and anon cannot forge reviews',async()=>{
 assert.equal((await context()).can_review,false);
 await assert.rejects(review(),/recebendo avaliações/);
 await asUser(owner,()=>db.query('update public.stores set reviews_enabled=true where id=$1',[store]));
 assert.equal((await context()).can_review,true);
 assert.equal((await context(stranger)).can_review,false);assert.equal((await context(owner)).can_review,false);
 for(const identity of [stranger,secondBuyer,owner,otherOwner])await assert.rejects(review(identity),/compra|clientes/);
 await assert.rejects(review(buyer,{},otherProduct.product.id),/avaliações/);
 await assert.rejects(asUser(null,()=>db.query('select public.product_review_context($1)',[product.product.id]),'anon'),/permission denied/);
 await assert.rejects(asUser(null,()=>db.query('select public.save_product_review($1,5,\'\',\'comentário de teste longo\',\'Pessoa\')',[product.product.id]),'anon'),/permission denied/);
 await assert.rejects(context(null),/Entre na sua conta/);
 const invisible=await asUser(stranger,()=>db.query('update public.stores set reviews_enabled=true where id=$1 returning id',[otherStore]));assert.equal(invisible.rows.length,0);
});

test('verified buyer can create and edit one review without choosing account/store IDs or altering another review',async()=>{
 const first=await review();reviewId=first.id;assert.equal(first.store_id,store);assert.equal(first.product_id,product.product.id);assert.equal(first.rating,5);assert.equal(Object.hasOwn(first,'buyer_id'),false);
 const updated=await review(buyer,{rating:4,body:body+' Recomendo!'});assert.equal(updated.id,first.id);assert.equal(updated.rating,4);assert.equal(updated.created_at,first.created_at);
 const mine=await context();assert.equal(mine.my_review.id,first.id);assert.equal(Object.hasOwn(mine.my_review,'buyer_id'),false);
 const notMine=await context(stranger);assert.equal(notMine.my_review,null);
 assert.equal((await db.query('select count(*)::int as n from public.product_reviews where product_id=$1',[product.product.id])).rows[0].n,1);
 const before=(await db.query('select * from public.product_reviews order by id')).rows;
 for(const patch of [{rating:0},{rating:6},{body:'Curto'},{body:'x'.repeat(2001)},{title:'x'.repeat(121)},{author_name:'X'}])await assert.rejects(review(buyer,patch));
 assert.deepEqual((await db.query('select * from public.product_reviews order by id')).rows,before);
 await makeOrder(secondBuyer,true,'a3000000-0000-4000-8000-000000000003');
 const other=await review(secondBuyer,{rating:2,author_name:'Outro Cliente'});assert.notEqual(other.id,first.id);
 await assert.rejects(asUser(buyer,()=>db.query("update public.product_reviews set body='Bypass body should never persist' where id=$1",[other.id])),/permission denied/);
 await assert.rejects(asUser(owner,()=>db.query('delete from public.product_reviews where id=$1',[first.id])),/permission denied/);
});

test('public reads expose display content and complete summary without account IDs, and observe shop/product visibility',async()=>{
 for(const [identity,role] of [[null,'anon'],[stranger,'authenticated']])await asUser(identity,async()=>{
  const rows=(await db.query('select id,store_id,product_id,author_name,rating,title,body,created_at,updated_at from public.product_reviews where product_id=$1',[product.product.id])).rows;assert.equal(rows.length,2);
  const summary=(await db.query('select review_count,average_rating from public.product_review_summary where product_id=$1',[product.product.id])).rows[0];assert.equal(Number(summary.review_count),2);assert.equal(Number(summary.average_rating),3);
 },role);
 for(const [identity,role] of [[null,'anon'],[buyer,'authenticated'],[owner,'authenticated']]){
  await assert.rejects(asUser(identity,()=>db.query('select buyer_id from public.product_reviews'),role),/permission denied/);
  await assert.rejects(asUser(identity,()=>db.query('select * from public.product_reviews'),role),/permission denied/);
 }
 await asUser(owner,()=>db.query('update public.stores set reviews_enabled=false where id=$1',[store]));
 await asUser(null,async()=>{assert.equal((await db.query('select id from public.product_reviews')).rows.length,0);assert.equal((await db.query('select * from public.product_review_summary')).rows.length,0)},'anon');
 await asUser(owner,async()=>assert.equal((await db.query('select id from public.product_reviews')).rows.length,2));
 await assert.rejects(review(),/recebendo avaliações/);
 await asUser(owner,()=>db.query('update public.stores set reviews_enabled=true,published=false where id=$1',[store]));
 await asUser(null,async()=>assert.equal((await db.query('select id from public.product_reviews')).rows.length,0),'anon');
 await assert.rejects(review(),/não está disponível/);
 await asUser(owner,()=>db.query('update public.stores set published=true where id=$1',[store]));
 await saveProduct({active:false});
 await asUser(null,async()=>assert.equal((await db.query('select id from public.product_reviews')).rows.length,0),'anon');
 await assert.rejects(review(),/não está disponível/);
 await saveProduct({active:true});
});

test('review privileges, composite foreign key and invoker view guard against tenant and permission bypasses',async()=>{
 await assert.rejects(db.query('insert into public.product_reviews(store_id,product_id,buyer_id,author_name,rating,body) values($1,$2,$3,\'Cliente\',5,$4)',[otherStore,product.product.id,stranger,body]),/foreign key constraint/);
 const functions=(await db.query("select n.nspname,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('product_review_context','save_product_review') order by n.nspname,p.proname")).rows;
 assert.equal(functions.length,4);assert.ok(functions.every(row=>row.proconfig.some(value=>value.startsWith('search_path='))));assert.ok(functions.filter(row=>row.nspname==='public').every(row=>!row.prosecdef));assert.ok(functions.filter(row=>row.nspname==='private').every(row=>row.prosecdef));
 const options=(await db.query("select reloptions from pg_class where oid='public.product_review_summary'::regclass")).rows[0].reloptions;assert.ok(options.includes('security_invoker=true'));
 assert.equal((await db.query("select has_function_privilege('anon','public.save_product_review(uuid,integer,text,text,text)','execute') as allowed")).rows[0].allowed,false);
});

test('idempotent upgrade preserves photos, reviews, inventory, orders and review settings',async()=>{
 const business=await businessSnapshot();const photos=(await db.query('select id,image_urls from public.products order by id')).rows;const reviews=(await db.query('select * from public.product_reviews order by id')).rows;const stores=(await db.query('select id,reviews_enabled from public.stores order by id')).rows;
 await db.exec(migration);assert.deepEqual(await businessSnapshot(),business);assert.deepEqual((await db.query('select id,image_urls from public.products order by id')).rows,photos);assert.deepEqual((await db.query('select * from public.product_reviews order by id')).rows,reviews);assert.deepEqual((await db.query('select id,reviews_enabled from public.stores order by id')).rows,stores);
 assert.equal((await db.query("select count(*)::int as n from pg_policies where schemaname='public' and tablename='product_reviews'")).rows[0].n,1);
 assert.equal((await context()).my_review.id,reviewId);
});
