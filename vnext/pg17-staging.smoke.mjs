import { test } from 'node:test';
import { randomUUID,randomBytes,createHmac } from 'node:crypto';
import { createAppointmentWebhook } from './appointment-reminders.mjs';
import { createMetaInboundWebhook } from './meta-inbound.mjs';
import assert from 'node:assert/strict';
import pg from 'pg';
import { migrateStaging,openStagingDatabase,assertReminderRole,assertWorkspaceRole,assertIntegrationRole,withAsaasRole } from './staging-db.mjs';
import { simulateReminderDispatch } from './simulated-dispatch.mjs';
import { verifyFinancialRls } from './financial-rls-pg17.mjs';
import { verifyAsaasLeastPrivilege } from './asaas-roles-pg17.mjs';

// This test can connect ONLY to a fixture database on the Actions runner.
// The CI password is intentionally non-secret and never used elsewhere.
const connection=process.env.GITHUB_ACTIONS==='true' &&
  process.env.CI_PG17_LOCAL_TEST==='1'
  ? 'postgresql://postgres:ci-local-only-not-a-secret@127.0.0.1:5432/lkz_vnext_stage_ci'
  : undefined;
const a='00000000-0000-4000-8000-000000000001';
const b='00000000-0000-4000-8000-000000000002';
const adminA='00000000-0000-4000-8000-000000000011';
const adminB='00000000-0000-4000-8000-000000000013';

function asUser(name){
  const url=new URL(connection);
  url.username=name;
  url.password='ci-local-only-not-a-secret';
  return url.toString();
}

