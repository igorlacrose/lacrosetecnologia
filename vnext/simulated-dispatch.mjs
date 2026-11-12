// Purely SYNTHETIC dispatch accounting. No Meta client and no network I/O.
// Every simulated claim + monthly reservation + job status is ONE transaction.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function simulateReminderDispatch(db,{
  tenant,clock=Date.now,limit=20,
}={}){
  if(typeof db?.transaction!=='function'||!uuid.test(tenant??'')
    ||typeof clock!=='function'||!Number.isInteger(limit)||limit<1||limit>50)
    throw new TypeError('A dedicated tenant, database and bounded batch are required');

  const instant=new Date(clock());
  if(!Number.isFinite(instant.getTime()))throw new TypeError('Invalid worker clock');
  // Explicit UTC accounting for fixtures only. Meta invoices can use other
  // billing boundaries: this is NOT a production expenditure guarantee.
  const utcMonth=new Date(Date.UTC(
    instant.getUTCFullYear(),instant.getUTCMonth(),1
  )).toISOString().slice(0,10);

  return db.transaction(async tx=>{
    await tx.exec('set local role lkz_vnext_reminder_bridge');
    // Serialize quota accounting per tenant, independent of per-job row locks.
    // A real sender needs its own lease/outbox and last-moment consent check.
    await tx.query('select pg_advisory_xact_lock(hashtextextended($1,0))',
      [tenant+':simulation-month:'+utcMonth]);
    const {rows:jobs}=await tx.query(
      'select j.product,j.appointment_key,j.appointment_revision,j.kind,'+
      'p.monthly_message_limit as monthly_cap '+
      'from lkz_vnext.whatsapp_reminder_jobs j '+
      'join lkz_vnext.whatsapp_appointments a on '+
        '(a.tenant_id,a.product,a.appointment_key)='+
        '(j.tenant_id,j.product,j.appointment_key) '+
      'join lkz_vnext.whatsapp_reminder_policies p on p.tenant_id=j.tenant_id '+
      "where j.tenant_id=$1 and j.status='pending' "+
      'and j.scheduled_for <= $2::timestamptz '+
      "and j.scheduled_for > ($2::timestamptz - interval '15 minutes') "+
      'and a.revision=j.appointment_revision and a.state=\'scheduled\' '+
      'and a.consent_given=true and a.recipient_hash is not null '+
      'and a.starts_at > $2::timestamptz '+
      'and p.enabled=true and p.monthly_message_limit > 0 '+
      'and not exists (select 1 from lkz_vnext.whatsapp_opt_outs o '+
        'where o.tenant_id=a.tenant_id and o.recipient_hash=a.recipient_hash) '+
      'and exists (select 1 from lkz_vnext.whatsapp_connections c '+
        'where c.tenant_id=j.tenant_id and c.billing_owner=\'customer_direct\' '+
        "and c.billing_state='verified' and c.connection_state='ready') "+
      'and not exists (select 1 from lkz_vnext.whatsapp_simulated_dispatches s '+
        'where (s.tenant_id,s.product,s.appointment_key,'+
        's.appointment_revision,s.kind)=(j.tenant_id,j.product,'+
        'j.appointment_key,j.appointment_revision,j.kind)) '+
      'order by j.scheduled_for,j.product,j.appointment_key,j.kind '+
      'limit $3 for update of j skip locked',
      [tenant,instant.toISOString(),limit]
    );
    let simulated=0,quotaBlocked=0;
    for(const job of jobs){
      const cap=Number(job.monthly_cap);
      if(!Number.isInteger(cap)||cap<1||cap>10000)
        throw new Error('Invalid synthetic monthly cap');
      const {rows:reserved}=await tx.query(
        'insert into lkz_vnext.whatsapp_simulated_monthly_usage '+
        '(tenant_id,utc_month,simulated_count) values($1,$2::date,1) '+
        'on conflict(tenant_id,utc_month) do update set '+
        'simulated_count=lkz_vnext.whatsapp_simulated_monthly_usage.simulated_count+1,'+
        'updated_at=now() '+
        'where lkz_vnext.whatsapp_simulated_monthly_usage.simulated_count < $3 '+
        'returning simulated_count',
        [tenant,utcMonth,cap]
      );
      if(!reserved.length){quotaBlocked++;continue;}
      const key=[tenant,job.product,job.appointment_key,
        Number(job.appointment_revision),job.kind];
      const {rows:changed}=await tx.query(
        "update lkz_vnext.whatsapp_reminder_jobs set status='simulated',updated_at=now() "+
        'where tenant_id=$1 and product=$2 and appointment_key=$3 '+
        "and appointment_revision=$4 and kind=$5 and status='pending' "+
        'returning kind',key
      );
      if(changed.length!==1)
        throw new Error('Synthetic claim failed; rolling back quota reservation');
      // If any duplicate ledger slips through, abort the WHOLE transaction.
      // No quota is lost and no state becomes partially simulated.
      await tx.query(
        'insert into lkz_vnext.whatsapp_simulated_dispatches '+
        '(tenant_id,product,appointment_key,appointment_revision,kind,utc_month) '+
        'values($1,$2,$3,$4,$5,$6::date)',
        [...key,utcMonth]
      );
      simulated++;
    }
    return Object.freeze({
      mode:'simulation_only',dryRun:true,canDispatch:false,
      checked:jobs.length,simulated,quotaBlocked,utcMonth,
    });
  });
}
