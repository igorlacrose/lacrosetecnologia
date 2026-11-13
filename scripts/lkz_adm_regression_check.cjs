'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const app=fs.readFileSync('admin/app.js','utf8');
const html=fs.readFileSync('admin/index.html','utf8');
const css=fs.readFileSync('admin/premium.css','utf8');
const sql=fs.readFileSync('supabase/migrations/20261112154035_lkz_adm_crm_interno_operacoes_lixeiras.sql','utf8');
const check=(desc,value)=>{assert.ok(value,desc);console.log('OK:',desc)};
check('CRM navega pela aplicação',html.includes('data-view="crm"')&&app.includes('function crm()'));
check('Financeiro acessível pelo menu lateral',html.includes('data-view="finance"')&&app.includes('function finance()'));
const catalog=app.slice(app.indexOf('const systemCatalog='),app.indexOf('const esc='));
check('Sistemas aprovados no painel',catalog.includes("name:'LibertyOS'")&&
  catalog.includes("name:'BarbarOS'")&&(catalog.match(/name:/g)||[]).length===2);
check('CSS premium carregado com versão de cache',/href="premium\.css\?v=\d{8}-\d+"/.test(html));
check('Atualização manual conectada',html.includes('id="refreshData"')&&app.includes("el('refreshData').onclick"));
check('Agenda operável',app.includes("function openFollowupEditor(")&&app.includes("lkz_adm_manage_followup"));
check('Oportunidades operáveis',app.includes("function showOpportunity(")&&app.includes("lkz_adm_update_lead"));
check('Arquivo comercial acessível e arquivamento confirmado',
  app.includes('data-toggle-archived')&&app.includes("title:'Arquivar oportunidade?'")&&
  app.includes('Registre o motivo do arquivamento'));
check('Lixeira de mensagens e atendimentos',app.includes("data-empty-messages")&&app.includes("data-empty-conversations"));
check('Exclusão definitiva confirma e usa API autorizada',app.includes('p_expected_count:count')&&app.includes("keyword:'ESVAZIAR'"));
check('Sem acesso a service role no frontend',!app.includes('service_role')&&!app.includes('sb_secret_'));
check('Banco exige autorização por MFA',sql.includes('lkz_adm_private.is_operator()')&&sql.includes('lkz_adm_private.is_master()'));
check('Backend audita esvaziamento',sql.includes('trash.empty_')&&sql.includes('operator_audit'));
check('Visual para celular',css.includes('@media(max-width:560px)'));
const start=app.indexOf('function dailyBrief(');
const end=app.indexOf('function navigatePriority(',start);
check('Função de prioridades independente presente',start>=0&&end>start);
const scope=vm.createContext({Intl,Date,Set,Map,Number});
vm.runInContext(app.slice(start,end),scope);
const input={
 leads:[{id:'lead-1',name:'Cliente piloto',status:'qualified',updated_at:'2026-11-11T11:00:00Z'}],
 followups:[{id:'followup-1',lead_id:'lead-1',lead:'Cliente piloto',status:'pending',due_at:'2026-11-11T12:00:00Z'}],
 approvals:[]
};
const brief=vm.runInContext('dailyBrief',scope)(input,Date.parse('2026-11-12T15:00:00Z'));
assert.equal(brief.overdue,1);
assert.equal(brief.priorities[0].target,'followups');
assert.equal(brief.priorities[0].followupId,'followup-1');
assert.equal(brief.priorities[0].leadId,'lead-1');
console.log('OK: Prioridades apontam para o retorno específico');

