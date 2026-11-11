import {
  createCipheriv, createHash, createHmac, randomBytes, timingSafeEqual,
} from 'node:crypto';

const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const appointmentId=/^[A-Za-z0-9_-]{1,80}$/;
const phonePattern=/^\+[1-9][0-9]{7,14}$/;
const isoOffset=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const supportedProducts=new Set(['barbaros','libertyos']);
const supportedEvents=new Set(['booked','rescheduled','cancelled','opted_out']);
const digest=s=>createHash('sha256').update(s).digest('hex');
const reply=(status,code,extra={})=>Response.json(
  {ok:status>=200&&status<300,code,...extra},
  {status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}}
);

async function boundedText(req,maximum=4096){
  if(!req.body)throw new Error('no_body');
  const reader=req.body.getReader();
  let bytes=0;
  const chunks=[];
  while(true){
    const {done,value}=await reader.read();
    if(done)break;
    bytes+=value.byteLength;
    if(bytes>maximum){
      await reader.cancel();
      throw new Error('oversized_payload');
    }
    chunks.push(value);
  }
  const result=new Uint8Array(bytes);
  let position=0;
  for(const chunk of chunks){result.set(chunk,position);position+=chunk.byteLength;}
  return new TextDecoder('utf-8',{fatal:true}).decode(result);
}

function validDate(value){
  if(typeof value!=='string'||!isoOffset.test(value))return null;
  const date=new Date(value);
  return Number.isFinite(date.getTime())?date:null;
}

function validate(input,now){
  if(!input||typeof input!=='object'||Array.isArray(input)||
    !uuid.test(input.eventId??'')||!supportedEvents.has(input.type))
    throw new TypeError('invalid_event');
  const allowed=new Set(['eventId','type','appointmentId','revision',
    'startsAt','timezone','recipient','consent','source']);
  if(Object.keys(input).some(k=>!allowed.has(k)))
    throw new TypeError('unrecognized_field');
  if(input.type==='opted_out'){
    if(typeof input.recipient!=='string'||!phonePattern.test(input.recipient)||
       !['booking_platform','whatsapp_reply','staff_recorded'].includes(input.source))
      throw new TypeError('invalid_opt_out');
    return {type:input.type,eventId:input.eventId,recipient:input.recipient,source:input.source};
  }
  if(!appointmentId.test(input.appointmentId??'')||
     !Number.isSafeInteger(input.revision)||input.revision<1||input.revision>2147483647)
    throw new TypeError('invalid_appointment');
  if(input.type==='cancelled')
    return {type:input.type,eventId:input.eventId,
      appointmentId:input.appointmentId,revision:input.revision};
  const starts=validDate(input.startsAt);
  if(!starts||starts.getTime()<now+60000||starts.getTime()>now+366*86400000)
    throw new TypeError('invalid_start_time');
  let timezone;
  try{
    timezone=new Intl.DateTimeFormat('pt-BR',{timeZone:input.timezone}).resolvedOptions().timeZone;
  }catch{throw new TypeError('invalid_timezone');}
  if(timezone.length>64)throw new TypeError('invalid_timezone');
  const consent=input.consent;
  if(!consent||typeof consent!=='object'||Array.isArray(consent)||
    typeof consent.granted!=='boolean'||Object.keys(consent).some(k=>!['granted','at','source'].includes(k)))
    throw new TypeError('invalid_consent');
  const timestamp=consent.granted?validDate(consent.at):null;
  if(consent.granted && (
      !phonePattern.test(input.recipient??'')||
      !['online_booking','staff_recorded'].includes(consent.source)||
      !timestamp||timestamp.getTime()>now+300000
    )) throw new TypeError('invalid_consent_evidence');
  return {type:input.type,eventId:input.eventId,
    appointmentId:input.appointmentId,revision:input.revision,
    startsAt:starts.toISOString(),timezone,
    consent:consent.granted,
    consentAt:timestamp?.toISOString()??null,
    consentSource:consent.granted?consent.source:null,
    recipient:consent.granted?input.recipient:null};
}

