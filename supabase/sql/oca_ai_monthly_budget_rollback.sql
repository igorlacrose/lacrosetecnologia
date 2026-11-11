-- Rollback da API financeira do OCA: manter a tabela de métricas para auditoria.
-- Não apagar dados operacionais / reservas antigas.
BEGIN;
DROP FUNCTION IF EXISTS public.oca_ai_reserve_monthly(integer,integer);
COMMIT;
