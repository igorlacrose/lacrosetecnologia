// A deliberately NON-SENDING scheduler rehearsal.
// No Meta client, access token, endpoint, payment state mutation, or message body.
// Review this separately before implementing production sending.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function rehearseDueReminders(db,{
  tenant, clock=Date.now, limit=30, graceMinutes=15,
}={}){
  if(typeof db?.transaction!=='function'||!uuid.test(tenant??'')
    ||typeof clock!=='function'||!Number.isInteger(limit)||limit<1||limit>50
    ||graceMinutes!==15) {
    throw new TypeError('Invalid reminder rehearsal configuration');
  }
  const now=new Date(clock());
  if(!Number.isFinite(now.getTime()))throw new TypeError('Invalid rehearsal clock');

  return db.transaction(async tx=>{
    await tx.exec('set local role lkz_vnext_reminder_bridge');
    // PostgreSQL row locks serialize parallel rehearsals. This intentionally
    // never claims a job for sending. Future dispatch must have its own
    // durable claim, transactional monthly quota and independent security gate.
    const {rows}=await tx.query(
      'select j.tenant_id,j.product,j.appointment_key,j.appointment_revision,'+
      'j.kind,j.scheduled_for,a.revision as current_revision,'+
      'a.state as appointment_state,a.consent_given,a.recipient_hash,a.starts_at,'+
      'coalesce(p.enabled,false) as policy_enabled,'+
      'coalesce(p.monthly_message_limit,0) as monthly_cap,'+
      'exists (select 1 from lkz_vnext.whatsapp_opt_outs o '+
        'where o.tenant_id=a.tenant_id and o.recipient_hash=a.recipient_hash) as opted_out,'+
      'exists (select 1 from lkz_vnext.whatsapp_connections c '+
        "where c.tenant_id=j.tenant_id and c.billing_owner='customer_direct' "+
        "and c.billing_state='verified' and c.connection_state='ready') as billing_ready "+
      'from lkz_vnext.whatsapp_reminder_jobs j '+
      'join lkz_vnext.whatsapp_appointments a on '+
        '(a.tenant_id,a.product,a.appointment_key)='+
        '(j.tenant_id,j.product,j.appointment_key) '+
      'left join lkz_vnext.whatsapp_reminder_policies p on p.tenant_id=j.tenant_id '+
      "where j.tenant_id=$1 and j.status='pending' and j.scheduled_for<=$2 "+
      'order by j.scheduled_for,j.product,j.appointment_key,j.kind limit $3 '+
      'for update of j skip locked',
      [tenant,now.toISOString(),limit]
    );

    const outcomes={};
    for(const item of rows){
      const scheduledFor=new Date(item.scheduled_for).getTime();
      let decision;
      if(item.appointment_state!=='scheduled' ||
         Number(item.current_revision)!==Number(item.appointment_revision) ||
         new Date(item.starts_at).getTime()<=now.getTime()){
        decision='blocked_appointment';
      }else if(!item.consent_given||!item.recipient_hash){
        decision='blocked_consent';
      }else if(item.opted_out){
        decision='blocked_opt_out';
      }else if(now.getTime()-scheduledFor>15*60000){
        decision='expired';
      }else if(!item.policy_enabled||Number(item.monthly_cap)===0){
        decision='blocked_policy';
      }else if(!item.billing_ready){
        decision='blocked_billing';
      }else {
        // Theoretical readiness only: no templates, quotas, Meta calls or
        // production sender exist. NEVER interpret as permission to dispatch.
        decision='dry_run_eligible';
      }
      const args=[tenant,item.product,item.appointment_key,
        item.appointment_revision,item.kind];
      if(['blocked_appointment','blocked_consent','blocked_opt_out','expired'].includes(decision)){
        await tx.query(
          "update lkz_vnext.whatsapp_reminder_jobs set status=$6,updated_at=now() "+
          "where tenant_id=$1 and product=$2 and appointment_key=$3 "+
          "and appointment_revision=$4 and kind=$5 and status='pending'",
          [...args,decision==='expired'?'expired':'cancelled']
        );
      }
      await tx.query(
        'insert into lkz_vnext.whatsapp_reminder_rehearsals '+
        '(tenant_id,product,appointment_key,appointment_revision,kind,decision) '+
        'values($1,$2,$3,$4,$5,$6) '+
        'on conflict(tenant_id,product,appointment_key,appointment_revision,kind) '+
        'do update set decision=excluded.decision,last_checked_at=now(),'+
        'check_count=least(lkz_vnext.whatsapp_reminder_rehearsals.check_count+1,2147483647)',
        [...args,decision]
      );
      outcomes[decision]=(outcomes[decision]??0)+1;
    }
    return Object.freeze({
      dryRun:true,canDispatch:false,checked:rows.length,decisions:outcomes
    });
  });
}
