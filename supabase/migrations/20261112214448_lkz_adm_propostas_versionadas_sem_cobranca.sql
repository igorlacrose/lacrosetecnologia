-- LKZ ADM • propostas internas versionadas; sem aceite, cobrança ou provisionamento.
-- Cada proposta é um snapshot imutável de itens e preços de uma versão de minuta.
create table lkz_adm_private.client_quotes (
 id uuid primary key,
 request_id uuid not null unique,
 contact_id uuid not null references public.contacts(id) on delete restrict,
 contract_id uuid not null references lkz_adm_private.client_contract_drafts(id) on delete restrict,
 draft_version integer not null check(draft_version>0),
 items_snapshot jsonb not null check(jsonb_typeof(items_snapshot)='array'
   and jsonb_array_length(items_snapshot) between 1 and 20),
 setup_total_cents bigint not null check(setup_total_cents between 0 and 2000000000),
 monthly_total_cents bigint not null check(monthly_total_cents between 0 and 2000000000),
 yearly_total_cents bigint not null check(yearly_total_cents between 0 and 2000000000),
 status text not null default 'prepared' check(status in ('prepared','cancelled')),
 prepared_by uuid not null references auth.users(id),
 prepared_at timestamptz not null default clock_timestamp(),
 cancelled_at timestamptz,
 cancelled_by uuid references auth.users(id),
 cancel_reason text,
 cancel_request_id uuid unique,
 currency text not null default 'BRL' check(currency='BRL'),
 billing_enabled boolean not null default false check(billing_enabled=false),
 provisioning_enabled boolean not null default false check(provisioning_enabled=false),
 customer_accepted boolean not null default false check(customer_accepted=false),
 constraint quotes_cancellation_consistent check (
  (status='prepared' and cancelled_at is null and cancelled_by is null
   and cancel_reason is null and cancel_request_id is null)
  or (status='cancelled' and cancelled_at is not null and cancelled_by is not null
   and char_length(cancel_reason) between 5 and 500 and cancel_request_id is not null)
 )
);
create unique index client_quotes_unique_version
 on lkz_adm_private.client_quotes(contact_id,draft_version);
create index client_quotes_contact_date
 on lkz_adm_private.client_quotes(contact_id,prepared_at desc);
alter table lkz_adm_private.client_quotes enable row level security;
revoke all on lkz_adm_private.client_quotes from public,anon,authenticated;

