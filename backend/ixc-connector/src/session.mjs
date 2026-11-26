import {inspectReadOnly} from './schema.mjs';
import {withinDeadline,timeoutError} from './deadline.mjs';

export async function runInspection(createConnection,cfg){
 let connection;
 const controller=new AbortController();
 const destroy=()=>{try{connection?.destroy();}catch{}};
 const abort=error=>{controller.abort(error);destroy();};
 const timer=setTimeout(()=>abort(timeoutError()),cfg.totalTimeoutMs);
 const options={signal:controller.signal,onTimeout:abort};
 try{
  connection=createConnection(cfg.connection);
  const conn=connection.promise();
  await withinDeadline(()=>conn.connect(),cfg.connection.connectTimeout,options);
  const report=await inspectReadOnly(conn,cfg.connection.database,{
   ...options,queryTimeoutMs:cfg.queryTimeoutMs
  });
  await withinDeadline(()=>conn.end(),cfg.queryTimeoutMs,options);
  return report;
 }finally{clearTimeout(timer);destroy();}
}
