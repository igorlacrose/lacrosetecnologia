-- OCA IA — medidor transacional do orçamento mensal (proposta: NÃO executar sem backup).
-- Segurança financeira: reserva conservadora por chamada, sem estorno automático.
-- O limite máximo de referência é US$ 2,00/mês, inferior ao teto desejado em
-- BRL sob o câmbio de planejamento. Verificar câmbio, tributos e fatura real.
-- Não armazena prompts, conversas ou dados pessoais.
BEGIN;

CREATE TABLE IF NOT EXISTS lkz_adm_private.oca_ai_monthly_usage (
  tenant_slug text NOT NULL CHECK (tenant_slug = 'lacrose-tecnologia'),
  month_utc date NOT NULL,
  reserved_micro_usd bigint NOT NULL DEFAULT 0 CHECK (reserved_micro_usd >= 0),
  reservation_count bigint NOT NULL DEFAULT 0 CHECK (reservation_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_slug,month_utc)
);

ALTER TABLE lkz_adm_private.oca_ai_monthly_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE lkz_adm_private.oca_ai_monthly_usage
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.oca_ai_reserve_monthly(
  p_micro_usd integer,
  p_limit_micro_usd integer
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  v_day date := date_trunc('month',now() AT TIME ZONE 'UTC')::date;
  v_allowed bigint;
BEGIN
  -- O endpoint autoriza somente service_role; mesmo com chave servidor
  -- incorretamente configurada, a função bloqueia qualquer teto excessivo.
  IF p_micro_usd IS DISTINCT FROM 2000 OR p_limit_micro_usd IS NULL
     OR p_limit_micro_usd < 2000 OR p_limit_micro_usd > 2000000 THEN
    RETURN false;
  END IF;

  INSERT INTO lkz_adm_private.oca_ai_monthly_usage(
    tenant_slug,month_utc,reserved_micro_usd,reservation_count
  )
  VALUES ('lacrose-tecnologia',v_day,p_micro_usd,1)
  ON CONFLICT (tenant_slug,month_utc) DO UPDATE
    SET reserved_micro_usd=lkz_adm_private.oca_ai_monthly_usage.reserved_micro_usd
        + EXCLUDED.reserved_micro_usd,
        reservation_count=lkz_adm_private.oca_ai_monthly_usage.reservation_count+1,
        updated_at=now()
    WHERE lkz_adm_private.oca_ai_monthly_usage.reserved_micro_usd
          <= p_limit_micro_usd-EXCLUDED.reserved_micro_usd
  RETURNING reserved_micro_usd INTO v_allowed;

  RETURN v_allowed IS NOT NULL;
END;
$body$;

REVOKE ALL ON FUNCTION public.oca_ai_reserve_monthly(integer,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.oca_ai_reserve_monthly(integer,integer)
  TO service_role;

COMMIT;
