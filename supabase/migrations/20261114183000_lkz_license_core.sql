-- LKZ ERP: central de licenciamento isolada e aditiva.
-- A semente Ed25519 e gerada DENTRO do PostgreSQL, cifrada pelo Supabase Vault.
-- Nenhum valor privado entra no repositorio, SQL fonte ou navegador.
BEGIN;
CREATE SCHEMA lkz_licensing;
REVOKE ALL ON SCHEMA lkz_licensing FROM PUBLIC, anon, authenticated;
CREATE TABLE lkz_licensing.licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj char(14) NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'),
  product text NOT NULL CHECK (product IN ('lkz-erp','libertyos','barbaros')),
  status text NOT NULL DEFAULT 'suspended' CHECK (status IN ('active','grace','suspended','cancelled')),
  paid_until timestamptz NOT NULL,
  offline_seconds integer NOT NULL DEFAULT 604800 CHECK (offline_seconds BETWEEN 60 AND 604800),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(cnpj,product)
);
CREATE TABLE lkz_licensing.installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id uuid NOT NULL REFERENCES lkz_licensing.licenses(id) ON DELETE RESTRICT,
  installation_id char(64) NOT NULL UNIQUE CHECK (installation_id ~ '^[a-f0-9]{64}$'),
  enabled boolean NOT NULL DEFAULT true,
  minute_start timestamptz,
  minute_hits integer NOT NULL DEFAULT 0 CHECK(minute_hits>=0),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX lkz_license_installation_license_idx ON lkz_licensing.installations(license_id);
CREATE TABLE lkz_licensing.audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  license_id uuid REFERENCES lkz_licensing.licenses(id) ON DELETE RESTRICT,
  actor_id uuid,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  happened_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION lkz_licensing.reject_audit_modification()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $body$
BEGIN
  RAISE EXCEPTION 'Auditoria imutavel.' USING ERRCODE='42501';
END
$body$;
CREATE TRIGGER lkz_license_audit_immutable BEFORE UPDATE OR DELETE
ON lkz_licensing.audit FOR EACH ROW
EXECUTE FUNCTION lkz_licensing.reject_audit_modification();