function encrypt(plaintext,key){
  const nonce=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,nonce);
  return {
    ciphertext:Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final(),cipher.getAuthTag()]),
    nonce
  };
}
function recipientHash(pepper,tenant,phone){
  return createHmac('sha256',pepper).update(tenant+':'+phone).digest('hex');
}
function configured(options){
  if(!options||typeof options.db?.transaction!=='function'||
     !Array.isArray(options.sources)||!options.sources.length||
     !/^[a-f0-9]{64}$/i.test(options.encryptionKey??'')||
     typeof options.hashPepper!=='string'||options.hashPepper.length<32)
    throw new TypeError('A protected reminder DB, source registry and encryption are required');
  const sources=new Map();
  for(const item of options.sources){
    if(!uuid.test(item?.id??'')||!uuid.test(item?.tenant??'')||
       !supportedProducts.has(item?.product)||typeof item?.secret!=='string'||
       item.secret.length<32||sources.has(item.id))
      throw new TypeError('Invalid or duplicated appointment source');
    sources.set(item.id,{tenant:item.tenant,product:item.product,secret:item.secret});
  }
  return {db:options.db,sources,key:Buffer.from(options.encryptionKey,'hex'),
    pepper:options.hashPepper,clock:options.clock??Date.now};
}

async function apply(db,source,event,hashValue,key,pepper,clock){
  return db.transaction(async tx=>{
    await tx.exec('set local role lkz_vnext_reminder_bridge');
    const tenant=source.tenant,product=source.product;
    // Serialize by tenant/product so concurrent requests cannot bypass the
    // 60-events/minute guard. Separate products keep independent quotas.
    await tx.query('select pg_advisory_xact_lock(hashtextextended($1,0))',
      [tenant+':'+product+':source-rate']);
    const {rows:[rate]}=await tx.query(
      "select count(*)::integer as total from lkz_vnext.whatsapp_appointment_events "+
      "where tenant_id=$1 and product=$2 and received_at>now()-interval '1 minute'",
      [tenant,product]
    );
    if(Number(rate.total)>=60)return {code:'rate_limited'};
    const priorEvent=await tx.query(
      'select event_digest from lkz_vnext.whatsapp_appointment_events '+
      'where tenant_id=$1 and product=$2 and event_id=$3',
      [tenant,product,event.eventId]
    );
    if(priorEvent.rows.length)
      return {code:priorEvent.rows[0].event_digest===hashValue?'duplicate':'event_conflict'};
    // A unique ledger row and the appointment update share the same transaction.
    const inserted=await tx.query(
      'insert into lkz_vnext.whatsapp_appointment_events '+
      '(tenant_id,product,event_id,event_digest,event_type) values ($1,$2,$3,$4,$5) '+
      'on conflict do nothing returning event_id',
      [tenant,product,event.eventId,hashValue,event.type]
    );
    if(!inserted.rows.length)return {code:'duplicate'};

    if(event.type==='opted_out'){
      const hashed=recipientHash(pepper,tenant,event.recipient);
      await tx.query('select pg_advisory_xact_lock(hashtextextended($1,0))',
        [tenant+':recipient:'+hashed]);
      await tx.query(
        'insert into lkz_vnext.whatsapp_opt_outs '+
        '(tenant_id,recipient_hash,source) values($1,$2,$3) on conflict do nothing',
        [tenant,hashed,event.source]
      );
      await tx.query(
        "update lkz_vnext.whatsapp_reminder_jobs set status='cancelled',updated_at=now() "+
        "where tenant_id=$1 and status='pending' and (tenant_id,product,appointment_key) in "+
        "(select tenant_id,product,appointment_key from lkz_vnext.whatsapp_appointments "+
        "where tenant_id=$1 and recipient_hash=$2)",[tenant,hashed]
      );
      await tx.query(
        'update lkz_vnext.whatsapp_appointments set consent_given=false,'+
        'consent_at=null,consent_source=null,recipient_hash=null,'+
        'recipient_ciphertext=null,recipient_nonce=null,updated_at=now() '+
        'where tenant_id=$1 and recipient_hash=$2',[tenant,hashed]
      );
      return {code:'opt_out_applied'};
    }

    // Lock recipient BEFORE appointment, matching the opt-out lock order.
    // Otherwise a concurrent opt-out across BarbarOS/LibertyOS can deadlock.
    const isCancelled=event.type==='cancelled';
    let permitted=Boolean(event.consent)&&!isCancelled;
    let hashed=null;
    let cipher=null;
    if(permitted){
      hashed=recipientHash(pepper,tenant,event.recipient);
      await tx.query('select pg_advisory_xact_lock(hashtextextended($1,0))',
        [tenant+':recipient:'+hashed]);
      const excluded=await tx.query(
        'select 1 from lkz_vnext.whatsapp_opt_outs where tenant_id=$1 and recipient_hash=$2',
        [tenant,hashed]
      );
      permitted=!excluded.rows.length;
      if(permitted)cipher=encrypt(event.recipient,key);
      else hashed=null;
    }
    // Revisions of the same appointment are serialized after consent checks.
    await tx.query('select pg_advisory_xact_lock(hashtextextended($1,0))',
      [tenant+':'+product+':'+event.appointmentId]);
    const prev=await tx.query(
      'select revision from lkz_vnext.whatsapp_appointments where '+
      'tenant_id=$1 and product=$2 and appointment_key=$3 for update',
      [tenant,product,event.appointmentId]
    );
    if(prev.rows.length && Number(prev.rows[0].revision)>=event.revision)
      return {code:'stale_revision'};
    const state=isCancelled?'cancelled':'scheduled';
    await tx.query(
      'insert into lkz_vnext.whatsapp_appointments '+
      '(tenant_id,product,appointment_key,revision,starts_at,timezone,state,consent_given,'+
      'consent_at,consent_source,recipient_hash,recipient_ciphertext,recipient_nonce,last_event_id) '+
      'values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) '+
      'on conflict (tenant_id,product,appointment_key) do update set '+
      'revision=excluded.revision,starts_at=excluded.starts_at,timezone=excluded.timezone,'+
      'state=excluded.state,consent_given=excluded.consent_given,consent_at=excluded.consent_at,'+
      'consent_source=excluded.consent_source,recipient_hash=excluded.recipient_hash,'+
      'recipient_ciphertext=excluded.recipient_ciphertext,recipient_nonce=excluded.recipient_nonce,'+
      'last_event_id=excluded.last_event_id,updated_at=now()',
      [tenant,product,event.appointmentId,event.revision,
        isCancelled?null:event.startsAt,isCancelled?null:event.timezone,state,permitted,
        permitted?event.consentAt:null,permitted?event.consentSource:null,
        hashed,cipher?.ciphertext??null,cipher?.nonce??null,event.eventId]
    );
    await tx.query(
      "update lkz_vnext.whatsapp_reminder_jobs set status='cancelled',updated_at=now() "+
      "where tenant_id=$1 and product=$2 and appointment_key=$3 and status='pending'",
      [tenant,product,event.appointmentId]
    );
    let scheduled=0;
    if(permitted){
      const now=clock();
      const when=new Date(event.startsAt).getTime();
      const tasks=[
        ['confirmation',new Date(now)],
        ['reminder_24h',new Date(when-86400000)],
        ['reminder_2h',new Date(when-7200000)]
      ].filter(([kind,due])=>kind==='confirmation'||due.getTime()>now+60000);
      for(const [kind,due] of tasks){
        await tx.query(
          'insert into lkz_vnext.whatsapp_reminder_jobs '+
          '(tenant_id,product,appointment_key,appointment_revision,kind,scheduled_for) '+
          'values ($1,$2,$3,$4,$5,$6) on conflict do nothing',
          [tenant,product,event.appointmentId,event.revision,kind,due.toISOString()]
        );
      }
      scheduled=tasks.length;
    }
    return {code:isCancelled?'cancelled':permitted?'scheduled':'no_consent',jobs:scheduled};
  });
}

