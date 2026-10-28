-- LKZ ISP v1.3 / 2026-10-28
-- Migracao aplicada somente ao projeto syysqoieyycclpfbadwp.
-- Base esperada: migrations LKZ ISP v1.0/1.1. Sem chaves de API ou PII.
-- Executar uma única vez; rollback de esquema deve ser planejado separadamente.
BEGIN;
INSERT INTO public.lkz_isp_sectors(tenant_id,name)
SELECT DISTINCT a.tenant_id,k.name FROM public.lkz_isp_aggregate_snapshots a
CROSS JOIN LATERAL jsonb_object_keys(a.snapshot->'sectors') AS k(name)
WHERE length(btrim(k.name)) BETWEEN 2 AND 80
ON CONFLICT(tenant_id,name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.lkz_isp_get_sector_snapshots(p_tenant uuid)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
SELECT jsonb_build_object(
 'id',a.id,'tenant_id',a.tenant_id,'fingerprint',a.fingerprint,
 'snapshot',jsonb_build_object(
  'fingerprint',a.fingerprint,'schema',a.snapshot->'schema','source','IXC — setor',
  'importedAt',a.snapshot->'importedAt',
  'referenceDate',a.snapshot->'referenceDate','earliest',a.snapshot->'earliest','latest',a.snapshot->'latest',
  'sectorOnly',true,'sectorName',sec.name,
  'total',coalesce((a.snapshot->'sectors'->sec.name->>'total')::int,0),
  'finalized',coalesce((a.snapshot->'sectors'->sec.name->>'finalized')::int,0),
  'pending',coalesce((a.snapshot->'sectors'->sec.name->>'pending')::int,0),
  'pendingOlder7d',coalesce((a.snapshot->'sectors'->sec.name->>'age7')::int,0),
  'closedOver24',coalesce((a.snapshot->'sectors'->sec.name->>'over24')::int,0),
  'sectors',jsonb_build_object(sec.name,a.snapshot->'sectors'->sec.name),
  'subjects','{}'::jsonb,'cities','{}'::jsonb,'daily','{}'::jsonb
 ))
FROM public.lkz_isp_memberships m
JOIN public.lkz_isp_sectors sec ON sec.tenant_id=m.tenant_id AND sec.id=m.sector_id
JOIN public.lkz_isp_aggregate_snapshots a ON a.tenant_id=m.tenant_id
WHERE m.tenant_id=p_tenant AND m.user_id=(SELECT auth.uid())
 AND m.role IN ('lider_setor'::public.lkz_isp_role,'financeiro'::public.lkz_isp_role)
 AND coalesce((SELECT auth.jwt())->>'aal','aal1')='aal2'
 AND jsonb_typeof(a.snapshot->'sectors'->sec.name)='object'
ORDER BY a.created_at DESC,a.id DESC LIMIT 10000;
$function$
;

REVOKE ALL ON FUNCTION public.lkz_isp_get_sector_snapshots(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lkz_isp_get_sector_snapshots(uuid) TO authenticated,service_role;

ALTER TABLE public.lkz_isp_aggregate_snapshots
 ADD CONSTRAINT lkz_isp_agg_tenant_id_unique UNIQUE(tenant_id,id);

CREATE TABLE public.lkz_isp_snapshot_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 snapshot_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('approve','reject')),
 rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 20 AND 2000),
 reviewed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 reviewed_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT lkz_isp_review_snapshot_fk FOREIGN KEY(tenant_id,snapshot_id)
  REFERENCES public.lkz_isp_aggregate_snapshots(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT lkz_isp_review_member_fk FOREIGN KEY(tenant_id,reviewed_by)
  REFERENCES public.lkz_isp_memberships(tenant_id,user_id) ON DELETE RESTRICT,
 CONSTRAINT lkz_isp_review_one_per_snapshot UNIQUE(tenant_id,snapshot_id)
);
ALTER TABLE public.lkz_isp_snapshot_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY lkz_isp_review_read ON public.lkz_isp_snapshot_reviews
 FOR SELECT TO authenticated USING(lkz_private.is_global_viewer(tenant_id));
CREATE POLICY lkz_isp_review_insert ON public.lkz_isp_snapshot_reviews
 FOR INSERT TO authenticated
 WITH CHECK(reviewed_by=(SELECT auth.uid()) AND lkz_private.is_gestor(tenant_id));
