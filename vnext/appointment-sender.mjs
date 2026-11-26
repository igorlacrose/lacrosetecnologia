import { createHmac } from 'node:crypto';

// Reusable server-side adapter for BarbarOS and LibertyOS.
// Use a durable source event ID and monotonically increasing appointment revision.
// Each SaaS holds only its OWN HMAC secret; no Meta/Asaas token is required.
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export function createAppointmentSender({
  endpoint,sourceId,secret,request=fetch,clock=Date.now
}={}){
  let url;
  try{url=new URL(endpoint)}catch{throw new TypeError('Absolute endpoint is required')}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search||
     !uuid.test(sourceId??'')||typeof secret!=='string'||secret.length<32||
     typeof request!=='function'){
    throw new TypeError('Secure endpoint, source ID and protected signing secret are required');
  }
  return async function sendAppointmentEvent(event){
    if(!event||typeof event!=='object'||Array.isArray(event)||!uuid.test(event.eventId??''))
      throw new TypeError('Durable appointment event ID is required');
    const body=JSON.stringify(event);
    if(Buffer.byteLength(body,'utf8')>4096)
      throw new TypeError('Appointment event too large');
    const timestamp=String(Math.floor(clock()/1000));
    const signature=createHmac('sha256',secret)
      .update(timestamp+'.'+body).digest('hex');
    const response=await request(url.toString(),{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
      headers:{
        'content-type':'application/json',
        'x-lkz-source-id':sourceId,
        'x-lkz-timestamp':timestamp,
        'x-lkz-signature':signature
      },
      body
    });
    let result={code:'unavailable'};
    try{result=await response.json()}catch{}
    // No raw event, recipient number or HMAC secret in errors.
    if(!response.ok && response.status>=500)
      throw new Error('appointment_delivery_retryable');
    return {status:response.status,code:String(result.code??'invalid_response'),
      scheduledJobs:Number(result.scheduledJobs??0)};
  };
}
