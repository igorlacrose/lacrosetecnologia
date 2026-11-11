-- Reversão da correção de permissão, sem apagar mensagens ou tabelas.
-- Restaura a definição original que estava no banco em 11/11/2026.
-- ATENÇÃO: restaura também o problema funcional original de INSERT/UPDATE.
BEGIN;

CREATE OR REPLACE FUNCTION public.lkz_adm_move_messages(p_conversation uuid, p_ids bigint[], p_from text, p_to text)
 RETURNS integer
 LANGUAGE plpgsql
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

DROP FUNCTION IF EXISTS lkz_adm_private.move_messages(uuid,bigint[],text,text);

COMMIT;
