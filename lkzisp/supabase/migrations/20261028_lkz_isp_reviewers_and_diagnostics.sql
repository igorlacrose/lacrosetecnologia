-- LKZ ISP · Gestor e Administrador podem aprovar/reprovar o mesmo snapshot autorizado.
-- Sem alterar importação MASTER, esquema, históricos, auditoria ou políticas RLS.
-- Migração reversível: função da versão anterior no checkpoint GitHub.
BEGIN;
CREATE OR REPLACE FUNCTION public.lkz_isp_review_snapshot(p_tenant uuid, p_snapshot uuid, p_decision text, p_rationale text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 uid uuid := (SELECT auth.uid());
 out_id uuid;
BEGIN
 IF uid IS NULL OR COALESCE((SELECT auth.jwt())->>'aal','aal1')<>'aal2' THEN
  RAISE EXCEPTION 'MFA_AAL2_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF NOT (lkz_private.is_system_master() OR EXISTS(
  SELECT 1 FROM public.lkz_isp_memberships m
  WHERE m.tenant_id=p_tenant AND m.user_id=uid AND m.role IN ('gestor','administrador')
 )) THEN
  RAISE EXCEPTION 'REVIEWER_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF p_decision NOT IN ('approve','reject') OR p_decision IS NULL
   OR p_rationale IS NULL OR pg_catalog.length(pg_catalog.btrim(p_rationale)) NOT BETWEEN 20 AND 2000 THEN
  RAISE EXCEPTION 'INVALID_REVIEW' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.lkz_isp_aggregate_snapshots a
               WHERE a.tenant_id=p_tenant AND a.id=p_snapshot) THEN
  RAISE EXCEPTION 'REPORT_NOT_FOUND' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.lkz_isp_snapshot_reviews(tenant_id,snapshot_id,decision,rationale,reviewed_by)
 VALUES(p_tenant,p_snapshot,p_decision,pg_catalog.btrim(p_rationale),uid)
 RETURNING id INTO out_id;
 INSERT INTO public.lkz_isp_audit_events(tenant_id,actor_id,event_name,target_id,audit_visibility,details)
 VALUES(p_tenant,uid,
    CASE WHEN p_decision='approve' THEN 'snapshot_review.approved' ELSE 'snapshot_review.rejected' END,
    out_id,
    CASE WHEN lkz_private.is_system_master() THEN 'master_only' ELSE 'standard' END,
    pg_catalog.jsonb_build_object('snapshot_id',p_snapshot,'decision',p_decision));
 RETURN out_id;
END $function$
;
COMMIT;
