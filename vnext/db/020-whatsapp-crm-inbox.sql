begin;

create table lkz_vnext.whatsapp_crm_inbox (
  tenant_id uuid not null references lkz_vnext.tenants(id),
  meta_phone_number_id text not null check (meta_phone_number_id ~ '^[0-9]{5,30}$'),
  meta_message_id text not null check (meta_message_id ~ '^[A-Za-z0-9._:=/-]{1,255}$'),
  peer_phone text not null check (peer_phone ~ '^\+[1-9][0-9]{7,14}$'),
  direction text not null check (direction in ('incoming','app_echo')),
  client_id uuid,
  body text not null check (length(body) between 1 and 4096),
  received_at timestamptz not null default now(),
  primary key (tenant_id, meta_phone_number_id, meta_message_id),
  foreign key (tenant_id,client_id) references lkz_vnext.clients(tenant_id,id)
);
create index whatsapp_crm_inbox_latest on lkz_vnext.whatsapp_crm_inbox
  (tenant_id, received_at desc, meta_message_id);
create index whatsapp_crm_inbox_client on lkz_vnext.whatsapp_crm_inbox
  (tenant_id, client_id, received_at desc);

alter table lkz_vnext.whatsapp_crm_inbox enable row level security;
revoke all on lkz_vnext.whatsapp_crm_inbox from public,anon,authenticated;
grant select on lkz_vnext.whatsapp_crm_inbox to authenticated;
grant insert (tenant_id,meta_phone_number_id,meta_message_id,peer_phone,direction,body)
  on lkz_vnext.whatsapp_crm_inbox to lkz_vnext_reminder_bridge;
create policy crm_inbox_read on lkz_vnext.whatsapp_crm_inbox for select to authenticated
  using (lkz_vnext.has_access(tenant_id,array['admin','operator']));
create policy crm_inbox_append on lkz_vnext.whatsapp_crm_inbox for insert to lkz_vnext_reminder_bridge
  with check (exists (
    select 1 from lkz_vnext.whatsapp_connections c
    where c.tenant_id=whatsapp_crm_inbox.tenant_id
      and c.meta_phone_number_id=whatsapp_crm_inbox.meta_phone_number_id
  ));

create index client_relationships_phone_match
  on lkz_vnext.client_relationships (tenant_id,phone) where phone<>'';

create function lkz_vnext.link_whatsapp_crm_client()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  select case when count(*)=1 then (array_agg(r.id))[1] end into new.client_id
  from lkz_vnext.client_relationships r
    join lkz_vnext.clients c on (c.tenant_id,c.id)=(r.tenant_id,r.id)
  where r.tenant_id=new.tenant_id and r.phone=new.peer_phone and r.phone<>'' and c.archived_at is null;
  return new;
end;
$$;
revoke all on function lkz_vnext.link_whatsapp_crm_client() from public,anon,authenticated;
create trigger whatsapp_crm_link before insert on lkz_vnext.whatsapp_crm_inbox
  for each row execute function lkz_vnext.link_whatsapp_crm_client();

commit;
