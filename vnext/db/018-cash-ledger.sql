begin;

create table lkz_vnext.cash_entries (
  tenant_id uuid not null references lkz_vnext.tenants,
  id uuid not null,
  actor_id uuid not null default auth.uid(),
  business_date date not null,
  amount_brl_cents integer not null check (amount_brl_cents > 0),
  reference text not null check (length(btrim(reference)) between 1 and 200),
  reverses_id uuid,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, id),
  unique (tenant_id, reverses_id),
  foreign key (tenant_id, reverses_id) references lkz_vnext.cash_entries (tenant_id, id)
);
create index cash_entries_by_date on lkz_vnext.cash_entries (tenant_id, business_date, recorded_at desc, id);

alter table lkz_vnext.cash_entries enable row level security;
revoke all on lkz_vnext.cash_entries from public, anon, authenticated;
grant select on lkz_vnext.cash_entries to authenticated;
grant insert (tenant_id,id,business_date,amount_brl_cents,reference,reverses_id)
  on lkz_vnext.cash_entries to authenticated;
create policy cash_read on lkz_vnext.cash_entries for select to authenticated
  using (lkz_vnext.has_access(tenant_id, array['admin']));
create policy cash_append on lkz_vnext.cash_entries for insert to authenticated
  with check (lkz_vnext.has_access(tenant_id, array['admin']) and actor_id = (select auth.uid()));

create function lkz_vnext.validate_cash_entry()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if not isfinite(new.business_date) or new.business_date > (now() at time zone 'America/Bahia')::date then
    raise exception 'Data do caixa inválida' using errcode = '22023';
  end if;
  if new.reverses_id is not null and not exists (
    select from lkz_vnext.cash_entries e
    where e.tenant_id=new.tenant_id and e.id=new.reverses_id and e.reverses_id is null
      and e.amount_brl_cents=new.amount_brl_cents and e.business_date<=new.business_date
  ) then
    raise exception 'Recebimento incompatível com o estorno' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function lkz_vnext.validate_cash_entry() from public, anon, authenticated;
create trigger validate_cash_entry before insert on lkz_vnext.cash_entries
for each row execute function lkz_vnext.validate_cash_entry();
create trigger audit_cash_entry after insert on lkz_vnext.cash_entries
for each row execute function lkz_vnext.audit_crm_change();

create table lkz_vnext.cash_counts (
  tenant_id uuid not null references lkz_vnext.tenants,
  id uuid not null,
  actor_id uuid not null default auth.uid(),
  business_date date not null,
  counted_brl_cents integer not null check (counted_brl_cents >= 0),
  expected_brl_cents bigint not null,
  difference_brl_cents bigint generated always as (counted_brl_cents-expected_brl_cents) stored,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id,id)
);
alter table lkz_vnext.cash_counts enable row level security;
revoke all on lkz_vnext.cash_counts from public, anon, authenticated;
grant select on lkz_vnext.cash_counts to authenticated;
grant insert (tenant_id,id,business_date,counted_brl_cents) on lkz_vnext.cash_counts to authenticated;
create policy cash_count_read on lkz_vnext.cash_counts for select to authenticated
  using (lkz_vnext.has_access(tenant_id, array['admin']));
create policy cash_count_append on lkz_vnext.cash_counts for insert to authenticated
  with check (lkz_vnext.has_access(tenant_id, array['admin']) and actor_id = (select auth.uid()));

create function lkz_vnext.snapshot_cash_count()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if not isfinite(new.business_date) or new.business_date > (now() at time zone 'America/Bahia')::date then
    raise exception 'Data do caixa inválida' using errcode = '22023';
  end if;
  select coalesce(sum(case when reverses_id is null then amount_brl_cents else -amount_brl_cents end),0)
    into new.expected_brl_cents from lkz_vnext.cash_entries
    where tenant_id=new.tenant_id and business_date=new.business_date;
  return new;
end;
$$;
revoke all on function lkz_vnext.snapshot_cash_count() from public, anon, authenticated;
create trigger snapshot_cash_count before insert on lkz_vnext.cash_counts
for each row execute function lkz_vnext.snapshot_cash_count();
create trigger audit_cash_count after insert on lkz_vnext.cash_counts
for each row execute function lkz_vnext.audit_crm_change();

commit;
