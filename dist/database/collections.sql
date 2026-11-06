-- Camizetas: additive collections upgrade for the existing commerce schema.
-- Safe to run again. Product, order and inventory records remain unchanged.
begin;

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$'),
  description text not null default '' check (char_length(description) <= 3000),
  image_url text not null default '' check (char_length(image_url) <= 2048 and (image_url = '' or image_url ~ '^https://' or image_url ~ '^assets/')),
  active boolean not null default false,
  featured boolean not null default false,
  sort_order integer not null default 0 check (sort_order between 0 and 9999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id, slug),
  unique(id, store_id)
);
create index if not exists collections_store_active_order_idx on public.collections(store_id, active, sort_order, created_at);

create table if not exists public.collection_products (
  collection_id uuid not null,
  product_id uuid not null,
  store_id uuid not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  primary key(collection_id, product_id),
  foreign key(collection_id, store_id) references public.collections(id, store_id),
  foreign key(product_id, store_id) references public.products(id, store_id)
);
create index if not exists collection_products_product_idx on public.collection_products(product_id);
create index if not exists collection_products_store_idx on public.collection_products(store_id);

alter table public.collections enable row level security;
alter table public.collection_products enable row level security;

-- Only the guarded RPC below may mutate collections and membership rows.
revoke all on public.collections, public.collection_products from public, anon, authenticated;
grant select on public.collections, public.collection_products to anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='collections' and policyname='collections_catalog_read') then
    create policy collections_catalog_read on public.collections for select to anon, authenticated
    using (
      exists (
        select 1 from public.stores s
        where s.id=collections.store_id
          and (s.owner_id=(select auth.uid()) or (s.published and collections.active))
      )
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='collection_products' and policyname='collection_products_catalog_read') then
    create policy collection_products_catalog_read on public.collection_products for select to anon, authenticated
    using (
      exists (
        select 1 from public.stores s
        where s.id=collection_products.store_id
          and (
            s.owner_id=(select auth.uid())
            or (
              s.published
              and exists (select 1 from public.collections c where c.id=collection_products.collection_id and c.store_id=collection_products.store_id and c.active)
              and exists (select 1 from public.products p where p.id=collection_products.product_id and p.store_id=collection_products.store_id and p.active)
            )
          )
      )
    );
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.collections'::regclass and tgname='collections_touch' and not tgisinternal) then
    create trigger collections_touch before update on public.collections
      for each row execute function private.touch_updated_at();
  end if;
end;
$$;

create or replace function private.save_collection(p_store_id uuid, p_collection jsonb, p_product_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid:=auth.uid();
  v_collection public.collections%rowtype;
  v_ids uuid[]:=coalesce(p_product_ids,'{}'::uuid[]);
  v_name text; v_slug text; v_description text; v_image text; v_order integer;
begin
  if v_user is null then raise exception using errcode='42501',message='Entre na sua conta para salvar coleções.'; end if;
  perform 1 from public.stores where id=p_store_id and owner_id=v_user for update;
  if not found then raise exception using errcode='42501',message='Você não administra esta loja.'; end if;
  if jsonb_typeof(p_collection) is distinct from 'object' then raise exception using errcode='22023',message='Informe os dados da coleção.'; end if;
  v_name:=btrim(coalesce(p_collection->>'name',''));
  v_slug:=coalesce(p_collection->>'slug','');
  v_description:=coalesce(p_collection->>'description','');
  v_image:=coalesce(p_collection->>'image_url','');
  if char_length(v_name) not between 2 and 100 or v_slug !~ '^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$' then
    raise exception using errcode='22023',message='Informe um nome e um endereço válidos para a coleção.';
  end if;
  if char_length(v_description)>3000 or char_length(v_image)>2048 or (v_image<>'' and v_image !~ '^https://' and v_image !~ '^assets/') then
    raise exception using errcode='22023',message='Confira a descrição e a imagem da coleção. Use HTTPS para imagens externas.';
  end if;
  if coalesce(p_collection->>'sort_order','0') !~ '^[0-9]{1,4}$' then raise exception using errcode='22023',message='A ordem da coleção deve estar entre 0 e 9999.'; end if;
  v_order:=coalesce((p_collection->>'sort_order')::integer,0);
  if cardinality(v_ids)>500 or array_position(v_ids,null) is not null then
    raise exception using errcode='22023',message='Selecione até 500 produtos válidos para a coleção.';
  end if;
  -- Duplicate IDs are normalized by first occurrence, preserving the intended display order.
  select coalesce(array_agg(q.id order by q.first_position),'{}'::uuid[]) into v_ids
  from (select u.id,min(u.position) as first_position from unnest(v_ids) with ordinality as u(id,position) group by u.id) q;
  if (select count(*) from public.products p where p.store_id=p_store_id and p.id=any(v_ids))<>cardinality(v_ids) then
    raise exception using errcode='22023',message='Um dos produtos não pertence a esta loja ou não está disponível.';
  end if;
  if nullif(p_collection->>'id','') is not null then
    select * into v_collection from public.collections where id=(p_collection->>'id')::uuid and store_id=p_store_id for update;
    if not found then raise exception using errcode='42501',message='Coleção não encontrada nesta loja.'; end if;
    update public.collections set
      name=v_name,slug=v_slug,description=v_description,image_url=v_image,
      active=coalesce((p_collection->>'active')::boolean,false),
      featured=coalesce((p_collection->>'featured')::boolean,false),sort_order=v_order
    where id=v_collection.id returning * into v_collection;
  else
    insert into public.collections(store_id,name,slug,description,image_url,active,featured,sort_order)
    values(p_store_id,v_name,v_slug,v_description,v_image,coalesce((p_collection->>'active')::boolean,false),coalesce((p_collection->>'featured')::boolean,false),v_order)
    returning * into v_collection;
  end if;
  -- Replace only this collection's association rows; catalogue and stock records are untouched.
  delete from public.collection_products where collection_id=v_collection.id and store_id=p_store_id;
  insert into public.collection_products(collection_id,product_id,store_id,sort_order)
  select v_collection.id,u.id,p_store_id,(u.position-1)::integer from unnest(v_ids) with ordinality as u(id,position);
  return to_jsonb(v_collection)||jsonb_build_object('product_ids',to_jsonb(v_ids));
end;
$$;

create or replace function public.save_collection(p_store_id uuid, p_collection jsonb, p_product_ids uuid[])
returns jsonb language sql security invoker set search_path = '' as $$
  select private.save_collection(p_store_id,p_collection,p_product_ids);
$$;
revoke all on function private.save_collection(uuid,jsonb,uuid[]) from public, anon, authenticated;
revoke all on function public.save_collection(uuid,jsonb,uuid[]) from public, anon, authenticated;
grant execute on function private.save_collection(uuid,jsonb,uuid[]) to authenticated;
grant execute on function public.save_collection(uuid,jsonb,uuid[]) to authenticated;

notify pgrst, 'reload schema';
commit;