export function createAppointmentWebhook(options){
  const cfg=configured(options);
  return async function appointmentWebhook(request){
    if(request.method!=='POST')return reply(405,'method_not_allowed');
    if(!(request.headers.get('content-type')??'').toLowerCase().startsWith('application/json'))
      return reply(415,'content_type');
    const source=cfg.sources.get(request.headers.get('x-lkz-source-id'));
    const timestamp=request.headers.get('x-lkz-timestamp')??'';
    const sig=request.headers.get('x-lkz-signature')??'';
    if(!source||!/^\d{10}$/.test(timestamp)||!/^[a-f0-9]{64}$/i.test(sig))
      return reply(401,'unauthorized');
    const millis=Number(timestamp)*1000;
    if(!Number.isSafeInteger(millis)||Math.abs(cfg.clock()-millis)>300000)
      return reply(401,'signature_expired');
    let raw,event;
    try{
      raw=await boundedText(request);
      const expected=createHmac('sha256',source.secret)
        .update(timestamp+'.'+raw).digest();
      if(!timingSafeEqual(expected,Buffer.from(sig,'hex')))
        return reply(401,'unauthorized');
      event=validate(JSON.parse(raw),cfg.clock());
    }catch{
      return reply(400,'invalid_or_oversized_event');
    }
    try{
      const result=await apply(cfg.db,source,event,digest(raw),
        cfg.key,cfg.pepper,cfg.clock);
      const status=result.code==='rate_limited'?429:
        result.code==='event_conflict'||result.code==='stale_revision'?409:200;
      return reply(status,result.code,result.jobs===undefined?{}:{scheduledJobs:result.jobs});
    }catch{
      // No raw payloads, phone numbers, secrets or tokens are logged.
      return reply(503,'storage_unavailable');
    }
  };
}

