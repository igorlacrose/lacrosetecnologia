-- LKZ ADM: acesso global à lixeira de mensagens, somente para operador com MFA.
-- Sem exclusão, modificação ou migração dos dados existentes.
CREATE OR REPLACE FUNCTION lkz_adm_private.list_deleted_messages(p_before bigint DEFAULT NULL)
RETURNS TABLE (
  id bigint,
  conversation_id uuid,
  content_preview text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NOT lkz_adm_private.is_operator() THEN
    RAISE EXCEPTION 'Acesso administrativo com MFA obrigatório.'
      USING ERRCODE='42501';
  END IF;
  IF p_before IS NOT NULL AND p_before<=0 THEN
    RAISE EXCEPTION 'Cursor inválido.' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
    SELECT m.id, m.conversation_id, left(m.content, 240), m.created_at
      FROM public.messages m
      JOIN lkz_adm_private.message_folders mf ON mf.message_id=m.id
      WHERE mf.folder='deleted'
        AND (p_before IS NULL OR m.id < p_before)
      ORDER BY m.id DESC
      LIMIT 51;
END;
$$;

CREATE OR REPLACE FUNCTION public.lkz_adm_list_deleted_messages(p_before bigint DEFAULT NULL)
RETURNS TABLE (
  id bigint,
  conversation_id uuid,
  content_preview text,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO ''
AS $$
  SELECT * FROM lkz_adm_private.list_deleted_messages(p_before);
$$;

REVOKE ALL ON FUNCTION
  lkz_adm_private.list_deleted_messages(bigint),
  public.lkz_adm_list_deleted_messages(bigint)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  lkz_adm_private.list_deleted_messages(bigint),
  public.lkz_adm_list_deleted_messages(bigint)
TO authenticated;
