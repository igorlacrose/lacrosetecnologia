-- PostgreSQL 17 smoke: esquema fictício e migração real.
-- Executar SOMENTE em banco descartável.
\set ON_ERROR_STOP on

CREATE SCHEMA lkz_adm_private;
CREATE SCHEMA auth;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT '11111111-1111-4111-8111-111111111111'::uuid $$;
CREATE FUNCTION lkz_adm_private.is_operator() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT true $$;

CREATE TABLE public.contacts (id uuid PRIMARY KEY);
CREATE TABLE lkz_adm_private.client_quotes (
 id uuid PRIMARY KEY, contact_id uuid NOT NULL REFERENCES public.contacts(id),
 draft_version integer NOT NULL, status text NOT NULL,
 prepared_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lkz_adm_private.client_contract_drafts (
 contact_id uuid PRIMARY KEY REFERENCES public.contacts(id), version integer NOT NULL
);
CREATE TABLE lkz_adm_private.signature_dossiers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid UNIQUE NOT NULL
 REFERENCES lkz_adm_private.client_quotes(id),
 contact_id uuid NOT NULL, request_id uuid UNIQUE NOT NULL,
 terms_version text NOT NULL, document_ref text NOT NULL, document_sha256 text NOT NULL,
 status text NOT NULL DEFAULT 'prepared',
 prepared_at timestamptz NOT NULL DEFAULT now(), void_reason text
);
CREATE TABLE lkz_adm_private.contract_text_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid UNIQUE NOT NULL
 REFERENCES lkz_adm_private.client_quotes(id), contact_id uuid NOT NULL
);

-- Exercita a migração como será versionada, sem duplicar função/trigger em fixture.
\i supabase/migrations/20261112233300_lkz_adm_documentos_exclusivos_por_proposta.sql

INSERT INTO public.contacts VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO lkz_adm_private.client_contract_drafts VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1);
INSERT INTO lkz_adm_private.client_quotes (id,contact_id,draft_version,status)
VALUES
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'prepared'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'prepared'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'prepared');

INSERT INTO lkz_adm_private.contract_text_previews (id,quote_id,contact_id)
VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO lkz_adm_private.signature_dossiers
 (id,quote_id,contact_id,request_id,terms_version,document_ref,document_sha256)
VALUES ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2','v1','DOC-TEST-0002',repeat('a',64));

DO $lkz_assert$
DECLARE v_count integer; v_eligible text;
BEGIN
 -- Minuta existente proíbe dossiê para a MESMA proposta.
 BEGIN
  INSERT INTO lkz_adm_private.signature_dossiers
   (quote_id,contact_id,request_id,terms_version,document_ref,document_sha256)
  VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','v1','DOC-TEST-0001',repeat('a',64));
  RAISE EXCEPTION 'FALHA: dossiê coexistiu com minuta';
 EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
 END;

 -- Dossiê existente proíbe minuta para a MESMA proposta.
 BEGIN
  INSERT INTO lkz_adm_private.contract_text_previews (quote_id,contact_id)
  VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  RAISE EXCEPTION 'FALHA: minuta coexistiu com dossiê';
 EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
 END;

 -- Segunda minuta da mesma proposta deve ser ignorada, não criar outra linha.
 INSERT INTO lkz_adm_private.contract_text_previews (quote_id,contact_id)
 VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 SELECT count(*) INTO v_count FROM lkz_adm_private.contract_text_previews
 WHERE quote_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
 IF v_count<>1 THEN RAISE EXCEPTION 'FALHA: duplicidade de minuta'; END IF;

 -- A consulta de dossiês não pode sugerir preparar onde há texto salvo.
 SELECT quote->>'eligible' INTO v_eligible
 FROM jsonb_array_elements(
  (lkz_adm_private.list_signature_dossiers('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))->'quotes'
 ) AS quote WHERE quote->>'id'='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
 IF v_eligible IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'FALHA: UI ainda marca dossiê como elegível';
 END IF;

 SELECT count(*) INTO v_count FROM lkz_adm_private.contract_document_claims;
 IF v_count<>2 THEN RAISE EXCEPTION 'FALHA: reservas divergentes: %',v_count; END IF;
 IF has_table_privilege('authenticated',
   'lkz_adm_private.contract_document_claims','SELECT') THEN
  RAISE EXCEPTION 'FALHA: grants diretos ao usuário autenticado';
 END IF;
END
$lkz_assert$;

SELECT 'PASS: documento único por proposta, não coexistente, elegibilidade e acesso privado' AS result;
