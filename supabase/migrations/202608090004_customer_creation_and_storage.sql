-- Customer creation + private identity-image upload support.
-- This migration keeps image bytes outside PostgreSQL and stores only private
-- Storage object paths in the existing customer record.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'id-cards',
  'id-cards',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'sales workspace upload own id cards'
  ) then
    create policy "sales workspace upload own id cards"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'id-cards'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'sales workspace manage own id cards'
  ) then
    create policy "sales workspace manage own id cards"
      on storage.objects for update to authenticated
      using (
        bucket_id = 'id-cards'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
      )
      with check (
        bucket_id = 'id-cards'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'sales workspace delete own id cards'
  ) then
    create policy "sales workspace delete own id cards"
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'id-cards'
        and (storage.foldername(name))[1] = (select auth.uid()::text)
      );
  end if;
end
$$;

create or replace function public.create_sales_workspace_customer(
  p_customer_id uuid,
  p_name text,
  p_phone text,
  p_id_card_front_path text,
  p_id_card_back_path text
)
returns table (id uuid)
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
set row_security = 'on'
as $$
declare
  expected_prefix text;
begin
  if auth.uid() is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if p_customer_id is null
     or nullif(btrim(p_name), '') is null
     or char_length(btrim(p_name)) > 100
     or p_phone !~ '^\\+?[0-9]{6,20}$' then
    raise invalid_parameter_value using message = 'invalid customer fields';
  end if;

  expected_prefix := auth.uid()::text || '/' || p_customer_id::text || '/';
  if p_id_card_front_path <> (expected_prefix || 'front')
     or p_id_card_back_path <> (expected_prefix || 'back') then
    raise insufficient_privilege using message = 'invalid object ownership';
  end if;

  return query
  insert into public.customers (
    id,
    name,
    phone,
    id_card_front_url,
    id_card_back_url,
    created_at
  ) values (
    p_customer_id,
    btrim(p_name),
    p_phone,
    p_id_card_front_path,
    p_id_card_back_path,
    now()
  )
  returning customers.id;
end
$$;

revoke all on function public.create_sales_workspace_customer(uuid, text, text, text, text) from public;
grant execute on function public.create_sales_workspace_customer(uuid, text, text, text, text) to authenticated;

comment on function public.create_sales_workspace_customer(uuid, text, text, text, text)
is 'Creates one RLS-visible customer using private Storage paths owned by auth.uid().';
