import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CloudAccess} from '../src/cloud-auth.js';
import {describeAccess,mayInvite} from '../src/roles.js';

const tenant='8f2fa969-a686-471d-99de-247bdc2cd15e';
const snap='8d17ccac-e91d-47de-98f7-159f5484ef5c';
const jwt=aal=>['head',Buffer.from(JSON.stringify({aal,sub:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'})).toString('base64url'),'sig'].join('.');
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const source=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Líder/Financeiro: consulta setorial por RPC e nunca snapshots globais',async()=>{
 const calls=[],sector={total:10,finalized:7,pending:3};
 const client=new CloudAccess(async(url,opts)=>{
  calls.push({url,opts});
  if(url.includes('grant_type=password'))return response({access_token:jwt('aal2'),refresh_token:'test-refresh',expires_in:3600,user:{id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',email:'viewer@example.invalid'}});
  if(url.includes('rpc/lkz_isp_read_sector_snapshots'))return response([{
   id:snap,tenant_id:tenant,snapshot:{sectorName:'Suporte',total:10,finalized:7,pending:3,sectors:{Suporte:sector}}
  }]);
  throw Error('URL não autorizada: '+url);
 });
 await client.signIn('viewer@example.invalid','senha-teste');
 const list=await client.listSectorSnapshots(tenant);
 assert.equal(list.length,1);
 assert.deepEqual(Object.keys(list[0].sectors),['Suporte']);
 assert.equal(list[0].total,10);
 const request=calls.find(c=>c.url.includes('rpc/lkz_isp_read_sector_snapshots'));
 assert.equal(request.opts.method,'POST');
 assert.equal(JSON.parse(request.opts.body).p_tenant,tenant);
 assert.equal(request.opts.headers.Authorization,'Bearer '+jwt('aal2'));
 assert.ok(!calls.some(c=>c.url.includes('lkz_isp_aggregate_snapshots')));
});
test('MFA AAL1 não recebe relatórios setoriais e falha fechado',async()=>{
 let called=0;
 const client=new CloudAccess(async url=>{
  called++;
  if(url.includes('grant_type=password'))return response({access_token:jwt('aal1'),refresh_token:'test-refresh',expires_in:3600,user:{email:'viewer@example.invalid'}});
  throw Error('Forbidden: '+url);
 });
 await client.signIn('viewer@example.invalid','senha-teste');
 await assert.rejects(client.listSectorSnapshots(tenant),/MFA obrigatório/);
 assert.equal(called,1);
});
test('Decisões enviadas exclusivamente ao servidor e precisam de justificativa',async()=>{
 const calls=[];
 const client=new CloudAccess(async(url,opts)=>{
  calls.push({url,opts});
  if(url.includes('grant_type=password'))return response({access_token:jwt('aal2'),refresh_token:'test-refresh',expires_in:3600,user:{email:'gestor@example.invalid'}});
  if(url.includes('rpc/lkz_isp_review_snapshot'))return response('77777777-7777-4777-8777-777777777777');
  if(url.includes('lkz_isp_snapshot_reviews?'))return response([]);
  throw Error('URL não autorizada: '+url);
 });
 await client.signIn('gestor@example.invalid','senha-teste');
 await assert.rejects(client.reviewSnapshot(tenant,snap,'reject','curto'),/20 a 4000/);
 assert.equal(await client.reviewSnapshot(tenant,snap,'approve','Indicadores validados pelo gestor do período.'),'77777777-7777-4777-8777-777777777777');
 const req=calls.find(c=>c.url.includes('rpc/lkz_isp_review_snapshot'));
 assert.equal(req.opts.method,'POST');
 const payload=JSON.parse(req.opts.body);
 assert.deepEqual({p_tenant:payload.p_tenant,p_snapshot:payload.p_snapshot,p_decision:payload.p_decision},
  {p_tenant:tenant,p_snapshot:snap,p_decision:'approve'});
});
test('UX v1.3: MASTER preservado, demais perfis sem edição/importação',()=>{
 const app=source('../src/app.js');
 const sql=source('../supabase/migrations/20261028_lkz_isp_v13_executive_roles.sql');
 assert.match(app,/function sectorMode\(\)/);
 assert.match(app,/cloud\.listSectorSnapshots\(chosen\):await cloud\.listAggregateSnapshots\(chosen\)/);
 assert.match(app,/function sectorDashboard\(\)/);
 assert.match(app,/function executiveDashboard\(\)/);
 assert.match(app,/function executiveReviews\(\)/);
 assert.match(app,/function submitExecutiveReview\(\)/);
 assert.match(app,/cloud\.reviewSnapshot\(state\.selectedTenant,s\.id,state\.reviewIntent,reason\)/);
 assert.match(app,/window\.print\(\)/);
 assert.match(app,/function canAdministerLocalWorkspace\(\)\{return isMfaLinked\(\)&&cloudUi\.memberships\.some\(m=>m\.role==='master'\);\}/);
 assert.match(sql,/SECURITY DEFINER SET search_path TO ''/);
 assert.match(sql,/m\.role IN \('lider_setor','financeiro'\)/);
 assert.match(sql,/pg_catalog\.jsonb_build_object\(s\.name,a\.snapshot->'sectors'->s\.name\)/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.lkz_isp_review_snapshot/);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/CONSTRAINT lkz_isp_snapshot_reviews_one UNIQUE\(tenant_id,snapshot_id\)/);
 assert.equal(describeAccess('master','settings_write'),'Permitido');
 for(const role of ['gestor','administrador','lider_setor','financeiro']){
  assert.equal(describeAccess(role,'settings_write'),'Negado');
  assert.equal(mayInvite(role,'administrador'),false);
 }
 assert.equal(mayInvite('master','gestor'),true);
});
