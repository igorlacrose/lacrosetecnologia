export function timeoutError(){
 return Object.assign(Error('Prazo de execução excedido. Conexão encerrada.'),{code:'IXC_TIMEOUT'});
}

// Cancela a espera e encerra o transporte; não promete cancelar trabalho remoto.
export function withinDeadline(operation,ms,{signal,onTimeout=()=>{}}={}){
 return new Promise((resolve,reject)=>{
  let timer,settled=false;
  const finish=(callback,value)=>{
   if(settled)return;
   settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
   callback(value);
  };
  const abort=()=>finish(reject,signal.reason||timeoutError());
  if(signal?.aborted){abort();return;}
  signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>{
   const error=timeoutError();finish(reject,error);
   onTimeout(error);
  },ms);
  Promise.resolve().then(operation).then(value=>finish(resolve,value),error=>finish(reject,error));
 });
}
