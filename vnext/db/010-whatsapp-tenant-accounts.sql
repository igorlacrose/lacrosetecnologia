begin;

-- Connection ownership and billing are PER TENANT/PMA, never per Lacrose credit line.
-- Nothing in this migration performs a Meta API call, sends a message or bills a client.
do $do$ begin
  if not exists (select 1 from pg_roles where rolname='lkz_vnext_meta_bridge') then
    create role lkz_vnext_meta_bridge nologin noinherit;
  end if;
end $do$;

grant usage on schema lkz_vnext to lkz_vnext_meta_bridge;

create table lkz_vnext.whatsapp_connections (
  tenant_id uuid not null references lkz_vnext.tenants(id),
  id uuid not null default gen_random_uuid(),
  meta_waba_id text not null check (meta_waba_id ~ '^[0-9]{5,30}$'),
  meta_phone_number_id text not null check (meta_phone_number_id ~ '^[0-9]{5,30}$'),
  meta_messaging_account_id text check (meta_messaging_account_id ~ '^[0-9]{5,30}$'),
  phone_display text check (length(phone_display) <= 40),
  connection_state text not null default 'awaiting_billing'
    check (connection_state in ('awaiting_billing','ready','suspended','revoked')),
  billing_owner text not null default 'customer_direct'
    check (billing_owner = 'customer_direct'),
  billing_state text not null default 'unverified'
    check (billing_state in ('unverified','customer_reported','verified')),
  billing_verified_at timestamptz,
  billing_verified_by uuid,
  -- Encrypted Business Integration token: never plaintext, never exposed by Data API.
  token_ciphertext bytea not null,
  token_nonce bytea not null check (length(token_nonce)=12),
  token_key_version integer not null default 1 check (token_key_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id,id),
  unique (meta_phone_number_id),
  check (
    connection_state <> 'ready' OR
    (billing_state='verified' and billing_verified_at is not null and billing_verified_by is not null)
  )
);

create table lkz_vnext.whatsapp_signup_intents (
  tenant_id uuid not null references lkz_vnext.tenants(id),
  id uuid not null default gen_random_uuid(),
  actor_id uuid not null,
  nonce_hash text not null check (nonce_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id,id),
  unique (nonce_hash),
  check (expires_at <= created_at+interval '10 minutes')
);

create table lkz_vnext.whatsapp_reminder_policies (
  tenant_id uuid primary key references lkz_vnext.tenants(id),
  enabled boolean not null default false,
  offsets_minutes integer[] not null default array[1440,120],
  monthly_message_limit integer not null default 0 check (monthly_message_limit between 0 and 10000),
  updated_at timestamptz not null default now(),
  check (array_length(offsets_minutes,1) between 1 and 3)
);

alter table lkz_vnext.whatsapp_connections enable row level security;
alter table lkz_vnext.whatsapp_signup_intents enable row level security;
alter table lkz_vnext.whatsapp_reminder_policies enable row level security;
revoke all on lkz_vnext.whatsapp_connections,lkz_vnext.whatsapp_signup_intents,
  lkz_vnext.whatsapp_reminder_policies from public,anon,authenticated;

-- Only benign metadata is readable by MFA-authenticated tenant members.
grant select (tenant_id,id,meta_waba_id,meta_phone_number_id,meta_messaging_account_id,
  phone_display,connection_state,billing_owner,billing_state,billing_verified_at,created_at,updated_at)
  on lkz_vnext.whatsapp_connections to authenticated;
create policy whatsapp_connection_tenant_read on lkz_vnext.whatsapp_connections for select to authenticated
  using (lkz_vnext.has_access(tenant_id,array['admin','operator','viewer']));
create policy whatsapp_connection_bridge on lkz_vnext.whatsapp_connections for all to lkz_vnext_meta_bridge
  using (true) with check (true);
grant select,insert,update on lkz_vnext.whatsapp_connections to lkz_vnext_meta_bridge;

-- A browser may request an ephemeral signup, but cannot finalize a connection.
grant select (tenant_id,id,actor_id,expires_at,consumed_at,created_at)
  on lkz_vnext.whatsapp_signup_intents to authenticated;
grant insert (tenant_id,actor_id,nonce_hash,expires_at)
  on lkz_vnext.whatsapp_signup_intents to authenticated;
create policy whatsapp_signup_read on lkz_vnext.whatsapp_signup_intents for select to authenticated
  using (actor_id=(select auth.uid()) and lkz_vnext.has_access(tenant_id,array['admin']));
create policy whatsapp_signup_create on lkz_vnext.whatsapp_signup_intents for insert to authenticated
  with check (actor_id=(select auth.uid()) and lkz_vnext.has_access(tenant_id,array['admin'])
    and expires_at > now() and expires_at <= now()+interval '10 minutes');
create policy whatsapp_signup_bridge on lkz_vnext.whatsapp_signup_intents for all to lkz_vnext_meta_bridge
  using (true) with check (true);
grant select,update (consumed_at) on lkz_vnext.whatsapp_signup_intents to lkz_vnext_meta_bridge;

grant select on lkz_vnext.whatsapp_reminder_policies to authenticated;
create policy whatsapp_policy_read on lkz_vnext.whatsapp_reminder_policies for select to authenticated
  using (lkz_vnext.has_access(tenant_id,array['admin','operator','viewer']));
-- Never let a tenant self-enable paid dispatch without the provider connection gate.
create policy whatsapp_policy_bridge on lkz_vnext.whatsapp_reminder_policies for all to lkz_vnext_meta_bridge
  using (true) with check (true);
grant select,insert,update on lkz_vnext.whatsapp_reminder_policies to lkz_vnext_meta_bridge;

-- Nothing grants CREATE, DELETE, or token access to the browser.
commit;
