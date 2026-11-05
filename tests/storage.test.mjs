import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = '10000000-0000-4000-8000-000000000001';
const otherOwner = '10000000-0000-4000-8000-000000000002';
const store = '20000000-0000-4000-8000-000000000001';
const otherStore = '20000000-0000-4000-8000-000000000002';
const object = '30000000-0000-4000-8000-000000000001';
let db;
async function asUser(userId, callback, role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId || '']);
    const result = await callback();
    await db.exec('commit');
    return result;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}
async function insert(name, bucket = 'camizetas-products') {
  return db.query('insert into storage.objects(bucket_id,name) values($1,$2) returning name', [bucket, name]);
}
before(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
    create table public.stores(id uuid primary key,owner_id uuid not null,published boolean not null default false);
    alter table public.stores enable row level security;
    create policy stores_owner_read on public.stores for select to authenticated using(owner_id=(select auth.uid()));
    grant usage on schema public,auth to anon,authenticated;
    grant select on public.stores to authenticated;
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
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('unrelated-bucket','unrelated-bucket',false,123,array['text/plain']);
  `);
  await db.query('insert into public.stores(id,owner_id) values($1,$2),($3,$4)', [store,owner,otherStore,otherOwner]);
  await db.exec(await readFile(new URL('../database/storage.sql', import.meta.url), 'utf8'));
});
after(async () => { if (db) await db.close(); });

test('dedicated image bucket is public with 5 MB MIME limits, unrelated bucket is untouched', async () => {
  const rows = (await db.query('select id,public,file_size_limit,allowed_mime_types from storage.buckets order by id')).rows;
  assert.deepEqual(rows[0], { id: 'camizetas-products', public: true, file_size_limit: 5242880, allowed_mime_types: ['image/jpeg','image/png','image/webp'] });
  assert.deepEqual(rows[1], { id: 'unrelated-bucket', public: false, file_size_limit: 123, allowed_mime_types: ['text/plain'] });
});

test('owner uploads only within own store directory; foreign and malformed paths are denied', async () => {
  const name = `${store}/${object}.jpg`;
  const result = await asUser(owner, () => insert(name));
  assert.equal(result.rows[0].name, name);
  await assert.rejects(asUser(otherOwner, () => insert(`${store}/30000000-0000-4000-8000-000000000002.png`)), /row-level security/);
  for (const path of [
    `not-a-uuid/${object}.jpg`,
    `${store}/../${object}.jpg`,
    `${store}/${object}.svg`,
    `${store}/arbitrary.png`,
    `${store}/nested/${object}.jpg`,
    `${object}.jpg`,
  ]) await assert.rejects(asUser(owner, () => insert(path)), /row-level security/);
  await assert.rejects(asUser(owner, () => insert(`${store}/${object}.webp`, 'unrelated-bucket')), /row-level security/);
});

test('anonymous visitors can read bucket objects but cannot upload', async () => {
  const rows = await asUser(null, () => db.query('select name from storage.objects'), 'anon');
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].name, `${store}/${object}.jpg`);
  await assert.rejects(asUser(null, () => insert(`${store}/30000000-0000-4000-8000-000000000003.png`), 'anon'), /permission denied/);
  await assert.rejects(asUser(null, () => insert(`${store}/30000000-0000-4000-8000-000000000003.png`)), /row-level security/);
});

test('object replacement has no UPDATE policy and only the store owner may delete', async () => {
  const name = `${store}/${object}.jpg`;
  const attemptedUpdate = await asUser(owner, () => db.query("update storage.objects set name=$1 where bucket_id='camizetas-products' and name=$2 returning name", [`${store}/${object}.png`,name]));
  assert.equal(attemptedUpdate.rows.length, 0);
  const wrongDelete = await asUser(otherOwner, () => db.query('delete from storage.objects where name=$1 returning name', [name]));
  assert.equal(wrongDelete.rows.length, 0);
  const rightDelete = await asUser(owner, () => db.query('delete from storage.objects where name=$1 returning name', [name]));
  assert.equal(rightDelete.rows.length, 1);
});
