-- Camizetas: configuração inicial para um projeto Supabase novo.
-- Execute uma única vez no SQL Editor do projeto da Camizetas.
-- Não apaga dados. Se já houver tabelas com estes nomes, a transação será revertida.
begin;

-- Camizetas initial transactional commerce schema.
-- Apply only to the dedicated Camizetas project. No sample users or orders are inserted.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  description text not null default '' check (char_length(description) <= 3000),
  template text not null default 'chic' check (template in ('chic','underground','rock','nerd')),
  accent text not null default '#6c674d' check (accent ~ '^#[0-9a-fA-F]{6}$'),
  background text not null default '#f5f1e9' check (background ~ '^#[0-9a-fA-F]{6}$'),
  headline text not null default 'Sua marca. Seu universo.' check (char_length(headline) <= 100),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index stores_owner_idx on public.stores(owner_id);
create index stores_published_idx on public.stores(published, created_at desc) where published;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text not null default '' check (char_length(description) <= 5000),
  category text not null default 'Camisetas' check (char_length(btrim(category)) between 1 and 50),
  image_url text not null default '' check (char_length(image_url) <= 2048 and (image_url = '' or image_url ~ '^https?://' or image_url ~ '^assets/')),
  price_cents integer not null check (price_cents between 1 and 100000000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, store_id)
);
create index products_store_active_idx on public.products(store_id, active, created_at desc);

create table public.variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  store_id uuid not null,
  sku text not null check (char_length(btrim(sku)) between 1 and 80),
  size text not null default 'Único' check (char_length(btrim(size)) between 1 and 30),
  color text not null default 'Padrão' check (char_length(btrim(color)) between 1 and 50),
  on_hand integer not null default 0 check (on_hand >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(product_id, store_id) references public.products(id, store_id),
  unique(store_id, sku),
  unique(product_id, size, color),
  unique(id, store_id)
);
create index variants_product_idx on public.variants(product_id);
create index variants_store_active_idx on public.variants(store_id, active);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  store_id uuid not null references public.stores(id),
  buyer_id uuid not null references auth.users(id),
  customer_name text not null check (char_length(btrim(customer_name)) between 2 and 100),
  customer_phone text not null check (char_length(customer_phone) between 8 and 25 and customer_phone ~ '^[+0-9() .-]+$' and char_length(regexp_replace(customer_phone,'[^0-9]','','g')) between 8 and 15),
  address jsonb not null check (jsonb_typeof(address) = 'object'),
  notes text not null default '' check (char_length(notes) <= 1000),
  total_cents bigint not null check (total_cents > 0),
  status text not null default 'new' check (status in ('new','confirmed','packing','shipped','completed','cancelled')),
  tracking_code text check (tracking_code is null or char_length(tracking_code) <= 100),
  idempotency_key uuid not null,
  request_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(buyer_id, idempotency_key),
  unique(id, store_id)
);
create index orders_store_queue_idx on public.orders(store_id, status, created_at);
create index orders_buyer_created_idx on public.orders(buyer_id, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  store_id uuid not null,
  product_id uuid not null references public.products(id),
  variant_id uuid not null references public.variants(id),
  product_name text not null,
  sku text not null,
  size text not null,
  color text not null,
  quantity integer not null check (quantity between 1 and 99),
  unit_price_cents integer not null check (unit_price_cents > 0),
  created_at timestamptz not null default now(),
  foreign key(order_id, store_id) references public.orders(id, store_id),
  unique(order_id, variant_id)
);
create index order_items_store_idx on public.order_items(store_id);
create index order_items_product_idx on public.order_items(product_id);
create index order_items_variant_idx on public.order_items(variant_id);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  variant_id uuid not null,
  order_id uuid references public.orders(id),
  quantity integer not null check (quantity <> 0),
  balance_after integer not null check (balance_after >= 0),
  reason text not null check (char_length(btrim(reason)) between 2 and 250),
  kind text not null check (kind in ('initial','adjustment','sale','cancellation')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key(variant_id, store_id) references public.variants(id, store_id),
  unique(order_id, variant_id, kind)
);
create index inventory_store_created_idx on public.inventory_movements(store_id, created_at desc);
create index inventory_variant_idx on public.inventory_movements(variant_id);
create index inventory_created_by_idx on public.inventory_movements(created_by);

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  store_id uuid not null,
  status text not null check (status in ('new','confirmed','packing','shipped','completed','cancelled')),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key(order_id, store_id) references public.orders(id, store_id)
);
create index order_events_order_created_idx on public.order_events(order_id, created_at);
create index order_events_store_idx on public.order_events(store_id);
create index order_events_actor_idx on public.order_events(actor_id);

