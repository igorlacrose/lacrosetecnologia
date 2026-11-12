-- LKZ ADM: um único tipo de documento interno por proposta.
-- Exclusão mútua no PostgreSQL, inclusive sob concorrência; não habilita assinatura,
-- aceite, cobrança, transmissão, PDF, Storage nem provisionamento.
--
-- Executar como migração transacional. LOCKs preservam consistência ao
-- migrar registros preexistentes; uma colisão impede a migração inteira.
BEGIN;

LOCK TABLE lkz_adm_private.signature_dossiers,
           lkz_adm_private.contract_text_previews
IN SHARE ROW EXCLUSIVE MODE;

DO $lkz_check$
BEGIN
 IF EXISTS (
   SELECT 1
   FROM lkz_adm_private.signature_dossiers d
   JOIN lkz_adm_private.contract_text_previews t USING (quote_id)
 ) THEN
   RAISE EXCEPTION
     'Conflito documental preexistente: dossiê manual e minuta textual na mesma proposta. Corrija sem excluir evidências.'
     USING ERRCODE = '23514';
 END IF;
END
$lkz_check$;

CREATE TABLE lkz_adm_private.contract_document_claims (
 quote_id uuid PRIMARY KEY REFERENCES lkz_adm_private.client_quotes(id) ON DELETE RESTRICT,
 document_kind text NOT NULL CHECK (document_kind IN ('legacy_dossier','server_text')),
 document_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (document_kind,document_id)
);
ALTER TABLE lkz_adm_private.contract_document_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE lkz_adm_private.contract_document_claims
 FROM PUBLIC, anon, authenticated;

-- A referência reservada é persistente, inclusive após invalidação do dossiê.
-- Se já houve documento nessa proposta, exige-se nova versão comercial.
INSERT INTO lkz_adm_private.contract_document_claims
 (quote_id,document_kind,document_id)
SELECT quote_id,'legacy_dossier',id
FROM lkz_adm_private.signature_dossiers
UNION ALL
SELECT quote_id,'server_text',id
FROM lkz_adm_private.contract_text_previews;

CREATE FUNCTION lkz_adm_private.claim_contract_document()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = '' AS $lkz_claim$
DECLARE
 v_quote uuid;
 v_kind text;
BEGIN
 IF TG_OP <> 'INSERT' OR NEW.quote_id IS NULL
   OR NEW.id IS NULL OR TG_NARGS <> 1
   OR TG_ARGV[0] NOT IN ('legacy_dossier','server_text') THEN
   RAISE EXCEPTION 'Reserva documental inválida.' USING ERRCODE='22023';
 END IF;

 -- O índice UNIQUE/PRIMARY KEY serializa inserções concorrentes
 -- independentemente do snapshot de cada função RPC.
 INSERT INTO lkz_adm_private.contract_document_claims
  (quote_id,document_kind,document_id)
 VALUES (NEW.quote_id,TG_ARGV[0],NEW.id)
 ON CONFLICT (quote_id) DO NOTHING
 RETURNING quote_id INTO v_quote;

 IF v_quote IS NOT NULL THEN
   RETURN NEW;
 END IF;

 SELECT document_kind INTO v_kind
 FROM lkz_adm_private.contract_document_claims
 WHERE quote_id=NEW.quote_id;

 IF v_kind IS DISTINCT FROM TG_ARGV[0] THEN
   RAISE EXCEPTION
     'Proposta já reservada por outro tipo de documento; use nova versão.'
     USING ERRCODE='40001';
 END IF;

 -- Mesma categoria e proposta: não insere uma segunda linha.
 -- As RPCs originais distinguem retentativa idempotente de operação diferente.
 RETURN NULL;
END
$lkz_claim$;

CREATE TRIGGER contract_text_exclusive_claim
BEFORE INSERT ON lkz_adm_private.contract_text_previews
FOR EACH ROW EXECUTE FUNCTION lkz_adm_private.claim_contract_document('server_text');

CREATE TRIGGER signature_dossier_exclusive_claim
BEFORE INSERT ON lkz_adm_private.signature_dossiers
FOR EACH ROW EXECUTE FUNCTION lkz_adm_private.claim_contract_document('legacy_dossier');

REVOKE ALL ON FUNCTION lkz_adm_private.claim_contract_document()
 FROM PUBLIC, anon, authenticated;

-- Reconciliar a indicação da interface com a regra efetiva do banco.
-- Preserva a assinatura, checagem MFA, formato JSON e semântica da função original.
CREATE OR REPLACE FUNCTION lkz_adm_private.list_signature_dossiers(p_contact uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $lkz_list$
DECLARE v_draft_version integer:=0;
BEGIN
 IF NOT lkz_adm_private.is_operator() OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Operador com MFA necessário.' USING ERRCODE='42501';
 END IF;
 IF p_contact IS NULL OR NOT EXISTS(SELECT 1 FROM public.contacts WHERE id=p_contact) THEN
  RAISE EXCEPTION 'Cliente inexistente.' USING ERRCODE='22023';
 END IF;
 SELECT version INTO v_draft_version
 FROM lkz_adm_private.client_contract_drafts WHERE contact_id=p_contact;
 RETURN jsonb_build_object(
  'signature_enabled',false,'customer_accepted',false,
  'billing_enabled',false,'provisioning_enabled',false,
  'quotes',coalesce((
   SELECT jsonb_agg(jsonb_build_object(
     'id',q.id,'draft_version',q.draft_version,'status',q.status,
     'current',q.draft_version=coalesce(v_draft_version,0),
     'eligible',q.status='prepared' AND q.draft_version=coalesce(v_draft_version,0)
       AND d.id IS NULL
       AND NOT EXISTS(
         SELECT 1 FROM lkz_adm_private.contract_text_previews t WHERE t.quote_id=q.id
       ),
     'dossier',CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object(
       'id',d.id,'status',d.status,'terms_version',d.terms_version,
       'document_ref',d.document_ref,'document_sha256',d.document_sha256,
       'prepared_at',d.prepared_at,'void_reason',d.void_reason,
       'signature_enabled',false,'customer_accepted',false,
       'billing_enabled',false,'provisioning_enabled',false) END
   ) ORDER BY q.prepared_at DESC,q.id DESC)
   FROM (SELECT * FROM lkz_adm_private.client_quotes
     WHERE contact_id=p_contact ORDER BY prepared_at DESC,id DESC LIMIT 30) q
   LEFT JOIN lkz_adm_private.signature_dossiers d ON d.quote_id=q.id
  ),'[]'::jsonb)
 );
END
$lkz_list$;

COMMIT;
