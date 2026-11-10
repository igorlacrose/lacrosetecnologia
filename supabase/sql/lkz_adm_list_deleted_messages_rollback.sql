-- Reversão segura somente das duas funções novas.
-- Não remover tabelas, políticas ou dados.
DROP FUNCTION IF EXISTS public.lkz_adm_list_deleted_messages(bigint);
DROP FUNCTION IF EXISTS lkz_adm_private.list_deleted_messages(bigint);
