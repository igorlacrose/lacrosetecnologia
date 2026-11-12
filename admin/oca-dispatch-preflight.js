/* OCA • pré-validação auditada, sem despacho ou integração com provedores.
 * O servidor aplica MFA, vinculação de tenant e bloqueio de transporte.
 * A interface não cria/edita empresas nem efetua envios.
 */
(function(){
'use strict';

const labels=Object.freeze({
  workspace_unassigned:'Esta oportunidade ainda não está vinculada a uma empresa do OCA.',
  workspace_disabled:'O ambiente da empresa está desativado para comunicações.',
  preview_not_approved:'A prévia ainda não recebeu aprovação comercial.',
  lead_closed_or_relinked:'A oportunidade foi encerrada ou trocou de contato.',
  recipient_missing:'O destinatário não está cadastrado.',
  recipient_changed:'O e-mail ou telefone mudou desde a revisão.',
  consent_missing_or_stale:'Não há autorização vigente e comprovada para o canal e destino.',
  draft_changed_or_missing:'O texto salvo foi alterado ou removido após a revisão.',
  transport_disabled:'O transporte continua desabilitado: nenhum provedor oficial foi homologado.'
});
const retries=new Map();
function element(tag,cls,value){
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(value!==undefined)el.textContent=String(value);
  return el;
}
function mount({target,preview,sb,isSessionActive}){
  if(!target?.isConnected||!preview?.id||preview.status!=='approved'||!sb||!isSessionActive())return;
  if(target.querySelector('[data-oca-preflight]'))return;
  const root=element('section','oca-preflight');
  root.dataset.ocaPreflight='';
  root.append(
    element('h4','','Prontidão de despacho OCA'),
    element('p','oca-preflight-intro',
      'Diagnóstico técnico auditado. Não agenda, transmite ou entrega mensagens.')
  );
  const run=element('button','cta secondary','Verificar bloqueios');
  run.type='button';
  const feedback=element('p','oca-preflight-status','Nenhum diagnóstico solicitado.');
  feedback.setAttribute('role','status');
  const blockers=element('ul','oca-preflight-blockers');
  root.append(run,feedback,blockers);
  target.append(root);
  const active=()=>root.isConnected&&isSessionActive();
  let busy=false;
  run.onclick=async()=>{
    if(busy||!active())return;
    const key=String(preview.id);
    let id=retries.get(key);
    if(!id){
      id=crypto.randomUUID();
      retries.set(key,id);
    }
    busy=true;run.disabled=true;feedback.textContent='Validando pré-requisitos no servidor...';
    let response;
    try{
      response=await sb.rpc('lkz_adm_oca_comm_preflight',{
        p_preview:preview.id,p_request_id:id
      });
    }catch{
      response={error:{code:'NETWORK'}};
    }
    if(!active())return;
    busy=false;run.disabled=false;
    if(response.error||response.data?.status!=='blocked'||
       response.data?.delivery_enabled!==false||
       response.data?.dry_run_only!==true||
       !Array.isArray(response.data?.blockers)){
      feedback.textContent='Diagnóstico não confirmado ('+
        (response.error?.code||'RESPOSTA_INVALIDA')+
        '). A retentativa reutilizará o mesmo identificador.';
      return;
    }
    retries.delete(key);
    blockers.replaceChildren();
    for(const code of response.data.blockers){
      blockers.append(element('li','',labels[code]||'Bloqueio do servidor: '+String(code)));
    }
    feedback.textContent=response.data.already_recorded?
      'Diagnóstico previamente registrado, sem duplicação. Despacho bloqueado.':
      'Diagnóstico registrado. Despacho bloqueado; nenhum envio realizado.';
  };
}
window.LKZOcaPreflight=Object.freeze({mount});
})();