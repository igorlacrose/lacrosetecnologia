-- LKZ ADM VNext: hosted Supabase PostgreSQL 17 RLS integration smoke.
-- Run ONLY against an EMPTY, SEPARATE staging project with 16 VNext migrations.
-- No production use, no credentials, no HTTP/API calls and no persistent fixtures.
-- This file deliberately runs BEGIN...ROLLBACK, including auth.users and all writes.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users)
    OR EXISTS (SELECT 1 FROM lkz_vnext.tenants)
    OR EXISTS (SELECT 1 FROM lkz_vnext_billing.payment_bindings)
  THEN
    RAISE EXCEPTION 'Refusing to run a fixture on a populated database';
  END IF;
  IF (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('lkz_vnext','lkz_vnext_billing')
      AND c.relkind IN ('r','p') AND NOT c.relrowsecurity) <> 0
  THEN
    RAISE EXCEPTION 'RLS disabled on a VNext table';
  END IF;
END $guard$;

-- Supabase Auth fixture rows exist only until this transaction rolls back.
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-000000000011'),
  ('00000000-0000-4000-8000-000000000012'),
  ('00000000-0000-4000-8000-000000000013'),
  ('00000000-0000-4000-8000-000000000014');

INSERT INTO lkz_vnext.tenants (id,name) VALUES
  ('00000000-0000-4000-8000-000000000001','CI Tenant A'),
  ('00000000-0000-4000-8000-000000000002','CI Tenant B');

INSERT INTO lkz_vnext.memberships (tenant_id,user_id,role,active) VALUES
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','admin',true),
  ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000012','admin',true),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000013','viewer',true),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000014','admin',false);

-- Seed under a fixture actor so SECURITY DEFINER audit triggers can record it.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000011","aal":"aal2","role":"authenticated"}',true);
INSERT INTO lkz_vnext.clients(tenant_id,name,email)
VALUES ('00000000-0000-4000-8000-000000000001','Client A','ci-client-a@example.test');
INSERT INTO lkz_vnext.products(tenant_id,slug,name,kind)
VALUES ('00000000-0000-4000-8000-000000000001','fixture-a','Fixture A','saas');
INSERT INTO lkz_vnext.plans(tenant_id,product_id,name,amount_brl_cents,interval)
SELECT tenant_id,id,'Plan A',1000,'monthly'
FROM lkz_vnext.products WHERE slug='fixture-a';
INSERT INTO lkz_vnext.subscription_drafts(tenant_id,client_id,plan_id)
SELECT c.tenant_id,c.id,p.id FROM lkz_vnext.clients c
JOIN lkz_vnext.plans p ON p.tenant_id=c.tenant_id
WHERE c.name='Client A' AND p.name='Plan A';

SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000012","aal":"aal2","role":"authenticated"}',true);
INSERT INTO lkz_vnext.clients(tenant_id,name,email)
VALUES ('00000000-0000-4000-8000-000000000002','Client B','ci-client-b@example.test');
INSERT INTO lkz_vnext.products(tenant_id,slug,name,kind)
VALUES ('00000000-0000-4000-8000-000000000002','fixture-b','Fixture B','saas');
INSERT INTO lkz_vnext.plans(tenant_id,product_id,name,amount_brl_cents,interval)
SELECT tenant_id,id,'Plan B',1000,'monthly'
FROM lkz_vnext.products WHERE slug='fixture-b';
INSERT INTO lkz_vnext.subscription_drafts(tenant_id,client_id,plan_id)
SELECT c.tenant_id,c.id,p.id FROM lkz_vnext.clients c
JOIN lkz_vnext.plans p ON p.tenant_id=c.tenant_id
WHERE c.name='Client B' AND p.name='Plan B';

INSERT INTO lkz_vnext_billing.payment_bindings (
  payment_id,tenant_id,subscription_id,customer_id,
  external_reference,expected_brl_cents,state
)
SELECT CASE WHEN d.tenant_id='00000000-0000-4000-8000-000000000001'
    THEN 'pay_ci_a' ELSE 'pay_ci_b' END,
  d.tenant_id,d.id,
  CASE WHEN d.tenant_id='00000000-0000-4000-8000-000000000001'
    THEN 'cus_ci_a' ELSE 'cus_ci_b' END,
  gen_random_uuid(),1000,
  CASE WHEN d.tenant_id='00000000-0000-4000-8000-000000000001'
    THEN 'paid' ELSE 'overdue' END
FROM lkz_vnext.subscription_drafts d;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000011","aal":"aal2","role":"authenticated"}',true);

