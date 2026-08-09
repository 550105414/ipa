-- Defense-in-depth upgrade for projects that may have applied an earlier
-- revision of the sensitive-data migration during development.

begin;

drop policy if exists payment_data_select_visible_customer
  on private.customer_sensitive_payment_data;
drop policy if exists payment_data_insert_visible_customer
  on private.customer_sensitive_payment_data;
drop policy if exists payment_data_update_visible_customer
  on private.customer_sensitive_payment_data;

revoke all on schema private from public;
revoke all on function public.get_sales_workspace_customer_sensitive(uuid)
  from public;
revoke all on function public.update_sales_workspace_customer_bank_card(uuid, text, text)
  from public;

do $permissions$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    execute 'revoke all on schema private from anon';
    execute 'revoke all on table private.customer_sensitive_payment_data from anon';
    execute 'revoke all on function public.get_sales_workspace_customer_sensitive(uuid) from anon';
    execute 'revoke all on function public.update_sales_workspace_customer_bank_card(uuid, text, text) from anon';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema private from authenticated';
    execute 'revoke all on table private.customer_sensitive_payment_data from authenticated';
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

commit;
