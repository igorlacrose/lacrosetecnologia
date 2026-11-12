begin;

create table lkz_vnext.products (
  tenant_id uuid references lkz_vnext.tenants not null,
  id uuid default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name text not null check (length(btrim(name)) between 1 and 160),
  kind text not null check (kind in ('service', 'saas')),
  primary key (tenant_id, id),
  unique (tenant_id, slug)
);

create table lkz_vnext.plans (
  tenant_id uuid not null,
  id uuid default gen_random_uuid(),
  product_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 160),
  amount_brl_cents integer not null check (amount_brl_cents > 0),
  interval text not null check (interval in ('once', 'monthly', 'annual')),
  primary key (tenant_id, id),
  foreign key (tenant_id, product_id) references lkz_vnext.products (tenant_id, id)
);

alter table lkz_vnext.products enable row level security;
alter table lkz_vnext.plans enable row level security;
revoke all on lkz_vnext.products, lkz_vnext.plans from public, anon, authenticated;
grant select on lkz_vnext.products, lkz_vnext.plans to authenticated;
grant insert (tenant_id, slug, name, kind) on lkz_vnext.products to authenticated;
grant insert (tenant_id, product_id, name, amount_brl_cents, interval) on lkz_vnext.plans to authenticated;

create policy product_read on lkz_vnext.products for select to authenticated
using (lkz_vnext.has_access(tenant_id, array['admin', 'operator', 'viewer']));
create policy product_draft on lkz_vnext.products for insert to authenticated
with check (lkz_vnext.has_access(tenant_id, array['admin']));
create policy plan_read on lkz_vnext.plans for select to authenticated
using (lkz_vnext.has_access(tenant_id, array['admin', 'operator', 'viewer']));
create policy plan_draft on lkz_vnext.plans for insert to authenticated
with check (lkz_vnext.has_access(tenant_id, array['admin']));

create trigger product_audit after insert on lkz_vnext.products
for each row execute function lkz_vnext.audit_crm_change();
create trigger plan_audit after insert on lkz_vnext.plans
for each row execute function lkz_vnext.audit_crm_change();

commit;