create function lkz_adm_private.list_client_quotes(p_contact uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_version integer:=0;v_count integer:=0;
begin
 if not lkz_adm_private.is_operator() or auth.uid() is null then
   raise exception 'Sessão administrativa com MFA obrigatória.' using errcode='42501';
 end if;
 if p_contact is null or not exists(select 1 from public.contacts where id=p_contact) then
   raise exception 'Cliente não encontrado.' using errcode='22023';
 end if;
 select d.version,(select count(*) from lkz_adm_private.client_contract_draft_items
   where contract_id=d.id)
 into v_version,v_count
 from lkz_adm_private.client_contract_drafts d where d.contact_id=p_contact;
 return jsonb_build_object(
  'draft_version',coalesce(v_version,0),
  'draft_item_count',coalesce(v_count,0),
  'billing_enabled',false,'provisioning_enabled',false,
  'customer_acceptance_enabled',false,
  'quotes',coalesce((select jsonb_agg(jsonb_build_object(
    'id',q.id,'draft_version',q.draft_version,'status',q.status,
    'items',q.items_snapshot,'prepared_at',q.prepared_at,
    'current_draft',q.draft_version=coalesce(v_version,0),
    'setup_total_cents',q.setup_total_cents,
    'monthly_total_cents',q.monthly_total_cents,
    'yearly_total_cents',q.yearly_total_cents,
    'cancelled_at',q.cancelled_at,'cancel_reason',q.cancel_reason,
    'billing_enabled',false,'provisioning_enabled',false,
    'customer_accepted',false
  ) order by q.prepared_at desc,q.id desc)
  from (select * from lkz_adm_private.client_quotes
    where contact_id=p_contact order by prepared_at desc,id desc limit 30)q),'[]'::jsonb)
 );
end $$;

create function lkz_adm_private.prepare_client_quote(
 p_contact uuid,p_expected_version integer,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 d lkz_adm_private.client_contract_drafts%rowtype;
 q lkz_adm_private.client_quotes%rowtype;
 v_items jsonb;v_setup bigint;v_monthly bigint;v_yearly bigint;
begin
 if not lkz_adm_private.is_master() or auth.uid() is null then
   raise exception 'Somente MASTER com MFA pode preparar propostas.' using errcode='42501';
 end if;
 if p_contact is null or p_request_id is null or
   p_request_id='00000000-0000-0000-0000-000000000000'::uuid or
   p_expected_version is null or p_expected_version<1 then
   raise exception 'Solicitação de proposta inválida.' using errcode='22023';
 end if;
 select * into q from lkz_adm_private.client_quotes where request_id=p_request_id;
 if found then
   if q.contact_id is distinct from p_contact or
     q.draft_version is distinct from p_expected_version or
     q.prepared_by is distinct from auth.uid() then
     raise exception 'Identificador já utilizado com outra solicitação.' using errcode='40001';
   end if;
   return jsonb_build_object('id',q.id,'status',q.status,'already_recorded',true,
     'billing_enabled',false,'provisioning_enabled',false,'customer_accepted',false);
 end if;

 perform 1 from public.contacts where id=p_contact for share;
 if not found then raise exception 'Cliente inexistente.' using errcode='22023';end if;
 select * into d from lkz_adm_private.client_contract_drafts
   where contact_id=p_contact for share;
 if not found or d.version<>p_expected_version then
   raise exception 'Minuta mudou ou não existe. Atualize a ficha.' using errcode='40001';
 end if;
 select jsonb_agg(jsonb_build_object(
   'code',i.product_code,'name',p.name,'setup_cents',i.setup_cents,
   'recurring_cents',i.recurring_cents,'billing_interval',i.billing_interval)
   order by p.sort_order,p.code),
   coalesce(sum(i.setup_cents),0)::bigint,
   coalesce(sum(i.recurring_cents) filter(where i.billing_interval='monthly'),0)::bigint,
   coalesce(sum(i.recurring_cents) filter(where i.billing_interval='yearly'),0)::bigint
 into v_items,v_setup,v_monthly,v_yearly
 from lkz_adm_private.client_contract_draft_items i
 join lkz_adm_private.commercial_products p on p.code=i.product_code
 where i.contract_id=d.id;
 if v_items is null or jsonb_array_length(v_items)=0 then
   raise exception 'Selecione e salve ao menos um sistema antes da proposta.' using errcode='22023';
 end if;
 insert into lkz_adm_private.client_quotes(
   id,request_id,contact_id,contract_id,draft_version,items_snapshot,
   setup_total_cents,monthly_total_cents,yearly_total_cents,prepared_by)
 values(gen_random_uuid(),p_request_id,p_contact,d.id,d.version,v_items,
   v_setup,v_monthly,v_yearly,auth.uid())
 on conflict do nothing returning * into q;
 if not found then
   select * into q from lkz_adm_private.client_quotes
     where request_id=p_request_id;
   if found and q.contact_id=p_contact and
     q.draft_version=p_expected_version and q.prepared_by=auth.uid() then
     return jsonb_build_object('id',q.id,'status',q.status,'already_recorded',true,
       'billing_enabled',false,'provisioning_enabled',false,'customer_accepted',false);
   end if;
   raise exception 'Já existe proposta para esta versão. Altere a minuta para gerar outra.'
     using errcode='40001';
 end if;
 insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
 values(auth.uid(),p_contact,'commercial.quote.prepare',
   jsonb_build_object('quote_id',q.id,'draft_version',q.draft_version,
      'product_codes', (select jsonb_agg(x->>'code') from jsonb_array_elements(v_items)x)));
 return jsonb_build_object('id',q.id,'status','prepared','already_recorded',false,
    'billing_enabled',false,'provisioning_enabled',false,'customer_accepted',false);
end $$;

create function lkz_adm_private.cancel_client_quote(
 p_quote uuid,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare q lkz_adm_private.client_quotes%rowtype;
 v_reason text:=btrim(coalesce(p_reason,''));
begin
 if not lkz_adm_private.is_master() or auth.uid() is null then
   raise exception 'Somente MASTER com MFA pode cancelar propostas.' using errcode='42501';
 end if;
 if p_quote is null or p_request_id is null or
   p_request_id='00000000-0000-0000-0000-000000000000'::uuid or
   char_length(v_reason) not between 5 and 500 or
   v_reason ~ '[[:cntrl:]]' then
   raise exception 'Cancelamento inválido.' using errcode='22023';
 end if;
 select * into q from lkz_adm_private.client_quotes where id=p_quote for update;
 if not found then raise exception 'Proposta não encontrada.' using errcode='22023';end if;
 if q.status='cancelled' then
   if q.cancel_request_id=p_request_id and q.cancelled_by=auth.uid()
      and q.cancel_reason=v_reason then
     return jsonb_build_object('id',q.id,'status','cancelled','already_recorded',true,
       'billing_enabled',false,'provisioning_enabled',false,'customer_accepted',false);
   end if;
   raise exception 'Proposta já cancelada em outra operação.' using errcode='40001';
 end if;
 if exists(select 1 from lkz_adm_private.client_quotes
   where cancel_request_id=p_request_id and id<>p_quote) then
   raise exception 'Identificador de cancelamento reutilizado.' using errcode='40001';
 end if;
 update lkz_adm_private.client_quotes set status='cancelled',
   cancelled_at=clock_timestamp(),cancelled_by=auth.uid(),
   cancel_reason=v_reason,cancel_request_id=p_request_id where id=p_quote;
 insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
 values(auth.uid(),q.contact_id,'commercial.quote.cancel',
   jsonb_build_object('quote_id',p_quote,'draft_version',q.draft_version));
 return jsonb_build_object('id',p_quote,'status','cancelled','already_recorded',false,
   'billing_enabled',false,'provisioning_enabled',false,'customer_accepted',false);
end $$;

create function public.lkz_adm_list_client_quotes(p_contact uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select lkz_adm_private.list_client_quotes(p_contact);
$$;
create function public.lkz_adm_prepare_client_quote(
 p_contact uuid,p_expected_version integer,p_request_id uuid
) returns jsonb language sql security invoker set search_path='' as $$
 select lkz_adm_private.prepare_client_quote(p_contact,p_expected_version,p_request_id);
$$;
create function public.lkz_adm_cancel_client_quote(
 p_quote uuid,p_reason text,p_request_id uuid
) returns jsonb language sql security invoker set search_path='' as $$
 select lkz_adm_private.cancel_client_quote(p_quote,p_reason,p_request_id);
$$;
revoke all on function
 lkz_adm_private.list_client_quotes(uuid),
 lkz_adm_private.prepare_client_quote(uuid,integer,uuid),
 lkz_adm_private.cancel_client_quote(uuid,text,uuid),
 public.lkz_adm_list_client_quotes(uuid),
 public.lkz_adm_prepare_client_quote(uuid,integer,uuid),
 public.lkz_adm_cancel_client_quote(uuid,text,uuid)
from public,anon,authenticated;
grant execute on function
 lkz_adm_private.list_client_quotes(uuid),
 lkz_adm_private.prepare_client_quote(uuid,integer,uuid),
 lkz_adm_private.cancel_client_quote(uuid,text,uuid),
 public.lkz_adm_list_client_quotes(uuid),
 public.lkz_adm_prepare_client_quote(uuid,integer,uuid),
 public.lkz_adm_cancel_client_quote(uuid,text,uuid)
to authenticated;