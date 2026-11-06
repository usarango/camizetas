-- Camizetas: correcao do envio e da exclusao de imagens.
-- Execute no SQL Editor do projeto Supabase da Camizetas.
-- Nao apaga produtos ou imagens; mantem o acesso restrito ao dono da loja.
-- Pode ser executado novamente com seguranca.
begin;

alter policy camizetas_products_owner_insert on storage.objects
to authenticated
with check (
  bucket_id = 'camizetas-products'
  and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
  and exists (
    select 1 from public.stores s
    where s.id::text = (storage.foldername(storage.objects.name))[1]
      and s.owner_id = (select auth.uid())
  )
);

alter policy camizetas_products_owner_delete on storage.objects
to authenticated
using (
  bucket_id = 'camizetas-products'
  and exists (
    select 1 from public.stores s
    where s.id::text = (storage.foldername(storage.objects.name))[1]
      and s.owner_id = (select auth.uid())
  )
);

commit;
