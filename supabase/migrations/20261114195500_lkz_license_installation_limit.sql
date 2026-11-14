-- LKZ licensing: 1 instalação ativa por licença (configurável até 10).
-- Nenhuma operação pública é acrescentada. Adicional e não destrutiva.
BEGIN;
ALTER TABLE lkz_licensing.licenses
ADD COLUMN max_installations smallint NOT NULL DEFAULT 1
CHECK (max_installations BETWEEN 1 AND 10);

-- Se uma instalação antiga exceder o novo padrão, abortar a migração
-- em vez de suspender instalações silenciosamente.
DO $$
BEGIN
 IF EXISTS (
   SELECT 1 FROM lkz_licensing.installations
   WHERE enabled GROUP BY license_id HAVING count(*) > 1
 ) THEN
   RAISE EXCEPTION 'Licenças com múltiplas instalações: revisar antes da migração.'
     USING ERRCODE='23514';
 END IF;
END $$;

-- Somente chamadas internas por funções privilegiadas; sem GRANT à API.
-- FOR UPDATE na licença serializa ativações concorrentes da mesma licença.
CREATE FUNCTION lkz_licensing.claim_installation_v1(
 p_license uuid,p_installation text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $body$
DECLARE v_limit smallint;v_count integer;v_owner uuid;v_enabled boolean;
        v_exists boolean:=false;
BEGIN
 IF p_license IS NULL OR p_installation !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'Instalação inválida.' USING ERRCODE='22023';
 END IF;
 SELECT max_installations INTO v_limit
 FROM lkz_licensing.licenses WHERE id=p_license FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Licença desconhecida.' USING ERRCODE='22023';
 END IF;
 SELECT license_id,enabled INTO v_owner,v_enabled
 FROM lkz_licensing.installations WHERE installation_id=p_installation FOR UPDATE;
 v_exists:=FOUND;
 IF v_exists AND v_owner<>p_license THEN
  RAISE EXCEPTION 'Instalação já pertence a outra licença.' USING ERRCODE='23505';
 END IF;
 IF v_exists AND v_enabled THEN RETURN true; END IF;
 SELECT count(*) INTO v_count FROM lkz_licensing.installations
 WHERE license_id=p_license AND enabled;
 IF v_count>=v_limit THEN
  RAISE EXCEPTION 'Limite de instalações atingido.' USING ERRCODE='23514';
 END IF;
 IF v_exists THEN
  UPDATE lkz_licensing.installations SET enabled=true
  WHERE license_id=p_license AND installation_id=p_installation;
 ELSE
  INSERT INTO lkz_licensing.installations(license_id,installation_id)
  VALUES(p_license,p_installation);
 END IF;
 RETURN true;
END
$body$;
REVOKE ALL ON FUNCTION lkz_licensing.claim_installation_v1(uuid,text)
FROM PUBLIC,anon,authenticated,service_role;

-- Corrige ativação futura: bloqueia reativar licença cancelada e
-- usa limite serializado de instalações.
CREATE OR REPLACE FUNCTION public.lkz_license_admin_activate_v1(
 p_product text,p_cnpj text,p_installation text,p_paid_until timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE v_id uuid;v_prior_status text;
BEGIN
 IF NOT lkz_adm_private.is_master() OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'MASTER com MFA necessário.' USING ERRCODE='42501';
 END IF;
 IF p_product NOT IN ('lkz-erp','libertyos','barbaros')
   OR p_cnpj !~ '^[0-9]{14}$' OR p_installation !~ '^[a-f0-9]{64}$'
   OR p_paid_until IS NULL OR p_paid_until<=clock_timestamp()
   OR p_paid_until>clock_timestamp()+interval '3 years' THEN
  RAISE EXCEPTION 'Dados inválidos.' USING ERRCODE='22023';
 END IF;
 SELECT status INTO v_prior_status FROM lkz_licensing.licenses
 WHERE cnpj=p_cnpj AND product=p_product FOR UPDATE;
 IF v_prior_status='cancelled' THEN
  RAISE EXCEPTION 'Licença cancelada: reativação exige revisão.'
    USING ERRCODE='42501';
 END IF;
 INSERT INTO lkz_licensing.licenses(cnpj,product,status,paid_until)
 VALUES(p_cnpj,p_product,'active',p_paid_until)
 ON CONFLICT(cnpj,product) DO UPDATE SET
  status='active',paid_until=EXCLUDED.paid_until,updated_at=clock_timestamp()
 RETURNING id INTO v_id;
 PERFORM lkz_licensing.claim_installation_v1(v_id,p_installation);
 INSERT INTO lkz_licensing.audit(license_id,actor_id,action,details)
 VALUES(v_id,auth.uid(),'license.manual_activate',
 jsonb_build_object('product',p_product,'cnpjLast4',right(p_cnpj,4),
                    'installationConfigured',true));
 RETURN jsonb_build_object('id',v_id);
END
$body$;
-- Não reabrir as RPCs administrativas: validação MASTER+MFA pendente.
REVOKE ALL ON FUNCTION public.lkz_license_admin_activate_v1(text,text,text,timestamptz)
FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
