-- LKZ ADM: vínculo auditável de contato existente a um atendimento (sem criar cadastros duplicados).
create function lkz_adm_private.link_existing_contact(
 p_conversation uuid, p_expected_lead uuid, p_contact uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_lead uuid; v_current uuid; v_contact public.contacts%rowtype;
begin
 if not lkz_adm_private.is_operator() then
   raise exception 'Sessão administrativa com MFA obrigatória.' using errcode='42501';
 end if;
 if p_conversation is null or p_expected_lead is null or p_contact is null then
   raise exception 'Identificadores inválidos.' using errcode='22023';
 end if;
 select c.lead_id into v_lead from public.conversations c
   where c.id=p_conversation for update;
 if not found or v_lead is distinct from p_expected_lead then
   raise exception 'Atendimento alterado: atualize antes de vincular.' using errcode='40001';
 end if;
 select l.contact_id into v_current from public.leads l
   where l.id=v_lead for update;
 if not found then
   raise exception 'Oportunidade não localizada.' using errcode='40001';
 end if;
 if v_current is not null and v_current<>p_contact then
   raise exception 'Oportunidade já possui outro contato. Recarregue.' using errcode='40001';
 end if;
 select * into v_contact from public.contacts where id=p_contact;
 if not found then raise exception 'Contato não localizado.' using errcode='22023';end if;
 if v_current is null then
   update public.leads set contact_id=p_contact,updated_at=clock_timestamp()
     where id=v_lead and contact_id is null;
   if not found then raise exception 'Vínculo modificado. Recarregue.' using errcode='40001';end if;
   insert into public.lead_events(lead_id,event_type,actor_type,actor_id,before_data,after_data)
     values(v_lead,'admin.contact_linked','admin',auth.uid(),jsonb_build_object('contact_id',null),
       jsonb_build_object('contact_id',p_contact));
   insert into lkz_adm_private.operator_audit(actor_id,target_id,action,details)
     values(auth.uid(),p_contact,'client.link_existing',
       jsonb_build_object('lead_id',v_lead,'conversation_id',p_conversation));
 end if;
 return jsonb_build_object('id',v_contact.id,'company_name',v_contact.company_name,
   'person_name',v_contact.person_name,'email',v_contact.email,'phone',v_contact.phone,
   'segment',v_contact.segment,'city',v_contact.city,'state',v_contact.state,
   'created_at',v_contact.created_at,'updated_at',v_contact.updated_at,
   'consent_contact',v_contact.consent_contact);
end $$;

create function public.lkz_adm_link_existing_contact(
 p_conversation uuid,p_expected_lead uuid,p_contact uuid
) returns jsonb language sql security invoker set search_path='' as $$
 select lkz_adm_private.link_existing_contact(p_conversation,p_expected_lead,p_contact);
$$;

revoke all on function
 lkz_adm_private.link_existing_contact(uuid,uuid,uuid),
 public.lkz_adm_link_existing_contact(uuid,uuid,uuid)
from public,anon,authenticated;
grant execute on function
 lkz_adm_private.link_existing_contact(uuid,uuid,uuid),
 public.lkz_adm_link_existing_contact(uuid,uuid,uuid)
to authenticated;
