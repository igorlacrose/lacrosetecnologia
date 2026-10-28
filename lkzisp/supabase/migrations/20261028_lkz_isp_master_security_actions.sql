-- LKZ ISP v1.5 · Recuperação administrativa (somente MASTER do cadastro privado).
-- Códigos/senhas nunca são registrados. Reservas e resultados são append-only.
-- Nenhum usuário comum pode consultar este registro ou executar as funções.
BEGIN;
CREATE TABLE IF NOT EXISTS lkz_private.lkz_isp_security_actions (
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 target_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('password_recovery','mfa_reset')),
 phase text NOT NULL CHECK(phase IN ('reserved','succeeded','failed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(id)
);
CREATE INDEX IF NOT EXISTS lkz_isp_security_actions_actor_time ON lkz_private.lkz_isp_security_actions(actor_id,created_at DESC);
CREATE INDEX IF NOT EXISTS lkz_isp_security_actions_target_time ON lkz_private.lkz_isp_security_actions(target_id,created_at DESC);
ALTER TABLE lkz_private.lkz_isp_security_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lkz_private.lkz_isp_security_actions FROM PUBLIC,anon,authenticated;
GRANT INSERT,SELECT ON lkz_private.lkz_isp_security_actions TO service_role;

CREATE OR REPLACE FUNCTION public.lkz_isp_master_security_check(p_actor uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
 SELECT COALESCE(lkz_private.is_system_master_uid(p_actor),false);
$$;
REVOKE ALL ON FUNCTION public.lkz_isp_master_security_check(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lkz_isp_master_security_check(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.lkz_isp_master_security_reserve(p_actor uuid,p_target uuid,p_action text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE request_uuid uuid := gen_random_uuid();
BEGIN
 IF NOT lkz_private.is_system_master_uid(p_actor) THEN
  RAISE EXCEPTION 'MASTER_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF p_action NOT IN ('password_recovery','mfa_reset') OR p_action IS NULL THEN
  RAISE EXCEPTION 'INVALID_ACTION' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.lkz_isp_memberships WHERE user_id=p_target) THEN
  RAISE EXCEPTION 'TARGET_NOT_LINKED' USING ERRCODE='42501';
 END IF;
 -- Impede corrida entre solicitações concorrentes do mesmo MASTER.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor::text,48258));
 IF (SELECT count(*) FROM lkz_private.lkz_isp_security_actions
     WHERE actor_id=p_actor AND phase='reserved'
       AND created_at>now()-interval '24 hours') >= 12
 OR (SELECT count(*) FROM lkz_private.lkz_isp_security_actions
     WHERE target_id=p_target AND phase='reserved'
       AND created_at>now()-interval '24 hours') >= 4
 OR EXISTS(SELECT 1 FROM lkz_private.lkz_isp_security_actions
     WHERE actor_id=p_actor AND phase='reserved'
       AND created_at>now()-interval '30 seconds')
 THEN
  RAISE EXCEPTION 'SECURITY_ACTION_RATE_LIMIT' USING ERRCODE='42901';
 END IF;
 INSERT INTO lkz_private.lkz_isp_security_actions(request_id,actor_id,target_id,action,phase)
 VALUES(request_uuid,p_actor,p_target,p_action,'reserved');
 RETURN request_uuid;
END;
$$;
REVOKE ALL ON FUNCTION public.lkz_isp_master_security_reserve(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lkz_isp_master_security_reserve(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.lkz_isp_master_security_finish(p_actor uuid,p_request uuid,p_success boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE original record;
BEGIN
 IF NOT lkz_private.is_system_master_uid(p_actor) THEN
  RAISE EXCEPTION 'MASTER_REQUIRED' USING ERRCODE='42501';
 END IF;
 SELECT actor_id,target_id,action INTO original
 FROM lkz_private.lkz_isp_security_actions
 WHERE request_id=p_request AND actor_id=p_actor AND phase='reserved' LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM lkz_private.lkz_isp_security_actions
  WHERE request_id=p_request AND phase IN ('succeeded','failed')) THEN
  RAISE EXCEPTION 'REQUEST_ALREADY_FINISHED' USING ERRCODE='23505';
 END IF;
 INSERT INTO lkz_private.lkz_isp_security_actions(request_id,actor_id,target_id,action,phase)
 VALUES(p_request,original.actor_id,original.target_id,original.action,
  CASE WHEN p_success THEN 'succeeded' ELSE 'failed' END);
END;
$$;
REVOKE ALL ON FUNCTION public.lkz_isp_master_security_finish(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lkz_isp_master_security_finish(uuid,uuid,boolean) TO service_role;
COMMIT;
