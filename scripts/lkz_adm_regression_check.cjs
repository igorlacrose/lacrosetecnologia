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
check('Novo CSS premium carregado',html.includes('premium.css?v=20261112-4'));
check('Atualização manual conectada',html.includes('id="refreshData"')&&app.includes("el('refreshData').onclick"));
check('Agenda operável',app.includes("function openFollowupEditor(")&&app.includes("lkz_adm_manage_followup"));
check('Oportunidades operáveis',app.includes("function showOpportunity(")&&app.includes("lkz_adm_update_lead"));
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

check('Central manual carregada na ficha de oportunidade',app.includes('LKZCrmComms.mount')&&html.includes('crm-comms.js?v=20261112-1'));
check('Estilo isolado carregado',html.includes('crm-comms.css?v=20261112-1'));
check('Nenhuma chave privada de API introduzida',!app.includes('sb_secret_')&&!html.includes('service_role'));