REVOKE ALL ON public.lkz_isp_snapshot_reviews FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.lkz_isp_snapshot_reviews TO authenticated;
GRANT ALL ON public.lkz_isp_snapshot_reviews TO service_role;

CREATE OR REPLACE FUNCTION lkz_private.lkz_isp_audit_snapshot_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 INSERT INTO public.lkz_isp_audit_events (tenant_id,actor_id,event_name,target_id,audit_visibility,details)
 VALUES (NEW.tenant_id,NEW.reviewed_by,
  CASE WHEN NEW.decision='approve' THEN 'snapshot.review_approved' ELSE 'snapshot.review_rejected' END,
  NEW.snapshot_id,
  CASE WHEN lkz_private.is_system_master_uid(NEW.reviewed_by) THEN 'master_only' ELSE 'standard' END,
  jsonb_build_object('review_id',NEW.id,'decision',NEW.decision));
 RETURN NEW;
END $function$
;

REVOKE ALL ON FUNCTION lkz_private.lkz_isp_audit_snapshot_review() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER lkz_isp_snapshot_review_audit AFTER INSERT ON public.lkz_isp_snapshot_reviews
 FOR EACH ROW EXECUTE FUNCTION lkz_private.lkz_isp_audit_snapshot_review();

DROP POLICY lkz_aggregates_write ON public.lkz_isp_aggregate_snapshots;
CREATE POLICY lkz_aggregates_write ON public.lkz_isp_aggregate_snapshots
 FOR INSERT TO authenticated
 WITH CHECK(created_by=(SELECT auth.uid()) AND lkz_private.is_system_master());
DROP POLICY lkz_employee_write_manager ON public.lkz_isp_employee_metrics;
CREATE POLICY lkz_employee_write_manager ON public.lkz_isp_employee_metrics
 FOR INSERT TO authenticated
 WITH CHECK(created_by=(SELECT auth.uid()) AND lkz_private.is_system_master());

