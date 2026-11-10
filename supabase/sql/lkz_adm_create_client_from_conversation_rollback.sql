-- Só remover as duas funções NOVAS. Nunca remover dados de contatos ou conversas.
DROP FUNCTION IF EXISTS public.lkz_adm_create_client_from_conversation(
 uuid,uuid,uuid,text,text,text,text,text,text,text
);
DROP FUNCTION IF EXISTS lkz_adm_private.create_client_for_conversation(
 uuid,uuid,uuid,text,text,text,text,text,text,text
);
