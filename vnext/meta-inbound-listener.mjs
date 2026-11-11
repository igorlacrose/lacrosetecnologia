import { createServer } from 'node:http';
import { openStagingDatabase, assertReminderRole } from './staging-db.mjs';
import { createMetaInboundWebhook } from './meta-inbound.mjs';

// Dedicated loopback-only server for a controlled HTTPS ingress/proxy.
// No UI, admin API, secrets, message sending, or generic file routes.
export function createMetaInboundServer(handler){
  if(typeof handler!=='function')throw new TypeError('Meta handler required');
  return createServer({
    requestTimeout:10000,headersTimeout:8000,maxHeaderSize:8192,
  },async(incoming,outgoing)=>{
    const port=outgoing.socket.localPort;
    const origin='http://127.0.0.1:'+port;
    const noStore={'cache-control':'no-store','x-content-type-options':'nosniff'};
    try{
      if(incoming.headers.host!=='127.0.0.1:'+port){
        outgoing.writeHead(403,noStore).end();return;
      }
      const url=new URL(incoming.url,origin);
      if(url.origin!==origin||url.pathname!=='/integrations/meta-whatsapp'||
         (incoming.method==='POST'&&url.search)){
        outgoing.writeHead(404,noStore).end();return;
      }
      if(incoming.method!=='GET'&&incoming.method!=='POST'){
        outgoing.writeHead(405,{...noStore,allow:'GET, POST'}).end();return;
      }
      const headers=new Headers({
        'content-type':incoming.headers['content-type']??'',
        'x-hub-signature-256':incoming.headers['x-hub-signature-256']??'',
      });
      let body;
      if(incoming.method==='POST'){
        const chunks=[];let length=0;
        for await(const part of incoming){
          length+=part.length;
          if(length>65536){
            outgoing.writeHead(413,{...noStore,connection:'close'}).end();return;
          }
          chunks.push(part);
        }
        body=Buffer.concat(chunks);
      }
      const request=new Request(url,{
        method:incoming.method,headers,
        body:incoming.method==='POST'?body:undefined
      });
      const response=await handler(request);
      const text=await response.text();
      outgoing.writeHead(response.status,{
        ...noStore,'content-type':response.headers.get('content-type')??'text/plain; charset=utf-8'
      }).end(text);
    }catch{
      outgoing.writeHead(503,noStore).end();
    }
  });
}

if(process.argv[1]&&import.meta.filename===process.argv[1]){
  let db;
  try{
    db=openStagingDatabase(process.env.VNEXT_REMINDER_DATABASE_URL);
    await assertReminderRole(db);
    const handler=createMetaInboundWebhook({
      db,
      appSecret:process.env.VNEXT_META_APP_SECRET,
      verifyToken:process.env.VNEXT_META_WEBHOOK_VERIFY_TOKEN,
      hashPepper:process.env.VNEXT_REMINDER_HASH_PEPPER
    });
    const server=createMetaInboundServer(handler);
    server.listen(4178,'127.0.0.1',()=>console.log('VNext Meta inbound: loopback-only'));
    for(const signal of ['SIGINT','SIGTERM'])
      process.once(signal,()=>server.close(()=>void db.close()));
  }catch{
    console.error('Meta inbound service not configured; no listener started.');
    if(db)await db.close();
    process.exitCode=1;
  }
}
