-- Supabase Storage companion migration. Run after schema.sql.
-- This only configures the Camizetas-owned bucket and its narrowly scoped policies.
begin;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'camizetas-products',
  'camizetas-products',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy camizetas_products_read on storage.objects
for select to anon, authenticated
using (bucket_id = 'camizetas-products');

create policy camizetas_products_owner_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'camizetas-products'
  and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
  and exists (
    select 1 from public.stores s
    where s.id::text = (storage.foldername(name))[1]
      and s.owner_id = (select auth.uid())
  )
);

create policy camizetas_products_owner_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'camizetas-products'
  and exists (
    select 1 from public.stores s
    where s.id::text = (storage.foldername(name))[1]
      and s.owner_id = (select auth.uid())
  )
);

-- No UPDATE/upsert policy: create a fresh UUID filename for every uploaded image.
-- Supabase already enables RLS and manages grants on storage.objects; do not alter them here.
commit;
