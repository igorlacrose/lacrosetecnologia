-- LKZ ADM — minuta textual contratual interna, gerada e autenticada no banco.
-- Sem PDF, assinatura, aceite, cobrança, provisionamento, envio ou acesso público.
create table lkz_adm_private.contract_text_previews (
 id uuid primary key,
 quote_id uuid not null unique references lkz_adm_private.client_quotes(id) on delete restrict,
 contact_id uuid not null references public.contacts(id) on delete restrict,
 request_id uuid not null unique,
 draft_version integer not null check(draft_version>0),
 template_version text not null default 'lacrose-internal-2026-11'
   check(template_version='lacrose-internal-2026-11'),
 document_ref text not null unique,
 content_text text not null check(octet_length(content_text) between 250 and 32768),
 content_bytes integer not null check(content_bytes between 250 and 32768),
 content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 status text not null default 'internal_review' check(status='internal_review'),
 legal_approved boolean not null default false check(legal_approved=false),
 signature_enabled boolean not null default false check(signature_enabled=false),
 customer_accepted boolean not null default false check(customer_accepted=false),
 billing_enabled boolean not null default false check(billing_enabled=false),
 provisioning_enabled boolean not null default false check(provisioning_enabled=false)
);
create index contract_text_previews_contact_idx
 on lkz_adm_private.contract_text_previews(contact_id,created_at desc);
alter table lkz_adm_private.contract_text_previews enable row level security;
revoke all on table lkz_adm_private.contract_text_previews from public,anon,authenticated;

create function lkz_adm_private.reject_contract_text_modification()
returns trigger language plpgsql set search_path='' as $$
begin
 raise exception 'Minutas textuais registradas são imutáveis. Gere nova proposta.' using errcode='42501';
end $$;
create trigger contract_text_immutable
before update or delete on lkz_adm_private.contract_text_previews
for each row execute function lkz_adm_private.reject_contract_text_modification();

create function lkz_adm_private.list_contract_text_previews(p_contact uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_version integer:=0;
begin
 if not lkz_adm_private.is_operator() or auth.uid() is null then
  raise exception 'Sessão administrativa com MFA obrigatória.' using errcode='42501';
 end if;
 if p_contact is null or not exists(select 1 from public.contacts where id=p_contact) then
  raise exception 'Cliente não encontrado.' using errcode='22023';
 end if;
 select version into v_version from lkz_adm_private.client_contract_drafts
  where contact_id=p_contact;
 return jsonb_build_object(
  'legal_approved',false,'signature_enabled',false,'customer_accepted',false,
  'billing_enabled',false,'provisioning_enabled',false,
  'quotes',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',q.id,'draft_version',q.draft_version,'status',q.status,
      'current_draft',q.draft_version=coalesce(v_version,0),
      'can_prepare',q.status='prepared' and q.draft_version=coalesce(v_version,0)
        and a.id is null and d.id is null,
      'document',case when a.id is null then null else jsonb_build_object(
        'id',a.id,'document_ref',a.document_ref,'content_sha256',a.content_sha256,
        'content_bytes',a.content_bytes,'template_version',a.template_version,
        'status',a.status,'created_at',a.created_at,
        'legal_approved',false,'signature_enabled',false,'customer_accepted',false)
      end
    ) order by q.prepared_at desc,q.id desc)
    from (select * from lkz_adm_private.client_quotes
      where contact_id=p_contact order by prepared_at desc,id desc limit 30)q
    left join lkz_adm_private.contract_text_previews a on a.quote_id=q.id
    left join lkz_adm_private.signature_dossiers d on d.quote_id=q.id
  ),'[]'::jsonb)
 );
end $$;

