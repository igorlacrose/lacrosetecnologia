begin;

create role lkz_vnext_asaas_issue nologin;
grant usage on schema lkz_vnext, lkz_vnext_billing to lkz_vnext_asaas_issue;

grant select (tenant_id,id,email,archived_at) on lkz_vnext.clients to lkz_vnext_asaas_issue;
grant select (tenant_id,id,client_id,plan_id) on lkz_vnext.subscription_drafts to lkz_vnext_asaas_issue;
grant select (tenant_id,id,amount_brl_cents,interval) on lkz_vnext.plans to lkz_vnext_asaas_issue;
create policy sandbox_client_lookup on lkz_vnext.clients for select to lkz_vnext_asaas_issue
using (archived_at is null and email like '%@example.test');
create policy sandbox_draft_lookup on lkz_vnext.subscription_drafts for select to lkz_vnext_asaas_issue
using (exists (
  select 1 from lkz_vnext.clients c where c.tenant_id = subscription_drafts.tenant_id and c.id = subscription_drafts.client_id
));
create policy sandbox_plan_lookup on lkz_vnext.plans for select to lkz_vnext_asaas_issue using (true);

create table lkz_vnext_billing.sandbox_issuance (
  tenant_id uuid not null,
  client_id uuid not null,
  draft_id uuid,
  kind text not null check (kind in ('customers','payments','subscriptions')),
  external_reference uuid primary key default gen_random_uuid(),
  provider_id text unique,
  requested_at timestamptz not null default now(),
  linked_at timestamptz,
  amount_cents integer check (amount_cents > 0),
  due_date date,
  cycle text check (cycle in ('MONTHLY','YEARLY')),
  billing_type text check (billing_type in ('PIX','BOLETO','UNDEFINED')),
  foreign key (tenant_id,client_id) references lkz_vnext.clients (tenant_id,id),
  foreign key (tenant_id,draft_id) references lkz_vnext.subscription_drafts (tenant_id,id),
  check ((linked_at is null) = (provider_id is null)),
  check (
    (kind = 'customers' and draft_id is null and amount_cents is null and due_date is null and billing_type is null
      and cycle is null and (provider_id is null or provider_id ~ '^cus_[A-Za-z0-9_-]{1,120}$')) or
    (kind = 'payments' and draft_id is not null and amount_cents is not null and due_date is not null and billing_type is not null
      and cycle is null and (provider_id is null or provider_id ~ '^pay_[A-Za-z0-9_-]{1,120}$')) or
    (kind = 'subscriptions' and draft_id is not null and amount_cents is not null and due_date is not null and billing_type is not null
      and cycle is not null and (provider_id is null or provider_id ~ '^sub_[A-Za-z0-9_-]{1,120}$'))
  )
);
create unique index sandbox_one_customer on lkz_vnext_billing.sandbox_issuance (tenant_id,client_id) where kind = 'customers';
create unique index sandbox_one_contract on lkz_vnext_billing.sandbox_issuance (tenant_id,draft_id) where draft_id is not null;

alter table lkz_vnext_billing.sandbox_issuance enable row level security;
revoke all on lkz_vnext_billing.sandbox_issuance from public, anon, authenticated;
grant select on lkz_vnext_billing.sandbox_issuance to lkz_vnext_asaas_issue, lkz_vnext_asaas_reconcile;
grant insert (tenant_id,client_id,draft_id,kind,amount_cents,due_date,cycle,billing_type),
  update (provider_id,linked_at) on lkz_vnext_billing.sandbox_issuance to lkz_vnext_asaas_issue;
create policy sandbox_issue_read on lkz_vnext_billing.sandbox_issuance for select to lkz_vnext_asaas_issue using (true);
create policy sandbox_issue_insert on lkz_vnext_billing.sandbox_issuance for insert to lkz_vnext_asaas_issue
with check (
  exists (select 1 from lkz_vnext.clients c where c.tenant_id = sandbox_issuance.tenant_id and c.id = sandbox_issuance.client_id)
  and (draft_id is null or exists (
    select 1 from lkz_vnext.subscription_drafts d
    where d.tenant_id = sandbox_issuance.tenant_id and d.id = sandbox_issuance.draft_id and d.client_id = sandbox_issuance.client_id
  ))
);
create policy sandbox_issue_link on lkz_vnext_billing.sandbox_issuance for update to lkz_vnext_asaas_issue
using (provider_id is null) with check (provider_id is not null);
create policy sandbox_reconcile_lookup on lkz_vnext_billing.sandbox_issuance for select to lkz_vnext_asaas_reconcile using (true);

-- Each recurring charge has a different provider ID, while all share the contract reference.
alter table lkz_vnext_billing.payment_bindings drop constraint payment_bindings_external_reference_key;
alter table lkz_vnext_billing.payment_bindings add column provider_subscription_id text
  check (provider_subscription_id ~ '^sub_[A-Za-z0-9_-]{1,120}$');
create unique index payment_bindings_one_time_reference on lkz_vnext_billing.payment_bindings (external_reference)
where provider_subscription_id is null;
grant insert (payment_id,tenant_id,subscription_id,customer_id,external_reference,expected_brl_cents)
  on lkz_vnext_billing.payment_bindings to lkz_vnext_asaas_issue, lkz_vnext_asaas_reconcile;
grant insert (provider_subscription_id) on lkz_vnext_billing.payment_bindings to lkz_vnext_asaas_reconcile;
create policy binding_issue on lkz_vnext_billing.payment_bindings for insert to lkz_vnext_asaas_issue
with check (exists (
  select 1 from lkz_vnext_billing.sandbox_issuance i
  join lkz_vnext_billing.sandbox_issuance c using (tenant_id,client_id)
  where i.kind = 'payments' and i.tenant_id = payment_bindings.tenant_id and i.draft_id = payment_bindings.subscription_id
    and i.external_reference = payment_bindings.external_reference and i.provider_id = payment_bindings.payment_id
    and i.amount_cents = payment_bindings.expected_brl_cents and c.kind = 'customers' and c.provider_id = payment_bindings.customer_id
));
create policy binding_recurring on lkz_vnext_billing.payment_bindings for insert to lkz_vnext_asaas_reconcile
with check (exists (
  select 1 from lkz_vnext_billing.sandbox_issuance i
  join lkz_vnext_billing.sandbox_issuance c using (tenant_id,client_id)
  where i.kind = 'subscriptions' and i.provider_id = payment_bindings.provider_subscription_id
    and i.tenant_id = payment_bindings.tenant_id and i.draft_id = payment_bindings.subscription_id
    and i.external_reference = payment_bindings.external_reference and i.amount_cents = payment_bindings.expected_brl_cents
    and c.kind = 'customers' and c.provider_id = payment_bindings.customer_id
));

commit;