const contactSql=fs.readFileSync('supabase/migrations/20261112161747_lkz_adm_link_contato_existente.sql','utf8');
check('Sem diálogos nativos bloqueados',!/window\.(?:prompt|confirm)\s*\(/.test(app));
check('Confirmação própria e acessível',app.includes('function askConfirmation(')&&app.includes("setAttribute('aria-modal','true')"));
check('Vinculação usa RPC auditada',app.includes('lkz_adm_link_existing_contact')&&contactSql.includes('is_operator()')&&contactSql.includes('operator_audit'));
check('Cadastro evita duplicidade acidental',app.includes('Possível duplicidade com ')&&app.includes('normalizedPhone(val('));
check('Contatos encontrados continuam como sugestão',app.includes('Possível: ')&&app.includes('Confirme o cadastro sugerido'));
const contactStart=app.indexOf('function normalizedPhone(');
const contactEnd=app.indexOf('const label=',contactStart);
check('Reconhecimento determinístico isolável',contactStart>=0&&contactEnd>contactStart);
const contactScope=vm.createContext({String});
vm.runInContext(app.slice(contactStart,contactEnd),contactScope);
const matched=vm.runInContext('recognizedContactCandidates',contactScope)(
  {structured_data:{contact_email:'teste@example.com',contact_phone:'+55 (73) 99999-0000'}},
  [{id:'a',person_name:'Cliente conhecido',email:'teste@example.com',phone:null},
   {id:'b',person_name:'Outro',email:null,phone:'73 99999-0000'},
   {id:'c',person_name:'Desconhecido',email:'outra@example.com',phone:'73 88888-1111'}]
);
assert.equal(matched.length,2);
assert.equal(vm.runInContext('normalizedPhone',contactScope)('+55 (73) 99999-0000'),'73999990000');
console.log('OK: Sugestões por coincidência exata, sem atribuir nome arbitrário');


const workerSql=fs.readFileSync('supabase/migrations/20261112171446_lkz_oca_internal_worker_safe_pilot.sql','utf8');
check('OCA visível no menu',html.includes('data-view="oca"')&&app.includes('function oca('));
check('Fila interna usa RPCs autorizadas',app.includes('lkz_adm_oca_list_tasks')&&app.includes('lkz_adm_oca_resolve_task'));
check('Motor possui pausa e execução com MASTER',app.includes('lkz_adm_oca_run_now')&&app.includes('lkz_adm_oca_set_enabled'));
check('Worker grava somente tarefas internas',workerSql.includes('insert into lkz_adm_private.oca_internal_tasks')&&
 !/insert\s+into\s+public\.followups/i.test(workerSql));
check('Worker não envia mensagens/solicitações externas',!/https?:\/\/|net\.http|sendTelegram|sendMessage|pg_net/i.test(workerSql));
check('Automação idempotente e semanal',workerSql.includes('unique(lead_id,rule_code,week_start)')&&
 workerSql.includes('on conflict(lead_id,rule_code,week_start) do nothing'));
check('Fila administrativa exige MFA',workerSql.includes('lkz_adm_private.is_operator()'));
check('Pausa exige MASTER MFA',workerSql.includes('lkz_adm_private.is_master()'));
check('Cron apenas dias úteis',workerSql.includes("'10 14 * * 1-5'"));

check('Atendimento abre oportunidade existente',app.includes('data-message-lead')&&app.includes('openOpportunity(thread.lead_id)'));
check('Atendimento agenda retorno no CRM interno',app.includes('data-message-schedule')&&app.includes("openFollowupEditor('create',null,thread.lead_id)"));
check('Atendimento não agenda para oportunidade fechada',app.includes("!['won','lost','archived'].includes(linkedLead.status)"));
check('Polling detecta alterações acima dos primeiros 100',app.includes("count:'exact'")&&app.includes('countChanged'));
check('Polling preserva diálogo em aberto',app.includes('activeDialogCancel!==')||app.includes("typeof activeDialogCancel!=='undefined'&&activeDialogCancel"));

check('Central manual carregada na ficha de oportunidade',app.includes('LKZCrmComms.mount')&&html.includes('crm-comms.js?v=20261112-3'));
check('Estilo isolado carregado',html.includes('crm-comms.css?v=20261112-1'));
check('Nenhuma chave privada de API introduzida',!app.includes('sb_secret_')&&!html.includes('service_role'));

check('Registro manual usa RPC idempotente',require('node:fs').readFileSync('admin/crm-comms.js','utf8').includes('lkz_adm_crm_log_manual_contact_once'));
check('Chave de retentativa preservada por conteúdo',require('node:fs').readFileSync('admin/crm-comms.js','utf8').includes('requestForManualContact(note,currentChannel)'));

check('Pré-envio revisado sem transporte',html.includes('crm-previews.js?v=20261112-4')&&html.includes('crm-previews.css?v=20261112-2'));
check('Módulo de aprovação integrado à ficha',app.includes('LKZCrmPreviews.mount')&&app.includes("profile?.role==='master'"));

check('Data de consentimento disponível na ficha',app.includes('consent_contact,consent_at'));
check('Pré-envio recebe o cliente vinculado e atalho ao cadastro',app.includes('openClient:()=>')&&app.includes('contact:state.contacts.find('));

check('Histórico de consentimento por canal exibido na ficha do cliente',app.includes('LKZContactConsents.mount')&&html.includes('contact-consent.js?v=20261112-1'));
check('Nova folha de estilos carregada',html.includes('contact-consent.css?v=20261112-1'));
check('Cadastro não presume autorização global',!app.includes("selected.consent_contact?'Registrado':'Não registrado'"));
check('Comunicação não confunde legado com consentimento atual',!require('node:fs').readFileSync('admin/crm-comms.js','utf8').includes("contact?.consent_contact?"));

check('OCA pré-despacho sem transporte vinculado à prévia aprovada',app.includes('LKZCrmPreviews.mount')&&html.includes('oca-dispatch-preflight.js?v=20261112-1')&&html.includes('oca-dispatch-preflight.css?v=20261112-1'));
check('Pré-despacho usa módulos isolados',require('node:fs').readFileSync('admin/crm-previews.js','utf8').includes('window.LKZOcaPreflight.mount'));

check('Produtos múltiplos carregados na ficha',app.includes('LKZClientServices?.mountForm')&&app.includes('LKZClientServices.mountDetail'));
check('Criação e edição de minuta transacional',app.includes('lkz_adm_create_client_with_draft')&&app.includes('lkz_adm_edit_client_with_draft'));
check('Resumo financeiro distingue minuta de cobrança',app.includes('LKZClientServices.mountFinance'));
check('Módulo de serviços e estilos carregados',html.includes('client-services.js?v=20261112-2')&&html.includes('client-services.css?v=20261112-2'));
check('Seleção dos sistemas por dropdown com preço condicional',require('node:fs').readFileSync('admin/client-services.js','utf8').includes("node('details','service-picker')")&&require('node:fs').readFileSync('admin/client-services.js','utf8').includes('f.pricesCard.hidden=!enabled'));
check('Busca de cliente por nome abre ficha sem depender do CRM externo',app.includes('clientNameSuggestions')&&app.includes('client-name-link')&&app.includes('selectExactName'));

check('Módulo de propostas disponível na ficha de cliente',app.includes('window.LKZClientQuotes.mount')&&html.includes('client-quotes.js?v=20261112-1')&&html.includes('client-quotes.css?v=20261112-1'));
check('Proposta não confunde aceite com cobrança',require('node:fs').readFileSync('admin/client-quotes.js','utf8').includes('Preparar proposta (sem envio)')&&require('node:fs').readFileSync('admin/client-quotes.js','utf8').includes('customer_acceptance_enabled'));

check('Dossiê sem aceite disponível na ficha do cliente',app.includes('window.LKZSignatureDossiers.mount')&&html.includes('client-signature-dossiers.js?v=20261112-1')&&html.includes('client-signature-dossiers.css?v=20261112-1'));
check('Dossiê não habilita assinatura por UI',require('node:fs').readFileSync('admin/client-signature-dossiers.js','utf8').includes('customer_accepted!==false')&&require('node:fs').readFileSync('admin/client-signature-dossiers.js','utf8').includes('signature_enabled!==false'));

check('Minuta contratual privada disponível na ficha',app.includes('LKZContractTexts.mount')&&html.includes('client-contract-texts.js?v=20261112-1')&&html.includes('client-contract-texts.css?v=20261112-1'));
check('Minuta interna sem aceite nem cobrança',require('node:fs').readFileSync('admin/client-contract-texts.js','utf8').includes('legal_approved!==false')&&require('node:fs').readFileSync('admin/client-contract-texts.js','utf8').includes('signature_enabled!==false'));
