-- Camizetas: additive product galleries and optional verified-purchase reviews.
-- Apply only this upgrade to an existing installation. Products, stock and orders are preserved.
begin;

create or replace function private.valid_product_images(p_urls text[]) returns boolean
language sql immutable security invoker set search_path='' as $$
  select p_urls is not null and coalesce(array_ndims(p_urls),1)=1 and cardinality(p_urls)<=10
    and not exists (select 1 from unnest(p_urls) u(url) where url is null or char_length(url)>2048 or url !~ '^(https://[^[:space:]]+|assets/[^[:space:]]+)$');
$$;
revoke all on function private.valid_product_images(text[]) from public,anon,authenticated;

alter table public.products add column if not exists image_urls text[] not null default '{}';
alter table public.stores add column if not exists reviews_enabled boolean not null default false;
grant update(reviews_enabled) on public.stores to authenticated;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.products'::regclass and conname='products_image_urls_valid') then
    alter table public.products add constraint products_image_urls_valid check (private.valid_product_images(image_urls));
  end if;
end; $$;

create or replace function private.save_product(p_store_id uuid, p_product jsonb, p_variants jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_store public.stores%rowtype; v_product public.products%rowtype;
  v_variant public.variants%rowtype; v_data jsonb; v_id uuid; v_ids uuid[] := '{}';
  v_stock integer; v_sku text; v_size text; v_color text;
  v_images text[]; v_image text;
begin
  if v_user is null then raise exception using errcode = '42501', message = 'Entre na sua conta para salvar produtos.'; end if;
  select * into v_store from public.stores where id = p_store_id and owner_id = v_user for update;
  if not found then raise exception using errcode = '42501', message = 'Você não administra esta loja.'; end if;
  if jsonb_typeof(p_product) is distinct from 'object' or jsonb_typeof(p_variants) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Produto ou variações inválidos.';
  end if;
  if jsonb_array_length(p_variants) not between 1 and 100 then raise exception using errcode = '22023', message = 'Cadastre de 1 a 100 variações por produto.'; end if;
  if coalesce(p_product->>'name','') = '' or char_length(btrim(p_product->>'name')) not between 2 and 120
     or coalesce(p_product->>'price_cents','') !~ '^[0-9]{1,9}$'
     or (p_product->>'price_cents')::integer not between 1 and 100000000 then
    raise exception using errcode = '22023', message = 'Informe nome e preço válidos para o produto.';
  end if;
  if nullif(p_product->>'id','') is not null then
    select * into v_product from public.products where id = (p_product->>'id')::uuid and store_id = p_store_id for update;
    if not found then raise exception using errcode = '42501', message = 'Produto não encontrado nesta loja.'; end if;
    -- Missing gallery fields preserve existing photos; legacy cover edits keep the other photos.
    v_images := v_product.image_urls;
    v_image := case when p_product ? 'image_url' then coalesce(p_product->>'image_url','') else v_product.image_url end;
    if not (p_product ? 'image_urls') and v_image is distinct from v_product.image_url then
      v_images := case when v_image='' then '{}'::text[] else array_prepend(v_image,array_remove(array_remove(v_images,v_product.image_url),v_image)) end;
    end if;
    update public.products set name = btrim(p_product->>'name'), description = coalesce(p_product->>'description',''),
      category = coalesce(nullif(btrim(p_product->>'category'),''),'Camisetas'), image_url = v_image,
      price_cents = (p_product->>'price_cents')::integer, active = coalesce((p_product->>'active')::boolean,true)
    where id = v_product.id returning * into v_product;
  else
    v_image := coalesce(p_product->>'image_url','');
    v_images := case when v_image='' then '{}'::text[] else array[v_image] end;
    insert into public.products(store_id, name, description, category, image_url, price_cents, active)
    values(p_store_id, btrim(p_product->>'name'), coalesce(p_product->>'description',''),
      coalesce(nullif(btrim(p_product->>'category'),''),'Camisetas'), v_image,
      (p_product->>'price_cents')::integer, coalesce((p_product->>'active')::boolean,true)) returning * into v_product;
  end if;
  if p_product ? 'image_urls' then
    if jsonb_typeof(p_product->'image_urls') is distinct from 'array' then
      raise exception using errcode='22023',message='Informe uma lista de até 10 fotos para o produto.';
    end if;
    if jsonb_array_length(p_product->'image_urls')>10 or exists (select 1 from jsonb_array_elements(p_product->'image_urls') e where jsonb_typeof(e) is distinct from 'string') then
      raise exception using errcode='22023',message='Informe uma lista de até 10 fotos válidas para o produto.';
    end if;
    select coalesce(array_agg(q.url order by q.position),'{}'::text[]) into v_images
    from (select e.url,min(e.position) as position from jsonb_array_elements_text(p_product->'image_urls') with ordinality e(url,position) group by e.url) q;
    if not private.valid_product_images(v_images) then
      raise exception using errcode='22023',message='Use até 10 fotos com links HTTPS válidos.';
    end if;
    v_image:=coalesce(v_images[1],'');
  elsif cardinality(v_images)=0 and v_image ~ '^https://' then
    v_images:=array[v_image];
  end if;
  -- A legacy HTTP cover remains readable, while new gallery URLs always require HTTPS.
  if not private.valid_product_images(v_images) then
    if not (p_product ? 'image_urls') and cardinality(v_images)=1 and v_images[1] ~ '^http://' then v_images:='{}'::text[];
    else raise exception using errcode='22023',message='Use até 10 fotos com links HTTPS válidos.'; end if;
  end if;
  update public.products set image_url=v_image,image_urls=v_images where id=v_product.id returning * into v_product;
  -- The store lock serializes saves, adjustments and checkout for this store before variant locks.
  for v_data in select value from jsonb_array_elements(p_variants) loop
    if jsonb_typeof(v_data) is distinct from 'object' then raise exception using errcode = '22023', message = 'Variação inválida.'; end if;
    v_size := coalesce(nullif(btrim(v_data->>'size'),''),'Único');
    v_color := coalesce(nullif(btrim(v_data->>'color'),''),'Padrão');
    if nullif(v_data->>'id','') is not null then
      select * into v_variant from public.variants where id = (v_data->>'id')::uuid and product_id = v_product.id and store_id = p_store_id for update;
      if not found then raise exception using errcode = '42501', message = 'Variação não encontrada neste produto.'; end if;
      if v_variant.id = any(v_ids) then raise exception using errcode = '22023', message = 'Não repita uma variação no cadastro.'; end if;
      if v_data ? 'on_hand' and ((v_data->>'on_hand') is null or (v_data->>'on_hand') !~ '^[0-9]{1,10}$' or (v_data->>'on_hand')::bigint <> v_variant.on_hand) then
        raise exception using errcode = '22023', message = 'Use o ajuste de estoque para alterar o saldo de uma variação existente.';
      end if;
      v_sku := coalesce(nullif(btrim(v_data->>'sku'),''),v_variant.sku);
      update public.variants set sku=v_sku, size=v_size, color=v_color, active=coalesce((v_data->>'active')::boolean,true)
      where id=v_variant.id returning * into v_variant;
    else
      if coalesce(v_data->>'on_hand','0') !~ '^[0-9]{1,7}$' or coalesce((v_data->>'on_hand')::integer,0) not between 0 and 1000000 then
        raise exception using errcode = '22023', message = 'Informe um estoque inicial entre 0 e 1.000.000.';
      end if;
      v_stock := coalesce((v_data->>'on_hand')::integer,0); v_id := gen_random_uuid();
      v_sku := coalesce(nullif(btrim(v_data->>'sku'),''),upper(substr(v_id::text,1,8)));
      insert into public.variants(id,product_id,store_id,sku,size,color,on_hand,active)
      values(v_id,v_product.id,p_store_id,v_sku,v_size,v_color,v_stock,coalesce((v_data->>'active')::boolean,true)) returning * into v_variant;
      if v_stock > 0 then
        insert into public.inventory_movements(store_id,variant_id,quantity,balance_after,reason,kind,created_by)
        values(p_store_id,v_id,v_stock,v_stock,'Estoque inicial','initial',v_user);
      end if;
    end if;
    v_ids := array_append(v_ids,v_variant.id);
  end loop;
  update public.variants set active=false where product_id=v_product.id and not(id=any(v_ids));
  return jsonb_build_object('product',to_jsonb(v_product),'variants',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at,v.id) from public.variants v where v.product_id=v_product.id),'[]'::jsonb));
