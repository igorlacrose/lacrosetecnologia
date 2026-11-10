-- LKZ ADM: cadastro e vínculo de contato a um atendimento, operação atômica.
-- Adição isolada: não altera tabelas, dados, RLS ou rotinas existentes.
CREATE OR REPLACE FUNCTION lkz_adm_private.create_client_for_conversation(
  p_id uuid, p_conversation uuid, p_expected_lead uuid,
  p_company text, p_name text, p_segment text, p_email text,
  p_phone text, p_city text, p_state text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_lead_id uuid;
  v_contact_id uuid;
  v_result jsonb;
BEGIN
  IF NOT lkz_adm_private.is_operator() THEN
    RAISE EXCEPTION 'Acesso administrativo com MFA obrigatório.' USING ERRCODE='42501';
  END IF;
  IF p_id IS NULL OR p_conversation IS NULL OR p_expected_lead IS NULL THEN
    RAISE EXCEPTION 'Identificador de cliente, atendimento ou oportunidade inválido.' USING ERRCODE='22023';
  END IF;

  -- A conversa determina a oportunidade: não aceitar um lead arbitrário do navegador.
  SELECT c.lead_id INTO v_lead_id
    FROM public.conversations c WHERE c.id=p_conversation FOR UPDATE;
  IF NOT FOUND OR v_lead_id IS DISTINCT FROM p_expected_lead THEN
    RAISE EXCEPTION 'Atendimento e oportunidade não correspondem.' USING ERRCODE='40001';
  END IF;

  SELECT l.contact_id INTO v_contact_id
    FROM public.leads l WHERE l.id=v_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oportunidade não localizada.' USING ERRCODE='40001';
  END IF;
  IF v_contact_id IS NOT NULL AND v_contact_id<>p_id THEN
    RAISE EXCEPTION 'A oportunidade já possui um contato. Atualize a tela.' USING ERRCODE='40001';
  END IF;

  -- Reutiliza validação e idempotência do cadastro original.
  v_result:=lkz_adm_private.create_client(
    p_id,p_company,p_name,p_segment,p_email,p_phone,p_city,p_state
  );

  IF v_contact_id IS NULL THEN
    UPDATE public.leads SET contact_id=p_id,updated_at=clock_timestamp()
      WHERE id=v_lead_id AND contact_id IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Vínculo modificado por outra operação.' USING ERRCODE='40001';
    END IF;
    INSERT INTO lkz_adm_private.operator_audit(actor_id,target_id,action,details)
      VALUES(auth.uid(),p_id,'client.link_to_conversation',
        jsonb_build_object('lead_id',v_lead_id,'conversation_id',p_conversation));
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.lkz_adm_create_client_from_conversation(
  p_id uuid, p_conversation uuid, p_expected_lead uuid,
  p_company text, p_name text, p_segment text, p_email text,
  p_phone text, p_city text, p_state text
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path TO ''
AS $$
  SELECT lkz_adm_private.create_client_for_conversation(
    p_id,p_conversation,p_expected_lead,p_company,p_name,p_segment,
    p_email,p_phone,p_city,p_state
  );
$$;

REVOKE ALL ON FUNCTION
  lkz_adm_private.create_client_for_conversation(uuid,uuid,uuid,text,text,text,text,text,text,text),
  public.lkz_adm_create_client_from_conversation(uuid,uuid,uuid,text,text,text,text,text,text,text)
  FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  lkz_adm_private.create_client_for_conversation(uuid,uuid,uuid,text,text,text,text,text,text,text),
  public.lkz_adm_create_client_from_conversation(uuid,uuid,uuid,text,text,text,text,text,text,text)
  TO authenticated;
