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
check('Novo CSS premium carregado',html.includes('premium.css?v=20261112-1'));
check('Atualização manual conectada',html.includes('id="refreshData"')&&app.includes("el('refreshData').onclick"));
check('Agenda operável',app.includes("function openFollowupEditor(")&&app.includes("lkz_adm_manage_followup"));
check('Oportunidades operáveis',app.includes("function showOpportunity(")&&app.includes("lkz_adm_update_lead"));
check('Lixeira de mensagens e atendimentos',app.includes("data-empty-messages")&&app.includes("data-empty-conversations"));
check('Exclusão definitiva confirma e usa API autorizada',app.includes('p_expected_count:count')&&app.includes('Digite ESVAZIAR'));
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