end;
$$;

create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  product_id uuid not null,
  buyer_id uuid not null references auth.users(id),
  author_name text not null check (char_length(btrim(author_name)) between 2 and 60),
  rating integer not null check (rating between 1 and 5),
  title text not null default '' check (char_length(title)<=120),
  body text not null check (char_length(btrim(body)) between 20 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(product_id,store_id) references public.products(id,store_id),
  unique(product_id,buyer_id)
);
create index if not exists product_reviews_store_product_created_idx on public.product_reviews(store_id,product_id,created_at desc);
create index if not exists product_reviews_buyer_idx on public.product_reviews(buyer_id);
alter table public.product_reviews enable row level security;
-- Public reviews expose a chosen display name, never the buyer's account ID or order data.
revoke all on public.product_reviews from public,anon,authenticated;
grant select(id,store_id,product_id,author_name,rating,title,body,created_at,updated_at) on public.product_reviews to anon,authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='product_reviews' and policyname='product_reviews_catalog_read') then
    create policy product_reviews_catalog_read on public.product_reviews for select to anon,authenticated
    using (exists (select 1 from public.stores s where s.id=product_reviews.store_id and
      (s.owner_id=(select auth.uid()) or (s.published and s.reviews_enabled and exists (
        select 1 from public.products p where p.id=product_reviews.product_id and p.store_id=product_reviews.store_id and p.active
      )))
    ));
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.product_reviews'::regclass and tgname='product_reviews_touch' and not tgisinternal) then
    create trigger product_reviews_touch before update on public.product_reviews for each row execute function private.touch_updated_at();
  end if;
end; $$;

