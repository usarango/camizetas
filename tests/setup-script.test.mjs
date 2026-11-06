import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db, setup, schema, storage, design, collections, productPages;
const userId='40000000-0000-4000-8000-000000000001';
const stripTransaction = sql => sql.replace(/^\s*(?:begin|commit);\s*$/gmi,'').trim();
const normalize = sql => sql.replace(/\s+/g,' ').trim();

before(async()=>{
  [setup,schema,storage,design,collections,productPages]=await Promise.all(['setup.sql','schema.sql','storage.sql','design.sql','collections.sql','product-pages.sql'].map(file=>readFile(new URL(`../database/${file}`,import.meta.url),'utf8')));
  db=new PGlite();
  await db.waitReady;
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
    grant usage on schema public,auth to anon,authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null,unique(bucket_id,name));
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select case when strpos(name,'/')=0 then '{}'::text[] else (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] end;
    $$;
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated;
    grant select on storage.objects to anon,authenticated;
    grant insert,update,delete on storage.objects to authenticated;
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('existing-other-bucket','existing-other-bucket',false,321,array['text/plain']);
  `);
  await db.query('insert into auth.users(id) values($1)',[userId]);
});
after(async()=>{if(db)await db.close()});

test('one-shot setup contains all tested source scripts, one transaction and schema reload',()=>{
  const text=normalize(setup);
  assert.ok(text.includes(normalize(stripTransaction(schema))), 'commerce source differs from setup.sql');
  assert.ok(text.includes(normalize(stripTransaction(storage))), 'storage source differs from setup.sql');
  assert.ok(text.includes(normalize(stripTransaction(design))), 'design source differs from setup.sql');
  assert.ok(text.includes(normalize(stripTransaction(collections))), 'collections source differs from setup.sql');
  assert.ok(text.includes(normalize(stripTransaction(productPages))), 'product page source differs from setup.sql');
  assert.equal((setup.match(/^\s*begin;\s*$/gmi)||[]).length,1);
  assert.equal((setup.match(/^\s*commit;\s*$/gmi)||[]).length,1);
  assert.match(setup,/notify\s+pgrst,\s*'reload schema';/i);
  const statementsWithoutComments=setup.replace(/--[^\n]*/g,'');
  // Function bodies are defined, not executed, during setup. The collection RPC
  // intentionally replaces only its own membership rows; that operation has dedicated RLS tests.
  const setupStatements=statementsWithoutComments.replace(/create(?:\s+or\s+replace)?\s+function\b[\s\S]*?\$\$[\s\S]*?\$\$\s*;/gi,'');
  assert.doesNotMatch(setupStatements,/\b(?:drop\s+(?:table|schema|function|policy)|truncate\b|delete\s+from\b)/i);
  assert.doesNotMatch(statementsWithoutComments,/\b(?:drop\s+(?:table|schema)|truncate\b)/i);
  assert.doesNotMatch(statementsWithoutComments,/alter\s+table\s+storage\./i);
});

test('combined setup executes against actual PostgreSQL with Supabase auth/storage stubs',async()=>{
  await db.exec(setup);
  const tables=(await db.query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by relname")).rows;
  assert.equal(tables.length,11);
  assert.ok(tables.every(t=>t.relrowsecurity));
  const functions=(await db.query("select proname,prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by proname")).rows;
  assert.deepEqual(functions.map(f=>f.proname),['adjust_stock','create_store','place_order','product_review_context','save_collection','save_product','save_product_review','save_store_design_draft','transition_order']);
  assert.ok(functions.every(f=>!f.prosecdef));
  const bucket=(await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='camizetas-products'")).rows[0];
  assert.deepEqual(bucket,{public:true,file_size_limit:5242880,allowed_mime_types:['image/jpeg','image/png','image/webp']});
  const policies=(await db.query("select policyname from pg_policies where schemaname='storage' and tablename='objects' order by policyname")).rows;
  assert.deepEqual(policies.map(p=>p.policyname),['camizetas_products_owner_delete','camizetas_products_owner_insert','camizetas_products_read']);
  assert.deepEqual((await db.query("select public,file_size_limit from storage.buckets where id='existing-other-bucket'")).rows,[{public:false,file_size_limit:321}]);
  await db.exec('begin; set local role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[userId]);
  const store=(await db.query("select public.create_store('Loja após setup','loja-apos-setup') as value")).rows[0].value;
  assert.equal(store.owner_id,userId);
  assert.equal(store.published,false);
  await db.exec('commit');
});

test('rerunning on existing application tables fails atomically and preserves existing data',async()=>{
  const before=(await db.query('select id,name,owner_id from public.stores')).rows;
  assert.equal(before.length,1);
  await assert.rejects(db.exec(setup),/already exists/);
  await db.exec('rollback');
  assert.deepEqual((await db.query('select id,name,owner_id from public.stores')).rows,before);
  assert.equal((await db.query("select count(*)::integer as n from storage.buckets where id='camizetas-products'")).rows[0].n,1);
});
