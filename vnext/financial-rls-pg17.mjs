import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Invoked only by pg17-staging.smoke.mjs against its disposable local CI DB.
// No Asaas requests, real credentials, real customers or paid operations.
export async function verifyFinancialRls(pool,workspace,{a,b,adminA,adminB}){
  const viewerA='00000000-0000-4000-8000-000000000016';
  const operatorA='00000000-0000-4000-8000-000000000017';
  await pool.query('insert into auth.users(id) values($1),($2)',[viewerA,operatorA]);
  await pool.query(
    "insert into lkz_vnext.memberships(tenant_id,user_id,role,active) "+
    "values($1,$2,'viewer',true),($1,$3,'operator',true)",
    [a,viewerA,operatorA]
  );

  const writer=await pool.connect();
  try{
    await writer.query('begin');
    for(const [tenant,code,state,actor] of [[a,'a','paid',adminA],[b,'b','overdue',adminB]]){
      await writer.query("select set_config('request.jwt.claims',$1,true)",
        [JSON.stringify({sub:actor,aal:'aal2'})]);
    const {rows:[client]}=await writer.query(
      'insert into lkz_vnext.clients(tenant_id,name,email) values($1,$2,$3) returning id',
      [tenant,'Fixture '+code,'fixture-'+code+'@example.test']
    );
    const {rows:[product]}=await writer.query(
      "insert into lkz_vnext.products(tenant_id,slug,name,kind) "+
      "values($1,$2,$3,'saas') returning id",
      [tenant,'sandbox-financial-'+code,'Synthetic '+code]
    );
    const {rows:[plan]}=await writer.query(
      "insert into lkz_vnext.plans(tenant_id,product_id,name,amount_brl_cents,interval) "+
      "values($1,$2,$3,1000,'monthly') returning id",
      [tenant,product.id,'CI Billing '+code]
    );
    const {rows:[draft]}=await writer.query(
      'insert into lkz_vnext.subscription_drafts(tenant_id,client_id,plan_id) '+
      'values($1,$2,$3) returning id',
      [tenant,client.id,plan.id]
    );
    await writer.query(
      'insert into lkz_vnext_billing.payment_bindings '+
      '(payment_id,tenant_id,subscription_id,customer_id,external_reference,expected_brl_cents,state) '+
      'values($1,$2,$3,$4,$5,1000,$6)',
      ['pay_ci_financial_'+code,tenant,draft.id,'cus_ci_financial_'+code,randomUUID(),state]
    );
    }
    await writer.query('commit');
  }catch(error){
    await writer.query('rollback');
    throw error;
  }finally{
    writer.release();
  }

  async function asUser(sub,aal,sql,args=[]){
    return workspace.transaction(async tx=>{
      await tx.exec('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims',$1,true)",
        [JSON.stringify({sub,aal})]);
      return tx.query(sql,args);
    });
  }
  const list='select tenant_id,state from lkz_vnext_billing.payment_bindings order by tenant_id';
  assert.deepEqual((await asUser(adminA,'aal2',list)).rows,[{tenant_id:a,state:'paid'}],
    'Company A admin must not read B billing');
  assert.deepEqual((await asUser(adminB,'aal2',list)).rows,[{tenant_id:b,state:'overdue'}],
    'Company B admin must not read A billing');
  assert.deepEqual((await asUser(viewerA,'aal2',list)).rows,[],
    'Viewer cannot inspect financial states');
  assert.deepEqual((await asUser(operatorA,'aal2',list)).rows,[],
    'Operator cannot inspect financial states');
  assert.deepEqual((await asUser(adminA,'aal1',list)).rows,[],
    'Billing requires verified MFA level 2');

  // The browser role receives only state summary columns, never raw gateway IDs.
  await assert.rejects(asUser(adminA,'aal2',
    'select * from lkz_vnext_billing.payment_bindings'),err=>err.code==='42501');
  await assert.rejects(asUser(adminA,'aal2',
    "update lkz_vnext_billing.payment_bindings set state='paid' where tenant_id=$1",[b]),
  err=>err.code==='42501');
  await assert.rejects(asUser(adminA,'aal2',
    'select * from lkz_vnext_billing.payment_state_events'),err=>err.code==='42501');
  assert.equal((await pool.query(
    "select has_table_privilege('anon','lkz_vnext_billing.payment_bindings','SELECT') as allowed"
  )).rows[0].allowed,false,'Anonymous payment table reads must be denied');

  // Revocation is read from memberships on each database request, not cached JWT roles.
  await pool.query(
    'update lkz_vnext.memberships set active=false where tenant_id=$1 and user_id=$2',
    [a,adminA]
  );
  try {
    assert.deepEqual((await asUser(adminA,'aal2',list)).rows,[],
      'Previously authorized JWT must lose billing access after membership revocation');
  }finally{
    await pool.query(
      'update lkz_vnext.memberships set active=true where tenant_id=$1 and user_id=$2',
      [a,adminA]
    );
  }
  assert.deepEqual((await asUser(adminA,'aal2',list)).rows,[{tenant_id:a,state:'paid'}]);
}
