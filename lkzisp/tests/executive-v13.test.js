import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CloudAccess} from '../src/cloud-auth.js';
import {mayInvite,describeAccess} from '../src/roles.js';
import {
  activeRole,executiveNavigation,canOpenExecutiveView,
  renderExecutiveDashboard,renderExecutiveProductivity,
  renderExecutiveReviews,renderExecutiveReports
} from '../src/executive.js';
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const style=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const tenant='12345678-1234-4234-8234-123456789abc';
const other='22345678-1234-4234-8234-123456789abc';
const id='22345678-2234-4234-8234-123456789abc';
const sample={id,earliest:'2026-10-01',latest:'2026-10-28',importedAt:'2026-10-28T10:00:00Z',
 total:2931,finalized:2200,pending:731,pendingOlder7d:12,
 daily:{'2026-10-01':{total:20,finalized:12,pending:8}},
 sectors:{'Suporte Técnico':{total:80,finalized:66,pending:14}}};
test('MASTER mantém seu perfil e menu original; gestor recebe apenas quatro abas',()=>{
 assert.equal(activeRole([{tenant_id:tenant,role:'master'}],tenant),'master');
 assert.equal(executiveNavigation('gestor').length,4);
 assert.deepEqual(executiveNavigation('administrador').map(x=>x[0]),['dashboard','productivity','reports']);
 for(const role of ['administrador','lider_setor','financeiro']){
   assert.equal(canOpenExecutiveView(role,'results'),false);
   assert.equal(canOpenExecutiveView(role,'users'),false);
   assert.equal(canOpenExecutiveView(role,'imports'),false);
 }
 assert.equal(canOpenExecutiveView('gestor','results'),true);
 assert.match(app,/canAdministerLocalWorkspace\(\)\{return isMfaLinked\(\)&&cloudUi\.memberships\.some\(m=>m\.role==='master'\)/);
 assert.match(app,/role!=='master'&&executiveViews\[role\]/);
});
test('relatórios e impressão para todos os perfis, sem exibição de clientes',()=>{
 for(const role of ['gestor','administrador','lider_setor','financeiro']){
   assert.equal(canOpenExecutiveView(role,'reports'),true);
   const page=renderExecutiveReports({snapshot:sample,role});
   assert.match(page,/data-exec-print/);
   assert.match(page,/exec-printable/);
   assert.match(page,/2\.931/);
   assert.doesNotMatch(page,/CPF|Telefone|Senha PPPoE|Cliente:\s*<strong>/i);
 }
 assert.match(style,/@media print/);
 assert.match(style,/#exec-printable/);
});
test('setor utiliza gráfico apenas do setor, sem tentar inventar série diária',()=>{
 const sector={...sample,total:80,finalized:66,pending:14,
   sectorOnly:true,sectorName:'Suporte <Técnico>',daily:{},sectors:{'Suporte <Técnico>':{total:80,finalized:66,pending:14}}};
 const dashboard=renderExecutiveDashboard({snapshot:sector});
 assert.match(dashboard,/Suporte &lt;Técnico&gt;/);
 assert.match(dashboard,/80/);
 assert.match(dashboard,/não contém evolução diária separada por setor/);
 assert.doesNotMatch(dashboard,/2\.931/);
 const prod=renderExecutiveProductivity({snapshot:sector});
 assert.doesNotMatch(prod,/data-load-employees/);
});
test('gestor pode registrar parecer, administrador não vê aprovação',()=>{
 const active=renderExecutiveReviews({snapshot:sample,reviews:[],role:'gestor'});
 assert.match(active,/data-review-choice="approve"/);
 assert.match(active,/data-review-choice="reject"/);
 assert.match(renderExecutiveReviews({snapshot:sample,reviews:[],choice:'reject',role:'gestor'}),/exec-review-note/);
 assert.doesNotMatch(renderExecutiveReviews({snapshot:sample,reviews:[],role:'administrador'}),/data-review-choice/);
 const closed=renderExecutiveReviews({snapshot:sample,reviews:[{snapshot_id:id,decision:'approve',
  rationale:'Resultado conferido e revisado pelo gestor da unidade.',
  reviewed_at:'2026-10-28T13:00:00Z'}],role:'gestor'});
 assert.match(closed,/Resultado aprovado/);
 assert.doesNotMatch(closed,/data-review-choice/);
 assert.match(app,/cloud\.submitSnapshotReview/);
});
test('CloudAccess setorial chama somente RPC filtrado, nunca tabela de snapshots globais',async()=>{
 const user='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
 const jwt=aal=>'head.'+Buffer.from(JSON.stringify({sub:user,aal,role:'authenticated'})).toString('base64url')+'.sig';
 const requests=[];
 const session={access_token:jwt('aal2'),refresh_token:'ref',expires_in:3600,user:{id:user,email:'sector@example.invalid'}};
 const result=[{tenant_id:tenant,id,fingerprint:'f'.repeat(64),snapshot:{
   fingerprint:'f'.repeat(64),sectorOnly:true,sectorName:'NOC',sectors:{NOC:{total:2}},
   total:2,finalized:2,pending:0
 }}];
 const fetch=async(url,opts)=>{
   requests.push(url);
   if(url.includes('auth/v1/token'))return {ok:true,status:200,json:async()=>session};
   if(url.includes('rpc/lkz_isp_get_sector_snapshots'))return {ok:true,status:200,json:async()=>result};
   throw Error('unexpected endpoint '+url);
 };
 const c=new CloudAccess(fetch);
 await c.signIn('sector@example.invalid','password');
 const items=await c.listSectorSnapshots(tenant);
 assert.equal(items[0].sectorName,'NOC');
 assert.equal(items[0].total,2);
 assert.ok(requests.some(x=>x.includes('rpc/lkz_isp_get_sector_snapshots')));
 assert.ok(!requests.some(x=>x.includes('lkz_isp_aggregate_snapshots')));
});
test('perfil de setor não aceita retorno RPC contendo resumo global',async()=>{
 const user='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
 const jwt='head.'+Buffer.from(JSON.stringify({sub:user,aal:'aal2'})).toString('base64url')+'.sig';
 const fetch=async(url)=>{
   if(url.includes('/auth/v1/token'))return {ok:true,status:200,json:async()=>({access_token:jwt,refresh_token:'x',expires_in:3600,user:{id:user}})};
   return {ok:true,status:200,json:async()=>([{tenant_id:tenant,fingerprint:'f'.repeat(64),snapshot:{
     sectorOnly:true,fingerprint:'f'.repeat(64),sectors:{NOC:{},OUTRO:{}}
   }}])};
 };
 const c=new CloudAccess(fetch);
 await c.signIn('test@example.invalid','x');
 await assert.rejects(c.listSectorSnapshots(tenant),/não verificados/);
});
test('revogação client-side e backend para acessos não administrativos',()=>{
 assert.match(app,/role==='master'/);
 assert.match(app,/role!=='master'&&executiveViews\[role\]&&!canOpenExecutiveView/);
 assert.match(app,/role!=='gestor'/);
 assert.match(app,/if\(name==='menu'&&canViewWorkspace\(\)\)/);
 assert.ok(other!==tenant);
});

test('matriz de permissões nega convites e escrita aos perfis executivos',()=>{
 for(const role of ['gestor','administrador','lider_setor','financeiro']){
  assert.equal(mayInvite(role,'administrador'),false);
  assert.equal(describeAccess(role,'invite_staff'),'Negado');
  assert.equal(describeAccess(role,'finance_write'),'Negado');
  assert.equal(describeAccess(role,'settings_write'),'Negado');
 }
 assert.equal(mayInvite('master','gestor'),true);
 assert.equal(mayInvite('master','master'),false);
});
test('migração registra consulta setor restrita e parecer append-only',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261028_v13_executive_and_sector_reports.sql',import.meta.url),'utf8');
 assert.match(sql,/m\.user_id=\(SELECT auth\.uid\(\)\)/);
 assert.match(sql,/m\.role IN \('lider_setor'::public\.lkz_isp_role,'financeiro'::public\.lkz_isp_role\)/);
 assert.match(sql,/jsonb_build_object\(sec\.name,a\.snapshot->'sectors'->sec\.name\)/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.lkz_isp_get_sector_snapshots\(uuid\) FROM PUBLIC,anon/);
 assert.match(sql,/lkz_private\.is_gestor\(tenant_id\)/);
 assert.match(sql,/lkz_isp_snapshot_review_audit/);
 assert.doesNotMatch(sql,/GRANT (?:UPDATE|DELETE) ON public\.lkz_isp_snapshot_reviews TO authenticated/);
});
