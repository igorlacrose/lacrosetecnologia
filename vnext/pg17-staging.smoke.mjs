import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { migrateStaging,openStagingDatabase,assertReminderRole,assertWorkspaceRole } from './staging-db.mjs';
import { simulateReminderDispatch } from './simulated-dispatch.mjs';

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
  let reminder,workspace;
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
    assert.equal(history.length,16);
    assert.ok(history.every(row=>/^[a-f0-9]{64}$/.test(row.sha256)));

    await pool.query('insert into lkz_vnext.tenants values($1,$2),($3,$4)',
      [a,'Empresa fictícia A',b,'Empresa fictícia B']);
    await pool.query('insert into auth.users values($1),($2)',[adminA,adminB]);
    await pool.query(
      "insert into lkz_vnext.memberships(tenant_id,user_id,role,active) "+
      "values($1,$2,'admin',true),($3,$4,'admin',true)",
      [a,adminA,b,adminB]
    );
    await pool.query(
      "create role lkz_vnext_reminder_runtime noinherit login password 'ci-local-only-not-a-secret'"
    );
    await pool.query(
      'grant lkz_vnext_reminder_bridge to lkz_vnext_reminder_runtime '+
      'with inherit false, set true'
    );
    await pool.query(
      "create role lkz_vnext_runtime noinherit login password 'ci-local-only-not-a-secret'"
    );
    await pool.query('grant authenticated to lkz_vnext_runtime with inherit false, set true');
    reminder=openStagingDatabase(asUser('lkz_vnext_reminder_runtime'));
    workspace=openStagingDatabase(asUser('lkz_vnext_runtime'));
    await assertReminderRole(reminder);
    await assertWorkspaceRole(workspace);

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
    await Promise.allSettled([migrator.close(),reminder?.close(),workspace?.close()]);
    await pool.end();
  }
});
