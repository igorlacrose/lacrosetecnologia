'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const matcher=require('../assets/oca-intents.js');
const advisor=require('../assets/oca-advisor.js');

test('perguntas sobre a Lacrose por assunto, abreviação e erros comuns',()=>{
  const variants=[
    'Quais os serviços a Lacrose oferece?',
    'q servissos vcs oferece?',
    'oq vcs faizm',
    'Quais atividades da Lacrose?',
    'quero conhece as atividades de vcs',
    'Que serviços vocês prestam?',
    'que solucoes vcs oferese?',
    'Me fala da Lacrose',
    'Quero conhecer a empresa Lacrose',
    'Quais os servicos dessa empresa Lacrose?'
  ];
  for(const input of variants){
    const route=matcher.classify(input);
    assert.equal(route.intent,'company_services',input);
    const answer=advisor.answerTurn(input,{},null);
    assert.ok(answer,input);
    assert.match(answer.text,/sites e sistemas/i,input);
    assert.match(answer.text,/automação empresarial com IA/i,input);
  }
});
test('pedido do visitante não vira explicação dos serviços',()=>{
  const requests=[
    'Preciso de um site que apresente meus serviços',
    'Quero um sistema que organize os serviços da empresa',
    'quero sistema pra minha loja',
    'qro automatiza e-mail da clinica',
    'preciso de software para vender meus serviços',
    'quero um site para contar as atividades da minha clinica'
  ];
  for(const input of requests){
    const route=matcher.classify(input);
    assert.equal(route.intent,'project_request',input);
    assert.equal(advisor.reply(input,{}),null,input);
  }
});
test('custo de produto e nome com erro levam apenas ao preço aprovado',()=>{
  const samples=[
    ['qto custa libertios?','LibertyOS'],
    ['preço barberos','BarbarOS'],
    ['qual mensalidade liberty os?','LibertyOS'],
    ['quanto ta o barbaros','BarbarOS']
  ];
  for(const [input,product] of samples){
    const route=matcher.classify(input);
    assert.equal(route.intent,'product_price',input);
    const answer=advisor.answerTurn(input,{},null);
    assert.match(answer.text,/R\$ 129,00/);
    assert.ok(answer.text.includes(product),input);
    assert.match(answer.text,/desenvolvimento/);
  }
  const custom=advisor.reply('qto sai fazer um site?',{});
  assert.ok(custom);
  assert.doesNotMatch(custom,/R\$ ?\d/);
});
test('classificação de assunto usa objetivo antes do segmento',()=>{
  assert.equal(advisor.subject('',{problem:'Qro automatiza emaills e cria tarefa',segment:'Beleza / Estética'}),'email');
  assert.equal(advisor.subject('',{problem:'preciso agendar horarios na barbearia',segment:'Beleza / Estética'}),'agenda');
  assert.equal(advisor.subject('',{problem:'problemas com firewal e backup'}),'infra');
  assert.equal(advisor.subject('',{problem:'quero integrar tarefas com relatorios'}),'automacao');
  assert.equal(advisor.questionFor('current',{problem:'Preciso automatizar emals da clínica'}).startsWith('Quais e-mails'),true);
});
test('não confunde assunto de serviços com infraestrutura',()=>{
  assert.equal(matcher.topic('Quais os serviços a Lacrose oferece?'),'geral');
  assert.equal(matcher.topic('Quais os servicos prestados pela empresa?'),'geral');
  assert.equal(matcher.topic('Problema com servidor na rede'),'infra');
});
test('localização e horário não são o mesmo assunto',()=>{
  assert.equal(matcher.classify('vcs atendem na Bahia?').intent,'company_location');
  assert.notEqual(matcher.classify('qual horario vcs atendem?').intent,'company_location');
});
test('aproximação de palavras deve ter limites para evitar falsos positivos',()=>{
  assert.equal(matcher.approx('servicos','servidor'),false);
  assert.equal(matcher.approx('servissos','servicos'),true);
  assert.equal(matcher.approx('libertios','libertyos'),true);
  assert.deepEqual(matcher.productNames('quero um barbeiro'),[]);
});
test('pedidos de atendimento humano e fallback seguro',()=>{
  assert.match(advisor.reply('posso fala com uma pessoa?',{}),/humano/i);
  const uncertain=advisor.reply('A Lacrose vende drones espaciais?',{});
  assert.ok(uncertain);
  assert.doesNotMatch(uncertain,/\b(sim|vendemos drones)\b/i);
});
test('sem preço externo, segurança e sem catálogo inventado',()=>{
  const unknown=advisor.reply('qto sai fazer um site?',{});
  assert.doesNotMatch(unknown,/R\$\s*\d+/);
  const source=fs.readFileSync(path.join(__dirname,'../assets/oca-intents.js'),'utf8');
  assert.doesNotMatch(source,/(?:fetch\(|XMLHttpRequest|localStorage|service_role|apikey\s*=)/i);
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  assert.ok(html.indexOf('assets/oca-intents.js')>=0);
  assert.ok(html.indexOf('assets/oca-intents.js')<html.indexOf('assets/oca-advisor.js'));
  assert.ok(html.indexOf('assets/oca-advisor.js')<html.indexOf('app.js?v='));
});

test('perguntas de suporte específico não recebem catálogo genérico',()=>{
 const q='Vocês oferecem manutenção e suporte?';
 assert.notEqual(matcher.classify(q).intent,'company_services');
 assert.match(advisor.reply(q,{}),/definidos no contrato/);
});
test('prazo não vira preço mesmo com quanto abreviado',()=>{
 for(const q of ['Quanto tempo leva para fazer um site?','qto tempo pra criar um site?']){
   assert.equal(matcher.classify(q).intent,'duration_question');
   assert.match(advisor.reply(q,{}),/prazo depende do escopo/);
   assert.doesNotMatch(advisor.reply(q,{}),/R\$\s*\d+/);
 }
});
test('preço por pergunta abreviada mantém o assunto na mensagem seguinte',()=>{
 const first=advisor.answerTurn('qto custa libertios?',{},null);
 assert.equal(first.context.kind,'product_price');
 const second=advisor.answerTurn('E o BarbarOS?',{},first.context);
 assert.match(second.text,/R\$ 129,00/);
 assert.match(second.text,/BarbarOS/);
});
