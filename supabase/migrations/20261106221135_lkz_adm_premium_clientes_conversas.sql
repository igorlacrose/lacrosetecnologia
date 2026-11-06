-- Migration reconstructed from verified live schema, no data deletion.
create table if not exists lkz_adm_private.conversation_folders (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  folder text not null check (folder in ('active','archived','deleted')),
  updated_at timestamptz not null default now()
);
alter table lkz_adm_private.conversation_folders enable row level security;
revoke all on lkz_adm_private.conversation_folders from public,anon,authenticated;

CREATE OR REPLACE FUNCTION lkz_adm_private.list_conversation_folders()
 RETURNS TABLE(conversation_id uuid, folder text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not lkz_adm_private.is_operator() then
    raise exception 'Acesso administrativo com MFA obrigatório.' using errcode='42501';
  end if;
  return query select cf.conversation_id,cf.folder from lkz_adm_private.conversation_folders cf;
end; $function$;

CREATE OR REPLACE FUNCTION lkz_adm_private.conversation_action(p_id uuid, p_action text, p_expected_folder text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_current text;
  v_to text;
  v_count bigint;
begin
  if not lkz_adm_private.is_operator() then
    raise exception 'Acesso administrativo com MFA obrigatório.' using errcode='42501';
  end if;
  if p_id is null or p_action is null or p_action not in ('archive','trash','restore','purge')
     or p_expected_folder not in ('active','archived','deleted') then
    raise exception 'Ação ou atendimento inválido.' using errcode='22023';
  end if;
  -- Lock prevents competing admin actions and a concurrent purge.
  perform 1 from public.conversations where id=p_id for update;
  if not found then raise exception 'Atendimento inexistente.' using errcode='22023'; end if;
  select coalesce((select folder from lkz_adm_private.conversation_folders where conversation_id=p_id),'active') into v_current;
  if v_current is distinct from p_expected_folder then
    raise exception 'O atendimento mudou. Atualize a lista.' using errcode='40001';
  end if;
  if p_action='purge' then
    if v_current<>'deleted' or not lkz_adm_private.is_master() then
      raise exception 'Exclusão definitiva exige Lixeira e conta MASTER com MFA.' using errcode='42501';
    end if;
    select count(*) into v_count from public.messages where conversation_id=p_id;
    delete from public.conversations where id=p_id;
    insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
      values (auth.uid(),p_id,'conversation.purge',jsonb_build_object('message_count',v_count));
    return jsonb_build_object('folder','purged','message_count',v_count);
  end if;
  if (p_action='archive' and v_current<>'active') or
     (p_action='trash' and v_current not in ('active','archived')) or
     (p_action='restore' and v_current not in ('archived','deleted')) then
    raise exception 'Transição de pasta inválida.' using errcode='22023';
  end if;
  v_to:=case when p_action='archive' then 'archived'
             when p_action='trash' then 'deleted' else 'active' end;
  insert into lkz_adm_private.conversation_folders(conversation_id,folder,updated_at)
  values(p_id,v_to,clock_timestamp())
  on conflict (conversation_id) do update
    set folder=excluded.folder,updated_at=excluded.updated_at;
  insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
    values(auth.uid(),p_id,'conversation.'||p_action,
       jsonb_build_object('from',v_current,'to',v_to));
  return jsonb_build_object('folder',v_to);
end; $function$;

CREATE OR REPLACE FUNCTION lkz_adm_private.edit_client(p_id uuid, p_version timestamp with time zone, p_company text, p_name text, p_segment text, p_email text, p_phone text, p_city text, p_state text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.contacts%rowtype;
  v_company text:=nullif(btrim(coalesce(p_company,'')),'');
  v_name text:=nullif(btrim(coalesce(p_name,'')),'');
  v_segment text:=nullif(btrim(coalesce(p_segment,'')),'');
  v_email text:=nullif(lower(btrim(coalesce(p_email,''))),'');
  v_phone text:=nullif(btrim(coalesce(p_phone,'')),'');
  v_city text:=nullif(btrim(coalesce(p_city,'')),'');
  v_state text:=nullif(upper(btrim(coalesce(p_state,''))),'');
begin
  if not lkz_adm_private.is_operator() then
    raise exception 'Acesso administrativo com MFA obrigatório.' using errcode='42501';
  end if;
  if p_id is null or p_version is null or (v_company is null and v_name is null)
    or length(v_company)>120 or length(v_name)>120 or length(v_segment)>100
    or length(v_city)>100 or length(v_email)>254 or length(v_phone)>32
    or (v_state is not null and v_state !~ '^[A-Z]{2}$')
    or (v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or (v_phone is not null and v_phone !~ '^[+0-9(). -]+$')
    or coalesce(v_company,'')||coalesce(v_name,'')||coalesce(v_segment,'')||
       coalesce(v_email,'')||coalesce(v_city,'')||coalesce(v_phone,'') ~ '[[:cntrl:]]'
    then raise exception 'Dados inválidos para edição do cliente.' using errcode='22023';
  end if;
  select * into c from public.contacts where id=p_id for update;
  if not found then raise exception 'Cliente inexistente.' using errcode='22023'; end if;
  if c.updated_at is distinct from p_version then
    raise exception 'Cliente alterado em outra sessão. Recarregue antes de salvar.' using errcode='40001';
  end if;
  update public.contacts set company_name=v_company,person_name=v_name,segment=v_segment,
    email=v_email,phone=v_phone,city=v_city,state=v_state,updated_at=clock_timestamp()
    where id=p_id returning * into c;
  insert into lkz_adm_private.operator_audit(actor_id,target_id,action)
    values(auth.uid(),p_id,'client.update');
  return jsonb_build_object('id',c.id,'company_name',c.company_name,'person_name',c.person_name,
     'segment',c.segment,'email',c.email,'phone',c.phone,'city',c.city,'state',c.state,
     'created_at',c.created_at,'updated_at',c.updated_at,'consent_contact',c.consent_contact);
end; $function$;

CREATE OR REPLACE FUNCTION public.lkz_adm_list_conversation_folders()
 RETURNS TABLE(conversation_id uuid, folder text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select * from lkz_adm_private.list_conversation_folders();
$function$;

CREATE OR REPLACE FUNCTION public.lkz_adm_conversation_action(p_id uuid, p_action text, p_expected_folder text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select lkz_adm_private.conversation_action(p_id,p_action,p_expected_folder);
$function$;

CREATE OR REPLACE FUNCTION public.lkz_adm_edit_client(p_id uuid, p_version timestamp with time zone, p_company text, p_name text, p_segment text, p_email text, p_phone text, p_city text, p_state text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select lkz_adm_private.edit_client(p_id,p_version,p_company,p_name,p_segment,
                                    p_email,p_phone,p_city,p_state);
$function$;


revoke all on function
 lkz_adm_private.list_conversation_folders(),
 lkz_adm_private.conversation_action(uuid,text,text),
 lkz_adm_private.edit_client(uuid,timestamptz,text,text,text,text,text,text,text),
 public.lkz_adm_list_conversation_folders(),
 public.lkz_adm_conversation_action(uuid,text,text),
 public.lkz_adm_edit_client(uuid,timestamptz,text,text,text,text,text,text,text)
from public,anon,authenticated;
grant execute on function
 lkz_adm_private.list_conversation_folders(),
 lkz_adm_private.conversation_action(uuid,text,text),
 lkz_adm_private.edit_client(uuid,timestamptz,text,text,text,text,text,text,text),
 public.lkz_adm_list_conversation_folders(),
 public.lkz_adm_conversation_action(uuid,text,text),
 public.lkz_adm_edit_client(uuid,timestamptz,text,text,text,text,text,text,text)
to authenticated;
