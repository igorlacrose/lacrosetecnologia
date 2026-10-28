import test from 'node:test';
import assert from 'node:assert/strict';
import {GROUPS, PERMISSIONS, describeAccess, mayInvite, isPrivilegedAuditVisible} from '../src/roles.js';
import {newBrand,validateBrandName,validateHexColor,validateDomain} from '../src/branding.js';
import {readFile} from 'node:fs/promises';

test('cinco perfis e regras aprovadas na matriz',()=>{
 assert.deepEqual(GROUPS.map(g=>g.id),['master','gestor','administrador','lider_setor','financeiro']);
 assert.equal(describeAccess('master','audit_master'),'Permitido');
 assert.equal(describeAccess('administrador','invite_staff'),'Permitido');
 assert.equal(describeAccess('administrador','invite_gestor'),'Negado');
 assert.equal(describeAccess('gestor','invite_gestor'),'Permitido');
 assert.equal(describeAccess('gestor','audit_master'),'Negado');
 assert.equal(describeAccess('gestor','settings_write'),'Permitido');
 assert.equal(describeAccess('administrador','settings_write'),'Negado');
 assert.equal(describeAccess('administrador','global'),'Permitido');
 assert.equal(describeAccess('lider_setor','global'),'Negado');
 assert.equal(describeAccess('lider_setor','finance_write'),'Negado');
 assert.equal(describeAccess('financeiro','global'),'Negado');
 assert.equal(describeAccess('financeiro','finance_write'),'Permitido');
 for(const perm of PERMISSIONS)assert.equal(describeAccess('anon',perm),'Negado');
});
test('white label: nome, cor, domínio e entradas inseguras',()=>{
 assert.equal(newBrand().primary,'#086bca');
 assert.equal(validateBrandName('Provedor Alfa'),'Provedor Alfa');
 assert.equal(validateHexColor('#0A78DD'),'#0a78dd');
 assert.equal(validateDomain('  SISTEMA.EXEMPLO.COM.BR '),'sistema.exemplo.com.br');
 assert.equal(validateDomain(''),'');
 for(const bad of ['https://empresa.com.br','empresa.com.br/rota','empresa.com.br:443','x..com','127.0.0.1','<script>'])assert.throws(()=>validateDomain(bad));
 for(const bad of ['<svg onload=alert(1)>','', 'A'.repeat(51)])assert.throws(()=>validateBrandName(bad));
 for(const bad of ['red','#fff','#00000g','var(--test)'])assert.throws(()=>validateHexColor(bad));
});
test('rodapé oficial e módulo branding têm whitelist estática',async()=>{
 const app=await readFile(new URL('../src/app.js', import.meta.url),'utf8');
 const srv=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(app,/Desenvolvido por Lacrose Tecnologia/);
 assert.match(app,/https:\/\/lacrosetecnologia\.com\.br\//);
 assert.match(srv,/\/src\/branding\.js/);
 assert.match(srv,/\/src\/roles\.js/);
});
test('SQL RLS não oferece escrita direta nem visibilidade global ao líder',async()=>{
 const sql=await readFile(new URL('../backend/001_schema_rls.sql', import.meta.url),'utf8');
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/g);
 assert.match(sql,/m\.role IN \('lider_setor','financeiro'\) AND m\.sector_id=p_sector/);
 assert.match(sql,/m\.role='financeiro' AND m\.sector_id=p_sector/);
 assert.match(sql,/GRANT SELECT ON public\.lkz_isp_tenants/);
 assert.doesNotMatch(sql,/GRANT\s+(INSERT|UPDATE|DELETE)\s+ON\s+public\.lkz_isp_finance_events\s+TO\s+authenticated/i);
});

test('convites nunca elevam a MASTER e auditoria é reservada',()=>{
 assert.equal(mayInvite('master','gestor'),true);
 assert.equal(mayInvite('gestor','gestor'),true);
 assert.equal(mayInvite('administrador','gestor'),false);
 assert.equal(mayInvite('administrador','financeiro'),true);
 assert.equal(mayInvite('administrador','master'),false);
 assert.equal(mayInvite('lider_setor','administrador'),false);
 assert.equal(isPrivilegedAuditVisible('master','master'),true);
 for(const role of ['gestor','administrador','lider_setor','financeiro']){
  assert.equal(isPrivilegedAuditVisible(role,'master'),false);
 }
 assert.equal(isPrivilegedAuditVisible('gestor','administrador'),true);
});