DO $admin_a$
DECLARE denied boolean;
BEGIN
  IF NOT lkz_vnext.has_access('00000000-0000-4000-8000-000000000001',
    ARRAY['admin']::text[]) OR
    lkz_vnext.has_access('00000000-0000-4000-8000-000000000002',
    ARRAY['admin']::text[])
  THEN RAISE EXCEPTION 'Admin A tenant claims were not isolated'; END IF;

  IF (SELECT count(*) FROM lkz_vnext.clients) <> 1
    OR (SELECT count(*) FROM lkz_vnext_billing.payment_bindings) <> 1
    OR (SELECT min(state) FROM lkz_vnext_billing.payment_bindings) <> 'paid'
  THEN RAISE EXCEPTION 'Admin A can see other tenants or cannot see its own billing'; END IF;

  denied:=false;
  BEGIN
    INSERT INTO lkz_vnext.clients(tenant_id,name,email) VALUES
      ('00000000-0000-4000-8000-000000000002','Intruder','intruder@example.test');
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-tenant write was accepted'; END IF;

  denied:=false;
  BEGIN
    PERFORM customer_id FROM lkz_vnext_billing.payment_bindings;
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Billing private column was exposed'; END IF;

  denied:=false;
  BEGIN
    UPDATE lkz_vnext_billing.payment_bindings SET state='paid';
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Admin may forge gateway payment status'; END IF;
END $admin_a$;

-- A viewer may read its own CRM but may not see billing or create clients.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000013","aal":"aal2","role":"authenticated"}',true);
DO $viewer$
DECLARE denied boolean:=false;
BEGIN
  IF (SELECT count(*) FROM lkz_vnext.clients) <> 1
    OR (SELECT count(*) FROM lkz_vnext_billing.payment_bindings) <> 0
  THEN RAISE EXCEPTION 'Viewer read restrictions failed'; END IF;
  BEGIN
    INSERT INTO lkz_vnext.clients(tenant_id,name,email) VALUES
    ('00000000-0000-4000-8000-000000000001','Viewer-created','viewer-created@example.test');
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Viewer created a client'; END IF;
END $viewer$;

-- Even a valid tenant administrator with AAL1 cannot read data.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000011","aal":"aal1","role":"authenticated"}',true);
DO $without_mfa$
BEGIN
  IF (SELECT count(*) FROM lkz_vnext.clients) <> 0
    OR (SELECT count(*) FROM lkz_vnext_billing.payment_bindings) <> 0
  THEN RAISE EXCEPTION 'Session without MFA accessed tenant data'; END IF;
END $without_mfa$;

-- An inactive membership is denied regardless of its JWT claims.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000014","aal":"aal2","role":"authenticated"}',true);
DO $disabled$
BEGIN
  IF (SELECT count(*) FROM lkz_vnext.clients) <> 0
    OR (SELECT count(*) FROM lkz_vnext_billing.payment_bindings) <> 0
  THEN RAISE EXCEPTION 'Disabled admin accessed tenant data'; END IF;
END $disabled$;

-- Tenant B admin sees B only and never A.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000012","aal":"aal2","role":"authenticated"}',true);
DO $admin_b$
BEGIN
  IF (SELECT count(*) FROM lkz_vnext.clients) <> 1
    OR (SELECT count(*) FROM lkz_vnext_billing.payment_bindings) <> 1
    OR (SELECT min(state) FROM lkz_vnext_billing.payment_bindings) <> 'overdue'
  THEN RAISE EXCEPTION 'Admin B financial tenant isolation failed'; END IF;
END $admin_b$;

-- Membership revocation must apply immediately to the very same JWT.
RESET ROLE;
UPDATE lkz_vnext.memberships SET active=false
WHERE tenant_id='00000000-0000-4000-8000-000000000001'
AND user_id='00000000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000011","aal":"aal2","role":"authenticated"}',true);
DO $revoked$
BEGIN
  IF (SELECT count(*) FROM lkz_vnext.clients) <> 0
    OR (SELECT count(*) FROM lkz_vnext_billing.payment_bindings) <> 0
  THEN RAISE EXCEPTION 'Revoked membership did not remove access'; END IF;
END $revoked$;

-- An anonymous role cannot even use the application schemas.
SET LOCAL ROLE anon;
DO $anonymous$
BEGIN
  IF has_schema_privilege(current_user,'lkz_vnext','USAGE')
    OR has_schema_privilege(current_user,'lkz_vnext_billing','USAGE')
  THEN RAISE EXCEPTION 'Anon role can access VNext schemas'; END IF;
END $anonymous$;

RESET ROLE;
ROLLBACK;

-- A failed fixture cleanup is a hard failure, not a warning.
DO $clean$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users)
    OR EXISTS (SELECT 1 FROM lkz_vnext.tenants)
    OR EXISTS (SELECT 1 FROM lkz_vnext_billing.payment_bindings)
  THEN RAISE EXCEPTION 'Hosted integration fixture was not rolled back'; END IF;
END $clean$;
SELECT 'hosted_rls_passed_no_persisted_data' AS result;
