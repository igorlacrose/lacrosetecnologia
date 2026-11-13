import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const scriptPath=new URL('./lkz_adm_backup_encrypted.sh',import.meta.url);
const docPath=new URL('../docs/LKZ_ADM_BACKUP_E_MIGRACAO_GATE.md',import.meta.url);
const source=fs.readFileSync(scriptPath,'utf8');
const doc=fs.readFileSync(docPath,'utf8');

test('script Bash completo: parser aceita e execução sem destino falha fechada',()=>{
 const syntax=spawnSync('bash',['-n',scriptPath.pathname],{encoding:'utf8'});
 assert.equal(syntax.status,0,syntax.stderr);
 const missing=spawnSync('bash',[scriptPath.pathname],{encoding:'utf8'});
 assert.notEqual(missing.status,0);
 assert.match(missing.stderr,/Uso:/);
});

test('sem credenciais no código ou argumentos e alvo fixo correto',()=>{
 assert.match(source,/readonly PROJECT_REF='icrtewhazpfauuroswri'/);
 assert.match(source,/PGHOST.*Connect/);
 assert.match(source,/PGUSER.*Connect/);
 assert.match(source,/PGSSLMODE/);
 assert.match(source,/verify-full/);
 assert.match(source,/PGSSLROOTCERT/);
 assert.match(source,/PGPORT.*5432/);
 assert.match(source,/REPO_ROOT/);
 assert.match(source,/git -C/);
 assert.doesNotMatch(source,/https?:\/\/[^ '"\n]+:[^ '"\n]+@/);
 assert.doesNotMatch(source,/PGPASSWORD\s*=/);
 assert.doesNotMatch(source,/service_role|sb_secret_/i);
});

test('dump em stream criptografado, com validação local e sem deploy',()=>{
 assert.match(source,/pg_dump\s+\\/);
 assert.doesNotMatch(source,/--file(?:=|\s+)-(?:\s|$)/m, 'pg_dump nunca deve criar arquivo literal -');
 assert.match(source,/--format=custom/);
 assert.match(source,/gpg --symmetric --cipher-algo AES256/);
 assert.match(source,/pg_restore --list/);
 assert.match(source,/sha256sum/);
 assert.match(source,/umask 077/);
 assert.doesNotMatch(source,/\b(pg_restore.*--dbname|psql.*-c.*drop|supabase db push|curl .*-X POST)\b/i);
});

test('runbook diferencia índice de teste real de restauração',()=>{
 assert.match(doc,/Restauraç|restauração/);
 assert.match(doc,/NÃO comprova restauração funcional/);
 assert.match(doc,/off-site/i);
 assert.match(doc,/NÃO exporta conteúdo dos objetos do Storage API/);
 assert.match(doc,/MASTER\+MFA/);
 assert.match(doc,/supabase\/migrations\/20261112233300/);
});
