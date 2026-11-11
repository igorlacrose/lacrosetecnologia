'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const advisor=require('../assets/oca-advisor.js');

const lead=(problem,segment='')=>({problem,segment});
function answer(q){return advisor.reply(q,lead(''))}

test('responde o que a Lacrose faz sem perguntar tamanho ou urgência',()=>{
 const x=answer('Quais serviços vocês oferecem?');
 assert.match(x,/sites e sistemas/);
 assert.match(x,/automação empresarial/);
 assert.doesNotMatch(x,/tamanho aproximado|urgência|R\$/i);
});
test('consultoria local e remoto, sem inventar endereços',()=>{
 const x=answer('Vocês atendem onde?');
 assert.match(x,/Jequié, Bahia/);
 assert.match(x,/remotamente/);
});
test('preços somente de mensalidade planejada do LibertyOS e BarbarOS',()=>{
 for(const product of ['LibertyOS','BarbarOS']){
   const x=answer('Qual a mensalidade do '+product+'?');
   assert.match(x,/R\$ 129,00/);
   assert.match(x,/em desenvolvimento/);
   assert.match(x,/sujeita à confirmação/);
   assert.doesNotMatch(x,/ativado|entregue imediatamente|pague agora/);
 }
});
test('não inventa tabela para sites ou serviços personalizados',()=>{
 for(const q of ['Quanto custa um site?', 'Qual é o valor do desenvolvimento personalizado?', 'Qual o preço de uma automação?']){
   const x=answer(q);
   assert.match(x,/não têm preço fixo/);
   assert.doesNotMatch(x,/R\$ ?\d/);
 }
});
test('não promete produto ainda não homologado',()=>{
 const x=answer('BarbarOS já está pronto para contratar?');
 assert.match(x,/em desenvolvimento/);
 assert.doesNotMatch(x,/acesso liberado/);
});
test('não confunde segmento com a necessidade de automação de e-mail',()=>{
 const l=lead('Quero automatizar e-mails, classificação e criação de tarefas','Beleza / Estética');
 assert.equal(advisor.subject('',l),'email');
 assert.match(advisor.questionFor('current',l),/Quais e-mails/);
 const quick=advisor.quickOptions('current',l);
 assert.deepEqual(quick.options.map(x=>x.label),['Agendamentos','Orçamentos','Fornecedores','Outros']);
 assert.ok(!quick.options.some(x=>/rede|equipamentos|planilha/i.test(x.label)));
});
test('perguntas relevantes por assunto sem questionário longo obrigatório',()=>{
 assert.match(advisor.questionFor('current',lead('Quero agendamento online em minha barbearia')),/agendamentos/);
 assert.match(advisor.questionFor('current',lead('Preciso que meu site tenha integração de pagamento')),/objetivo do site/);
 assert.match(advisor.questionFor('current',lead('Tenho problema no firewall e Wi-Fi')),/pessoas são afetados/);
});
test('comunicação sobre contato respeita recusa',()=>{
 assert.equal(advisor.isContactDecline('Prefiro não informar'),true);
 assert.equal(advisor.isContactDecline('Não quero passar contato'),true);
 assert.equal(advisor.isContactDecline('Meu nome é João'),false);
 assert.match(advisor.questionFor('contact',lead('')), /Se preferir/);
});
test('responde perguntas sobre WhatsApp e prazos sem fingir integrações',()=>{
 assert.match(answer('Vocês conectam ao WhatsApp por API?'),/não vou afirmar que a integração está ativa/);
 assert.match(answer('Qual prazo de entrega?'),/depende do escopo/);
});
test('permite atendimento humano e orçamento sem compromisso',()=>{
 assert.match(answer('Posso falar com um consultor?'),/atendimento humano/);
 assert.match(answer('Quero um orçamento de sistema sob medida'),/sem compromisso/);
});
test('código publicado usa conhecimento, reduz campos e mantém persistência existente',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 assert.ok(html.indexOf('assets/oca-advisor.js')<html.indexOf('app.js?v='));
 assert.match(app,/LacroseOcaAdvisor/);
 assert.match(app,/return \['problem','segment','current','contact'\];/);
 assert.match(app,/ADVISOR\?\.reply\(text,state\.lead\)/);
 assert.match(app,/schedulePersist\(\)/);
 assert.doesNotMatch(html+app,/Sites simples a partir de R\$ 350/);
});

test('conserva contexto quando pergunta preço dos dois sistemas',()=>{
 const first=advisor.answerTurn('Qual é a mensalidade do LibertyOS?',lead(''),null);
 assert.match(first.text,/R\$ 129,00/);
 const second=advisor.answerTurn('E o BarbarOS?',lead(''),first.context);
 assert.match(second.text,/R\$ 129,00/);
 assert.match(second.text,/BarbarOS/);
 const third=advisor.answerTurn('Já está pronto?',lead(''),second.context);
 assert.match(third.text,/em desenvolvimento/);
});
test('não reaproveita preço após mudar de assunto',()=>{
 const first=advisor.answerTurn('Quanto custa o LibertyOS?',lead(''),null);
 const other=advisor.answerTurn('Onde vocês atendem?',lead(''),first.context);
 assert.match(other.text,/Jequié/);
 assert.equal(other.context,null);
});
