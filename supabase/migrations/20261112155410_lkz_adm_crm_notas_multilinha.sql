-- LKZ ADM • correção de notas com quebras de linha e histórico de etapas protegidas.

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
  if length(v_message)>1500 then
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
      ('new','diagnosing','qualified','contacted','human_review','lost','archived','proposal','won')
     or length(v_note)>2000 then
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
