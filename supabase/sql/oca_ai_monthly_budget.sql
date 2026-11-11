-- OCA IA — orçamento mensal transacional com controle de replay de Turnstile.
-- MIGRAÇÃO AINDA NÃO EXECUTADA. Exige backup, homologação e revisão de grants.
-- Cada chamada paga reserva US$ 0,002; máximo de US$ 2,00/mês (UTC).
-- Não armazena perguntas, respostas, IPs, e-mails nem tokens do widget em claro.
BEGIN;

CREATE TABLE IF NOT EXISTS lkz_adm_private.oca_ai_monthly_usage (
  tenant_slug text NOT NULL CHECK (tenant_slug='lacrose-tecnologia'),
  month_utc date NOT NULL,
  reserved_micro_usd bigint NOT NULL DEFAULT 0 CHECK (reserved_micro_usd>=0),
  reservation_count bigint NOT NULL DEFAULT 0 CHECK (reservation_count>=0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_slug,month_utc)
);

CREATE TABLE IF NOT EXISTS lkz_adm_private.oca_ai_token_claims (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  month_utc date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lkz_adm_private.oca_ai_monthly_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE lkz_adm_private.oca_ai_token_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE lkz_adm_private.oca_ai_monthly_usage,
  lkz_adm_private.oca_ai_token_claims FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.oca_ai_reserve_monthly(
  p_micro_usd integer,
  p_limit_micro_usd integer,
  p_token_hash text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  v_day date := date_trunc('month',now() AT TIME ZONE 'UTC')::date;
  v_allowed bigint;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' OR
     p_micro_usd IS DISTINCT FROM 2000 OR p_limit_micro_usd IS NULL OR
     p_limit_micro_usd < 2000 OR p_limit_micro_usd > 2000000 THEN
    RETURN false;
  END IF;

  -- Claim único e reserva executam dentro da mesma transação PostgreSQL.
  -- Isso bloqueia cobrança dupla mesmo durante convergência do Siteverify.
  INSERT INTO lkz_adm_private.oca_ai_token_claims(token_hash,month_utc)
    VALUES(p_token_hash,v_day)
    ON CONFLICT (token_hash) DO NOTHING;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO lkz_adm_private.oca_ai_monthly_usage(
    tenant_slug,month_utc,reserved_micro_usd,reservation_count
  )
  VALUES('lacrose-tecnologia',v_day,p_micro_usd,1)
  ON CONFLICT (tenant_slug,month_utc) DO UPDATE
    SET reserved_micro_usd=lkz_adm_private.oca_ai_monthly_usage.reserved_micro_usd
        + EXCLUDED.reserved_micro_usd,
        reservation_count=lkz_adm_private.oca_ai_monthly_usage.reservation_count+1,
        updated_at=now()
    WHERE lkz_adm_private.oca_ai_monthly_usage.reserved_micro_usd
          <= p_limit_micro_usd-EXCLUDED.reserved_micro_usd
  RETURNING reserved_micro_usd INTO v_allowed;

  IF v_allowed IS NULL THEN
    DELETE FROM lkz_adm_private.oca_ai_token_claims
      WHERE token_hash=p_token_hash;
    RETURN false;
  END IF;
  RETURN true;
END;
$body$;

REVOKE ALL ON FUNCTION public.oca_ai_reserve_monthly(integer,integer,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.oca_ai_reserve_monthly(integer,integer,text)
  TO service_role;

COMMIT;