CREATE OR REPLACE FUNCTION lkz_private.may_invite(p_tenant uuid, p_role lkz_isp_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT p_role<>'master'::public.lkz_isp_role AND lkz_private.is_system_master()
 AND EXISTS(SELECT 1 FROM public.lkz_isp_memberships m WHERE m.tenant_id=p_tenant
            AND m.user_id=(SELECT auth.uid()) AND m.role='master');
$function$
;
CREATE OR REPLACE FUNCTION lkz_private.lkz_isp_authorized_inviter(p_actor uuid, p_tenant uuid, p_role lkz_isp_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT p_role<>'master'::public.lkz_isp_role
 AND EXISTS (SELECT 1 FROM public.lkz_isp_memberships m
 JOIN lkz_private.lkz_isp_system_masters sm ON sm.user_id=m.user_id AND sm.active
 WHERE m.tenant_id=p_tenant AND m.user_id=p_actor AND m.role='master');
$function$
;
CREATE OR REPLACE FUNCTION public.lkz_isp_save_snapshot_with_employees(p_tenant uuid, p_snapshot jsonb, p_employees jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
 uid uuid := (SELECT auth.uid());
 fp text := p_snapshot->>'fingerprint';
 snap_id uuid;
 item jsonb;
 k text;
 sum_assigned integer := 0;
 inserted integer := 0;
BEGIN
 IF uid IS NULL OR NOT lkz_private.is_system_master() THEN
  RAISE EXCEPTION 'MASTER com MFA necessário' USING ERRCODE='42501'; END IF;
 IF fp IS NULL OR fp !~ '^[a-f0-9]{64}$'
    OR NOT lkz_private.is_valid_aggregate(p_snapshot) THEN
  RAISE EXCEPTION 'Resumo inválido ou dados não saneados' USING ERRCODE='23514'; END IF;
 IF p_employees IS NULL OR pg_catalog.jsonb_typeof(p_employees)<>'array'
    OR pg_catalog.jsonb_array_length(p_employees)>500 THEN
  RAISE EXCEPTION 'Lista de colaboradores inválida' USING ERRCODE='23514'; END IF;

 -- Validar estritamente cada objeto; campos de cliente jamais podem ser gravados.
 FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_employees) LOOP
  IF pg_catalog.jsonb_typeof(item)<>'object' THEN RAISE EXCEPTION 'Entrada de colaborador inválida' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(item))<>8 THEN
   RAISE EXCEPTION 'Campos de colaborador não autorizados' USING ERRCODE='23514'; END IF;
  FOR k IN SELECT pg_catalog.jsonb_object_keys(item) LOOP
   IF k<>ALL(ARRAY['name','sector','total','finalized','pending','closedWithDates','closedOver24','pendingOlder7d']) THEN
    RAISE EXCEPTION 'Campo de colaborador não autorizado' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF pg_catalog.jsonb_typeof(item->'name')<>'string'
    OR pg_catalog.jsonb_typeof(item->'sector')<>'string' THEN
    RAISE EXCEPTION 'Nome ou setor inválido' USING ERRCODE='23514'; END IF;
  FOR k IN SELECT pg_catalog.unnest(ARRAY['total','finalized','pending','closedWithDates','closedOver24','pendingOlder7d']) LOOP
   IF pg_catalog.jsonb_typeof(item->k)<>'number'
     OR item->>k !~ '^[0-9]{1,5}$'
     OR (item->>k)::integer>50000 THEN RAISE EXCEPTION 'Contagem inválida' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF (item->>'total')::int<1 OR (item->>'total')::int<>(item->>'finalized')::int+(item->>'pending')::int
    OR (item->>'closedWithDates')::int>(item->>'finalized')::int
    OR (item->>'closedOver24')::int>(item->>'closedWithDates')::int
    OR (item->>'pendingOlder7d')::int>(item->>'pending')::int THEN
    RAISE EXCEPTION 'Contagens inconsistentes' USING ERRCODE='23514'; END IF;
  sum_assigned:=sum_assigned+(item->>'total')::int;
 END LOOP;
 IF sum_assigned>(p_snapshot->>'total')::int THEN
   RAISE EXCEPTION 'Quantidade atribuída maior que o total' USING ERRCODE='23514'; END IF;

 INSERT INTO public.lkz_isp_aggregate_snapshots(tenant_id,fingerprint,snapshot,created_by)
 VALUES(p_tenant,fp,p_snapshot,uid)
 ON CONFLICT(tenant_id,fingerprint) DO NOTHING
 RETURNING id INTO snap_id;
 IF snap_id IS NULL THEN
   SELECT id INTO snap_id FROM public.lkz_isp_aggregate_snapshots
   WHERE tenant_id=p_tenant AND fingerprint=fp AND snapshot=p_snapshot;
   IF snap_id IS NULL THEN RAISE EXCEPTION 'Hash reutilizado com conteúdo divergente' USING ERRCODE='23514'; END IF;
 END IF;

 SELECT count(*) INTO inserted FROM public.lkz_isp_employee_metrics
 WHERE tenant_id=p_tenant AND snapshot_fingerprint=fp;
 IF inserted>0 THEN
  -- Repetição idempotente SOMENTE quando todas as linhas e métricas coincidem.
  IF inserted<>pg_catalog.jsonb_array_length(p_employees) OR EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_employees) AS e(item)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.lkz_isp_employee_metrics z
      WHERE z.tenant_id=p_tenant AND z.snapshot_fingerprint=fp
        AND z.employee_name=e.item->>'name'
        AND z.sector_label=e.item->>'sector'
        AND z.total=(e.item->>'total')::int
        AND z.finalized=(e.item->>'finalized')::int
        AND z.pending=(e.item->>'pending')::int
        AND z.closed_with_dates=(e.item->>'closedWithDates')::int
        AND z.closed_over_24=(e.item->>'closedOver24')::int
        AND z.pending_older_7d=(e.item->>'pendingOlder7d')::int
    )
  ) THEN
   RAISE EXCEPTION 'Histórico individual não coincide; nenhuma alteração foi feita' USING ERRCODE='23505';
  END IF;
  RETURN snap_id;
 END IF;

 FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_employees) LOOP
   INSERT INTO public.lkz_isp_employee_metrics(
      tenant_id,snapshot_fingerprint,employee_name,sector_label,
      total,finalized,pending,closed_with_dates,closed_over_24,pending_older_7d,created_by)
   VALUES(p_tenant,fp,item->>'name',item->>'sector',
      (item->>'total')::int,(item->>'finalized')::int,(item->>'pending')::int,
      (item->>'closedWithDates')::int,(item->>'closedOver24')::int,(item->>'pendingOlder7d')::int,uid);
 END LOOP;
 RETURN snap_id;
END $function$
;

COMMIT;
