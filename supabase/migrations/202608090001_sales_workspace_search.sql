-- Sales workspace V1 search.
--
-- Required pre-existing columns:
--   customers(id uuid, name text, phone text, id_card_front_url text,
--             id_card_back_url text, created_at timestamptz)
--   merchants(id uuid, merchant_name text, merchant_no text, terminal_no text,
--             status text, created_at timestamptz)
--
-- Deliberate privacy boundary: identity-card numbers and image contents are not
-- accepted, indexed, OCR'd, or searched by the search function below.

begin;

do $extension$
begin
  if not exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_trgm'
  ) then
    if exists (
      select 1
      from pg_catalog.pg_namespace
      where nspname = 'extensions'
    ) then
      execute 'create extension pg_trgm with schema extensions';
    else
      execute 'create extension pg_trgm';
    end if;
  end if;
end
$extension$;

-- Fail closed if a base migration forgot to enable RLS. Existing policies are
-- preserved; no broad search policy is introduced here.
alter table public.customers enable row level security;
alter table public.merchants enable row level security;

-- Locate the extension's operator class instead of assuming whether the target
-- Supabase project installed extensions in `extensions` or `public`.
do $indexes$
declare
  trgm_schema text;
begin
  select namespace.nspname
  into trgm_schema
  from pg_catalog.pg_opclass as opclass
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = opclass.opcnamespace
  join pg_catalog.pg_am as access_method
    on access_method.oid = opclass.opcmethod
  where opclass.opcname = 'gin_trgm_ops'
    and access_method.amname = 'gin'
  order by (namespace.nspname = 'extensions') desc
  limit 1;

  if trgm_schema is null then
    raise exception 'pg_trgm gin_trgm_ops is unavailable';
  end if;

  execute format(
    'create index if not exists customers_name_trgm_idx on public.customers using gin (name %I.gin_trgm_ops) where name is not null',
    trgm_schema
  );
  execute format(
    'create index if not exists customers_phone_trgm_idx on public.customers using gin (phone %I.gin_trgm_ops) where phone is not null',
    trgm_schema
  );
  execute format(
    'create index if not exists merchants_name_trgm_idx on public.merchants using gin (merchant_name %I.gin_trgm_ops) where merchant_name is not null',
    trgm_schema
  );
  execute format(
    'create index if not exists merchants_no_trgm_idx on public.merchants using gin (merchant_no %I.gin_trgm_ops) where merchant_no is not null',
    trgm_schema
  );
  execute format(
    'create index if not exists merchants_terminal_no_trgm_idx on public.merchants using gin (terminal_no %I.gin_trgm_ops) where terminal_no is not null',
    trgm_schema
  );
end
$indexes$;

create index if not exists customers_created_at_search_idx
  on public.customers (created_at desc);