create function private.touch_updated_at() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
revoke all on function private.touch_updated_at() from public, anon, authenticated;
create trigger stores_touch before update on public.stores for each row execute function private.touch_updated_at();
create trigger products_touch before update on public.products for each row execute function private.touch_updated_at();
create trigger variants_touch before update on public.variants for each row execute function private.touch_updated_at();
create trigger orders_touch before update on public.orders for each row execute function private.touch_updated_at();

alter table public.stores enable row level security;
alter table public.products enable row level security;
alter table public.variants enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.order_events enable row level security;

create policy stores_read on public.stores for select to anon, authenticated
using (published or owner_id = (select auth.uid()));
create policy stores_owner_update on public.stores for update to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy products_read on public.products for select to anon, authenticated
using (exists (select 1 from public.stores s where s.id = store_id and (s.owner_id = (select auth.uid()) or (s.published and products.active))));
create policy variants_read on public.variants for select to anon, authenticated
using (exists (select 1 from public.stores s where s.id = store_id and (s.owner_id = (select auth.uid()) or (s.published and variants.active and exists (select 1 from public.products p where p.id = product_id and p.active)))));
create policy orders_read on public.orders for select to authenticated
using (buyer_id = (select auth.uid()) or exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));
create policy order_items_read on public.order_items for select to authenticated
using (exists (select 1 from public.orders o where o.id = order_id));
create policy inventory_owner_read on public.inventory_movements for select to authenticated
using (exists (select 1 from public.stores s where s.id = store_id and s.owner_id = (select auth.uid())));
create policy order_events_read on public.order_events for select to authenticated
using (exists (select 1 from public.orders o where o.id = order_id));

-- Explicit table grants remain independent of row policies. All operational writes are RPC-only.
revoke all on public.stores, public.products, public.variants, public.orders, public.order_items, public.inventory_movements, public.order_events from anon, authenticated;
grant select on public.stores, public.products, public.variants to anon, authenticated;
grant select on public.orders, public.order_items, public.inventory_movements, public.order_events to authenticated;
grant update(name, slug, description, template, accent, background, headline, published) on public.stores to authenticated;

