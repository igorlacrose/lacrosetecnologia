-- Integration fixture for PR #56: PostgreSQL 17, synthetic identities only.
-- The test database is created by GitHub Actions and destroyed with the job.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE SET search_path TO ''
AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path TO ''
AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.jwt(),auth.uid() TO anon,authenticated;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  active boolean NOT NULL,
  role text NOT NULL
);
GRANT SELECT ON public.profiles TO authenticated;
INSERT INTO public.profiles VALUES
  ('00000000-0000-4000-8000-000000000011', true, 'admin'),
  ('00000000-0000-4000-8000-000000000012', false, 'admin'),
  ('00000000-0000-4000-8000-000000000013', true, 'viewer');

CREATE TABLE public.messages (
  id bigint PRIMARY KEY,
  conversation_id uuid NOT NULL
);
INSERT INTO public.messages VALUES
  (101,'00000000-0000-4000-8000-000000000101'),
  (102,'00000000-0000-4000-8000-000000000101'),
  (201,'00000000-0000-4000-8000-000000000202');
GRANT SELECT ON public.messages TO authenticated;

CREATE SCHEMA lkz_adm_private;
REVOKE ALL ON SCHEMA lkz_adm_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA lkz_adm_private TO authenticated;
CREATE TABLE lkz_adm_private.message_folders (
  message_id bigint PRIMARY KEY REFERENCES public.messages(id),
  folder text NOT NULL CHECK(folder IN ('active','archived','deleted'))
);
ALTER TABLE lkz_adm_private.message_folders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE lkz_adm_private.message_folders FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE lkz_adm_private.message_folders TO authenticated;

CREATE FUNCTION lkz_adm_private.is_operator() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO ''
AS $$
  SELECT coalesce(auth.jwt()->>'aal'='aal2',false)
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id=auth.uid() AND active AND role IN ('master','admin')
    );
$$;
REVOKE ALL ON FUNCTION lkz_adm_private.is_operator() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION lkz_adm_private.is_operator() TO authenticated;
CREATE POLICY operator_access ON lkz_adm_private.message_folders
FOR SELECT TO authenticated USING (lkz_adm_private.is_operator());

-- Exercise the exact pending migration, rather than a hand-written substitute.
\ir ../supabase/sql/lkz_adm_move_messages_acl_fix.sql

DO $$
BEGIN
  IF has_table_privilege('authenticated','lkz_adm_private.message_folders','INSERT')
    OR has_table_privilege('authenticated','lkz_adm_private.message_folders','UPDATE')
    OR has_function_privilege('anon','public.lkz_adm_move_messages(uuid,bigint[],text,text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.lkz_adm_move_messages(uuid,bigint[],text,text)','EXECUTE')
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='lkz_adm_private.message_folders'::regclass)
  THEN RAISE EXCEPTION 'ACL/RLS became too permissive'; END IF;
END $$;

SET ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.lkz_adm_move_messages(
      '00000000-0000-4000-8000-000000000101',ARRAY[101]::bigint[],'active','deleted');
    RAISE EXCEPTION 'Anonymous unexpectedly moved a message';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000011","aal":"aal1"}',false);
DO $$
BEGIN
  BEGIN
    PERFORM public.lkz_adm_move_messages(
      '00000000-0000-4000-8000-000000000101',ARRAY[101]::bigint[],'active','deleted');
    RAISE EXCEPTION 'AAL1 bypassed MFA';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;

SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000012","aal":"aal2"}',false);
DO $$
BEGIN
  BEGIN
    PERFORM public.lkz_adm_move_messages(
      '00000000-0000-4000-8000-000000000101',ARRAY[101]::bigint[],'active','deleted');
    RAISE EXCEPTION 'Disabled administrator bypassed active flag';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;

SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000013","aal":"aal2"}',false);
DO $$
BEGIN
  BEGIN
    PERFORM public.lkz_adm_move_messages(
      '00000000-0000-4000-8000-000000000101',ARRAY[101]::bigint[],'active','deleted');
    RAISE EXCEPTION 'Viewer bypassed RBAC';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $$;

SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000011","aal":"aal2"}',false);
DO $$
DECLARE
  conversation uuid := '00000000-0000-4000-8000-000000000101';
  changed integer;
BEGIN
  changed:=public.lkz_adm_move_messages(conversation,ARRAY[101,102]::bigint[],'active','deleted');
  IF changed<>2 THEN RAISE EXCEPTION 'Valid MFA admin move failed'; END IF;

  BEGIN
    PERFORM public.lkz_adm_move_messages(conversation,ARRAY[101]::bigint[],'active','archived');
    RAISE EXCEPTION 'Stale folder transition passed';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;

  BEGIN
    PERFORM public.lkz_adm_move_messages(conversation,ARRAY[101,101]::bigint[],'deleted','active');
    RAISE EXCEPTION 'Duplicate selection passed';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM public.lkz_adm_move_messages(conversation,ARRAY[101,201]::bigint[],'deleted','active');
    RAISE EXCEPTION 'Cross-conversation selection passed';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;

  BEGIN
    PERFORM public.lkz_adm_move_messages(conversation,ARRAY[101]::bigint[],'deleted','sent');
    RAISE EXCEPTION 'Invalid folder transition passed';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM public.lkz_adm_move_messages(conversation,
      ARRAY(SELECT generate_series(1,51)::bigint),'deleted','active');
    RAISE EXCEPTION 'More than 50 message IDs accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  changed:=public.lkz_adm_move_messages(conversation,ARRAY[101]::bigint[],'deleted','active');
  IF changed<>1 THEN RAISE EXCEPTION 'Restore failed'; END IF;
  changed:=public.lkz_adm_move_messages(conversation,ARRAY[101]::bigint[],'active','archived');
  IF changed<>1 THEN RAISE EXCEPTION 'Archive failed'; END IF;
  changed:=public.lkz_adm_move_messages(conversation,ARRAY[101]::bigint[],'archived','deleted');
  IF changed<>1 THEN RAISE EXCEPTION 'Archived-to-deleted failed'; END IF;
  changed:=public.lkz_adm_move_messages(conversation,ARRAY[101]::bigint[],'deleted','active');
  IF changed<>1 THEN RAISE EXCEPTION 'Trash restore failed'; END IF;
END $$;

-- Verify no earlier failure leaked a change to another conversation.
DO $$
DECLARE changed_count integer;
BEGIN
  SELECT count(*) INTO changed_count FROM lkz_adm_private.message_folders
    WHERE message_id=201;
  IF changed_count<>0 THEN RAISE EXCEPTION 'Cross-conversation write occurred'; END IF;
END $$;
RESET ROLE;

-- The original privileged role checks the final state without exposing it to clients.
DO $$
BEGIN
  IF (SELECT folder FROM lkz_adm_private.message_folders WHERE message_id=101)<>'active'
    OR (SELECT folder FROM lkz_adm_private.message_folders WHERE message_id=102)<>'deleted'
    OR EXISTS(SELECT 1 FROM lkz_adm_private.message_folders WHERE message_id=201)
  THEN RAISE EXCEPTION 'Unexpected final folder state'; END IF;
END $$;

-- The provided rollback must leave the original invoker function in place.
\ir ../supabase/sql/lkz_adm_move_messages_acl_rollback.sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid=to_regprocedure('lkz_adm_private.move_messages(uuid,bigint[],text,text)')
  ) OR EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid='public.lkz_adm_move_messages(uuid,bigint[],text,text)'::regprocedure
      AND prosecdef
  )
  THEN RAISE EXCEPTION 'Rollback privilege/function inconsistency'; END IF;
END $$;
\echo LKZ ADM message ACL PostgreSQL integration checks passed.