// A read-only audit for a future worker. This deliberately NEVER sends a
// WhatsApp message or marks a job sent, even when Meta billing is verified.
export async function inspectDueReminders(db,{tenant,clock=Date.now,limit=20}){
  if(!uuid.test(tenant)||!Number.isInteger(limit)||limit<1||limit>50)
    throw new TypeError('Invalid due-job inspection');
  return db.transaction(async tx=>{
    await tx.exec('set local role lkz_vnext_reminder_bridge');
    const {rows}=await tx.query(
      "select j.product,j.appointment_key,j.kind,j.scheduled_for "+
      "from lkz_vnext.whatsapp_reminder_jobs j "+
      "join lkz_vnext.whatsapp_appointments a on "+
      "(a.tenant_id,a.product,a.appointment_key)=(j.tenant_id,j.product,j.appointment_key) "+
      "join lkz_vnext.whatsapp_reminder_policies p on p.tenant_id=j.tenant_id "+
      "where j.tenant_id=$1 and j.status='pending' and j.scheduled_for<=$2 "+
      "and j.scheduled_for>($2::timestamptz-interval '15 minutes') "+
      "and a.revision=j.appointment_revision and a.state='scheduled' "+
      "and a.consent_given=true and a.starts_at>$2 and "+
      "p.enabled=true and p.monthly_message_limit>0 "+
      "and not exists (select 1 from lkz_vnext.whatsapp_opt_outs o "+
      "where o.tenant_id=a.tenant_id and o.recipient_hash=a.recipient_hash) "+
      "and exists (select 1 from lkz_vnext.whatsapp_connections c "+
      "where c.tenant_id=j.tenant_id and c.billing_owner='customer_direct' "+
      "and c.billing_state='verified' and c.connection_state='ready') "+
      "order by j.scheduled_for limit $3",
      [tenant,new Date(clock()).toISOString(),limit]
    );
    return {dryRun:true,canDispatch:false,due:rows};
  });
}