create function private.create_store(p_name text, p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_store public.stores%rowtype;
begin
  if v_user is null then raise exception using errcode = '42501', message = 'Entre na sua conta para criar uma loja.'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 2 and 80 or p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' then
    raise exception using errcode = '22023', message = 'Informe um nome e um endereço de loja válidos.';
  end if;
  insert into public.stores(owner_id, name, slug) values(v_user, btrim(p_name), p_slug) returning * into v_store;
  return to_jsonb(v_store);
end;
$$;

create function private.save_product(p_store_id uuid, p_product jsonb, p_variants jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_store public.stores%rowtype; v_product public.products%rowtype;
  v_variant public.variants%rowtype; v_data jsonb; v_id uuid; v_ids uuid[] := '{}';
  v_stock integer; v_sku text; v_size text; v_color text;
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
    update public.products set name = btrim(p_product->>'name'), description = coalesce(p_product->>'description',''),
      category = coalesce(nullif(btrim(p_product->>'category'),''),'Camisetas'), image_url = coalesce(p_product->>'image_url',''),
      price_cents = (p_product->>'price_cents')::integer, active = coalesce((p_product->>'active')::boolean,true)
    where id = v_product.id returning * into v_product;
  else
    insert into public.products(store_id, name, description, category, image_url, price_cents, active)
    values(p_store_id, btrim(p_product->>'name'), coalesce(p_product->>'description',''),
      coalesce(nullif(btrim(p_product->>'category'),''),'Camisetas'), coalesce(p_product->>'image_url',''),
      (p_product->>'price_cents')::integer, coalesce((p_product->>'active')::boolean,true)) returning * into v_product;
  end if;
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

create function private.adjust_stock(p_variant_id uuid, p_delta integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_store_id uuid; v_variant public.variants%rowtype; v_balance bigint;
begin
  if v_user is null then raise exception using errcode = '42501', message = 'Entre na sua conta para ajustar estoque.'; end if;
  if p_delta is null or p_delta = 0 or p_delta not between -1000000 and 1000000 or p_reason is null or char_length(btrim(p_reason)) not between 2 and 250 then
    raise exception using errcode='22023', message='Informe uma quantidade de ajuste e um motivo válidos.';
  end if;
  select v.store_id into v_store_id from public.variants v join public.stores s on s.id=v.store_id where v.id=p_variant_id and s.owner_id=v_user;
  if not found then raise exception using errcode='42501',message='Você não administra esta variação.'; end if;
  perform 1 from public.stores where id=v_store_id and owner_id=v_user for share;
  select * into v_variant from public.variants where id=p_variant_id and store_id=v_store_id for update;
  v_balance := v_variant.on_hand::bigint+p_delta;
  if v_balance < 0 or v_balance > 2147483647 then raise exception using errcode='22023',message='O ajuste deixaria o estoque inválido.'; end if;
  update public.variants set on_hand=v_balance::integer where id=p_variant_id returning * into v_variant;
  insert into public.inventory_movements(store_id,variant_id,quantity,balance_after,reason,kind,created_by)
  values(v_store_id,p_variant_id,p_delta,v_variant.on_hand,btrim(p_reason),'adjustment',v_user);
  return to_jsonb(v_variant);
end;
$$;

create function private.place_order(p_store_id uuid, p_items jsonb, p_customer jsonb, p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_order public.orders%rowtype; v_line record; v_item jsonb;
  v_snapshots jsonb := '[]'; v_address jsonb; v_total bigint := 0; v_expected integer; v_found integer := 0;
  v_hash text; v_balance integer; v_name text; v_phone text; v_notes text;
begin
  if v_user is null then raise exception using errcode='42501',message='Entre na sua conta para enviar um pedido.'; end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='Identificador do pedido ausente.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_typeof(p_customer) is distinct from 'object' then raise exception using errcode='22023',message='Pedido inválido.'; end if;
  if jsonb_array_length(p_items) not between 1 and 50 then raise exception using errcode='22023',message='O pedido deve conter de 1 a 50 itens.'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) is distinct from 'object' or coalesce(v_item->>'variant_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or coalesce(v_item->>'quantity','') !~ '^[0-9]{1,2}$' or (v_item->>'quantity')::integer not between 1 and 99 then
      raise exception using errcode='22023',message='Informe variações e quantidades válidas.';
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_items) x group by (x->>'variant_id')::uuid having sum((x->>'quantity')::integer)>99) then
    raise exception using errcode='22023',message='O limite é de 99 unidades por variação.';
  end if;
  v_name:=btrim(coalesce(p_customer->>'name','')); v_phone:=btrim(coalesce(p_customer->>'phone','')); v_notes:=coalesce(p_customer->>'notes','');
  if char_length(v_name) not between 2 and 100 or char_length(v_phone) not between 8 and 25 or v_phone !~ '^[+0-9() .-]+$' or char_length(regexp_replace(v_phone,'[^0-9]','','g')) not between 8 and 15 or char_length(v_notes)>1000 then
    raise exception using errcode='22023',message='Informe nome e telefone válidos.';
  end if;
  if jsonb_typeof(p_customer->'address') is distinct from 'object' then raise exception using errcode='22023',message='Informe o endereço de entrega.'; end if;
  v_address:=jsonb_build_object('street',btrim(coalesce(p_customer#>>'{address,street}','')),'number',btrim(coalesce(p_customer#>>'{address,number}','')),
    'complement',btrim(coalesce(p_customer#>>'{address,complement}','')),'neighborhood',btrim(coalesce(p_customer#>>'{address,neighborhood}','')),
    'city',btrim(coalesce(p_customer#>>'{address,city}','')),'state',upper(btrim(coalesce(p_customer#>>'{address,state}',''))),
    'postal_code',btrim(coalesce(p_customer#>>'{address,postal_code}','')));
  if char_length(v_address->>'street') not between 2 and 200 or char_length(v_address->>'number') not between 1 and 30
     or char_length(v_address->>'city') not between 2 and 100 or (v_address->>'state') not in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')
     or (v_address->>'postal_code') !~ '^[0-9]{5}-?[0-9]{3}$' or char_length(v_address->>'complement')>200 or char_length(v_address->>'neighborhood')>100 then
    raise exception using errcode='22023',message='Confira o endereço, a UF e o CEP de entrega.';
  end if;
  v_hash:=md5(jsonb_build_object('store',p_store_id,'items',p_items,'customer',p_customer)::text);
  perform pg_advisory_xact_lock(hashtextextended(v_user::text||':'||p_idempotency_key::text,0));
  select * into v_order from public.orders where buyer_id=v_user and idempotency_key=p_idempotency_key;
  if found then
    if v_order.store_id<>p_store_id or v_order.request_hash<>v_hash then raise exception using errcode='22023',message='Este identificador já foi usado em outro pedido. Atualize o carrinho e tente novamente.'; end if;
    return to_jsonb(v_order);
  end if;
  perform 1 from public.stores where id=p_store_id and published for share;
  if not found then raise exception using errcode='22023',message='Esta loja não está recebendo pedidos.'; end if;
  select count(distinct (x->>'variant_id')::uuid) into v_expected from jsonb_array_elements(p_items) x;
  for v_line in
    with requested as (select (x->>'variant_id')::uuid as variant_id,sum((x->>'quantity')::integer)::integer as quantity from jsonb_array_elements(p_items) x group by (x->>'variant_id')::uuid)
    select v.id,v.product_id,v.sku,v.size,v.color,v.on_hand,v.active,p.name,p.price_cents,p.active as product_active,r.quantity
    from requested r join public.variants v on v.id=r.variant_id join public.products p on p.id=v.product_id
    where v.store_id=p_store_id and p.store_id=p_store_id order by v.id for update of v
  loop
    v_found:=v_found+1;
    if not v_line.active or not v_line.product_active then raise exception using errcode='22023',message='Um dos produtos não está mais disponível.'; end if;
    if v_line.on_hand<v_line.quantity then raise exception using errcode='22023',message='Estoque insuficiente para '||v_line.name||' ('||v_line.size||' / '||v_line.color||').'; end if;
    v_total:=v_total+v_line.price_cents::bigint*v_line.quantity;
    v_snapshots:=v_snapshots||jsonb_build_array(jsonb_build_object('variant_id',v_line.id,'product_id',v_line.product_id,'sku',v_line.sku,'size',v_line.size,'color',v_line.color,'name',v_line.name,'quantity',v_line.quantity,'unit_price_cents',v_line.price_cents));
  end loop;
  if v_found<>v_expected then raise exception using errcode='22023',message='Uma variação não pertence a esta loja ou não está disponível.'; end if;
  insert into public.orders(store_id,buyer_id,customer_name,customer_phone,address,notes,total_cents,idempotency_key,request_hash)
  values(p_store_id,v_user,v_name,v_phone,v_address,v_notes,v_total,p_idempotency_key,v_hash) returning * into v_order;
  for v_item in select value from jsonb_array_elements(v_snapshots) loop
    update public.variants set on_hand=on_hand-(v_item->>'quantity')::integer where id=(v_item->>'variant_id')::uuid returning on_hand into v_balance;
    insert into public.order_items(order_id,store_id,product_id,variant_id,product_name,sku,size,color,quantity,unit_price_cents)
    values(v_order.id,p_store_id,(v_item->>'product_id')::uuid,(v_item->>'variant_id')::uuid,v_item->>'name',v_item->>'sku',v_item->>'size',v_item->>'color',(v_item->>'quantity')::integer,(v_item->>'unit_price_cents')::integer);
    insert into public.inventory_movements(store_id,variant_id,order_id,quantity,balance_after,reason,kind,created_by)
    values(p_store_id,(v_item->>'variant_id')::uuid,v_order.id,-(v_item->>'quantity')::integer,v_balance,'Pedido #'||v_order.order_number,'sale',v_user);
  end loop;
  insert into public.order_events(order_id,store_id,status,actor_id) values(v_order.id,p_store_id,'new',v_user);
  return to_jsonb(v_order);
end;
$$;

create function private.transition_order(p_order_id uuid, p_status text, p_tracking_code text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_order public.orders%rowtype; v_store_id uuid; v_item record; v_balance integer;
begin
  if v_user is null then raise exception using errcode='42501',message='Entre na sua conta para atualizar pedidos.'; end if;
  if p_status is null or p_status not in ('new','confirmed','packing','shipped','completed','cancelled') or char_length(coalesce(p_tracking_code,''))>100 then
    raise exception using errcode='22023',message='Status ou código de rastreamento inválido.';
  end if;
  select o.store_id into v_store_id from public.orders o join public.stores s on s.id=o.store_id where o.id=p_order_id and s.owner_id=v_user;
  if not found then raise exception using errcode='42501',message='Você não administra este pedido.'; end if;
  perform 1 from public.stores where id=v_store_id and owner_id=v_user for share;
  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.status=p_status then return to_jsonb(v_order); end if;
  if not ((v_order.status='new' and p_status in ('confirmed','cancelled')) or
          (v_order.status='confirmed' and p_status in ('packing','cancelled')) or
          (v_order.status='packing' and p_status in ('shipped','cancelled')) or
          (v_order.status='shipped' and p_status='completed')) then
    raise exception using errcode='22023',message='Esta mudança de status não é permitida.';
  end if;
  if p_status='cancelled' then
    for v_item in select i.variant_id,i.quantity from public.order_items i where i.order_id=p_order_id order by i.variant_id loop
      perform 1 from public.variants where id=v_item.variant_id for update;
      update public.variants set on_hand=on_hand+v_item.quantity where id=v_item.variant_id returning on_hand into v_balance;
      insert into public.inventory_movements(store_id,variant_id,order_id,quantity,balance_after,reason,kind,created_by)
      values(v_order.store_id,v_item.variant_id,v_order.id,v_item.quantity,v_balance,'Cancelamento do pedido #'||v_order.order_number,'cancellation',v_user);
    end loop;
  end if;
  update public.orders set status=p_status,tracking_code=case when p_status='shipped' then nullif(btrim(p_tracking_code),'') else tracking_code end
  where id=p_order_id returning * into v_order;
  insert into public.order_events(order_id,store_id,status,actor_id) values(v_order.id,v_order.store_id,p_status,v_user);
  return to_jsonb(v_order);
end;
$$;

-- Narrow exposed invoker wrappers; privileged implementations remain outside exposed schemas.
create function public.create_store(p_name text,p_slug text) returns jsonb language sql security invoker set search_path='' as $$ select private.create_store(p_name,p_slug); $$;
create function public.save_product(p_store_id uuid,p_product jsonb,p_variants jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.save_product(p_store_id,p_product,p_variants); $$;
create function public.adjust_stock(p_variant_id uuid,p_delta integer,p_reason text) returns jsonb language sql security invoker set search_path='' as $$ select private.adjust_stock(p_variant_id,p_delta,p_reason); $$;
create function public.place_order(p_store_id uuid,p_items jsonb,p_customer jsonb,p_idempotency_key uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.place_order(p_store_id,p_items,p_customer,p_idempotency_key); $$;
create function public.transition_order(p_order_id uuid,p_status text,p_tracking_code text default null) returns jsonb language sql security invoker set search_path='' as $$ select private.transition_order(p_order_id,p_status,p_tracking_code); $$;

revoke all on function private.create_store(text,text), private.save_product(uuid,jsonb,jsonb), private.adjust_stock(uuid,integer,text), private.place_order(uuid,jsonb,jsonb,uuid), private.transition_order(uuid,text,text) from public, anon, authenticated;
revoke all on function public.create_store(text,text), public.save_product(uuid,jsonb,jsonb), public.adjust_stock(uuid,integer,text), public.place_order(uuid,jsonb,jsonb,uuid), public.transition_order(uuid,text,text) from public, anon, authenticated;
grant execute on function private.create_store(text,text), private.save_product(uuid,jsonb,jsonb), private.adjust_stock(uuid,integer,text), private.place_order(uuid,jsonb,jsonb,uuid), private.transition_order(uuid,text,text) to authenticated;
grant execute on function public.create_store(text,text), public.save_product(uuid,jsonb,jsonb), public.adjust_stock(uuid,integer,text), public.place_order(uuid,jsonb,jsonb,uuid), public.transition_order(uuid,text,text) to authenticated;

comment on table public.orders is 'Pedidos sem cobrança integrada. Estoque é abatido na criação do pedido e devolvido uma única vez no cancelamento autorizado.';
comment on function public.place_order(uuid,jsonb,jsonb,uuid) is 'Cria pedido autenticado atomicamente, com preços do catálogo, locks de estoque e idempotência por comprador.';

-- Supabase Storage companion migration. Run after schema.sql.
-- This only configures the Camizetas-owned bucket and its narrowly scoped policies.

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
    where s.id::text = (storage.foldername(storage.objects.name))[1]
      and s.owner_id = (select auth.uid())
  )
);

create policy camizetas_products_owner_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'camizetas-products'
  and exists (
    select 1 from public.stores s
    where s.id::text = (storage.foldername(storage.objects.name))[1]
      and s.owner_id = (select auth.uid())
  )
);

-- No UPDATE/upsert policy: create a fresh UUID filename for every uploaded image.
-- Supabase already enables RLS and manages grants on storage.objects; do not alter them here.

-- Camizetas: additive store customizer upgrade.
-- Run after the existing commerce schema. Safe to run again; keeps all stores and drafts.

alter table public.stores
  add column if not exists design jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.stores'::regclass and conname = 'stores_design_valid'
  ) then
    alter table public.stores add constraint stores_design_valid
      check (jsonb_typeof(design) = 'object' and octet_length(design::text) <= 16384);
  end if;
end;
$$;

-- The existing owner UPDATE policy remains authoritative; this only adds one editable column.
grant update(design) on public.stores to authenticated;

create table if not exists public.store_design_drafts (
  store_id uuid primary key references public.stores(id),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  constraint store_design_drafts_payload_valid
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 24576)
);

alter table public.store_design_drafts enable row level security;

-- Supabase default table privileges may be broad; drafts have explicit, narrow grants.
revoke all on public.store_design_drafts from public, anon, authenticated;
grant select on public.store_design_drafts to authenticated;
grant insert(store_id, payload), update(payload), delete on public.store_design_drafts to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='store_design_drafts' and policyname='store_design_drafts_owner_select') then
    create policy store_design_drafts_owner_select on public.store_design_drafts
      for select to authenticated using (
        exists (select 1 from public.stores s where s.id=store_id and s.owner_id=(select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='store_design_drafts' and policyname='store_design_drafts_owner_insert') then
    create policy store_design_drafts_owner_insert on public.store_design_drafts
      for insert to authenticated with check (
        exists (select 1 from public.stores s where s.id=store_id and s.owner_id=(select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='store_design_drafts' and policyname='store_design_drafts_owner_update') then
    create policy store_design_drafts_owner_update on public.store_design_drafts
      for update to authenticated using (
        exists (select 1 from public.stores s where s.id=store_id and s.owner_id=(select auth.uid()))
      ) with check (
        exists (select 1 from public.stores s where s.id=store_id and s.owner_id=(select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='store_design_drafts' and policyname='store_design_drafts_owner_delete') then
    create policy store_design_drafts_owner_delete on public.store_design_drafts
      for delete to authenticated using (
        exists (select 1 from public.stores s where s.id=store_id and s.owner_id=(select auth.uid()))
      );
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid='public.store_design_drafts'::regclass and tgname='store_design_drafts_touch' and not tgisinternal
  ) then
    create trigger store_design_drafts_touch before update on public.store_design_drafts
      for each row execute function private.touch_updated_at();
  end if;
end;
$$;


-- Atomic draft upsert changes only payload, so clients do not need UPDATE(store_id).
create or replace function public.save_store_design_draft(p_store_id uuid, p_payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  insert into public.store_design_drafts as draft(store_id, payload)
  values(p_store_id, p_payload)
  on conflict(store_id) do update set payload = excluded.payload
  returning to_jsonb(draft);
$$;
revoke all on function public.save_store_design_draft(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_store_design_draft(uuid,jsonb) to authenticated;

-- New visual presets live in design.preset. The four-value legacy template constraint is unchanged.
notify pgrst, 'reload schema';

-- Camizetas: additive collections upgrade for the existing commerce schema.
-- Safe to run again. Product, order and inventory records remain unchanged.

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

-- Camizetas: additive product galleries and optional verified-purchase reviews.
-- Apply only this upgrade to an existing installation. Products, stock and orders are preserved.

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

notify pgrst, 'reload schema';
commit;
