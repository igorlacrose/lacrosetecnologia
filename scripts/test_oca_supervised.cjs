'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const knowledge=require('../assets/oca-knowledge.js');
const js=read('app.js');
const html=read('index.html');
const edge=read('supabase/functions/oca-interpret/index.ts');
const sql=read('supabase/sql/oca_ai_monthly_budget.sql');

test('catálogo supervisionado tem entradas versionadas e aprovadas',()=>{
  assert.ok(knowledge.entries.length>=8);
  assert.ok(knowledge.entries.every(item=>item.status==='approved'));
  assert.equal(new Set(knowledge.ids).size,knowledge.ids.length);
  for(const item of knowledge.entries){
    assert.ok(item.answer.length>30);
    assert.ok(item.questions.length>=2);
    assert.equal(knowledge.entry(item.id)?.answer,item.answer);
  }
  assert.equal(knowledge.entry('unknown'),null);
  assert.equal(knowledge.entry('admin'),null);
});

test('perguntas reais conhecidas são respondidas localmente',()=>{
  const cases=[
    ['Quais são as atividades da Lacrose?','company_services'],
    ['A Lacrose atende fora da Bahia?','coverage'],
    ['Vocês têm projetos no portfólio?','portfolio'],
    ['Fazem automação de processos empresariais?','automation'],
    ['Vocês prestam consultoria em firewall e redes?','security'],
    ['Como funciona um orçamento de site?','custom_quote'],
    ['Qual é o prazo para entregar um sistema?','delivery'],
    ['O BarbarOS já pode ser contratado?','product_status'],
    ['Posso falar com uma pessoa da Lacrose?','human']
  ];
  for(const [question,id] of cases){
    assert.equal(knowledge.match(question)?.id,id,question);
  }
});

test('pedido de projeto e consulta desconhecida não são inventados',()=>{
  for(const question of [
    'Preciso de um site para minha clínica e integração com prontuário',
    'Quero fazer um sistema para meu restaurante',
    'Meu sistema está caindo em vários servidores',
    'A Lacrose fabrica satélites espaciais?',
    '123'
  ])assert.equal(knowledge.match(question),null,question);
  assert.equal(knowledge.isSpecificRequest('Preciso de sistema para minha clínica'),true);
});

test('aplicação preserva FAQ anterior e só envia para IA perguntas elegíveis',()=>{
  assert.match(js,/const directAnswer=ADVISOR\?\.answerTurn\(text,state\.lead,state\.faqContext\)/);
  assert.match(js,/const approvedMatch=OCA_KNOWLEDGE\?\.match\(text\)/);
  assert.match(js,/if\(mayAskOcaAi\(text,meta,wasCompleted\)\)/);
  assert.match(js,/if\(!response\.ok\)return null/);
  assert.match(js,/if\(epoch!==ocaInterpretEpoch\)return/);
  assert.match(js,/ocaInterpretAbort\?\.abort\(\)/);
  assert.ok(js.indexOf('if(mayAskOcaAi(')<js.indexOf('setAwaited(',js.indexOf('async function submitText(')));
  assert.doesNotMatch(js,/OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
});

test('scripts carregados na ordem correta sem alterar o diagnóstico',()=>{
  const paths=['assets/oca-intents.js','assets/oca-advisor.js','assets/oca-knowledge.js','app.js?v='];
  const offsets=paths.map(p=>html.indexOf(p));
  assert.ok(offsets.every(p=>p>=0));
  assert.ok(offsets.every((p,i)=>i===0||p>offsets[i-1]));
});

test('contrato do classificador remoto coincide com o catálogo aprovado',()=>{
  const list=edge.match(/const IDS=\[([\s\S]*?)\] as const;/);
  assert.ok(list,'Lista de IDs não encontrada no backend');
  const ids=[...list[1].matchAll(/"([a-z_]+)"/g)].map(m=>m[1]);
  assert.deepEqual(ids,[...knowledge.ids,'unknown']);
  assert.match(edge,/model:MODEL/);
  assert.match(edge,/const MODEL="gpt-5\.6-luna"/);
  assert.match(edge,/reasoning:\{effort:"none"\}/);
  assert.match(edge,/max_output_tokens:120/);
  assert.match(edge,/store:false/);
  assert.match(edge,/strict:true/);
  assert.match(edge,/if\(containsSensitiveData\(question\)\)/);
  assert.match(edge,/return json\(origin,200,\{ok:true,id,source:"model_classifier"\}\)/);
  assert.doesNotMatch(edge,/return json\(origin,200,\{ok:true,(?:answer|reply):/);
});

test('segredos permanecem no backend e IA exige configuração explícita',()=>{
  for(const secret of ['OPENAI_API_KEY','SUPABASE_SERVICE_ROLE_KEY','OCA_RATE_SECRET',
    'OCA_AI_ENABLED','OCA_AI_MONTHLY_BUDGET_MICRO_USD'])
    assert.ok(edge.includes('Deno.env.get("'+secret+'")'),secret);
  const reserve=edge.indexOf('sb.rpc("oca_ai_reserve_monthly"');
  const paidFetch=edge.indexOf('fetch("https://api.openai.com/v1/responses"');
  assert.ok(reserve>0&&paidFetch>reserve,'A reserva deve ocorrer antes da cobrança');
  assert.match(edge,/budget>2_000_000/);
  assert.match(edge,/reserved!==true/);
  assert.match(edge,/check_agent_rate_limit/);
});

test('banco reserva mensalmente de forma atômica, com RLS e sem log de mensagens',()=>{
  assert.match(sql,/CREATE TABLE IF NOT EXISTS lkz_adm_private\.oca_ai_monthly_usage/);
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/ON CONFLICT \(tenant_slug,month_utc\) DO UPDATE/);
  assert.match(sql,/p_limit_micro_usd-EXCLUDED\.reserved_micro_usd/);
  assert.match(sql,/p_limit_micro_usd > 2000000/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.oca_ai_reserve_monthly[\s\S]*?TO service_role/);
  assert.doesNotMatch(sql,/GRANT EXECUTE ON FUNCTION public\.oca_ai_reserve_monthly[\s\S]*?TO (?:anon|authenticated)/);
  assert.doesNotMatch(sql,/message_text|prompt_content|raw_question|client_email|phone_number/i);
});
