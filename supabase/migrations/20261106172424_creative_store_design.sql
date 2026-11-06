-- Camizetas: additive store customizer upgrade.
-- Run after the existing commerce schema. Safe to run again; keeps all stores and drafts.
begin;

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
commit;
