-- LKZ ADM - restaurar movimentação de mensagens sem concessões amplas a tabelas privadas.
-- Fonte original: introspecção read-only do projeto LacroseTech em 11/11/2026.
-- CAUSA: public.lkz_adm_move_messages é SECURITY INVOKER, mas authenticated
--        não tem INSERT/UPDATE em lkz_adm_private.message_folders.
-- Não aplica alterações de dados, tabela, RLS ou permissões diretas em tabelas.
-- Aplique APENAS após backup e homologação em ambiente isolado.
BEGIN;

-- Função privilegiada fora do esquema exposto; mantém as verificações existentes
-- de MFA (aal2), perfil ativo, transições, limite de 50, unicidade e lock.
CREATE OR REPLACE FUNCTION lkz_adm_private.move_messages(p_conversation uuid, p_ids bigint[], p_from text, p_to text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  selected_count integer := cardinality(p_ids);
  changed_count integer;
begin
  if not lkz_adm_private.is_operator() then
    raise exception 'Acesso administrativo com MFA obrigatório.' using errcode = '42501';
  end if;
  if p_conversation is null or selected_count is null or selected_count not between 1 and 50
    or selected_count <> (select count(distinct value) from unnest(p_ids) as entry(value))
    or p_from is null or p_to is null or not (
      (p_from = 'active' and p_to in ('archived', 'deleted'))
      or (p_from = 'archived' and p_to in ('active', 'deleted'))
      or (p_from = 'deleted' and p_to = 'active')
    ) then
    raise exception 'Seleção ou destino inválido.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('lkz_adm_message:' || p_conversation::text, 0));
  insert into lkz_adm_private.message_folders (message_id, folder)
    select m.id, p_to
    from public.messages m
    left join lkz_adm_private.message_folders f on f.message_id = m.id
    where m.conversation_id = p_conversation and m.id = any(p_ids)
      and coalesce(f.folder, 'active') = p_from
    on conflict (message_id) do update set folder = excluded.folder
    where message_folders.folder = p_from;
  get diagnostics changed_count = row_count;
  if changed_count <> selected_count then
    raise exception 'A seleção mudou. Atualize a conversa.' using errcode = '40001';
  end if;
  return changed_count;
end;
$function$;

REVOKE ALL ON FUNCTION lkz_adm_private.move_messages(uuid,bigint[],text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lkz_adm_private.move_messages(uuid,bigint[],text,text)
  TO authenticated;

-- Porta de entrada pública permanece SECURITY INVOKER e apenas delega à
-- função privada que verifica operador autorizado no próprio banco.
CREATE OR REPLACE FUNCTION public.lkz_adm_move_messages(
  p_conversation uuid, p_ids bigint[], p_from text, p_to text
)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $$
  SELECT lkz_adm_private.move_messages(p_conversation,p_ids,p_from,p_to);
$$;

REVOKE ALL ON FUNCTION public.lkz_adm_move_messages(uuid,bigint[],text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lkz_adm_move_messages(uuid,bigint[],text,text)
  TO authenticated;

COMMIT;