create or replace function public.search_sales_workspace(
  p_query text default '',
  p_scope text default 'all',
  p_status text default 'all',
  p_period text default 'all',
  p_offset integer default 0,
  p_limit integer default 21
)
returns table (
  kind text,
  id text,
  name text,
  masked_phone text,
  profile_status text,
  created_at timestamptz,
  merchant_name text,
  merchant_no text,
  terminal_no text,
  merchant_status text
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
set row_security = 'on'
as $function$
declare
  normalized_query text := btrim(coalesce(p_query, ''));
  contains_pattern text;
  prefix_pattern text;
  this_month_start timestamptz;
  next_month_start timestamptz;
  last_month_start timestamptz;
begin
  if char_length(normalized_query) > 80 then
    raise exception using errcode = '22023', message = 'p_query is too long';
  end if;
  if p_scope is null or p_scope not in ('all', 'customers') then
    raise exception using errcode = '22023', message = 'invalid p_scope';
  end if;
  if p_status is null or p_status not in ('all', 'completed', 'draft') then
    raise exception using errcode = '22023', message = 'invalid p_status';
  end if;
  if p_period is null or p_period not in ('all', 'this_month', 'last_month') then
    raise exception using errcode = '22023', message = 'invalid p_period';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 1000000 then
    raise exception using errcode = '22023', message = 'p_offset is outside the allowed range';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 21 then
    raise exception using errcode = '22023', message = 'p_limit must be between 1 and 21';
  end if;

  contains_pattern := '%' ||
    replace(
      replace(
        replace(normalized_query, chr(92), chr(92) || chr(92)),
        '%', chr(92) || '%'
      ),
      '_', chr(92) || '_'
    ) || '%';
  prefix_pattern :=
    replace(
      replace(
        replace(normalized_query, chr(92), chr(92) || chr(92)),
        '%', chr(92) || '%'
      ),
      '_', chr(92) || '_'
    ) || '%';

  this_month_start :=
    date_trunc('month', pg_catalog.timezone('Asia/Shanghai', statement_timestamp()))
    at time zone 'Asia/Shanghai';
  next_month_start := this_month_start + interval '1 month';
  last_month_start := this_month_start - interval '1 month';

  return query
  with customer_matches as (
    select
      'customer'::text as result_kind,
      customer.id::text as result_id,
      customer.name::text as customer_name,
      case
        when customer.phone is null then null::text
        when char_length(customer.phone) < 7 then
          repeat('*', greatest(char_length(customer.phone) - 4, 0)) || right(customer.phone, 4)
        else left(customer.phone, 3) || '****' || right(customer.phone, 4)
      end::text as result_masked_phone,
      completeness.value::text as result_profile_status,
      customer.created_at::timestamptz as result_created_at,
      null::text as result_merchant_name,
      null::text as result_merchant_no,
      null::text as result_terminal_no,
      null::text as result_merchant_status,
      case
        when normalized_query = '' then 0
        when lower(customer.phone) = lower(normalized_query) then 110
        when lower(customer.name) = lower(normalized_query) then 100
        when customer.phone ilike prefix_pattern escape E'\\' then 90
        when customer.name ilike prefix_pattern escape E'\\' then 80
        else 50
      end as relevance
    from public.customers as customer
    cross join lateral (
      select case
        when nullif(btrim(customer.name), '') is not null
          and nullif(btrim(customer.phone), '') is not null
          and nullif(btrim(customer.id_card_front_url), '') is not null
          and nullif(btrim(customer.id_card_back_url), '') is not null
        then 'completed'
        else 'draft'
      end as value
    ) as completeness
    where (p_scope = 'customers' or normalized_query <> '')
      and (
        normalized_query = ''
        or customer.name ilike contains_pattern escape E'\\'
        or customer.phone ilike contains_pattern escape E'\\'
      )
      and (p_status = 'all' or completeness.value = p_status)
      and (
        p_period = 'all'
        or (
          p_period = 'this_month'
          and customer.created_at >= this_month_start
          and customer.created_at < next_month_start
        )
        or (
          p_period = 'last_month'
          and customer.created_at >= last_month_start
          and customer.created_at < this_month_start
        )
      )
  ),
  merchant_matches as (
    select
      'merchant'::text as result_kind,
      merchant.id::text as result_id,
      null::text as customer_name,
      null::text as result_masked_phone,
      null::text as result_profile_status,
      merchant.created_at::timestamptz as result_created_at,
      merchant.merchant_name::text as result_merchant_name,
      merchant.merchant_no::text as result_merchant_no,
      merchant.terminal_no::text as result_terminal_no,
      merchant.status::text as result_merchant_status,
      case
        when lower(merchant.merchant_no) = lower(normalized_query) then 110
        when lower(merchant.terminal_no) = lower(normalized_query) then 105
        when lower(merchant.merchant_name) = lower(normalized_query) then 100
        when merchant.merchant_no ilike prefix_pattern escape E'\\' then 90
        when merchant.terminal_no ilike prefix_pattern escape E'\\' then 85
        when merchant.merchant_name ilike prefix_pattern escape E'\\' then 80
        else 50
      end as relevance
    from public.merchants as merchant
    where p_scope = 'all'
      and normalized_query <> ''
      and (
        merchant.merchant_name ilike contains_pattern escape E'\\'
        or merchant.merchant_no ilike contains_pattern escape E'\\'
        or merchant.terminal_no ilike contains_pattern escape E'\\'
      )
  ),
  combined_matches as (
    select * from customer_matches
    union all
    select * from merchant_matches
  ),
  ranked_matches as (
    select
      combined.*,
      row_number() over (
        partition by combined.result_kind
        order by
          combined.relevance desc,
          combined.result_created_at desc nulls last,
          combined.result_id
      ) as kind_position
    from combined_matches as combined
  )
  select
    combined.result_kind,
    combined.result_id,
    combined.customer_name,
    combined.result_masked_phone,
    combined.result_profile_status,
    combined.result_created_at,
    combined.result_merchant_name,
    combined.result_merchant_no,
    combined.result_terminal_no,
    combined.result_merchant_status
  from ranked_matches as combined
  order by
    case when combined.kind_position = 1 then 0 else 1 end,
    combined.relevance desc,
    combined.result_created_at desc nulls last,
    combined.result_kind,
    combined.result_id
  offset p_offset
  limit p_limit;
end
$function$;

create or replace function public.get_sales_workspace_customer(
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

revoke all on function public.search_sales_workspace(text, text, text, text, integer, integer)
  from public;
revoke all on function public.get_sales_workspace_customer(uuid)
  from public;

do $permissions$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.search_sales_workspace(text, text, text, text, integer, integer) from anon';
    execute 'revoke all on function public.get_sales_workspace_customer(uuid) from anon';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.search_sales_workspace(text, text, text, text, integer, integer) to authenticated';
    execute 'grant execute on function public.get_sales_workspace_customer(uuid) to authenticated';
  end if;
end
$permissions$;

comment on function public.search_sales_workspace(text, text, text, text, integer, integer)
is 'RLS-aware V1 customer/merchant search. Never searches ID-card numbers or image content.';

comment on function public.get_sales_workspace_customer(uuid)
is 'RLS-aware safe customer detail. Returns upload booleans, never identity-card image URLs or content.';

commit;
