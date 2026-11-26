begin;
-- Administrative CRM only; no customer records are copied from other products.
create table lkz_vnext.client_relationships (
 tenant_id uuid not null, id uuid not null,
 phone text not null default '' check(phone='' or phone ~ '^\+[1-9][0-9]{7,14}$'),
 contact_name text not null default '' check(length(contact_name)<=160),
 segment text not null default 'new' check(segment in ('new','active','followup','inactive')),
 preferred_channel text not null default 'none' check(preferred_channel in ('none','whatsapp','email','phone')),
 whatsapp_permission text not null default 'unknown' check(whatsapp_permission in ('unknown','allowed','opted_out')),
 email_permission text not null default 'unknown' check(email_permission in ('unknown','allowed','opted_out')),
 permission_source text not null default '' check(length(permission_source)<=300),
 followup_on date, notes text not null default '' check(length(notes)<=2000),
 revision int not null default 1 check(revision>0), updated_at timestamptz not null default now(),
 primary key(tenant_id,id), foreign key(tenant_id,id) references lkz_vnext.clients(tenant_id,id),
 check((whatsapp_permission='unknown' and email_permission='unknown') or length(btrim(permission_source))>0)
);
create table lkz_vnext.client_contacts (
 tenant_id uuid not null, id uuid not null, client_id uuid not null,
 channel text not null check(channel in ('internal','phone','email','whatsapp','meeting')),
 note text not null check(length(btrim(note)) between 1 and 2000),
 actor_id uuid not null default auth.uid(), created_at timestamptz not null default now(),
 primary key(tenant_id,id), foreign key(tenant_id,client_id) references lkz_vnext.clients(tenant_id,id)
);
create index client_contacts_recent on lkz_vnext.client_contacts(tenant_id,client_id,created_at desc);
create table lkz_vnext.crm_message_versions (
 tenant_id uuid not null references lkz_vnext.tenants(id), id uuid not null,
 revision int not null check(revision>0),
 title text not null check(length(btrim(title)) between 1 and 80),
 body text not null check(length(btrim(body)) between 1 and 1000),
 active boolean not null, actor_id uuid not null default auth.uid(), created_at timestamptz not null default now(),
 primary key(tenant_id,id,revision)
);
do $$
declare resource text; writers text[];
begin
 foreach resource in array array['client_relationships','client_contacts','crm_message_versions'] loop
   writers := case when resource='crm_message_versions' then array['admin'] else array['admin','operator'] end;
   execute format('alter table lkz_vnext.%I enable row level security',resource);
   execute format('revoke all on lkz_vnext.%I from public,anon,authenticated',resource);
   execute format('grant select on lkz_vnext.%I to authenticated',resource);
   execute format('create policy crm_read on lkz_vnext.%I for select to authenticated using (lkz_vnext.has_access(tenant_id,array[''admin'',''operator'']))',resource);
   execute format('create policy crm_insert on lkz_vnext.%I for insert to authenticated with check (lkz_vnext.has_access(tenant_id,%L::text[]))',resource,writers);
   execute format('create trigger crm_audit after insert or update on lkz_vnext.%I for each row execute function lkz_vnext.audit_crm_change()',resource);
 end loop;
end $$;
grant insert(tenant_id,id,phone,contact_name,segment,preferred_channel,whatsapp_permission,email_permission,permission_source,followup_on,notes) on lkz_vnext.client_relationships to authenticated;
grant update(phone,contact_name,segment,preferred_channel,whatsapp_permission,email_permission,permission_source,followup_on,notes,revision,updated_at) on lkz_vnext.client_relationships to authenticated;
create policy crm_update on lkz_vnext.client_relationships for update to authenticated
using(lkz_vnext.has_access(tenant_id,array['admin','operator']))
with check(lkz_vnext.has_access(tenant_id,array['admin','operator']));
grant insert(tenant_id,id,client_id,channel,note) on lkz_vnext.client_contacts to authenticated;
grant insert(tenant_id,id,revision,title,body,active) on lkz_vnext.crm_message_versions to authenticated;
commit;
