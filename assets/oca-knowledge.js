/* OCA Knowledge v1 — SOMENTE respostas aprovadas e versionadas.
 * Aprendizado supervisionado = revisão humana + testes + PR.
 * Jamais adicionar automaticamente conteúdo de visitantes ou saídas do modelo.
 * Nenhuma chave, token ou decisão operacional é armazenada neste módulo.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.LacroseOcaKnowledge=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';

  const ENTRIES=Object.freeze([
    {
      id:'company_services',status:'approved',
      questions:['Quais serviços a Lacrose oferece?','O que a Lacrose Tecnologia faz?',
        'Quais são as atividades da Lacrose?','Que serviços vocês prestam?'],
      answer:'A Lacrose Tecnologia atua no desenvolvimento de sites, sistemas e aplicativos, automação empresarial com IA e serviços de redes, infraestrutura e segurança de TI. Conte seu objetivo para avaliarmos a solução adequada.'
    },
    {
      id:'coverage',status:'approved',
      questions:['Vocês atendem em todo o Brasil?','A Lacrose atende fora da Bahia?',
        'Vocês atendem remotamente?','Onde a Lacrose atende?'],
      answer:'A Lacrose Tecnologia presta serviços remotamente em todo o Brasil e atende presencialmente em Jequié, Bahia, conforme a natureza e a disponibilidade do serviço.'
    },
    {
      id:'portfolio',status:'approved',
      questions:['Quais clientes a Lacrose já atendeu?','Vocês têm projetos no portfólio?',
        'Podem citar exemplos de trabalhos realizados?'],
      answer:'Entre os projetos da Lacrose Tecnologia estão trabalhos para a CESMT, Studio Liberty e Bahia Nexos. Podemos conversar sobre um projeto semelhante, sem presumir que tenham exatamente as mesmas funções.'
    },
    {
      id:'automation',status:'approved',
      questions:['Vocês trabalham com automação usando IA?',
        'A Lacrose oferece automação empresarial com inteligência artificial?',
        'Fazem automação de processos empresariais?'],
      answer:'A Lacrose Tecnologia desenvolve soluções de automação empresarial com IA, como qualificação de contatos, organização de tarefas e integração de processos, conforme a viabilidade técnica. Recursos e preços dependem do escopo e da aprovação comercial.'
    },
    {
      id:'security',status:'approved',
      questions:['Vocês trabalham com redes e segurança de TI?',
        'A Lacrose oferece serviços de infraestrutura de redes?',
        'Vocês prestam consultoria em firewall e redes?'],
      answer:'Sim. A Lacrose Tecnologia atua com consultoria e soluções de redes, infraestrutura e segurança de TI. A recomendação depende do ambiente, dos riscos e dos requisitos encontrados no diagnóstico.'
    },
    {
      id:'custom_quote',status:'approved',
      questions:['Quanto custa criar um site institucional?',
        'Como funciona um orçamento de site?',
        'Qual o preço para desenvolver um sistema sob medida?'],
      answer:'O orçamento de sites e sistemas é personalizado conforme páginas, funcionalidades, integrações, manutenção e requisitos de segurança. Podemos levantar seu escopo e encaminhar uma proposta para avaliação humana; não há preço fixo confirmado para esse pedido.'
    },
    {
      id:'delivery',status:'approved',
      questions:['Quanto tempo demora para criar um site?',
        'Qual é o prazo para entregar um sistema?',
        'Quanto tempo leva um projeto de automação?'],
      answer:'O prazo de entrega depende do escopo, das integrações e da disponibilidade técnica. Só podemos estimá-lo após avaliar os requisitos do projeto.'
    },
    {
      id:'product_status',status:'approved',
      questions:['O LibertyOS já está disponível?','O BarbarOS já pode ser contratado?',
        'LibertyOS e BarbarOS estão prontos?'],
      answer:'LibertyOS e BarbarOS ainda estão em desenvolvimento. Não há contratação ou ativação automática disponível neste momento.'
    },
    {
      id:'human',status:'approved',
      questions:['Posso falar com uma pessoa da Lacrose?',
        'Quero conversar com um consultor humano',
        'Como posso falar com a equipe comercial?'],
      answer:'Claro. Posso organizar sua necessidade para análise comercial pela equipe da Lacrose Tecnologia. Se quiser retorno, compartilhe voluntariamente um contato; não solicitamos senhas ou dados sensíveis.'
    }
  ]);

  const IDS=Object.freeze(ENTRIES.map(entry=>entry.id));
  const STOP=new Set('a o as os um uma de da do das dos que qual quais por para com em na no e é vc vocês voce voces sua seu seus suas me sobre pela pelo faz fazem atende atendem'.split(' '));
  const normalize=value=>String(value??'').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/\b(vcs|vc)\b/g,'voces').replace(/\b(qto|qt)\b/g,'quanto')
    .replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
  const tokens=value=>[...new Set(normalize(value).split(' ').filter(word=>word.length>2&&!STOP.has(word)))];
  function isSpecificRequest(value){
    const t=normalize(value);
    return /^(?:eu |a gente )?(?:preciso|quero|busco|necessito|gostaria|queria) (?:de |um |uma |que )?/.test(t)
      && !/^(?:eu )?(?:quero|gostaria|queria) (?:saber|conhecer|entender|informacoes|perguntar|falar com)/.test(t);
  }
  function entry(id){
    const result=ENTRIES.find(e=>e.id===id && e.status==='approved');
    return result?{id:result.id,answer:result.answer}:null;
  }
  function match(text){
    const raw=normalize(text);
    if(raw.length<10||raw.length>350||isSpecificRequest(text))return null;
    const bag=tokens(raw);
    let top=null,topScore=0,runnerUp=0;
    for(const item of ENTRIES){
      if(item.status!=='approved')continue;
      for(const example of item.questions){
        const normalized=normalize(example);
        if(raw===normalized)return {id:item.id,answer:item.answer,mode:'exact'};
        const sample=tokens(normalized);
        const overlap=bag.filter(t=>sample.includes(t)).length;
        const union=new Set([...bag,...sample]).size;
        const score=union?overlap/union:0;
        if(score>topScore){runnerUp=topScore;topScore=score;top=item;}
        else if(score>runnerUp)runnerUp=score;
      }
    }
    // Quase idêntico: nunca tentar inferir semântica por baixa similaridade.
    if(top && bag.length>=3 && topScore>=0.90 && topScore-runnerUp>=0.10)
      return {id:top.id,answer:top.answer,mode:'near-exact'};
    return null;
  }
  return Object.freeze({entries:ENTRIES,ids:IDS,normalize,match,entry,isSpecificRequest});
});
