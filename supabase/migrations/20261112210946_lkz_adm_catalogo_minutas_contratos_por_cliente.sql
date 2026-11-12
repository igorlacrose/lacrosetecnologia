-- Minutas comerciais por cliente no LKZ ADM (sem provisionamento ou cobrança).
create table if not exists lkz_adm_private.commercial_products(
 code text primary key check(code ~ '^[A-Z0-9_]{2,32}$'),
 name text not null check(char_length(btrim(name)) between 3 and 100),
 description text not null default '',
 selectable boolean not null default true,
 delivery_state text not null default 'requires_manual_review'
  check(delivery_state in ('requires_manual_review','unavailable')),
 sort_order smallint not null default 100
);
insert into lkz_adm_private.commercial_products(code,name,description,sort_order)
values
 ('OCA','OCA — Operador Comercial Autônomo','Automação comercial com inteligência artificial',10),
 ('LKZ_ERP','LKZ ERP','Gestão comercial, estoque e caixa',20),
 ('LIBERTY_OS','LibertyOS','Gestão de salão e estética',30),
 ('BARBAR_OS','BarbarOS','Solução de gestão para barbearias',40),
 ('LISP','LKZ ISP Intelligence','Indicadores e processos para provedores',50),
 ('LCRM','Lacrose CRM','Gestão de clientes e oportunidades',60),
 ('LKZ_SST','LKZ SST','Gestão de saúde e segurança do trabalho',70)
on conflict(code) do nothing;
create table if not exists lkz_adm_private.client_contract_drafts (
 id uuid primary key default gen_random_uuid(),
 contact_id uuid not null unique references public.contacts(id) on delete restrict,
 status text not null default 'draft' check(status='draft'),
 currency text not null default 'BRL' check(currency='BRL'),
 version integer not null default 1 check(version>0),
 created_by uuid not null references auth.users(id),
 updated_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 last_request_id uuid not null,
 last_request_payload jsonb not null default '[]'::jsonb,
 billing_enabled boolean not null default false check(billing_enabled=false),
 provisioning_enabled boolean not null default false check(provisioning_enabled=false)
);
create unique index if not exists contract_drafts_request_id_unique
 on lkz_adm_private.client_contract_drafts(last_request_id);
create table if not exists lkz_adm_private.client_contract_draft_items (
 contract_id uuid not null references lkz_adm_private.client_contract_drafts(id) on delete cascade,
 product_code text not null references lkz_adm_private.commercial_products(code),
 setup_cents integer not null default 0 check(setup_cents between 0 and 100000000),
 recurring_cents integer not null default 0 check(recurring_cents between 0 and 100000000),
 billing_interval text not null default 'none' check(billing_interval in ('none','monthly','yearly')),
 primary key(contract_id,product_code),
 constraint recurring_interval_consistency check(
  (billing_interval='none' and recurring_cents=0) or billing_interval in ('monthly','yearly')
 )
);
create index if not exists contract_drafts_updated
 on lkz_adm_private.client_contract_drafts(updated_at desc);
alter table lkz_adm_private.commercial_products enable row level security;
alter table lkz_adm_private.client_contract_drafts enable row level security;
alter table lkz_adm_private.client_contract_draft_items enable row level security;
revoke all on table lkz_adm_private.commercial_products,
 lkz_adm_private.client_contract_drafts,
 lkz_adm_private.client_contract_draft_items
from public,anon,authenticated;

CREATE OR REPLACE FUNCTION lkz_adm_private.catalog_and_contract(p_contact uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_contract lkz_adm_private.client_contract_drafts%rowtype;
begin
 if not lkz_adm_private.is_operator() or auth.uid() is null then
  raise exception 'Acesso administrativo com MFA obrigatório.' using errcode='42501';
 end if;
 if p_contact is not null and not exists(select 1 from public.contacts where id=p_contact) then
  raise exception 'Cliente inexistente.' using errcode='22023';
 end if;
 if p_contact is not null then
  select * into v_contract from lkz_adm_private.client_contract_drafts where contact_id=p_contact;
 end if;
 return jsonb_build_object(
  'catalog',coalesce((select jsonb_agg(jsonb_build_object(
    'code',p.code,'name',p.name,'description',p.description,
    'selectable',p.selectable,'delivery_state',p.delivery_state
  ) order by p.sort_order,p.code)
   from lkz_adm_private.commercial_products p),'[]'::jsonb),
  'contract',case when v_contract.id is null then
    jsonb_build_object('status','none','version',0,'items','[]'::jsonb,
      'billing_enabled',false,'provisioning_enabled',false)
  else jsonb_build_object('id',v_contract.id,'status','draft','version',v_contract.version,
    'updated_at',v_contract.updated_at,'billing_enabled',false,'provisioning_enabled',false,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
       'code',i.product_code,'setup_cents',i.setup_cents,
       'recurring_cents',i.recurring_cents,'billing_interval',i.billing_interval
    ) order by p.sort_order,p.code)
    from lkz_adm_private.client_contract_draft_items i
    join lkz_adm_private.commercial_products p on p.code=i.product_code
    where i.contract_id=v_contract.id),'[]'::jsonb))
  end
 );