CREATE TABLE lkz_licensing.signing_config (
  singleton smallint PRIMARY KEY DEFAULT 1 CHECK(singleton=1),
  secret_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- CSPRNG no servidor. A semente NUNCA e retornada pela criacao.
INSERT INTO lkz_licensing.signing_config(singleton,secret_id)
SELECT 1,vault.create_secret(
  encode(extensions.gen_random_bytes(32),'base64'),
  'lkz_license_ed25519_seed_v1',
  'Private Ed25519 signing seed: service-side use only');

ALTER TABLE lkz_licensing.licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE lkz_licensing.installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE lkz_licensing.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE lkz_licensing.signing_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA lkz_licensing FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA lkz_licensing FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA lkz_licensing FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.lkz_license_signing_seed_v1()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE v_seed text;
BEGIN
  SELECT s.decrypted_secret INTO v_seed
  FROM lkz_licensing.signing_config c
  JOIN vault.decrypted_secrets s ON s.id=c.secret_id
  WHERE c.singleton=1;
  IF length(v_seed)<40 THEN
    RAISE EXCEPTION 'Signing key unavailable.' USING ERRCODE='55000';
  END IF;
  RETURN v_seed;
END
$body$;
REVOKE ALL ON FUNCTION public.lkz_license_signing_seed_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lkz_license_signing_seed_v1() TO service_role;

CREATE FUNCTION public.lkz_license_lookup_v1(p_product text,p_installation text,p_cnpj text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE v_l record; v_i lkz_licensing.installations%rowtype; v_now timestamptz:=clock_timestamp();
BEGIN
  IF p_product NOT IN ('lkz-erp','libertyos','barbaros')
    OR p_cnpj !~ '^[0-9]{14}$' OR p_installation !~ '^[a-f0-9]{64}$' THEN
    RETURN NULL;
  END IF;
  SELECT l.id,l.status,l.paid_until,l.offline_seconds INTO v_l
  FROM lkz_licensing.licenses l WHERE l.product=p_product AND l.cnpj=p_cnpj;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_i FROM lkz_licensing.installations
  WHERE license_id=v_l.id AND installation_id=p_installation AND enabled FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_i.minute_start IS NOT NULL
    AND v_i.minute_start>v_now-interval '60 seconds'
    AND v_i.minute_hits>=30 THEN RETURN jsonb_build_object('rate_limited',true); END IF;
  UPDATE lkz_licensing.installations SET last_seen_at=v_now,
    minute_start=CASE WHEN v_i.minute_start>v_now-interval '60 seconds' THEN v_i.minute_start ELSE v_now END,
    minute_hits=CASE WHEN v_i.minute_start>v_now-interval '60 seconds' THEN v_i.minute_hits+1 ELSE 1 END
  WHERE id=v_i.id;
  RETURN jsonb_build_object('licenseId',v_l.id::text,
    'status',v_l.status,
    'paidUntil',extract(epoch from v_l.paid_until)::bigint,
    'offlineSeconds',v_l.offline_seconds);
END
$body$;
REVOKE ALL ON FUNCTION public.lkz_license_lookup_v1(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lkz_license_lookup_v1(text,text,text) TO service_role;

-- Somente MASTER autenticado com MFA pode cadastrar uma instalacao.
-- Registro do pagamento e ato administrativo explicito, nao vindo do cliente Windows.
CREATE FUNCTION public.lkz_license_admin_activate_v1(
 p_product text,p_cnpj text,p_installation text,p_paid_until timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE v_id uuid;
BEGIN
 IF NOT lkz_adm_private.is_master() OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'MASTER com MFA necessario.' USING ERRCODE='42501';
 END IF;
 IF p_product NOT IN ('lkz-erp','libertyos','barbaros')
  OR p_cnpj !~ '^[0-9]{14}$' OR p_installation !~ '^[a-f0-9]{64}$'
  OR p_paid_until IS NULL OR p_paid_until<=clock_timestamp()
  OR p_paid_until>clock_timestamp()+interval '3 years' THEN
  RAISE EXCEPTION 'Dados invalidos.' USING ERRCODE='22023';
 END IF;
 INSERT INTO lkz_licensing.licenses(cnpj,product,status,paid_until)
 VALUES(p_cnpj,p_product,'active',p_paid_until)
 ON CONFLICT(cnpj,product) DO UPDATE SET
  status='active',paid_until=EXCLUDED.paid_until,updated_at=clock_timestamp()
 RETURNING id INTO v_id;
 INSERT INTO lkz_licensing.installations(license_id,installation_id)
 VALUES(v_id,p_installation)
 ON CONFLICT(installation_id) DO UPDATE SET enabled=true
 WHERE lkz_licensing.installations.license_id=EXCLUDED.license_id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Instalacao vinculada a outra licença.' USING ERRCODE='23505';
 END IF;
 INSERT INTO lkz_licensing.audit(license_id,actor_id,action,details)
 VALUES(v_id,auth.uid(),'license.manual_activate',
 jsonb_build_object('product',p_product,'cnpjLast4',right(p_cnpj,4)));
 RETURN jsonb_build_object('id',v_id);
END
$body$;
REVOKE ALL ON FUNCTION public.lkz_license_admin_activate_v1(text,text,text,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.lkz_license_admin_activate_v1(text,text,text,timestamptz) TO authenticated;

CREATE FUNCTION public.lkz_license_admin_status_v1(p_id uuid,p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE v_id uuid;
BEGIN
 IF NOT lkz_adm_private.is_master() OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'MASTER com MFA necessario.' USING ERRCODE='42501';
 END IF;
 IF p_status NOT IN ('active','grace','suspended','cancelled') THEN
  RAISE EXCEPTION 'Estado invalido.' USING ERRCODE='22023';
 END IF;
 UPDATE lkz_licensing.licenses SET status=p_status,updated_at=clock_timestamp()
 WHERE id=p_id RETURNING id INTO v_id;
 IF v_id IS NULL THEN
  RAISE EXCEPTION 'Licenca inexistente.' USING ERRCODE='22023';
 END IF;
 INSERT INTO lkz_licensing.audit(license_id,actor_id,action,details)
 VALUES(v_id,auth.uid(),'license.status_change',
 jsonb_build_object('status',p_status));
 RETURN jsonb_build_object('id',v_id,'status',p_status);
END
$body$;
REVOKE ALL ON FUNCTION public.lkz_license_admin_status_v1(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.lkz_license_admin_status_v1(uuid,text) TO authenticated;
COMMIT;