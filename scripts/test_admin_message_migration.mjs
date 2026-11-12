import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migration=readFileSync(new URL('../supabase/sql/lkz_adm_move_messages_acl_fix.sql',import.meta.url),'utf8');
const rollback=readFileSync(new URL('../supabase/sql/lkz_adm_move_messages_acl_rollback.sql',import.meta.url),'utf8');

test('mantém o corpo operacional original da função sem reescrever a lógica',()=>{
  const body=sql=>sql.match(/\$function\$([\s\S]*?)\$function\$/)?.[1]||'';
  assert.ok(body(migration).length>400,'Corpo privado não encontrado');
  assert.equal(body(migration),body(rollback),'A lógica original não foi preservada');
});

test('correção exige MFA, valida seleção, usa lock e falha em conflito',()=>{
  for(const required of [
    'if not lkz_adm_private.is_operator()',
    'selected_count not between 1 and 50',
    'count(distinct value)',
    'pg_advisory_xact_lock',
    'changed_count <> selected_count',
    "errcode = '40001'"
  ])assert.ok(migration.includes(required),'Proteção ausente: '+required);
});

test('função privada privilegiada e wrapper público sem privilégio extra',()=>{
  assert.match(migration,/CREATE OR REPLACE FUNCTION lkz_adm_private\.move_messages\(/);
  assert.match(migration,/LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path TO ''/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.lkz_adm_move_messages\(/);
  assert.match(migration,/LANGUAGE sql\s+SECURITY INVOKER\s+SET search_path TO ''/);
  assert.match(migration,/REVOKE ALL ON FUNCTION lkz_adm_private\.move_messages/);
  assert.match(migration,/GRANT EXECUTE ON FUNCTION lkz_adm_private\.move_messages/);
  assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.lkz_adm_move_messages/);
  assert.doesNotMatch(migration,/GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)\s+ON\s+(?:TABLE\s+)?lkz_adm_private\.message_folders/i);
  assert.doesNotMatch(migration,/\b(?:DROP|TRUNCATE)\s+TABLE\b/i);
});

test('rollback restaura somente a função e elimina o novo helper',()=>{
  assert.match(rollback,/CREATE OR REPLACE FUNCTION public\.lkz_adm_move_messages\(/);
  assert.match(rollback,/DROP FUNCTION IF EXISTS lkz_adm_private\.move_messages\(/);
  assert.doesNotMatch(rollback,/\b(?:DELETE FROM|TRUNCATE TABLE|DROP TABLE)\b/i);
});
