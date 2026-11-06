import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db, migration, originalStore;
const owner='50000000-0000-4000-8000-000000000001';
const otherOwner='50000000-0000-4000-8000-000000000002';
const publishedStore='60000000-0000-4000-8000-000000000001';
const privateStore='60000000-0000-4000-8000-000000000002';
const secondOwnerStore='60000000-0000-4000-8000-000000000003';
async function asUser(id, callback, role='authenticated') {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id||'']);
    const result=await callback();
    await db.exec('commit');
    return result;
  } catch(error) { await db.exec('rollback'); throw error; }
}
async function saveDraft(store,payload,id=owner) {
  return asUser(id,async()=>
    (await db.query('select public.save_store_design_draft($1,$2::jsonb) as value',[store,JSON.stringify(payload)])).rows[0].value
  );
}
async function setDesign(store,payload,id=owner) {
  return asUser(id,()=>db.query('update public.stores set design=$1::jsonb where id=$2 returning design',[JSON.stringify(payload),store]));
}

before(async()=>{
  db=new PGlite();
  await db.waitReady;
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
    grant usage on schema auth,public to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
  `);
  await db.query('insert into auth.users(id) values($1),($2)',[owner,otherOwner]);
  await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
  await db.query("insert into public.stores(id,owner_id,name,slug,published) values($1,$2,'Marca Publicada','marca-publicada',true),($3,$2,'Marca Privada','marca-privada',false),($4,$5,'Outra Marca','outra-marca',false)",[publishedStore,owner,privateStore,secondOwnerStore,otherOwner]);
  originalStore=(await db.query('select * from public.stores where id=$1',[publishedStore])).rows[0];
  migration=await readFile(new URL('../database/design.sql',import.meta.url),'utf8');
  await db.exec(migration);
});
after(async()=>{if(db)await db.close()});

test('additive design migration preserves existing stores and four legacy template values',async()=>{
  const upgraded=(await db.query('select * from public.stores where id=$1',[publishedStore])).rows[0];
  const {design,...priorFields}=upgraded;
  assert.deepEqual(priorFields,originalStore);
  assert.deepEqual(design,{});
  assert.equal((await db.query('select count(*)::integer as n from public.stores')).rows[0].n,3);
  assert.doesNotMatch(migration.replace(/--[^\n]*/g,''),/\b(?:drop\s+(?:table|policy|column)|truncate\b|delete\s+from\b)/i);
  await assert.rejects(asUser(owner,()=>db.query("update public.stores set template='new-editorial-preset' where id=$1",[publishedStore])),/check constraint/);
});

test('owner publishes new preset design and anonymous visitors read only published store design',async()=>{
  const design={version:1,preset:'editorial-new',colors:{primary:'#39428f'},sections:[{type:'hero',title:'Minha marca'}]};
  assert.deepEqual((await setDesign(publishedStore,design)).rows[0].design,design);
  await setDesign(privateStore,{preset:'private-custom'});
  await asUser(null,async()=>{
    const result=await db.query('select design from public.stores where id=$1',[publishedStore]);
    assert.deepEqual(result.rows,[{design}]);
    assert.equal((await db.query('select design from public.stores where id=$1',[privateStore])).rows.length,0);
  },'anon');
  const unauthorized=await setDesign(publishedStore,{preset:'forged'},otherOwner);
  assert.equal(unauthorized.rows.length,0);
});

test('owner draft RPC atomically inserts and updates payload with timestamp trigger',async()=>{
  const first=await saveDraft(publishedStore,{preset:'rock-plus',version:1,headline:'Draft only'});
  assert.equal(first.store_id,publishedStore);
  assert.deepEqual(first.payload,{preset:'rock-plus',version:1,headline:'Draft only'});
  assert.ok(first.updated_at);
  await db.query("update public.store_design_drafts set updated_at='2000-01-01T00:00:00Z' where store_id=$1",[publishedStore]);
  const second=await saveDraft(publishedStore,{preset:'pixel-plus',headline:'Latest draft'});
  assert.deepEqual(second.payload,{preset:'pixel-plus',headline:'Latest draft'});
  assert.ok(new Date(second.updated_at).getUTCFullYear()>2000);
  assert.equal((await db.query('select count(*)::integer as n from public.store_design_drafts where store_id=$1',[publishedStore])).rows[0].n,1);
  assert.equal((await db.query('select design from public.stores where id=$1',[publishedStore])).rows[0].design.preset,'editorial-new');
});

test('draft RLS and column grants reject anonymous access, another owner and ownership reassignment',async()=>{
  await assert.rejects(asUser(null,()=>db.query('select * from public.store_design_drafts'),'anon'),/permission denied/);
  await assert.rejects(asUser(null,()=>db.query("select public.save_store_design_draft($1,'{}')",[publishedStore]),'anon'),/permission denied/);
  await assert.rejects(saveDraft(publishedStore,{preset:'no-identity'},null),/row-level security/);
  await assert.rejects(saveDraft(publishedStore,{preset:'forged'},otherOwner),/row-level security/);
  await assert.rejects(saveDraft(secondOwnerStore,{preset:'wrong-store'}),/row-level security/);
  await asUser(otherOwner,async()=>{
    assert.equal((await db.query('select * from public.store_design_drafts where store_id=$1',[publishedStore])).rows.length,0);
    assert.equal((await db.query("update public.store_design_drafts set payload='{}' where store_id=$1 returning store_id",[publishedStore])).rows.length,0);
    assert.equal((await db.query('delete from public.store_design_drafts where store_id=$1 returning store_id',[publishedStore])).rows.length,0);
  });
  await assert.rejects(asUser(owner,()=>db.query('update public.store_design_drafts set store_id=$1 where store_id=$2',[secondOwnerStore,publishedStore])),/permission denied/);
  await assert.rejects(asUser(owner,()=>db.query("insert into public.store_design_drafts(store_id,payload,updated_at) values($1,'{}',now())",[privateStore])),/permission denied/);
  assert.deepEqual((await db.query('select payload from public.store_design_drafts where store_id=$1',[publishedStore])).rows[0].payload,{preset:'pixel-plus',headline:'Latest draft'});
});

test('design and draft payloads require JSON objects and enforce UTF-8 byte limits',async()=>{
  for(const invalid of [[],['x'],'text',42,true,null]) {
    await assert.rejects(setDesign(privateStore,invalid),/check constraint/);
    await assert.rejects(saveDraft(privateStore,invalid),/check constraint/);
  }
  await assert.rejects(asUser(owner,()=>db.query('update public.stores set design=null where id=$1',[privateStore])),/not-null constraint/);
  await assert.rejects(asUser(owner,()=>db.query('select public.save_store_design_draft($1,null)',[privateStore])),/not-null constraint/);
  await setDesign(privateStore,{text:'a'.repeat(16000)});
  await assert.rejects(setDesign(privateStore,{text:'a'.repeat(16384)}),/check constraint/);
  await assert.rejects(setDesign(privateStore,{text:'á'.repeat(8200)}),/check constraint/);
  await saveDraft(privateStore,{text:'a'.repeat(24000)});
  await assert.rejects(saveDraft(privateStore,{text:'a'.repeat(24576)}),/check constraint/);
  await assert.rejects(saveDraft(privateStore,{text:'á'.repeat(12300)}),/check constraint/);
  assert.equal((await db.query('select payload from public.store_design_drafts where store_id=$1',[privateStore])).rows[0].payload.text.length,24000);
});

test('safe rerun preserves published designs, owner drafts, grants and policy uniqueness',async()=>{
  const beforeStores=(await db.query('select id,design from public.stores order by id')).rows;
  const beforeDrafts=(await db.query('select * from public.store_design_drafts order by store_id')).rows;
  await db.exec(migration);
  assert.deepEqual((await db.query('select id,design from public.stores order by id')).rows,beforeStores);
  assert.deepEqual((await db.query('select * from public.store_design_drafts order by store_id')).rows,beforeDrafts);
  assert.equal((await db.query("select count(*)::integer as n from pg_policies where schemaname='public' and tablename='store_design_drafts'")).rows[0].n,4);
  assert.equal((await db.query("select count(*)::integer as n from pg_trigger where tgrelid='public.store_design_drafts'::regclass and not tgisinternal")).rows[0].n,1);
  const privilege=(await db.query("select has_column_privilege('authenticated','public.store_design_drafts','payload','update') as payload_update,has_column_privilege('authenticated','public.store_design_drafts','store_id','update') as store_update,has_table_privilege('anon','public.store_design_drafts','select') as anon_read,has_function_privilege('anon','public.save_store_design_draft(uuid,jsonb)','execute') as anon_rpc")).rows[0];
  assert.deepEqual(privilege,{payload_update:true,store_update:false,anon_read:false,anon_rpc:false});
  const result=await saveDraft(publishedStore,{preset:'after-rerun'});
  assert.deepEqual(result.payload,{preset:'after-rerun'});
});

test('owner may remove a draft without affecting published design',async()=>{
  const before=(await db.query('select design from public.stores where id=$1',[publishedStore])).rows[0].design;
  const removed=await asUser(owner,()=>db.query('delete from public.store_design_drafts where store_id=$1 returning store_id',[publishedStore]));
  assert.equal(removed.rows.length,1);
  assert.deepEqual((await db.query('select design from public.stores where id=$1',[publishedStore])).rows[0].design,before);
});
