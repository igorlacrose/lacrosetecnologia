-- Aditiva e restritiva. Nenhuma ativacao administrativa pode ser exposta
-- enquanto a interface e a prova de MASTER+MFA nao forem homologadas.
-- O endpoint service_role de consulta/assinatura permanece operacional.
BEGIN;
REVOKE ALL ON FUNCTION public.lkz_license_admin_activate_v1(text,text,text,timestamptz)
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.lkz_license_admin_status_v1(uuid,text)
FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