-- The view observes the invoking visitor's RLS instead of bypassing it.
create or replace view public.product_review_summary with (security_invoker=true) as
select store_id,product_id,count(*) as review_count,round(avg(rating)::numeric,2) as average_rating
from public.product_reviews group by store_id,product_id;
revoke all on public.product_review_summary from public,anon,authenticated;
grant select on public.product_review_summary to anon,authenticated;

create or replace function private.product_review_context(p_product_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid(); v_store public.stores%rowtype; v_product public.products%rowtype;
  v_review jsonb; v_reason text:=''; v_eligible boolean:=false;
begin
  if v_user is null then raise exception using errcode='42501',message='Entre na sua conta para avaliar um produto.'; end if;
  select * into v_product from public.products where id=p_product_id;
  if not found then return jsonb_build_object('can_review',false,'reason','Este produto não está disponível.','my_review',null); end if;
  select * into v_store from public.stores where id=v_product.store_id;
  if not v_store.published or not v_product.active then
    v_reason:='Este produto não está disponível para avaliações.';
  elsif not v_store.reviews_enabled then
    v_reason:='Esta loja não está recebendo avaliações.';
  elsif v_store.owner_id=v_user then
    v_reason:='As avaliações são reservadas aos clientes da loja.';
  elsif not exists (select 1 from public.orders o join public.order_items i on i.order_id=o.id and i.store_id=o.store_id
      where o.buyer_id=v_user and o.store_id=v_store.id and o.status='completed' and i.product_id=v_product.id) then
    v_reason:='Você poderá avaliar esta peça após a conclusão de uma compra.';
  else v_eligible:=true;
  end if;
  if v_eligible then
    select jsonb_build_object('id',r.id,'store_id',r.store_id,'product_id',r.product_id,'author_name',r.author_name,'rating',r.rating,'title',r.title,'body',r.body,'created_at',r.created_at,'updated_at',r.updated_at)
      into v_review from public.product_reviews r where r.product_id=v_product.id and r.buyer_id=v_user;
  end if;
  return jsonb_build_object('can_review',v_eligible,'reason',v_reason,'my_review',v_review);
end;
$$;

create or replace function private.save_product_review(p_product_id uuid,p_rating integer,p_title text,p_body text,p_author_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_store public.stores%rowtype; v_product public.products%rowtype; v_context jsonb; v_review public.product_reviews%rowtype;
begin
  if v_user is null then raise exception using errcode='42501',message='Entre na sua conta para avaliar um produto.'; end if;
  -- Match the commerce lock order: store first, product second. This also serializes activation changes.
  select s.* into v_store from public.stores s join public.products p on p.store_id=s.id where p.id=p_product_id for share of s;
  if not found then raise exception using errcode='22023',message='Este produto não está disponível.'; end if;
  select * into v_product from public.products where id=p_product_id and store_id=v_store.id for share;
  v_context:=private.product_review_context(p_product_id);
  if not coalesce((v_context->>'can_review')::boolean,false) then
    raise exception using errcode='42501',message=v_context->>'reason';
  end if;
  if p_rating is null or p_rating not between 1 and 5 or p_title is null or char_length(btrim(p_title))>120
    or p_body is null or char_length(btrim(p_body)) not between 20 and 2000
    or p_author_name is null or char_length(btrim(p_author_name)) not between 2 and 60 then
    raise exception using errcode='22023',message='Informe uma nota de 1 a 5, um nome de 2 a 60 caracteres e um comentário de 20 a 2.000 caracteres.';
  end if;
  insert into public.product_reviews(store_id,product_id,buyer_id,author_name,rating,title,body)
    values(v_store.id,v_product.id,v_user,btrim(p_author_name),p_rating,btrim(p_title),btrim(p_body))
    on conflict(product_id,buyer_id) do update set author_name=excluded.author_name,rating=excluded.rating,title=excluded.title,body=excluded.body
    returning * into v_review;
  return jsonb_build_object('id',v_review.id,'store_id',v_review.store_id,'product_id',v_review.product_id,'author_name',v_review.author_name,'rating',v_review.rating,'title',v_review.title,'body',v_review.body,'created_at',v_review.created_at,'updated_at',v_review.updated_at);
end;
$$;

create or replace function public.product_review_context(p_product_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.product_review_context(p_product_id); $$;
create or replace function public.save_product_review(p_product_id uuid,p_rating integer,p_title text,p_body text,p_author_name text) returns jsonb
language sql security invoker set search_path='' as $$ select private.save_product_review(p_product_id,p_rating,p_title,p_body,p_author_name); $$;
revoke all on function private.product_review_context(uuid),public.product_review_context(uuid),private.save_product_review(uuid,integer,text,text,text),public.save_product_review(uuid,integer,text,text,text) from public,anon,authenticated;
grant execute on function private.product_review_context(uuid),public.product_review_context(uuid),private.save_product_review(uuid,integer,text,text,text),public.save_product_review(uuid,integer,text,text,text) to authenticated;
-- Preserve the RPC's original access after its gallery-aware replacement above.
revoke all on function private.save_product(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.save_product(uuid,jsonb,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
