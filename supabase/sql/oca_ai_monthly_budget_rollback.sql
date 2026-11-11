-- Rollback da função de reservas do OCA (não apaga evidências financeiras).
-- A tabela de orçamento e o hash de challenges são mantidos para auditoria.
BEGIN;
DROP FUNCTION IF EXISTS public.oca_ai_reserve_monthly(integer,integer,text);
COMMIT;
