-- Password-gated application APIs use these RLS-aware RPCs. The database never
-- stores a plaintext PAN, CVV, PIN, magnetic-stripe data, or banking password.

begin;

create schema if not exists private;
revoke all on schema private from public;

create table if not exists private.customer_sensitive_payment_data (
  customer_id uuid primary key
    references public.customers (id) on delete cascade,
  bank_card_ciphertext text not null,
  bank_card_last4 varchar(4) not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint customer_sensitive_payment_pan_envelope_check check (
    char_length(bank_card_ciphertext) between 45 and 160
    and bank_card_ciphertext ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{38,96}$'
  ),
  constraint customer_sensitive_payment_last4_check check (
    bank_card_last4 ~ '^[0-9]{4}$'
  )
);

alter table private.customer_sensitive_payment_data enable row level security;

-- No authenticated policy is created. The application first proves customer
-- visibility through the ordinary user-JWT RPC, then a server-only service role
-- performs the sensitive operation. RLS remains enabled as defense in depth.

-- Remove the legacy full-phone shortcut. Full phone access now flows through
-- the password-gated sensitive application API.
drop function if exists public.get_sales_workspace_customer_phone(uuid);
drop function if exists public.get_sales_workspace_customer(uuid);

create function public.get_sales_workspace_customer(
  p_customer_id uuid
)
returns table (
  id text,
  name text,
  masked_phone text,
  profile_status text,
  created_at timestamptz,
  id_card_front_uploaded boolean,
  id_card_back_uploaded boolean
)
language sql
stable
security invoker
set search_path = pg_catalog, public
set row_security = 'on'
as $function$
  select
    customer.id::text,
    customer.name::text,
    case
      when customer.phone is null then null::text
      when char_length(customer.phone) < 7 then
        repeat('*', greatest(char_length(customer.phone) - 4, 0)) || right(customer.phone, 4)
      else left(customer.phone, 3) || '****' || right(customer.phone, 4)
    end::text,
    case
      when nullif(btrim(customer.name), '') is not null
        and nullif(btrim(customer.phone), '') is not null
        and nullif(btrim(customer.id_card_front_url), '') is not null
        and nullif(btrim(customer.id_card_back_url), '') is not null
      then 'completed'
      else 'draft'
    end::text,
    customer.created_at::timestamptz,
    (nullif(btrim(customer.id_card_front_url), '') is not null),
    (nullif(btrim(customer.id_card_back_url), '') is not null)
  from public.customers as customer
  where customer.id = p_customer_id
  limit 1
$function$;

create or replace function public.get_sales_workspace_customer_sensitive(
  p_customer_id uuid
)
returns table (
  phone text,
  id_card_front_path text,
  id_card_back_path text,
  bank_card_ciphertext text
)
language sql
stable
security invoker
set search_path = pg_catalog, public, private
set row_security = 'on'
as $function$
  select
    customer.phone::text,
    nullif(btrim(customer.id_card_front_url), '')::text,
    nullif(btrim(customer.id_card_back_url), '')::text,
    payment.bank_card_ciphertext::text
  from public.customers as customer
  left join private.customer_sensitive_payment_data as payment
    on payment.customer_id = customer.id
  where customer.id = p_customer_id
  limit 1
$function$;

create or replace function public.update_sales_workspace_customer_bank_card(
  p_customer_id uuid,
  p_bank_card_ciphertext text,
  p_bank_card_last4 text
)
returns table (last4 text)
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public, private
set row_security = 'on'
as $function$
begin
  if p_bank_card_ciphertext is null
    or char_length(p_bank_card_ciphertext) not between 45 and 160
    or p_bank_card_ciphertext !~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{38,96}$'
    or p_bank_card_last4 is null
    or p_bank_card_last4 !~ '^[0-9]{4}$'
  then
    raise exception using errcode = '22023', message = 'invalid encrypted bank-card payload';
  end if;

  return query
  insert into private.customer_sensitive_payment_data as payment (
    customer_id,
    bank_card_ciphertext,
    bank_card_last4
  )
  values (
    p_customer_id,
    p_bank_card_ciphertext,
    p_bank_card_last4
  )
  on conflict (customer_id) do update
  set bank_card_ciphertext = excluded.bank_card_ciphertext,
      bank_card_last4 = excluded.bank_card_last4,
      updated_at = statement_timestamp()
  returning payment.bank_card_last4::text;
end
$function$;

revoke all on function public.get_sales_workspace_customer(uuid) from public;
revoke all on function public.get_sales_workspace_customer_sensitive(uuid) from public;
revoke all on function public.update_sales_workspace_customer_bank_card(uuid, text, text) from public;

do $permissions$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    execute 'revoke all on schema private from anon';
    execute 'revoke all on table private.customer_sensitive_payment_data from anon';
    execute 'revoke all on function public.get_sales_workspace_customer(uuid) from anon';
    execute 'revoke all on function public.get_sales_workspace_customer_sensitive(uuid) from anon';
    execute 'revoke all on function public.update_sales_workspace_customer_bank_card(uuid, text, text) from anon';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema private from authenticated';
    execute 'revoke all on table private.customer_sensitive_payment_data from authenticated';
    execute 'grant execute on function public.get_sales_workspace_customer(uuid) to authenticated';
    execute 'revoke all on function public.get_sales_workspace_customer_sensitive(uuid) from authenticated';
    execute 'revoke all on function public.update_sales_workspace_customer_bank_card(uuid, text, text) from authenticated';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema private to service_role';
    execute 'grant select, insert, update on table private.customer_sensitive_payment_data to service_role';
    execute 'grant execute on function public.get_sales_workspace_customer_sensitive(uuid) to service_role';
    execute 'grant execute on function public.update_sales_workspace_customer_bank_card(uuid, text, text) to service_role';
  end if;
end
$permissions$;

comment on table private.customer_sensitive_payment_data
is 'AES-256-GCM encrypted bank PAN envelopes and last4 only; never CVV, PIN, passwords, or plaintext PAN.';
comment on column private.customer_sensitive_payment_data.bank_card_ciphertext
is 'Application-encrypted v1 AES-256-GCM envelope bound to customer_id as AAD.';
comment on function public.get_sales_workspace_customer_sensitive(uuid)
is 'Sensitive material for the password-gated API; user-JWT RLS preflight occurs before isolated service-role access and URL signing.';
comment on function public.update_sales_workspace_customer_bank_card(uuid, text, text)
is 'Service-role-only encrypted bank-card upsert after application user-RLS preflight. Accepts ciphertext envelope and last4 only.';

commit;
