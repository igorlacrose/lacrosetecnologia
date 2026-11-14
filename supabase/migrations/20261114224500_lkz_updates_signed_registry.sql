-- Repositório de versões para distribuição remota do LKZ ERP.
-- Aditivo: depende de 20261114183000_lkz_license_core.sql.
-- NÃO instala software e NÃO publica versões automaticamente.
-- Assinatura de RELEASES é feita em Darkstar/Osiris com chave separada da licença.
BEGIN;

CREATE TABLE lkz_licensing.update_signers (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9_-]{1,40}$'),
  public_key text NOT NULL CHECK (public_key ~ '^[A-Za-z0-9_-]{43}$'),
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  disabled_at timestamptz,
  CHECK (enabled = false OR disabled_at IS NULL)
);

CREATE TABLE lkz_licensing.update_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product text NOT NULL CHECK (product IN ('lkz-erp','libertyos','barbaros')),
  version text NOT NULL CHECK (version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'),
  platform text NOT NULL DEFAULT 'windows-amd64'
    CHECK (platform='windows-amd64'),
  channel text NOT NULL CHECK (channel IN ('pilot','stable')),
  object_path text NOT NULL CHECK (
    char_length(object_path) BETWEEN 15 AND 256 AND
    object_path ~ '^[a-z0-9-]+/[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}/[A-Za-z0-9._-]{1,128}\.zip$' AND
    position('..' in object_path) = 0 AND
    object_path LIKE product || '/' || version || '/%'
  ),
  package_sha256 text NOT NULL CHECK (package_sha256 ~ '^[a-f0-9]{64}$'),
  package_bytes bigint NOT NULL CHECK (package_bytes BETWEEN 1 AND 1000000000),
  manifest_b64url text NOT NULL CHECK (
    char_length(manifest_b64url) BETWEEN 64 AND 4096 AND
    manifest_b64url ~ '^[A-Za-z0-9_-]+$'
  ),
  signature_b64url text NOT NULL CHECK (signature_b64url ~ '^[A-Za-z0-9_-]{86}$'),
  signing_key_id text NOT NULL REFERENCES lkz_licensing.update_signers(id),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','revoked')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by uuid,
  approved_at timestamptz,
  approved_by uuid,
  published_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (product, version, platform, channel),
  CHECK (
    status <> 'published' OR
    (approved_at IS NOT NULL AND approved_by IS NOT NULL
     AND published_at IS NOT NULL AND revoked_at IS NULL)
  )
);

CREATE TABLE lkz_licensing.update_pilot_targets (
  release_id uuid NOT NULL REFERENCES lkz_licensing.update_releases(id)
    ON DELETE RESTRICT,
  license_id uuid NOT NULL REFERENCES lkz_licensing.licenses(id)
    ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(release_id,license_id)
);
CREATE INDEX lkz_updates_available_idx ON lkz_licensing.update_releases
 (product,platform,channel,status,published_at);
CREATE INDEX lkz_updates_target_by_license ON lkz_licensing.update_pilot_targets
 (license_id,release_id);

ALTER TABLE lkz_licensing.update_signers ENABLE ROW LEVEL SECURITY;
ALTER TABLE lkz_licensing.update_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE lkz_licensing.update_pilot_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA lkz_licensing
FROM PUBLIC,anon,authenticated,service_role;
-- Impede também alterações anônimas por REST mesmo se o schema for exposto.
REVOKE ALL ON SCHEMA lkz_licensing FROM PUBLIC,anon,authenticated,service_role;

-- Consultas apenas de instalações autorizadas. Uma chamada não publica,
-- não altera releases e não concede permissão de download a terceiros.
CREATE FUNCTION public.lkz_updates_candidate_v1(
 p_cnpj text,p_installation text,p_product text,p_current_version text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE v_license uuid; v_release record;
BEGIN
 IF p_cnpj !~ '^[0-9]{14}$'
  OR p_installation !~ '^[a-f0-9]{64}$'
  OR p_product NOT IN ('lkz-erp','libertyos','barbaros')
  OR p_current_version !~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'
 THEN RETURN NULL; END IF;

 SELECT l.id INTO v_license
 FROM lkz_licensing.licenses l
 JOIN lkz_licensing.installations i ON i.license_id=l.id
 WHERE l.cnpj=p_cnpj AND l.product=p_product
   AND i.installation_id=p_installation AND i.enabled
 LIMIT 1;
 IF v_license IS NULL THEN RETURN NULL; END IF;

 SELECT r.id,r.product,r.version,r.platform,r.channel,r.object_path,
        r.package_sha256,r.package_bytes,r.manifest_b64url,
        r.signature_b64url,r.signing_key_id,s.public_key
 INTO v_release
 FROM lkz_licensing.update_releases r
 JOIN lkz_licensing.update_signers s ON s.id=r.signing_key_id
 WHERE r.product=p_product AND r.platform='windows-amd64'
   AND r.status='published' AND r.published_at IS NOT NULL
   AND s.enabled AND s.disabled_at IS NULL
   AND (
     r.channel='stable' OR
     (r.channel='pilot' AND EXISTS (
       SELECT 1 FROM lkz_licensing.update_pilot_targets t
       WHERE t.release_id=r.id AND t.license_id=v_license
     ))
   )
   AND (
      split_part(r.version,'.',1)::integer,
      split_part(r.version,'.',2)::integer,
      split_part(r.version,'.',3)::integer
   ) > (
      split_part(p_current_version,'.',1)::integer,
      split_part(p_current_version,'.',2)::integer,
      split_part(p_current_version,'.',3)::integer
   )
 ORDER BY split_part(r.version,'.',1)::integer DESC,
          split_part(r.version,'.',2)::integer DESC,
          split_part(r.version,'.',3)::integer DESC,
          CASE WHEN r.channel='stable' THEN 0 ELSE 1 END
 LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object(
   'releaseId',v_release.id::text,
   'product',v_release.product,
   'version',v_release.version,
   'platform',v_release.platform,
   'channel',v_release.channel,
   'objectPath',v_release.object_path,
   'sha256',v_release.package_sha256,
   'sizeBytes',v_release.package_bytes,
   'manifest',v_release.manifest_b64url,
   'signature',v_release.signature_b64url,
   'keyId',v_release.signing_key_id,
   'publicKey',v_release.public_key
 );
END
$body$;
REVOKE ALL ON FUNCTION public.lkz_updates_candidate_v1(text,text,text,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lkz_updates_candidate_v1(text,text,text,text)
TO service_role;
COMMIT;