test('PostgreSQL 17: migrations, idempotence, quota and RLS', {skip:!connection},async()=>{
  const target=new URL(connection);
  assert.equal(target.hostname,'127.0.0.1');
  assert.equal(target.pathname,'/lkz_vnext_stage_ci');
  const pool=new pg.Pool({connectionString:connection,max:3});
  const migrator=openStagingDatabase(connection);
  let reminder,workspace,ingest,issue,reconcile;
  try{
    await pool.query([
      'create role anon nologin;',
      'create role authenticated nologin;',
      'create schema auth;',
      'create table auth.users(id uuid primary key);',
      'grant usage on schema auth to authenticated;',
      "create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;",
      "create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;",
    ].join('\n'));
    await migrateStaging(migrator);
    await migrateStaging(migrator);
    const {rows:history}=await pool.query(
      'select filename,sha256 from lkz_vnext_migrations.history order by filename'
    );
    assert.equal(history.length,17);
    assert.ok(history.every(row=>/^[a-f0-9]{64}$/.test(row.sha256)));

    const runtimePairs=[
      ['lkz_vnext_runtime','authenticated'],
      ['lkz_vnext_asaas_ingest_runtime','lkz_vnext_asaas_ingest'],
      ['lkz_vnext_asaas_issue_runtime','lkz_vnext_asaas_issue'],
      ['lkz_vnext_asaas_reconcile_runtime','lkz_vnext_asaas_reconcile'],
      ['lkz_vnext_meta_runtime','lkz_vnext_meta_bridge'],
      ['lkz_vnext_reminder_runtime','lkz_vnext_reminder_bridge'],
    ];
    for(const [runtime,delegate] of runtimePairs){
      const {rows:[identity]}=await pool.query(
        "select rolsuper,rolbypassrls,rolcanlogin,rolinherit,rolcreaterole,rolcreatedb, " +
        "pg_has_role($1::name,$2::name,'MEMBER') as member, " +
        "pg_has_role($1::name,$2::name,'USAGE') as inherited, " +
        "pg_has_role($1::name,$2::name,'SET') as switchable, " +
        "(select count(*)::int from pg_auth_members m join pg_roles r on r.oid=m.member " +
        "where r.rolname=$1) as membership_count " +
        "from pg_roles where rolname=$1",
        [runtime,delegate]
      );
      assert.ok(identity);
      assert.equal(identity.rolcanlogin,false);
      assert.equal(identity.rolinherit,false);
      assert.equal(identity.rolsuper,false);
      assert.equal(identity.rolbypassrls,false);
      assert.equal(identity.rolcreaterole,false);
      assert.equal(identity.rolcreatedb,false);
      assert.equal(identity.member,true);
      assert.equal(identity.inherited,false);
      assert.equal(identity.switchable,true);
      assert.equal(identity.membership_count,1);
    }

    await pool.query('insert into lkz_vnext.tenants values($1,$2),($3,$4)',
      [a,'Empresa fictícia A',b,'Empresa fictícia B']);
    await pool.query('insert into auth.users values($1),($2)',[adminA,adminB]);
    await pool.query(
      "insert into lkz_vnext.memberships(tenant_id,user_id,role,active) "+
      "values($1,$2,'admin',true),($3,$4,'admin',true)",
      [a,adminA,b,adminB]
    );
    // Login is enabled ONLY inside the disposable GitHub Actions database,
    // never in the managed Supabase staging project or production.
    for(const role of [
      'lkz_vnext_reminder_runtime','lkz_vnext_runtime',
      'lkz_vnext_asaas_ingest_runtime','lkz_vnext_asaas_issue_runtime',
      'lkz_vnext_asaas_reconcile_runtime',
    ]){
      await pool.query(
        "alter role " + role + " login password 'ci-local-only-not-a-secret'"
      );
    }
    reminder=openStagingDatabase(asUser('lkz_vnext_reminder_runtime'));
    workspace=openStagingDatabase(asUser('lkz_vnext_runtime'));
    await assertReminderRole(reminder);
    await assertWorkspaceRole(workspace);
    for(const [target,role] of [
      ['ingest','lkz_vnext_asaas_ingest'],
      ['issue','lkz_vnext_asaas_issue'],
      ['reconcile','lkz_vnext_asaas_reconcile'],
    ]){
      const conn=openStagingDatabase(asUser(role+'_runtime'));
      if(target==='ingest') ingest=conn;
      else if(target==='issue') issue=conn;
      else reconcile=conn;
      await assertIntegrationRole(conn,role);
    }
    await withAsaasRole(ingest,'lkz_vnext_asaas_ingest').transaction(async tx=>{
      const {rowCount}=await tx.query(
        "insert into lkz_vnext_billing.asaas_sandbox_events (event_id,event_type,payment_id) " +
        "values ('evt_ci_nologin_bridge','PAYMENT_RECEIVED','pay_ci_nologin_bridge')"
      );
      assert.equal(rowCount,1);
    });
    await verifyFinancialRls(pool,workspace,{a,b,adminA,adminB});
    await verifyAsaasLeastPrivilege(pool);

    // All data are synthetic, inside a disposable CI database.
    await pool.query(
      'insert into lkz_vnext.whatsapp_reminder_policies '+
      '(tenant_id,enabled,offsets_minutes,monthly_message_limit) values($1,true,$2,1)',
      [a,[1440,120]]
    );
    await pool.query(
      'insert into lkz_vnext.whatsapp_connections '+
      '(tenant_id,meta_waba_id,meta_phone_number_id,connection_state,'+
      'billing_state,billing_verified_at,billing_verified_by,token_ciphertext,token_nonce) '+
      "values($1,'123456789012','987654321012','ready','verified',now(),$2,$3,$4)",
      [a,adminA,Buffer.from('synthetic-ci-ciphertext'),Buffer.alloc(12,1)]
    );
    await pool.query(
      'insert into lkz_vnext.whatsapp_appointments '+
      '(tenant_id,product,appointment_key,revision,starts_at,timezone,'+
      'state,consent_given,consent_at,consent_source,recipient_hash,'+
      'recipient_ciphertext,recipient_nonce,last_event_id) '+
      "values($1,'barbaros','ci_fake_booking',1,now()+interval '1 day',"+
      "'America/Bahia','scheduled',true,now(),'online_booking',$2,$3,$4,$5)",
      [a,'a'.repeat(64),Buffer.from('ci-fake-encrypted'),
        Buffer.alloc(12,2),'00000000-0000-4000-8000-000000000777']
    );
    await pool.query(
      'insert into lkz_vnext.whatsapp_reminder_jobs '+
      '(tenant_id,product,appointment_key,appointment_revision,kind,scheduled_for) '+
      "values($1,'barbaros','ci_fake_booking',1,'confirmation',now())",
      [a]
    );
    const first=await simulateReminderDispatch(reminder,{tenant:a,clock:()=>Date.now()+2000});
    assert.equal(first.simulated,1);
    assert.equal(first.canDispatch,false);
    assert.equal((await simulateReminderDispatch(reminder,{
      tenant:a,clock:()=>Date.now()+2000
    })).simulated,0);
    const {rows:quota}=await pool.query(
      'select simulated_count from lkz_vnext.whatsapp_simulated_monthly_usage'
    );
    assert.equal(quota[0].simulated_count,1);
    const {rows:jobs}=await pool.query(
      "select status from lkz_vnext.whatsapp_reminder_jobs where kind='confirmation'"
    );
    assert.equal(jobs[0].status,'simulated');

    // End-to-end: both SaaS origins and a second tenant, on real PG17/RLS.
    const pepper=randomBytes(32).toString('hex');
    const encryptionKey=randomBytes(32).toString('hex');
    const sourceDefs=[
      {id:randomUUID(),tenant:a,product:'barbaros',secret:randomBytes(32).toString('hex')},
      {id:randomUUID(),tenant:a,product:'libertyos',secret:randomBytes(32).toString('hex')},
      {id:randomUUID(),tenant:b,product:'barbaros',secret:randomBytes(32).toString('hex')},
    ];
    const intake=createAppointmentWebhook({
      db:reminder,sources:sourceDefs,encryptionKey,hashPepper:pepper
    });
    const customerPhone='+5573999901000';
    for(const [index,source] of sourceDefs.entries()){
      const event={
        eventId:randomUUID(),type:'booked',appointmentId:'ci_extra_'+index,
        revision:1,startsAt:new Date(Date.now()+48*3600000).toISOString(),
        timezone:'America/Bahia',recipient:customerPhone,
        consent:{granted:true,at:new Date(Date.now()-2000).toISOString(),
          source:'online_booking'},
      };
      const unix=String(Math.floor(Date.now()/1000));
      const body=JSON.stringify(event);
      const signature=createHmac('sha256',source.secret)
        .update(unix+'.'+body).digest('hex');
      const result=await intake(new Request('https://fixture.example/integrations/appointments',{
        method:'POST',headers:{'content-type':'application/json',
          'x-lkz-source-id':source.id,'x-lkz-timestamp':unix,
          'x-lkz-signature':signature},
        body
      }));
      assert.equal(result.status,200);
    }
    const metaSecret='test-meta-app-secret-32-characters-long';
    const inbound=createMetaInboundWebhook({
      db:reminder,appSecret:metaSecret,
      verifyToken:'test-meta-verify-token-32-characters',
      hashPepper:pepper
    });
    const stopBody=JSON.stringify({
      object:'whatsapp_business_account',
      entry:[{id:'123456789012',changes:[{
        field:'messages',value:{
          metadata:{phone_number_id:'987654321012'},
          messages:[{id:'wamid.pg17-stop-0001',from:'5573999901000',
            type:'text',text:{body:'PARAR'}}]
        }
      }]}]
    });
    const stopSignature='sha256='+createHmac('sha256',metaSecret)
      .update(stopBody).digest('hex');
    async function sendStop(signature=stopSignature){
      const response=await inbound(new Request('https://fixture.example/integrations/meta-whatsapp',{
        method:'POST',
        headers:{'content-type':'application/json','x-hub-signature-256':signature},
        body:stopBody
      }));
      return {status:response.status,data:await response.json()};
    }
    assert.equal((await sendStop('sha256='+'0'.repeat(64))).status,401);
    const firstStop=await sendStop();
    assert.equal(firstStop.status,200);
    assert.equal(firstStop.data.processed,1);
    assert.equal((await sendStop()).data.processed,0);
    const {rows:affected}=await pool.query(
      'select tenant_id,product,consent_given from lkz_vnext.whatsapp_appointments '+
      "where appointment_key like 'ci_extra_%' order by tenant_id,product"
    );
    assert.equal(affected.filter(x=>x.tenant_id===a&&x.consent_given).length,0);
    assert.equal(affected.filter(x=>x.tenant_id===b&&x.consent_given).length,1);
    const {rows:remaining}=await pool.query(
      "select tenant_id,count(*)::integer n from lkz_vnext.whatsapp_reminder_jobs "+
      "where status='pending' and appointment_key like 'ci_extra_%' group by tenant_id"
    );
    assert.deepEqual(remaining,[{tenant_id:b,n:3}]);

    await workspace.transaction(async tx=>{
      await tx.exec('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims',$1,true)",
        [JSON.stringify({sub:adminA,aal:'aal2'})]);
      const {rows:own}=await tx.query(
        'select * from lkz_vnext.whatsapp_simulation_summary($1)',[a]
      );
      assert.equal(Number(own[0].simulated_jobs),1);
      await assert.rejects(
        tx.query('select * from lkz_vnext.whatsapp_simulated_dispatches'),
        err=>err.code==='42501'
      );
    });
    await assert.rejects(workspace.transaction(async tx=>{
      await tx.exec('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims',$1,true)",
        [JSON.stringify({sub:adminB,aal:'aal2'})]);
      await tx.query('select * from lkz_vnext.whatsapp_simulation_summary($1)',[a]);
    }),err=>err.code==='42501');
  }finally{
    await Promise.allSettled([migrator.close(),reminder?.close(),workspace?.close(),ingest?.close(),issue?.close(),reconcile?.close()]);
    await pool.end();
  }
});
