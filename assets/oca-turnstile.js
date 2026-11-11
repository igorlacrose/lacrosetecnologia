/* OCA Turnstile: verificação sob demanda. Sitekey é pública; segredo NUNCA sai do backend.
 * Nenhum token é persistido, reutilizado, enviado a logs ou armazenado no CRM.
 * Sem sitekey configurada, IA permanece desabilitada e o atendimento local funciona.
 */
(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.LacroseOcaTurnstile=api;
})(typeof window==='object'?window:globalThis,function(root){
  'use strict';
  const SCRIPT_URL='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  const CONTAINER_ID='ocaAiTurnstile';
  const ACTION='oca_interpret';
  const VALIDATION_TIMEOUT_MS=30000;
  let scriptPromise=null,active=null;

  function container(){return root.document?.getElementById(CONTAINER_ID)||null;}
  function sitekey(){return String(container()?.dataset?.sitekey||'').trim();}
  function available(){
    const key=sitekey();
    return !!container()&&key.length>=8&&key.length<=128&&/^[A-Za-z0-9_-]+$/.test(key);
  }

  function load(){
    if(root.turnstile?.render)return Promise.resolve(root.turnstile);
    if(scriptPromise)return scriptPromise;
    scriptPromise=new Promise((resolve,reject)=>{
      const script=root.document.createElement('script');
      script.src=SCRIPT_URL;
      script.async=true;
      script.referrerPolicy='no-referrer';
      let settled=false;
      const deadline=root.setTimeout(()=>{
        if(settled)return;
        settled=true;
        script.remove();
        reject(new Error('turnstile_load_timeout'));
      },8000);
      script.onload=()=>{
        if(settled)return;
        settled=true;
        root.clearTimeout(deadline);
        if(root.turnstile?.render)resolve(root.turnstile);
        else reject(new Error('turnstile_unavailable'));
      };
      script.onerror=()=>{
        if(settled)return;
        settled=true;
        root.clearTimeout(deadline);
        script.remove();
        reject(new Error('turnstile_load_failed'));
      };
      root.document.head.appendChild(script);
    }).catch(()=>{scriptPromise=null;return null;});
    return scriptPromise;
  }

  function cancel(){
    active?.finish(null);
  }

  async function acquire(){
    if(!available()||active)return null;
    const target=container();
    const api=await load();
    if(!api||!target||!target.isConnected||!available()||active)return null;
    return new Promise(resolve=>{
      let widgetId=null,done=false,timeout=null;
      function finish(value){
        if(done)return;
        done=true;
        root.clearTimeout(timeout);
        try{if(widgetId!==null)api.remove(widgetId);}catch{}
        target.replaceChildren();
        target.hidden=true;
        if(active?.finish===finish)active=null;
        resolve(typeof value==='string'&&value.length>0&&value.length<=2048?value:null);
      }
      active={finish};
      target.hidden=false;
      timeout=root.setTimeout(()=>finish(null),VALIDATION_TIMEOUT_MS);
      try{
        widgetId=api.render(target,{
          sitekey:sitekey(),action:ACTION,theme:'auto',
          execution:'execute',appearance:'interaction-only',
          callback:token=>finish(token),
          'expired-callback':()=>finish(null),
          'timeout-callback':()=>finish(null),
          'error-callback':()=>finish(null)
        });
        if(widgetId===undefined||widgetId===null){finish(null);return;}
        api.execute(widgetId);
      }catch{finish(null);}
    });
  }

  return Object.freeze({available,acquire,cancel});
});
