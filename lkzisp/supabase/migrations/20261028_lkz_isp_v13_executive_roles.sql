-- LKZ ISP v1.3 · Acesso setorial estrito e decisões reais auditadas
-- Apenas projeto Supabase LKZ ISP: syysqoieyycclpfbadwp
BEGIN;

-- Gestor/Administrador deixam de inserir dados: apenas MASTER efetua importações.
DROP POLICY IF EXISTS lkz_aggregates_write ON public.lkz_isp_aggregate_snapshots;
CREATE POLICY lkz_aggregates_write ON public.lkz_isp_aggregate_snapshots
 FOR INSERT TO authenticated
 WITH CHECK (created_by=(SELECT auth.uid()) AND lkz_private.is_system_master());
DROP POLICY IF EXISTS lkz_employee_write_manager ON public.lkz_isp_employee_metrics;
CREATE POLICY lkz_employee_write_manager ON public.lkz_isp_employee_metrics
 FOR INSERT TO authenticated
 WITH CHECK (created_by=(SELECT auth.uid()) AND lkz_private.is_system_master());

-- Perfis setoriais NÃO podem consultar diretamente o snapshot global.
-- Projeção derivada no banco somente do setor cadastrado no vínculo MFA.
CREATE OR REPLACE FUNCTION public.lkz_isp_read_sector_snapshots(p_tenant uuid)
 RETURNS TABLE(id uuid, tenant_id uuid, snapshot jsonb, created_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
 SELECT a.id,a.tenant_id,
  pg_catalog.jsonb_build_object(
   'schema',1,
   'fingerprint',a.fingerprint,
   'source','IXC · relatório setorial',
   'earliest',a.snapshot->>'earliest',
   'latest',a.snapshot->>'latest',
   'referenceDate',a.snapshot->>'referenceDate',
   'importedAt',a.snapshot->>'importedAt',
   'total', (a.snapshot->'sectors'->s.name->>'total')::integer,
   'finalized', (a.snapshot->'sectors'->s.name->>'finalized')::integer,
   'pending', (a.snapshot->'sectors'->s.name->>'pending')::integer,
   'sectorName',s.name,
   'sectors',pg_catalog.jsonb_build_object(s.name,a.snapshot->'sectors'->s.name)
  ),a.created_at
 FROM public.lkz_isp_memberships m
 JOIN public.lkz_isp_sectors s ON s.tenant_id=m.tenant_id AND s.id=m.sector_id
 JOIN public.lkz_isp_aggregate_snapshots a ON a.tenant_id=m.tenant_id
 WHERE m.tenant_id=p_tenant
   AND m.user_id=(SELECT auth.uid())
   AND m.role IN ('lider_setor','financeiro')
   AND m.sector_id IS NOT NULL
   AND COALESCE((SELECT auth.jwt())->>'aal','aal1')='aal2'
   AND pg_catalog.jsonb_typeof(a.snapshot->'sectors'->s.name)='object'
   AND a.snapshot->'sectors'->s.name ? 'total'
 ORDER BY a.created_at DESC,a.id DESC
 LIMIT 250;
$fn$;
REVOKE ALL ON FUNCTION public.lkz_isp_read_sector_snapshots(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lkz_isp_read_sector_snapshots(uuid) TO authenticated;

-- Aprovação/reprovação apenas de fotografia REAL salva em empresa autorizada.
CREATE TABLE IF NOT EXISTS public.lkz_isp_snapshot_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 snapshot_id uuid NOT NULL,
 decision text NOT NULL CHECK (decision IN ('approve','reject')),
 rationale text NOT NULL CHECK (length(btrim(rationale)) BETWEEN 20 AND 4000),
 decided_by uuid NOT NULL,
 decided_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT lkz_isp_snapshot_reviews_one UNIQUE(tenant_id,snapshot_id),
 CONSTRAINT lkz_isp_snapshot_reviews_snapshot FOREIGN KEY(tenant_id,snapshot_id)
   REFERENCES public.lkz_isp_aggregate_snapshots(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT lkz_isp_snapshot_reviews_actor FOREIGN KEY(tenant_id,decided_by)
   REFERENCES public.lkz_isp_memberships(tenant_id,user_id) ON DELETE RESTRICT
);
ALTER TABLE public.lkz_isp_snapshot_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lkz_isp_snapshot_reviews FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.lkz_isp_snapshot_reviews TO authenticated;
DROP POLICY IF EXISTS lkz_isp_snapshot_reviews_read ON public.lkz_isp_snapshot_reviews;
CREATE POLICY lkz_isp_snapshot_reviews_read ON public.lkz_isp_snapshot_reviews
 FOR SELECT TO authenticated USING(lkz_private.is_global_viewer(tenant_id));

CREATE OR REPLACE FUNCTION public.lkz_isp_review_snapshot(
 p_tenant uuid, p_snapshot uuid, p_decision text, p_rationale text
) RETURNS uuid
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
 uid uuid := (SELECT auth.uid());
 out_id uuid;
BEGIN
 IF uid IS NULL OR COALESCE((SELECT auth.jwt())->>'aal','aal1')<>'aal2' THEN
  RAISE EXCEPTION 'MFA_AAL2_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF NOT (lkz_private.is_system_master() OR EXISTS(
  SELECT 1 FROM public.lkz_isp_memberships m
  WHERE m.tenant_id=p_tenant AND m.user_id=uid AND m.role='gestor'
 )) THEN
  RAISE EXCEPTION 'GESTOR_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF p_decision NOT IN ('approve','reject') OR p_decision IS NULL
   OR p_rationale IS NULL OR pg_catalog.length(pg_catalog.btrim(p_rationale)) NOT BETWEEN 20 AND 4000 THEN
  RAISE EXCEPTION 'INVALID_REVIEW' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.lkz_isp_aggregate_snapshots a
               WHERE a.tenant_id=p_tenant AND a.id=p_snapshot) THEN
  RAISE EXCEPTION 'REPORT_NOT_FOUND' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.lkz_isp_snapshot_reviews(tenant_id,snapshot_id,decision,rationale,decided_by)
 VALUES(p_tenant,p_snapshot,p_decision,pg_catalog.btrim(p_rationale),uid)
 RETURNING id INTO out_id;
 INSERT INTO public.lkz_isp_audit_events(tenant_id,actor_id,event_name,target_id,audit_visibility,details)
 VALUES(p_tenant,uid,
    CASE WHEN p_decision='approve' THEN 'snapshot_review.approved' ELSE 'snapshot_review.rejected' END,
    out_id,
    CASE WHEN lkz_private.is_system_master() THEN 'master_only' ELSE 'standard' END,
    pg_catalog.jsonb_build_object('snapshot_id',p_snapshot,'decision',p_decision));
 RETURN out_id;
END $fn$;
REVOKE ALL ON FUNCTION public.lkz_isp_review_snapshot(uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lkz_isp_review_snapshot(uuid,uuid,text,text) TO authenticated;
COMMIT;