create function lkz_adm_private.generate_contract_text_preview(
 p_quote uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 q lkz_adm_private.client_quotes%rowtype;
 a lkz_adm_private.contract_text_previews%rowtype;
 c public.contacts%rowtype;
 v_current_version integer;
 v_client text;
 v_items text;
 v_doc text;
 v_id uuid;
 v_ref text;
 v_sha text;
 v_bytes integer;
begin
 if not lkz_adm_private.is_master() or auth.uid() is null then
  raise exception 'Somente MASTER com MFA pode gerar minutas contratuais.' using errcode='42501';
 end if;
 if p_quote is null or p_request_id is null or
  p_request_id='00000000-0000-0000-0000-000000000000'::uuid then
  raise exception 'Identificador inválido.' using errcode='22023';
 end if;
 select * into a from lkz_adm_private.contract_text_previews where request_id=p_request_id;
 if found then
  if a.quote_id is distinct from p_quote or a.created_by is distinct from auth.uid() then
   raise exception 'Identificador reutilizado em outra operação.' using errcode='40001';
  end if;
  return jsonb_build_object('id',a.id,'sha256',a.content_sha256,'document_ref',a.document_ref,
    'already_recorded',true,'status','internal_review','legal_approved',false,
    'signature_enabled',false,'billing_enabled',false,'provisioning_enabled',false);
 end if;
 select * into q from lkz_adm_private.client_quotes where id=p_quote for share;
 if not found then raise exception 'Proposta inexistente.' using errcode='22023';end if;
 select version into v_current_version from lkz_adm_private.client_contract_drafts
  where id=q.contract_id for share;
 if q.status<>'prepared' or q.draft_version is distinct from v_current_version then
  raise exception 'Proposta cancelada ou minuta desatualizada.' using errcode='40001';
 end if;
 if exists(select 1 from lkz_adm_private.signature_dossiers where quote_id=p_quote) then
  raise exception 'Já existe dossiê documental nesta proposta. Não misture documentos.' using errcode='40001';
 end if;
 select * into c from public.contacts where id=q.contact_id for share;
 if not found then raise exception 'Cliente sem cadastro.' using errcode='22023';end if;
 v_client:=regexp_replace(coalesce(nullif(btrim(c.company_name),''),
   nullif(btrim(c.person_name),''),'Cliente ainda não qualificado'), '[[:cntrl:]]+', ' ', 'g');
 v_client:=left(v_client,180);
 select string_agg(
   format('%s. %s [%s] | Implantação: R$ %s,%s | %s',
     t.ord,
     left(regexp_replace(coalesce(t.item->>'name','Sistema sem nome'),
       '[[:cntrl:]]+', ' ', 'g'),120),
     left(coalesce(t.item->>'code',''),32),
     ((t.item->>'setup_cents')::bigint /100)::text,
     lpad(((t.item->>'setup_cents')::bigint %100)::text,2,'0'),
     case t.item->>'billing_interval'
       when 'monthly' then 'Mensal: R$ '||
         ((t.item->>'recurring_cents')::bigint /100)::text||','||
         lpad(((t.item->>'recurring_cents')::bigint %100)::text,2,'0')
       when 'yearly' then 'Anual: R$ '||
         ((t.item->>'recurring_cents')::bigint /100)::text||','||
         lpad(((t.item->>'recurring_cents')::bigint %100)::text,2,'0')
       else 'Sem recorrência'
     end), E'\n' order by t.ord)
 into v_items
 from jsonb_array_elements(q.items_snapshot) with ordinality as t(item,ord);
 if v_items is null or length(v_items)>18000 then
  raise exception 'Itens da proposta inválidos ou extensos.' using errcode='22023';
 end if;
 v_id:=gen_random_uuid();
 v_ref:='CT-LKZ-'||replace(v_id::text,'-','');
 v_doc:=concat_ws(E'\n',
  'LACROSE TECNOLOGIA',
  'MINUTA INTERNA — PRESTAÇÃO DE SERVIÇOS E LICENCIAMENTO DE SISTEMAS',
  'REVISÃO JURÍDICA OBRIGATÓRIA — NÃO ASSINADO — NÃO VINCULANTE',
  '',
  'Referência interna: '||v_ref,
  'Proposta: '||q.id::text,
  'Versão da minuta comercial: '||q.draft_version::text,
  'Contratante (nome informado): '||v_client,
  'Qualificação do contratante, representante e CNPJ/CPF: PENDENTE DE CONFERÊNCIA.',
  'Prestadora: Lacrose Tecnologia. Qualificação jurídica completa: PENDENTE.',
  '',
  '1. OBJETO — SISTEMAS E PREÇOS CONGELADOS NA PROPOSTA',
  v_items,
  '',
  '2. IMPLANTAÇÃO E ENTREGÁVEIS',
  'PENDENTE: condições técnicas, cronograma, critérios de aceite e responsabilidades por sistema.',
  '',
  '3. SUPORTE, DISPONIBILIDADE E SLA',
  'PENDENTE: níveis de atendimento, horários, exclusões e canais oficiais.',
  '',
  '4. PAGAMENTO, VENCIMENTOS, TRIBUTOS E REAJUSTE',
  'PENDENTE: condições comerciais oficiais, forma de cobrança, reajuste e tributos aplicáveis.',
  '',
  '5. PROTEÇÃO DE DADOS, CONFIDENCIALIDADE E SEGURANÇA',
  'PENDENTE: papéis LGPD, finalidade, suboperadores, retenção, incidentes e medidas de segurança.',
  '',
  '6. PROPRIEDADE INTELECTUAL, LICENÇA E RESTRIÇÕES',
  'PENDENTE: direitos, permissões de uso, limites por plano e terceiros.',
  '',
  '7. CANCELAMENTO, EXPORTAÇÃO E EXCLUSÃO DE DADOS',
  'PENDENTE: aviso prévio, exportação, prazos, retenção legal e término da licença.',
  '',
  '8. RESPONSABILIDADES, RESOLUÇÃO DE CONFLITOS E FORO',
  'PENDENTE: responsabilidade civil e revisão jurídica das cláusulas finais.',
  '',
  'ASSINATURAS: DESABILITADAS NESTA VERSÃO.',
  'ESTE TEXTO NÃO COMPROVA CONSENTIMENTO, CONTRATO CELEBRADO OU PAGAMENTO.',
  'Nenhuma mensagem, boleto, Pix, assinatura ou provisionamento foi iniciado.'
 );
 v_bytes:=octet_length(v_doc);
 if v_bytes not between 250 and 32768 then
  raise exception 'Texto gerado excede os limites.' using errcode='22023';
 end if;
 v_sha:=encode(sha256(convert_to(v_doc,'UTF8')),'hex');
 insert into lkz_adm_private.contract_text_previews(
  id,quote_id,contact_id,request_id,draft_version,document_ref,
  content_text,content_bytes,content_sha256,created_by
 ) values(v_id,q.id,q.contact_id,p_request_id,q.draft_version,v_ref,
  v_doc,v_bytes,v_sha,auth.uid())
 on conflict do nothing returning * into a;
 if not found then
  select * into a from lkz_adm_private.contract_text_previews
   where request_id=p_request_id;
  if found and a.quote_id=p_quote and a.created_by=auth.uid() then
   return jsonb_build_object('id',a.id,'sha256',a.content_sha256,'document_ref',a.document_ref,
     'already_recorded',true,'status','internal_review','legal_approved',false,
     'signature_enabled',false,'billing_enabled',false,'provisioning_enabled',false);
  end if;
  raise exception 'Já existe documento nesta proposta. Crie uma nova versão da minuta.'
   using errcode='40001';
 end if;
 insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
 values(auth.uid(),q.contact_id,'commercial.contract_text.generate',
  jsonb_build_object('document_id',a.id,'quote_id',q.id,
     'draft_version',q.draft_version,'sha256',a.content_sha256));
 return jsonb_build_object('id',a.id,'sha256',a.content_sha256,'document_ref',a.document_ref,
  'already_recorded',false,'status','internal_review','legal_approved',false,
  'signature_enabled',false,'billing_enabled',false,'provisioning_enabled',false);
end $$;

create function lkz_adm_private.read_contract_text_preview(p_document uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a lkz_adm_private.contract_text_previews%rowtype;
begin
 if not lkz_adm_private.is_operator() or auth.uid() is null then
  raise exception 'Sessão administrativa com MFA obrigatória.' using errcode='42501';
 end if;
 if p_document is null then raise exception 'Identificador inválido.' using errcode='22023';end if;
 select * into a from lkz_adm_private.contract_text_previews where id=p_document;
 if not found then raise exception 'Documento não encontrado.' using errcode='22023';end if;
 if encode(sha256(convert_to(a.content_text,'UTF8')),'hex') is distinct from a.content_sha256
   or octet_length(a.content_text) is distinct from a.content_bytes then
  raise exception 'Integridade da minuta comprometida.' using errcode='40001';
 end if;
 return jsonb_build_object(
  'id',a.id,'contact_id',a.contact_id,'quote_id',a.quote_id,
  'document_ref',a.document_ref,'text',a.content_text,
  'content_sha256',a.content_sha256,'content_bytes',a.content_bytes,
  'template_version',a.template_version,'status','internal_review',
  'legal_approved',false,'signature_enabled',false,'customer_accepted',false,
  'billing_enabled',false,'provisioning_enabled',false);
end $$;

create function public.lkz_adm_list_contract_text_previews(p_contact uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select lkz_adm_private.list_contract_text_previews(p_contact);
$$;
create function public.lkz_adm_generate_contract_text_preview(p_quote uuid,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select lkz_adm_private.generate_contract_text_preview(p_quote,p_request_id);
$$;
create function public.lkz_adm_read_contract_text_preview(p_document uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select lkz_adm_private.read_contract_text_preview(p_document);
$$;
revoke all on function
 lkz_adm_private.reject_contract_text_modification(),
 lkz_adm_private.list_contract_text_previews(uuid),
 lkz_adm_private.generate_contract_text_preview(uuid,uuid),
 lkz_adm_private.read_contract_text_preview(uuid),
 public.lkz_adm_list_contract_text_previews(uuid),
 public.lkz_adm_generate_contract_text_preview(uuid,uuid),
 public.lkz_adm_read_contract_text_preview(uuid)
from public,anon,authenticated;
grant execute on function
 lkz_adm_private.list_contract_text_previews(uuid),
 lkz_adm_private.generate_contract_text_preview(uuid,uuid),
 lkz_adm_private.read_contract_text_preview(uuid),
 public.lkz_adm_list_contract_text_previews(uuid),
 public.lkz_adm_generate_contract_text_preview(uuid,uuid),
 public.lkz_adm_read_contract_text_preview(uuid)
to authenticated;