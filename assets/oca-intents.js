/* OCA - interpretação de assuntos com tolerância a variações de escrita.
 * Sem serviços externos. NÃO é um LLM: em caso de dúvida, pedir esclarecimento.
 * Não decide preço, autorização, cobrança ou provisionamento.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.LacroseOcaIntent=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const normalize=value=>String(value??'').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/\b(vcs|vcs\.|vc|c6s)\b/g,'voces')
    .replace(/\b(q|oq|qdo)\b/g,(_,a)=>a==='qdo'?'quando':'que')
    .replace(/\b(qto|qt)\b/g,'quanto')
    .replace(/\b(qro|qria|kero)\b/g,'quero')
    .replace(/\b(pra|pro)\b/g,'para')
    .replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const tokenize=text=>normalize(text).split(' ').filter(Boolean).slice(0,100);
  function distance(a,b,limit=2){
    if(Math.abs(a.length-b.length)>limit)return limit+1;
    if(a===b)return 0;
    let previous=Array.from({length:b.length+1},(_,i)=>i);
    for(let i=1;i<=a.length;i++){
      const current=[i];let min=current[0];
      for(let j=1;j<=b.length;j++){
        const penalty=a[i-1]===b[j-1]?0:1;
        current[j]=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+penalty);
        if(current[j]<min)min=current[j];
      }
      if(min>limit)return limit+1;
      previous=current;
    }
    return previous[b.length];
  }
  function approx(a,b){
    if(a===b)return true;
    const larger=Math.max(a.length,b.length),smaller=Math.min(a.length,b.length);
    if(larger<5||smaller<4)return false;
    const tolerance=larger>=8?2:1;
    // Duas correções só com tamanho próximo e prefixo coerente.
    // Ex.: "serviços" NÃO deve se parecer com "servidores".
    if(Math.abs(a.length-b.length)>1 || (tolerance===2 && a.slice(0,4)!==b.slice(0,4)))return false;
    // Duas trocas sem final parecido confundiam "serviços" e "servidor".
    if(tolerance===2 && a[a.length-1]!==b[b.length-1])return false;
    return distance(a,b,tolerance)<=tolerance;
  }
  // Cada assunto usa famílias de palavras e sinônimos, nunca uma frase única.
  const GROUPS={
    company:['lacrose','voces','voce'],
    services:['servico','servicos','atividade','atividades','trabalho','trabalham','trabalha','fazem','faz','oferecem','oferece','prestam','prestam','solucao','solucoes','atuacao','atuam','atua','fazm'],
    inquiry:['qual','quais','que','como','oque','saber','conhecer','conheco','explica','explicar','explique','fale','falar','fala','conta','conte','lista','listar','apresenta','mostra','mostre','informar'],
    request:['preciso','quero','busco','necessito','gostaria','desejo','procurando','queria'],
    project:['site','sites','sistema','sistemas','aplicativo','aplicativos','automacao','automatizar','automatiza','automatizando','integrar','integracao','crm','plataforma','programa','software'],
    human:['humano','humana','pessoa','atendente','consultor','consultora','responsavel','igor'],
    price:['preco','precos','valor','valores','custa','custo','quanto','mensalidade','mensal','assinatura','investimento'],
    availability:['pronto','pronta','disponivel','disponibilidade','assinar','contratar','ativo','liberado','funcionando'],
    location:['onde','local','cidade','endereco','presencial','remoto'],
    email:['email','emails','gmail','outlook','inbox','mensagens','correio','eletronico'],
    appointment:['agenda','agendar','agendamento','agendamentos','horario','horarios','marcar','reservar','reserva'],
    inventory:['estoque','inventario','almoxarifado','reposicao','lotes'],
    crm:['crm','lead','leads','funil','captacao','clientes','atendimentos'],
    website:['site','sites','website','pagina','paginas','landing','institucional'],
    network:['wifi','wi','firewall','mikrotik','pfsense','servidor','servidores','rede','redes','internet','vpn','backup'],
    automation:['automatizar','automacao','automatico','automatica','fluxo','processo','processos','tarefa','tarefas','integracao','integrar','repetitivo'],
    software:['sistema','sistemas','software','aplicativo','aplicativos','erp','pdv','plataforma']
  };
  const catalog=Object.fromEntries(Object.entries(GROUPS).map(([k,words])=>[k,words.map(normalize)]));
  function has(tokens,group,strict=false){
    return tokens.some(token=>catalog[group].some(w=>{
      if(strict)return token===w || (Math.max(token.length,w.length)>=5 && distance(token,w,1)<=1);
      return approx(token,w);
    }));
  }
  function productNames(text){
    const t=tokenize(text);
    const variants=[];
    for(let i=0;i<t.length;i++){
      variants.push(t[i]);
      if(i+1<t.length)variants.push(t[i]+t[i+1]);
    }
    const found=[];
    if(variants.some(v=>approx(v,'libertyos')||approx(v,'libertios')))found.push('libertyos');
    if(variants.some(v=>approx(v,'barbaros')))found.push('barbaros');
    return found;
  }
  function topic(text,lead={}){
    // Somente buscar assunto anterior quando a mensagem atual não traz outro.
    const current=tokenize(text),previous=tokenize(lead.problem||'');
    function resolve(tokens){
      if(has(tokens,'email',true) && (has(tokens,'automation',true)||has(tokens,'inquiry')||has(tokens,'request')||tokens.length<=5))return 'email';
      if(has(tokens,'appointment',true))return 'agenda';
      if(has(tokens,'inventory',true))return 'estoque';
      if(has(tokens,'website',true))return 'site';
      if(has(tokens,'network',true))return 'infra';
      if(has(tokens,'crm',true))return 'crm';
      if(has(tokens,'automation',true))return 'automacao';
      if(has(tokens,'software',true))return 'sistema';
      return null;
    }
    return resolve(current)||resolve(previous)||'geral';
  }
  function classify(text){
    const t=normalize(text),tokens=tokenize(text);
    const company=has(tokens,'company'),service=has(tokens,'services'),
      question=has(tokens,'inquiry'),request=has(tokens,'request'),
      project=has(tokens,'project'),price=has(tokens,'price'),
      human=has(tokens,'human'),location=has(tokens,'location');
    const product=productNames(text);
    const qStart=/^(?:oi |ola |bom dia |boa tarde |boa noite )?(?:quais? |que |como |o que |me |onde |quanto |voces )/.test(t);
    const asking=question||qStart||text.trim().endsWith('?');
    const startsProject=/^(?:eu )?(?:quero|preciso|necessito|busco|queria|gostaria)(?: de| um| uma| que)?\b/.test(t)
      && project && !/\b(saber|conhecer|informacao|me fala|me explique)\b/.test(t);
    if(startsProject)return {intent:'project_request',confidence:0.95,products:product,topic:topic(text)};
    if(product.length && price)return {intent:'product_price',confidence:0.92,products:product};
    if(product.length && has(tokens,'availability') && asking)
      return {intent:'product_status',confidence:0.88,products:product};
    if(human && (asking||request||has(tokens,'inquiry')))
      return {intent:'human_handoff',confidence:0.88,products:product};
    const geographicallyLocated=location ||
      (/\b(atende|atendem)\b/.test(t) && /\b(na|no|em|brasil|bahia|jequie|fora|outros estados)\b/.test(t));
    if(company && geographicallyLocated && asking)return {intent:'company_location',confidence:0.84,products:product};
    const nouns=['servico','servicos','solucao','solucoes','atividade','atividades','trabalho','trabalhos','atuacao'];
    const hasServiceNoun=tokens.some(token=>nouns.some(w=>approx(token,w)));
    const serviceQuestionStart=/^(?:quais?|qual|que)\b.{0,45}\b(?:servicos?|solucoes?|atividades?|trabalhos?)\b/.test(t);
    const specificArea=has(tokens,'network',true)||has(tokens,'website',true)||
      has(tokens,'software',true)||/\b(suporte|manutencao|seguranca|horarios?|telefone|contato|pagamento)\b/.test(t);
    const broadWork=company && question && service && !specificArea;
    const infoRequest=request && question && company && !project && !specificArea;
    if((hasServiceNoun && (company||serviceQuestionStart) && asking && !specificArea) ||
       broadWork || infoRequest ||
       (company && !project && !specificArea && /\b(sobre|conhecer|saber|falar|fale|fala|conta|conte|mais)\b/.test(t))){
      return {intent:'company_services',confidence:0.88,products:product};
    }
    if(asking && price && product.length===0)return {intent:'custom_price',confidence:0.75,products:[]};
    if(product.length && asking)return {intent:'product_info',confidence:0.80,products:product};
    if(company && asking)return {intent:'company_question',confidence:0.60,products:[]};
    return {intent:'none',confidence:0,products:[],topic:topic(text)};
  }
  return {normalize,tokenize,distance,approx,has,productNames,topic,classify};
});
