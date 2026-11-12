-- Dossiê interno pré-assinatura. Nunca registra aceite, pagamento ou provisionamento.
create table lkz_adm_private.signature_dossiers (
 id uuid primary key default gen_random_uuid(),
 quote_id uuid not null unique references lkz_adm_private.client_quotes(id) on delete restrict,
 contact_id uuid not null references public.contacts(id) on delete restrict,
 request_id uuid not null unique,
 terms_version text not null check(terms_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
 document_ref text not null check(document_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$' and document_ref !~* '^https?://'),
 document_sha256 text not null check(document_sha256 ~ '^[0-9a-f]{64}$' and document_sha256 <> repeat('0',64)),
 operator_attested boolean not null default true check(operator_attested=true),
 status text not null default 'prepared' check(status in ('prepared','void')),
 prepared_by uuid not null references auth.users(id),
 prepared_at timestamptz not null default clock_timestamp(),
 voided_at timestamptz,
 voided_by uuid references auth.users(id),
 void_reason text,
 void_request_id uuid unique,
 signature_enabled boolean not null default false check(signature_enabled=false),
 signer_identity_verified boolean not null default false check(signer_identity_verified=false),
 customer_accepted boolean not null default false check(customer_accepted=false),
 payment_confirmed boolean not null default false check(payment_confirmed=false),
 billing_enabled boolean not null default false check(billing_enabled=false),
 provisioning_enabled boolean not null default false check(provisioning_enabled=false),
 constraint dossiers_void_consistency check(
  (status='prepared' and voided_at is null and voided_by is null and void_reason is null and void_request_id is null)
  or (status='void' and voided_at is not null and voided_by is not null and char_length(void_reason) between 5 and 500 and void_request_id is not null)
 )
);
create index signature_dossiers_contact_idx on lkz_adm_private.signature_dossiers(contact_id,prepared_at desc);
alter table lkz_adm_private.signature_dossiers enable row level security;
revoke all on table lkz_adm_private.signature_dossiers from public,anon,authenticated;

create function lkz_adm_private.list_signature_dossiers(p_contact uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_draft_version integer:=0;
begin
 if not lkz_adm_private.is_operator() or auth.uid() is null then
  raise exception 'Operador com MFA necessário.' using errcode='42501';
 end if;
 if p_contact is null or not exists(select 1 from public.contacts where id=p_contact) then
  raise exception 'Cliente inexistente.' using errcode='22023';
 end if;
 select version into v_draft_version from lkz_adm_private.client_contract_drafts where contact_id=p_contact;
 return jsonb_build_object(
  'signature_enabled',false,'customer_accepted',false,
  'billing_enabled',false,'provisioning_enabled',false,
  'quotes',coalesce((
   select jsonb_agg(jsonb_build_object(
     'id',q.id,'draft_version',q.draft_version,'status',q.status,
     'current',q.draft_version=coalesce(v_draft_version,0),
     'eligible',q.status='prepared' and q.draft_version=coalesce(v_draft_version,0) and d.id is null,
     'dossier',case when d.id is null then null else jsonb_build_object(
       'id',d.id,'status',d.status,'terms_version',d.terms_version,
       'document_ref',d.document_ref,'document_sha256',d.document_sha256,
       'prepared_at',d.prepared_at,'void_reason',d.void_reason,
       'signature_enabled',false,'customer_accepted',false,
       'billing_enabled',false,'provisioning_enabled',false) end
   ) order by q.prepared_at desc,q.id desc)
   from (select * from lkz_adm_private.client_quotes
     where contact_id=p_contact order by prepared_at desc,id desc limit 30)q
   left join lkz_adm_private.signature_dossiers d on d.quote_id=q.id
  ),'[]'::jsonb)
 );
end $$;

create function lkz_adm_private.prepare_signature_dossier(
 p_quote uuid,p_request_id uuid,p_terms_version text,p_document_ref text,
 p_document_sha256 text,p_operator_attested boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 q lkz_adm_private.client_quotes%rowtype;
 d lkz_adm_private.signature_dossiers%rowtype;
 v_version text:=btrim(coalesce(p_terms_version,''));
 v_ref text:=btrim(coalesce(p_document_ref,''));
 v_digest text:=lower(btrim(coalesce(p_document_sha256,'')));
 v_draft_version integer;
begin
 if not lkz_adm_private.is_master() or auth.uid() is null then
  raise exception 'MASTER com MFA necessário.' using errcode='42501';
 end if;
 if p_quote is null or p_request_id is null or
   p_request_id='00000000-0000-0000-0000-000000000000'::uuid or
   p_operator_attested is distinct from true or
   v_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$' or
   v_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,119}$' or
   v_ref ~* '^https?://' or
   v_digest !~ '^[0-9a-f]{64}$' or v_digest=repeat('0',64) then
  raise exception 'Versão, referência ou SHA-256 inválidos.' using errcode='22023';
 end if;
 select * into q from lkz_adm_private.client_quotes where id=p_quote for share;
 if not found then raise exception 'Proposta inexistente.' using errcode='22023';end if;
 select * into d from lkz_adm_private.signature_dossiers where request_id=p_request_id;
 if found then
  if d.quote_id is distinct from p_quote or d.prepared_by is distinct from auth.uid() or
    d.terms_version is distinct from v_version or d.document_ref is distinct from v_ref or
    d.document_sha256 is distinct from v_digest then
    raise exception 'Identificador já utilizado com outros dados.' using errcode='40001';
  end if;
  return jsonb_build_object('id',d.id,'status',d.status,'already_recorded',true,
    'signature_enabled',false,'customer_accepted',false,'billing_enabled',false,'provisioning_enabled',false);
 end if;
 select version into v_draft_version from lkz_adm_private.client_contract_drafts
  where id=q.contract_id for share;
 if q.status<>'prepared' or q.draft_version is distinct from v_draft_version then
   raise exception 'Proposta cancelada ou desatualizada.' using errcode='40001';
 end if;
 insert into lkz_adm_private.signature_dossiers(
  quote_id,contact_id,request_id,terms_version,document_ref,document_sha256,prepared_by)
 values(p_quote,q.contact_id,p_request_id,v_version,v_ref,v_digest,auth.uid())
 on conflict do nothing returning * into d;
 if not found then
  select * into d from lkz_adm_private.signature_dossiers where request_id=p_request_id;
  if found and d.quote_id=p_quote and d.prepared_by=auth.uid() and
    d.terms_version=v_version and d.document_ref=v_ref and d.document_sha256=v_digest then
    return jsonb_build_object('id',d.id,'status',d.status,'already_recorded',true,
      'signature_enabled',false,'customer_accepted',false,'billing_enabled',false,'provisioning_enabled',false);
  end if;
  raise exception 'Já existe dossiê nesta proposta. Gere uma nova versão da minuta e proposta.' using errcode='40001';
 end if;
 insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
 values(auth.uid(),q.contact_id,'commercial.signature_dossier.prepare',
  jsonb_build_object('dossier_id',d.id,'quote_id',q.id,'terms_version',v_version));
 return jsonb_build_object('id',d.id,'status','prepared','already_recorded',false,
  'signature_enabled',false,'customer_accepted',false,'billing_enabled',false,'provisioning_enabled',false);
end $$;

create function lkz_adm_private.void_signature_dossier(
 p_dossier uuid,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 d lkz_adm_private.signature_dossiers%rowtype;
 v_reason text:=btrim(coalesce(p_reason,''));
begin
 if not lkz_adm_private.is_master() or auth.uid() is null then
  raise exception 'MASTER com MFA necessário.' using errcode='42501';
 end if;
 if p_dossier is null or p_request_id is null or
   p_request_id='00000000-0000-0000-0000-000000000000'::uuid or
   char_length(v_reason) not between 5 and 500 or v_reason ~ '[[:cntrl:]]' then
  raise exception 'Justificativa inválida.' using errcode='22023';
 end if;
 select * into d from lkz_adm_private.signature_dossiers where id=p_dossier for update;
 if not found then raise exception 'Dossiê inexistente.' using errcode='22023';end if;
 if d.status='void' then
  if d.void_request_id=p_request_id and d.voided_by=auth.uid() and d.void_reason=v_reason then
   return jsonb_build_object('id',d.id,'status','void','already_recorded',true,
    'signature_enabled',false,'customer_accepted',false);
  end if;
  raise exception 'Dossiê já invalidado.' using errcode='40001';
 end if;
 if exists(select 1 from lkz_adm_private.signature_dossiers where void_request_id=p_request_id) then
  raise exception 'Identificador reutilizado.' using errcode='40001';
 end if;
 update lkz_adm_private.signature_dossiers set status='void',
  void_reason=v_reason,void_request_id=p_request_id,voided_by=auth.uid(),voided_at=clock_timestamp()
 where id=p_dossier;
 insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
 values(auth.uid(),d.contact_id,'commercial.signature_dossier.void',
  jsonb_build_object('dossier_id',d.id,'quote_id',d.quote_id));
 return jsonb_build_object('id',d.id,'status','void','already_recorded',false,
  'signature_enabled',false,'customer_accepted',false);
end $$;

create function public.lkz_adm_list_signature_dossiers(p_contact uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select lkz_adm_private.list_signature_dossiers(p_contact);
$$;
create function public.lkz_adm_prepare_signature_dossier(
 p_quote uuid,p_request_id uuid,p_terms_version text,p_document_ref text,
 p_document_sha256 text,p_operator_attested boolean
) returns jsonb language sql security invoker set search_path='' as $$
 select lkz_adm_private.prepare_signature_dossier(
  p_quote,p_request_id,p_terms_version,p_document_ref,p_document_sha256,p_operator_attested);
$$;
create function public.lkz_adm_void_signature_dossier(
 p_dossier uuid,p_reason text,p_request_id uuid
) returns jsonb language sql security invoker set search_path='' as $$
 select lkz_adm_private.void_signature_dossier(p_dossier,p_reason,p_request_id);
$$;
revoke all on function
 lkz_adm_private.list_signature_dossiers(uuid),
 lkz_adm_private.prepare_signature_dossier(uuid,uuid,text,text,text,boolean),
 lkz_adm_private.void_signature_dossier(uuid,text,uuid),
 public.lkz_adm_list_signature_dossiers(uuid),
 public.lkz_adm_prepare_signature_dossier(uuid,uuid,text,text,text,boolean),
 public.lkz_adm_void_signature_dossier(uuid,text,uuid)
 from public,anon,authenticated;
grant execute on function
 lkz_adm_private.list_signature_dossiers(uuid),
 lkz_adm_private.prepare_signature_dossier(uuid,uuid,text,text,text,boolean),
 lkz_adm_private.void_signature_dossier(uuid,text,uuid),
 public.lkz_adm_list_signature_dossiers(uuid),
 public.lkz_adm_prepare_signature_dossier(uuid,uuid,text,text,text,boolean),
 public.lkz_adm_void_signature_dossier(uuid,text,uuid)
 to authenticated;