end $function$;

CREATE OR REPLACE FUNCTION lkz_adm_private.create_client_with_draft(p_id uuid, p_conversation uuid, p_expected_lead uuid, p_company text, p_name text, p_segment text, p_email text, p_phone text, p_city text, p_state text, p_items jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_client jsonb;v_contract jsonb;
begin
 if not lkz_adm_private.is_operator() or auth.uid() is null then
  raise exception 'Acesso administrativo com MFA obrigatório.' using errcode='42501';
 end if;
 if p_conversation is not null then
  if p_expected_lead is null then raise exception 'Oportunidade obrigatória.' using errcode='22023';end if;
  v_client:=lkz_adm_private.create_client_for_conversation(
    p_id,p_conversation,p_expected_lead,p_company,p_name,p_segment,p_email,p_phone,p_city,p_state);
 else
  if p_expected_lead is not null then raise exception 'Atendimento ausente.' using errcode='22023';end if;
  v_client:=lkz_adm_private.create_client(
    p_id,p_company,p_name,p_segment,p_email,p_phone,p_city,p_state);
 end if;
 v_contract:=lkz_adm_private.save_client_draft_items(p_id,p_items,0,p_request_id);
 return v_client||jsonb_build_object('contract_draft',v_contract);
end $function$;

CREATE OR REPLACE FUNCTION lkz_adm_private.edit_client_with_draft(p_id uuid, p_version timestamp with time zone, p_company text, p_name text, p_segment text, p_email text, p_phone text, p_city text, p_state text, p_items jsonb, p_contract_version integer, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_client jsonb;v_contract jsonb;
begin
 if not lkz_adm_private.is_operator() or auth.uid() is null then
  raise exception 'Acesso administrativo com MFA obrigatório.' using errcode='42501';
 end if;
 v_client:=lkz_adm_private.edit_client(
   p_id,p_version,p_company,p_name,p_segment,p_email,p_phone,p_city,p_state);
 v_contract:=lkz_adm_private.save_client_draft_items(
   p_id,p_items,p_contract_version,p_request_id);
 return v_client||jsonb_build_object('contract_draft',v_contract);
end $function$;

CREATE OR REPLACE FUNCTION lkz_adm_private.save_client_draft_items(p_contact uuid, p_items jsonb, p_expected_version integer, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_contract lkz_adm_private.client_contract_drafts%rowtype;
 v_item jsonb; v_code text;v_setup int;v_recurring int;v_interval text;
 v_codes text[]:='{}'::text[];v_idx integer:=0;v_new boolean:=false;
begin
 if not lkz_adm_private.is_operator() or auth.uid() is null then
  raise exception 'Acesso administrativo com MFA obrigatório.' using errcode='42501';
 end if;
 if p_contact is null or p_request_id is null or
  p_request_id='00000000-0000-0000-0000-000000000000'::uuid
  or p_expected_version is null or p_expected_version<0 or
  p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>20 then
  raise exception 'Parâmetros da minuta inválidos.' using errcode='22023';
 end if;
 perform 1 from public.contacts where id=p_contact for update;
 if not found then raise exception 'Cliente inexistente.' using errcode='22023';end if;
 -- Prevent any unrelated client reusing the same retry token.
 if exists (select 1 from lkz_adm_private.client_contract_drafts
   where last_request_id=p_request_id and contact_id<>p_contact) then
  raise exception 'Identificador de alteração já utilizado.' using errcode='40001';
 end if;
 select * into v_contract from lkz_adm_private.client_contract_drafts
    where contact_id=p_contact for update;
 if found and v_contract.last_request_id=p_request_id then
  if v_contract.last_request_payload is distinct from p_items or
    v_contract.updated_by is distinct from auth.uid() then
    raise exception 'Retentativa incompatível com solicitação anterior.' using errcode='40001';
  end if;
  return lkz_adm_private.catalog_and_contract(p_contact)->'contract';
 end if;
 if (v_contract.id is null and p_expected_version<>0) or
  (v_contract.id is not null and v_contract.version<>p_expected_version) then
  raise exception 'Minuta alterada em outra sessão. Recarregue.' using errcode='40001';
 end if;

 -- Strict types and ranges; never trust pricing or catalog values from the browser.
 for v_item in select value from jsonb_array_elements(p_items)
 loop
  v_idx:=v_idx+1;
  if jsonb_typeof(v_item)<>'object' or
     jsonb_typeof(v_item->'code')<>'string' or
     jsonb_typeof(v_item->'setup_cents')<>'number' or
     jsonb_typeof(v_item->'recurring_cents')<>'number' or
     jsonb_typeof(v_item->'billing_interval')<>'string' then
    raise exception 'Produto ou preço com formato inválido.' using errcode='22023';
  end if;
  v_code:=v_item->>'code';v_interval:=v_item->>'billing_interval';
  if v_code !~ '^[A-Z0-9_]{2,32}$' or v_code=any(v_codes) or
     (v_item->>'setup_cents') !~ '^[0-9]{1,9}$' or
     (v_item->>'recurring_cents') !~ '^[0-9]{1,9}$' or
     v_interval not in ('none','monthly','yearly') then
    raise exception 'Seleção comercial inválida ou duplicada.' using errcode='22023';
  end if;
  v_setup:=(v_item->>'setup_cents')::integer;
  v_recurring:=(v_item->>'recurring_cents')::integer;
  if v_setup>100000000 or v_recurring>100000000 or
    (v_interval='none' and v_recurring<>0) or
    not exists(select 1 from lkz_adm_private.commercial_products
       where code=v_code and selectable) then
    raise exception 'Produto indisponível ou condição financeira inválida.' using errcode='22023';
  end if;
  v_codes:=array_append(v_codes,v_code);
 end loop;

 if v_contract.id is null then
  insert into lkz_adm_private.client_contract_drafts(
    contact_id,created_by,updated_by,last_request_id,last_request_payload)
  values(p_contact,auth.uid(),auth.uid(),p_request_id,p_items)
  returning * into v_contract;
  v_new:=true;
 else
  delete from lkz_adm_private.client_contract_draft_items where contract_id=v_contract.id;
  update lkz_adm_private.client_contract_drafts set
    version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid(),
    last_request_id=p_request_id,last_request_payload=p_items
  where id=v_contract.id returning * into v_contract;
 end if;
 for v_item in select value from jsonb_array_elements(p_items)
 loop
  insert into lkz_adm_private.client_contract_draft_items(
    contract_id,product_code,setup_cents,recurring_cents,billing_interval)
  values(v_contract.id,v_item->>'code',
      (v_item->>'setup_cents')::integer,
      (v_item->>'recurring_cents')::integer,
      v_item->>'billing_interval');
 end loop;
 insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
 values(auth.uid(),p_contact,'commercial.contract_draft.save',
   jsonb_build_object('version',v_contract.version,'product_codes',to_jsonb(v_codes),
     'created',v_new,'billing_enabled',false,'provisioning_enabled',false));
 return lkz_adm_private.catalog_and_contract(p_contact)->'contract';
end $function$;

CREATE OR REPLACE FUNCTION public.lkz_adm_catalog_and_contract(p_contact uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select lkz_adm_private.catalog_and_contract(p_contact);
$function$;

CREATE OR REPLACE FUNCTION public.lkz_adm_create_client_with_draft(p_id uuid, p_conversation uuid, p_expected_lead uuid, p_company text, p_name text, p_segment text, p_email text, p_phone text, p_city text, p_state text, p_items jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select lkz_adm_private.create_client_with_draft(
 p_id,p_conversation,p_expected_lead,p_company,p_name,p_segment,p_email,p_phone,
 p_city,p_state,p_items,p_request_id);
$function$;

CREATE OR REPLACE FUNCTION public.lkz_adm_edit_client_with_draft(p_id uuid, p_version timestamp with time zone, p_company text, p_name text, p_segment text, p_email text, p_phone text, p_city text, p_state text, p_items jsonb, p_contract_version integer, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select lkz_adm_private.edit_client_with_draft(
 p_id,p_version,p_company,p_name,p_segment,p_email,p_phone,p_city,p_state,
 p_items,p_contract_version,p_request_id);
$function$;

revoke all on function
 lkz_adm_private.catalog_and_contract(uuid),
 lkz_adm_private.save_client_draft_items(uuid,jsonb,integer,uuid),
 lkz_adm_private.create_client_with_draft(uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb,uuid),
 lkz_adm_private.edit_client_with_draft(uuid,timestamptz,text,text,text,text,text,text,text,jsonb,integer,uuid),
 public.lkz_adm_catalog_and_contract(uuid),
 public.lkz_adm_create_client_with_draft(uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb,uuid),
 public.lkz_adm_edit_client_with_draft(uuid,timestamptz,text,text,text,text,text,text,text,jsonb,integer,uuid) from public,anon,authenticated;
grant execute on function
 lkz_adm_private.catalog_and_contract(uuid),
 lkz_adm_private.save_client_draft_items(uuid,jsonb,integer,uuid),
 lkz_adm_private.create_client_with_draft(uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb,uuid),
 lkz_adm_private.edit_client_with_draft(uuid,timestamptz,text,text,text,text,text,text,text,jsonb,integer,uuid),
 public.lkz_adm_catalog_and_contract(uuid),
 public.lkz_adm_create_client_with_draft(uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb,uuid),
 public.lkz_adm_edit_client_with_draft(uuid,timestamptz,text,text,text,text,text,text,text,jsonb,integer,uuid) to authenticated;
