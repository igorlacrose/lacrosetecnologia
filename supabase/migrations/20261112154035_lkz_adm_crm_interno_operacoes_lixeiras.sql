-- LKZ ADM • funções administrativas: CRM próprio e lixeiras auditadas.;

-- Migracao aplicada em 2026-11-12. Preserva registros existentes.;

CREATE OR REPLACE FUNCTION lkz_adm_private.manage_followup(p_id uuid, p_lead_id uuid, p_action text, p_due_at timestamp with time zone, p_channel text, p_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_item public.followups%rowtype;v_previous text;v_message text;
begin
  if not lkz_adm_private.is_operator() then
    raise exception 'Sessão administrativa com MFA necessária.' using errcode='42501';
  end if;
  if p_id is null or p_action not in ('create','reschedule','complete','cancel') then
    raise exception 'Operação inválida.' using errcode='22023';
  end if;
  v_message:=nullif(btrim(coalesce(p_message,'')),'');
  if length(v_message)>1500 or v_message ~ '[[:cntrl:]]' then
    raise exception 'Mensagem inválida.' using errcode='22023';
  end if;
  if p_action in ('create','reschedule') and
      (p_due_at is null or p_due_at<now()-interval '1 day' or p_due_at>now()+interval '5 years'
        or p_channel not in ('whatsapp','email','phone','other')) then
    raise exception 'Data ou canal inválido.' using errcode='22023';
  end if;
  if p_action='create' then
    if p_lead_id is null or not exists(
      select 1 from public.leads where id=p_lead_id and status not in ('archived','lost','won')
    ) then raise exception 'Oportunidade indisponível.' using errcode='22023'; end if;
    insert into public.followups(id,lead_id,channel,due_at,status,draft_message)
      values(p_id,p_lead_id,p_channel,p_due_at,'pending',v_message)
      on conflict (id) do nothing returning * into v_item;
    if not found then
      select * into v_item from public.followups where id=p_id;
      if not found or v_item.lead_id is distinct from p_lead_id or
         v_item.due_at is distinct from p_due_at or v_item.channel is distinct from p_channel or
         v_item.draft_message is distinct from v_message then
        raise exception 'Identificador reutilizado de forma incompatível.' using errcode='23505';
      end if;
      return to_jsonb(v_item);
    end if;
    v_previous:='none';
  else
    select * into v_item from public.followups where id=p_id for update;
    if not found or (p_lead_id is not null and v_item.lead_id<>p_lead_id) then
      raise exception 'Retorno não encontrado.' using errcode='22023';
    end if;
    if v_item.status<>'pending' then
      raise exception 'O retorno já foi finalizado ou alterado.' using errcode='40001';
    end if;
    v_previous:=v_item.status;
    if p_action='reschedule' then
      update public.followups set due_at=p_due_at,channel=p_channel,draft_message=v_message,
        approved_at=null,approved_by=null where id=p_id returning * into v_item;
    else
      update public.followups set status=case when p_action='complete' then 'done' else 'cancelled' end
      where id=p_id returning * into v_item;
    end if;
  end if;
  insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
  values(auth.uid(),p_id,'followup.'||p_action,
     jsonb_build_object('lead_id',v_item.lead_id,'previous',v_previous,'status',v_item.status));
  return to_jsonb(v_item);
end $function$
;

CREATE OR REPLACE FUNCTION lkz_adm_private.update_lead(p_id uuid, p_expected_status text, p_status text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_lead public.leads%rowtype;v_note text:=nullif(btrim(coalesce(p_note,'')),'');
begin
  if not lkz_adm_private.is_operator() then
    raise exception 'Sessão administrativa com MFA necessária.' using errcode='42501';
  end if;
  if p_id is null or p_status not in
      ('new','diagnosing','qualified','contacted','human_review','lost','archived')
     or length(v_note)>2000 or
        (v_note is not null and v_note ~ '[[:cntrl:]]') then
    raise exception 'Dados da oportunidade inválidos.' using errcode='22023';
  end if;
  select * into v_lead from public.leads where id=p_id for update;
  if not found or v_lead.status is distinct from p_expected_status then
    raise exception 'Oportunidade atualizada em outra sessão.' using errcode='40001';
  end if;
  if v_lead.status in ('won','proposal') and p_status<>v_lead.status then
    raise exception 'Etapa protegida: use o fluxo de aprovação/contratação.' using errcode='42501';
  end if;
  if p_status='lost' and (v_note is null or length(v_note)<5) then
    raise exception 'Informe o motivo da perda.' using errcode='22023';
  end if;
  if p_status=v_lead.status and v_note is null then
    raise exception 'Nenhuma alteração registrada.' using errcode='22023';
  end if;
  if p_status<>v_lead.status then
    update public.leads set status=p_status,updated_at=clock_timestamp(),
      needs_human_review=case when p_status='human_review' then true else needs_human_review end,
      lost_reason=case when p_status='lost' then v_note else lost_reason end
    where id=p_id returning * into v_lead;
  end if;
  insert into public.lead_events(lead_id,event_type,actor_type,actor_id,note,before_data,after_data)
  values(p_id,case when p_status=p_expected_status then 'admin.note' else 'admin.status_changed' end,
    'admin',auth.uid(),v_note,jsonb_build_object('status',p_expected_status),
    jsonb_build_object('status',p_status));
  insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
  values(auth.uid(),p_id,case when p_status=p_expected_status then 'lead.note' else 'lead.update' end,
    jsonb_build_object('from',p_expected_status,'to',p_status));
  return to_jsonb(v_lead);
end $function$
;

CREATE OR REPLACE FUNCTION lkz_adm_private.lead_history(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not lkz_adm_private.is_operator() then
    raise exception 'Sessão administrativa com MFA necessária.' using errcode='42501';
  end if;
  if p_id is null then raise exception 'Oportunidade inválida.' using errcode='22023';end if;
  return coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id desc)
    from (select id,event_type,note,actor_type,created_at from public.lead_events
       where lead_id=p_id order by created_at desc,id desc limit 30) t),'[]'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION lkz_adm_private.trash_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not lkz_adm_private.is_operator() then
    raise exception 'Sessão administrativa com MFA necessária.' using errcode='42501';
  end if;
  return jsonb_build_object(
    'messages',(select count(*) from lkz_adm_private.message_folders f
      join public.messages m on m.id=f.message_id where f.folder='deleted'),
    'conversations',(select count(*) from lkz_adm_private.conversation_folders
      where folder='deleted'));
end $function$
;

CREATE OR REPLACE FUNCTION lkz_adm_private.empty_trash(p_kind text, p_conversation uuid, p_expected_count integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actual int;v_removed int;v_msg_count int;
begin
  if not lkz_adm_private.is_master() then
    raise exception 'Operação exclusiva do MASTER com MFA.' using errcode='42501';
  end if;
  if p_kind not in ('messages','conversations') or p_expected_count is null or p_expected_count<1 or
     (p_kind='messages' and p_expected_count>500) or
     (p_kind='conversations' and (p_expected_count>100 or p_conversation is not null)) then
    raise exception 'Seleção de lixeira inválida ou muito grande.' using errcode='22023';
  end if;
  if p_kind='messages' then
    select count(*) into v_actual
    from lkz_adm_private.message_folders f join public.messages m on m.id=f.message_id
    where f.folder='deleted' and (p_conversation is null or m.conversation_id=p_conversation);
  else
    select count(*) into v_actual from lkz_adm_private.conversation_folders
     where folder='deleted';
  end if;
  if v_actual<>p_expected_count then
    raise exception 'A Lixeira foi alterada. Atualize e confirme novamente.' using errcode='40001';
  end if;
  if p_kind='messages' then
    with removed as (
      delete from public.messages m using lkz_adm_private.message_folders f
      where m.id=f.message_id and f.folder='deleted' and
        (p_conversation is null or m.conversation_id=p_conversation)
      returning m.id
    ), audit as (
      insert into lkz_adm_private.message_folder_audit
        (message_id,actor_id,previous_folder,next_folder)
      select id,auth.uid(),'deleted','purged' from removed returning message_id
    ) select count(*) into v_removed from audit;
    v_msg_count:=v_removed;
  else
    select count(*) into v_msg_count from public.messages m
      join lkz_adm_private.conversation_folders f on f.conversation_id=m.conversation_id
      where f.folder='deleted';
    with removed as (
      delete from public.conversations c using lkz_adm_private.conversation_folders f
      where c.id=f.conversation_id and f.folder='deleted' returning c.id
    ) select count(*) into v_removed from removed;
  end if;
  if v_removed<>p_expected_count then
    raise exception 'A Lixeira mudou durante a operação. Nenhum registro foi eliminado.' using errcode='40001';
  end if;
  insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
  values(auth.uid(),coalesce(p_conversation,auth.uid()),'trash.empty_'||p_kind,
    jsonb_build_object('deleted_count',v_removed,'message_count',v_msg_count,
      'scope',case when p_conversation is null then 'all' else 'conversation' end));
  return jsonb_build_object('deleted',v_removed,'messages',v_msg_count,'kind',p_kind);
end $function$
;

CREATE OR REPLACE FUNCTION public.lkz_adm_manage_followup(p_id uuid, p_lead_id uuid, p_action text, p_due_at timestamp with time zone, p_channel text, p_message text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select lkz_adm_private.manage_followup(p_id,p_lead_id,p_action,p_due_at,p_channel,p_message);
$function$
;

CREATE OR REPLACE FUNCTION public.lkz_adm_update_lead(p_id uuid, p_expected_status text, p_status text, p_note text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select lkz_adm_private.update_lead(p_id,p_expected_status,p_status,p_note);
$function$
;

CREATE OR REPLACE FUNCTION public.lkz_adm_lead_history(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select lkz_adm_private.lead_history(p_id);
$function$
;

CREATE OR REPLACE FUNCTION public.lkz_adm_trash_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select lkz_adm_private.trash_stats();
$function$
;

CREATE OR REPLACE FUNCTION public.lkz_adm_empty_trash(p_kind text, p_conversation uuid, p_expected_count integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select lkz_adm_private.empty_trash(p_kind,p_conversation,p_expected_count);
$function$
;

revoke all on function
 lkz_adm_private.manage_followup(uuid,uuid,text,timestamp with time zone,text,text),
 lkz_adm_private.update_lead(uuid,text,text,text),
 lkz_adm_private.lead_history(uuid),
 lkz_adm_private.trash_stats(),
 lkz_adm_private.empty_trash(text,uuid,integer),
 public.lkz_adm_manage_followup(uuid,uuid,text,timestamp with time zone,text,text),
 public.lkz_adm_update_lead(uuid,text,text,text),
 public.lkz_adm_lead_history(uuid),
 public.lkz_adm_trash_stats(),
 public.lkz_adm_empty_trash(text,uuid,integer) from public,anon,authenticated;
grant execute on function
 lkz_adm_private.manage_followup(uuid,uuid,text,timestamp with time zone,text,text),
 lkz_adm_private.update_lead(uuid,text,text,text),
 lkz_adm_private.lead_history(uuid),
 lkz_adm_private.trash_stats(),
 lkz_adm_private.empty_trash(text,uuid,integer),
 public.lkz_adm_manage_followup(uuid,uuid,text,timestamp with time zone,text,text),
 public.lkz_adm_update_lead(uuid,text,text,text),
 public.lkz_adm_lead_history(uuid),
 public.lkz_adm_trash_stats(),
 public.lkz_adm_empty_trash(text,uuid,integer) to authenticated;
