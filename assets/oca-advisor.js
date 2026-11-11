/* Lacrose OCA Advisor — base de conhecimento e interpretação contextual, sem API paga.
 * Não executa pagamentos, cadastros, propostas ou decisões de autorização.
 * Atualizar preços e status apenas depois de aprovação comercial.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.LacroseOcaAdvisor=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';

  const RELEASE_MONTHLY_BRL=129;
  const PRODUCTS={
    libertyos:{name:'LibertyOS',vertical:'salões de beleza e clínicas de estética'},
    barbaros:{name:'BarbarOS',vertical:'barbearias'}
  };
  function norm(value){
    return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().replace(/\s+/g,' ').trim();
  }
  const has=(s,re)=>re.test(norm(s));
  function productNames(text){
    const t=norm(text),names=[];
    if(/\bliberty[\s-]?os\b/.test(t))names.push('libertyos');
    if(/\bbarbar[\s-]?os\b/.test(t))names.push('barbaros');
    return names;
  }
  function isContactDecline(text){
    return has(text,/^(?:prefiro nao|nao quero|nao vou|sem contato|nao desejo|dispenso)(?:\s+(?:informar|passar|fornecer|compartilhar))?(?:\s+(?:meu|minha|meus|contato|dados|telefone|email|whatsapp|numero))*[.!]?\s*$/);
  }
  function subject(text,lead={}){
    // O pedido inicial é mais relevante que o segmento. Não interpretar uma
    // clínica de estética como pedido de prontuário quando ela pede e-mails.
    const t=norm([lead.problem||'',text||''].join(' '));
    if(/\b(email|e-mail|emails|e-mails|caixa de entrada|correio eletronico|outlook|gmail)\b/.test(t))
      return 'email';
    if(/\b(agenda|agendamento|marcar horario|marcacao de horario|reservas|horarios|barbeiro|sal[aã]o)\b/.test(t))
      return 'agenda';
    if(/\b(estoque|produtos|inventario|almoxarifado|lote)\b/.test(t))
      return 'estoque';
    if(/\b(crm|leads|clientes|funil|atendimento pelo whatsapp)\b/.test(t))
      return 'crm';
    if(/\b(site|landing page|pagina institucional|pagina web|website)\b/.test(t))
      return 'site';
    if(/\b(wifi|wi-fi|rede|servidor|firewall|mikrotik|backup|vpn|internet caindo|infraestrutura)\b/.test(t))
      return 'infra';
    if(/\b(automac|automat|repetitiv|integrac|integra|processo|tarefa|relatorio|documentos)\b/.test(t))
      return 'automacao';
    if(/\b(sistema|software|app|aplicativo|erp|pdv|plataforma)\b/.test(t))
      return 'sistema';
    return 'geral';
  }
  const diagnosticQuestions={
    email:'Quais e-mails você quer organizar primeiro: agendamentos, solicitações de orçamento, fornecedores ou outro tipo?',
    agenda:'Como os agendamentos são feitos hoje e o que você quer facilitar para a equipe ou os clientes?',
    estoque:'Como você controla o estoque hoje e qual é a principal dificuldade?',
    crm:'Por quais canais chegam os clientes hoje e o que gostaria de automatizar nesse atendimento?',
    site:'Qual é o principal objetivo do site e o que precisa integrar, se houver alguma integração?',
    infra:'O que acontece quando o problema aparece e quais serviços ou pessoas são afetados?',
    automacao:'Qual tarefa deve disparar a automação e qual resultado você espera que ela gere?',
    sistema:'Qual é a atividade principal que você quer controlar no sistema?',
    geral:'Como você resolve isso hoje e o que gostaria que fosse diferente?'
  };
  function questionFor(field,lead={}){
    if(field==='problem')return 'O que você gostaria de resolver ou melhorar? Pode explicar do seu jeito.';
    if(field==='segment')return 'Para contextualizar a solução: qual é o ramo de atividade da sua empresa?';
    if(field==='current')return diagnosticQuestions[subject('',lead)];
    if(field==='contact')return 'Posso organizar seu pedido para uma avaliação humana. Se quiser receber retorno, informe seu nome e WhatsApp ou e-mail. Se preferir, diga “não quero informar”.';
    return null;
  }
  function quickOptions(field,lead={}){
    if(field!=='current')return null;
    const options={
      email:[
        ['Agendamentos','E-mails de agendamento e solicitações de clientes'],
        ['Orçamentos','E-mails com pedidos de orçamento e propostas'],
        ['Fornecedores','E-mails de fornecedores e documentos'],
        ['Outros','Outros tipos de e-mail']
      ],
      agenda:[
        ['WhatsApp','Atualmente agendamos pelo WhatsApp'],
        ['Papel ou planilha','Atualmente usamos papel ou planilha'],
        ['Sistema atual','Já usamos um sistema de agenda'],
        ['Ainda não sei','Quero entender as possibilidades']
      ],
      crm:[
        ['WhatsApp','Os clientes chegam pelo WhatsApp'],
        ['Site','Os clientes chegam pelo site'],
        ['Redes sociais','Os clientes chegam pelas redes sociais'],
        ['Diversos canais','Os clientes chegam por vários canais']
      ],
      site:[
        ['Institucional','Apresentar empresa e serviços'],
        ['Captação','Receber contatos e pedidos de orçamento'],
        ['Área do cliente','Ter login ou área reservada'],
        ['Integrações','Integrar sistemas ou ferramentas']
      ]
    };
    const list=options[subject('',lead)];
    return list?{mode:'multi',hint:'Marque o que se aplica ou explique com suas palavras.',options:list.map(([label,value])=>({label,value}))}:null;
  }
  function reply(text,lead={}){
    const t=norm(text),products=productNames(text),price=
      /\b(quanto custa|quanto fica|preco|valor|mensalidade|mensal|assinatura|planos?|quanto cobram|quanto pag)/.test(t);
    const asksStatus=/\b(esta pronto|ja funciona|disponivel|posso contratar|posso assinar|ja vende|ja saiu|liberado|ja posso usar)\b/.test(t);
    if(products.length && price){
      const names=products.map(p=>PRODUCTS[p].name).join(' e ');
      return 'A mensalidade de lançamento planejada para '+names+' é de R$ '+RELEASE_MONTHLY_BRL+',00 por estabelecimento. Os sistemas ainda estão em desenvolvimento; esse valor é uma referência comercial sujeita à confirmação antes da contratação. Não há ativação ou cobrança automática disponível neste momento.';
    }
    if(products.length && asksStatus){
      return products.map(p=>PRODUCTS[p].name).join(' e ')+' ainda '+(products.length>1?'estão':'está')+' em desenvolvimento. Podemos registrar o que você precisa e avisar sobre uma futura disponibilidade, mas não vou prometer entrega, acesso ou prazo que ainda não foram validados.';
    }
    if(products.length && (t.length<65||/\b(o que e|para que serve|me fale|me explica|como funciona)\b/.test(t))){
      return products.map(p=>PRODUCTS[p].name+' é uma solução em desenvolvimento para '+PRODUCTS[p].vertical).join('. ')+'. Podemos conversar sobre seu fluxo de atendimento e gestão; funcionalidades específicas serão confirmadas conforme forem homologadas.';
    }
    if(price){
      if(/\b(site|website|pagina|landing page|sistema sob medida|projeto personalizado|desenvolvimento|automacao)\b/.test(t) || /^(quanto custa|preco|valores?|orcamento)/.test(t)){
        return 'Sites, automações e sistemas personalizados não têm preço fixo. A Lacrose Tecnologia conversa com você, entende os requisitos, define o escopo e apresenta um orçamento para sua avaliação e aprovação. Não há compromisso de contratação.';
      }
      return 'Para projetos personalizados, a proposta depende do escopo e das integrações. No caso do LibertyOS e BarbarOS, posso informar a mensalidade de lançamento planejada se você perguntar por um deles.';
    }
    if(/\b(falar com humano|falar com pessoa|falar com atendente|falar com consultor|falar com o responsavel|quero atendimento humano|falar com voce|falar com igor)\b/.test(t)){
      return 'Claro. Podemos encaminhar sua solicitação para atendimento humano. Descreva brevemente o que precisa e, se quiser retorno, informe seu nome e um WhatsApp ou e-mail. Não é necessário compartilhar senhas nem dados sensíveis.';
    }
    if(/\b(quais servicos|o que voces fazem|o que a lacrose faz|em que trabalham|que tipo de servico|como podem me ajudar|o que voces oferecem|areas de atuacao)\b/.test(t)){
      return 'A Lacrose Tecnologia trabalha com desenvolvimento de sites e sistemas, automação empresarial com IA, infraestrutura de redes e segurança de TI. Também avaliamos integrações e melhorias em processos ou sistemas existentes. Qual dessas necessidades você quer explorar?';
    }
    if(/\b(atendem onde|onde fica|qual cidade|atende em|atendimento presencial|atendem fora|atendem no brasil|atuam onde)\b/.test(t)){
      return 'Atendemos projetos remotamente em todo o Brasil e, conforme disponibilidade, presencialmente em Jequié, Bahia. A forma de atendimento depende do serviço e do escopo.';
    }
    if(/\b(voces fazem site|fazem sites|criam sites|desenvolvem site|site institucional|loja virtual)\b/.test(t) && /\?|^voces|^fazem|^criam|^desenvolvem/.test(t)){
      return 'Sim, desenvolvemos sites e soluções web conforme a necessidade da empresa. O valor depende de páginas, conteúdo, integrações, funcionalidades e manutenção. Podemos entender seu objetivo e preparar um orçamento personalizado.';
    }
    if(/\b(voces fazem automacao|conseguem automatizar|da pra automatizar|fazem automacoes|automatizam)\b/.test(t) && /\?|^voces|^conseguem|^da pra/.test(t)){
      return 'Podemos estudar automações como e-mails que viram tarefas, qualificação de leads, extração de dados de documentos e acompanhamento comercial. Primeiro mapeamos gatilhos, dados, permissões e exceções; a execução depende das integrações disponíveis.';
    }
    if(/\b(whatsapp|wpp|zap)\b/.test(t) && /\b(integr|conect|api|bot|automat|mensagem automatica|mensagens automaticas)\b/.test(t) && (/\?/.test(t)||/^(voces|da pra|pode|consigo|tem)/.test(t))){
      return 'Integrações com WhatsApp podem ser avaliadas usando os canais e APIs oficialmente permitidos. A disponibilidade e eventuais cobranças do provedor dependem da conta do cliente; não vou afirmar que a integração está ativa sem validar a configuração.';
    }
    if(/\b(o que e oca|como funciona o oca|operador comercial autonomo|oca faz o que)\b/.test(t)){
      return 'O OCA é o projeto de operador comercial autônomo da Lacrose Tecnologia. A meta é atender, qualificar, organizar propostas e, somente para produtos homologados, automatizar cobrança e liberação após confirmação segura de pagamento. Essas etapas ainda estão em desenvolvimento; o atendimento atual coleta informações para análise.';
    }
    if(/\b(quanto tempo|prazo de entrega|demora quanto|quando fica pronto)\b/.test(t) && /\?|^qual|^quanto|^quando/.test(t)){
      return 'O prazo depende do escopo, das integrações e da disponibilidade técnica. Só conseguimos confirmar uma estimativa após avaliar os requisitos.';
    }
    if(/\b(orcamento|cotacao|proposta comercial|fazer proposta)\b/.test(t) && /\?|^quero|^preciso|^como|^pode|^gostaria/.test(t)){
      return 'Podemos organizar um orçamento sem compromisso. Conte o objetivo, o que precisa funcionar e quais integrações são importantes; a proposta final será montada e aprovada por uma pessoa da Lacrose.';
    }
    if(/\b(garantia de seguranca|seguranca dos dados|lgpd|protegem meus dados|acesso aos dados)\b/.test(t)){
      return 'Em projetos que envolvem dados, avaliamos autenticação, permissões, proteção das integrações, backup e privacidade conforme o contexto e a LGPD. Não posso garantir segurança absoluta sem uma avaliação técnica do ambiente.';
    }
    if(/\b(portfolio|trabalhos feitos|clientes atendidos|exemplos de projetos)\b/.test(t)){
      return 'Entre os trabalhos da Lacrose Tecnologia estão projetos para a CESMT, Studio Liberty e Bahia Nexos. Para um orçamento, avaliamos cada necessidade separadamente; não presumo que um projeto tenha as mesmas funções de outro.';
    }
    return null;
  }
  return {norm,subject,questionFor,quickOptions,reply,productNames,isContactDecline,RELEASE_MONTHLY_BRL};
});
