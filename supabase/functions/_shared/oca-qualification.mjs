'use strict';
// OCA v2: qualificação determinística gratuita. Esta biblioteca NÃO executa vendas,
// pagamentos, provisionamento, consultas ao banco nem usa credenciais.
// Estado da sessão deve ser recuperado do armazenamento SEGURO do servidor.
const LIMIT=1800, MAX_TURNS=60;
const norm=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const yes=s=>/^(sim|isso|claro|pode|autorizo|concordo|com certeza|exato|quero sim)\b/.test(norm(s));
const no=s=>/^(nao|nem|sem|prefiro nao|de jeito nenhum)\b/.test(norm(s));
const segments=[
 ['barbearia',/\b(barbearia|barbeiro|barbearias)\b/g],
 ['estetica',/\b(estetica|clinica de estetica|procedimento estetico|depilacao|botox)\b/g],
 ['salao',/\b(salao de beleza|cabeleireir[oa]|salao)\b/g],
 ['restaurante',/\b(restaurante|lanchonete|pizzaria)\b/g],
 ['comercio',/\b(loja|mercado|comercio|distribuidora|varejo)\b/g],
 ['isp',/\b(provedor de internet|provedor|isp)\b/g]
];
const featureRules=[
 ['agendamento',/\b(agenda|agendar|agendamento|marcar horario|marcacao|horarios|reservas)\b/],
 ['pagamento',/\b(pagamento|pagar|paguem|receber antecipad|cobrar antecipad|pix|cartao|checkout)\b/],
 ['estoque',/\b(estoque|inventario|lote de produto|repor produto)\b/],
 ['prontuario',/\b(prontuario|anamnese|procedimento estetico|mapa facial|aplicacao por ponto)\b/],
 ['crm',/\b(crm|leads|funil comercial|captacao)\b/],
 ['automacao',/\b(automacao|automatizar|automatico|integracao|integrar|follow.?up)\b/],
 ['site',/\b(site|pagina web|pagina institucional|landing page)\b/],
 ['caixa',/\b(caixa|pdv|controle financeiro|sangria|comissao)\b/]
];
function extractSegment(text) {
 const t=norm(text);let last=null;
 for(const [id,re0] of segments){const re=new RegExp(re0.source,re0.flags);let m;
   while((m=re.exec(t))!==null){
     if(/\b(nao e|nao sou|sem)\s*$/.test(t.slice(Math.max(0,m.index-12),m.index)))continue;
     if(!last||last.pos<m.index)last={id,pos:m.index};
   }
 }
 return last?.id??null;
}
function extractStaff(text) {
 const t=norm(text),role='(?:barbeir[oa]s?|profissiona(?:l|is)|funcionari[oa]s?|pessoas?|colaboradores?|atendentes?)';
 const number=t.match(new RegExp('\\b(\\d{1,3})\\s+'+role+'\\b'));if(number)return Number(number[1]);
 const words={um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10};
 const found=t.match(new RegExp('\\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\\s+'+role+'\\b'));
 return found?words[found[1]]:null;
}
function extractContact(text) {
 const email=text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0]?.toLowerCase()??null;
 const chunks=text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/ig,' ').match(/(?:\+?\d[\d().\s/-]{8,}\d)/g)||[];
 let phone=null;
 for(const chunk of chunks){let digits=chunk.replace(/\D/g,'');
   if(digits.startsWith('55')&&(digits.length===12||digits.length===13))digits=digits.slice(2);
   if(digits.length===10||digits.length===11){phone='+55'+digits;break;}
 }
 return {email,phone};
}
function extractFeatures(text) {
 const t=norm(text);
 return featureRules.filter(([,re])=>{const m=re.exec(t);if(!m)return false;
    return !/\b(nao quero|nao preciso|sem)\s*$/.test(t.slice(Math.max(0,m.index-16),m.index));
 }).map(([id])=>id);
}
function createSession(){
 return {version:2,turn:0,stage:'discovery',pending:null,
   business:{segment:null,staffCount:null,problem:null,features:[],advancePayment:null},
   contact:{email:null,phone:null,consent:null},history:[],reviewRequired:true};
}
function applyTurn(serverState,input){
 // NUNCA receber serverState do cliente; ele precisa ser obtido por token de sessão
 // autenticado e validado no armazenamento do backend.
 if(!serverState||serverState.version!==2||!Number.isInteger(serverState.turn)||
    serverState.turn<0||serverState.turn>=MAX_TURNS)throw Error('Sessão inválida ou encerrada.');
 if(typeof input!=='string')throw TypeError('Mensagem deve ser texto.');
 const text=input.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').trim();
 if(!text||text.length>LIMIT)throw RangeError('Mensagem vazia ou longa demais.');
 const state=structuredClone(serverState),t=norm(text),prev=state.pending;
 state.turn++;state.pending=null;
 const segment=extractSegment(text);if(segment)state.business.segment=segment;
 const staff=extractStaff(text);if(staff!==null)state.business.staffCount=staff;
 state.business.features=[...new Set([...state.business.features,...extractFeatures(text)])];
 if(prev==='advance_payment'){
   if(no(text)||/\b(nao quero|nao preciso|sem pagamento antecipado)\b/.test(t))state.business.advancePayment=false;
   else if(yes(text)||/\b(antes|antecipad|pagamento|pix|cartao)\b/.test(t)){
     state.business.advancePayment=true;
     if(!state.business.features.includes('pagamento'))state.business.features.push('pagamento');
   }
 }else if(/\b(antes|antecipad|adiantad)\b/.test(t)&&/\b(pagar|pagamento|paguem|receber|cobrar|pix)\b/.test(t)){
   state.business.advancePayment=true;
 }
 const c=extractContact(text);
 if(c.email||c.phone){
   if(state.contact.consent===false)state.contact.consent=null;
   if(c.email)state.contact.email=c.email;
   if(c.phone)state.contact.phone=c.phone;
 }
 if(prev==='consent'){if(yes(text))state.contact.consent=true;else if(no(text))state.contact.consent=false;}
 if(prev==='contact'&&/\b(prefiro nao|nao quero informar|sem contato)\b/.test(t))state.contact.consent=false;
 if(state.contact.consent===false){state.contact.email=null;state.contact.phone=null;}
 const bare=/^(sim|nao|isso|claro|ok|certo|pode|autorizo|perfeito)[.!]?$/.test(t);
 if(!state.business.problem&&!bare&&!/\?\s*$/.test(text)&&
    (prev==='problem'||/\b(quero|preciso|gostaria|busco|tenho dificuldade|problema)\b/.test(t))){
   state.business.problem=text.slice(0,600);
 }
 // Não duplicar contato pessoal na transcrição da sessão.
 state.history.push({role:'user',text:(c.email||c.phone)?'[Contato fornecido]':text});
 let reply,pending;
 if(!state.business.segment){pending='segment';reply='Qual é o tipo de negócio ou atividade da sua empresa?';}
 else if(!state.business.problem){pending='problem';reply='Qual resultado você quer alcançar ou qual problema precisa resolver? Pode explicar do seu jeito.';}
 else if(state.business.features.includes('agendamento')&&state.business.advancePayment===null&&prev!=='advance_payment'){
   pending='advance_payment';reply='Além do agendamento, você quer permitir pagamento antecipado pelo cliente?';
 }else if(!state.contact.email&&!state.contact.phone&&state.contact.consent!==false){
   pending='contact';reply='Já entendi o cenário inicial. Qual telefone ou e-mail prefere informar para a Lacrose retornar?';
 }else if((state.contact.email||state.contact.phone)&&state.contact.consent===null){
   pending='consent';reply='Você autoriza a Lacrose Tecnologia a usar esse contato apenas para responder à sua solicitação?';
 }else if(state.contact.consent===false){
   pending=null;reply='Tudo bem. Não faremos contato sem sua autorização. Você poderá retomar quando quiser.';
 }else{
   pending=null;reply='Diagnóstico registrado para revisão comercial. A equipe confirmará escopo, preços vigentes e condições antes de propor a contratação.';
 }
 state.pending=pending??null;
 state.stage=pending?'discovery':(state.contact.consent===true?'ready_for_review':'no_contact');
 state.history.push({role:'assistant',text:reply});
 state.history=state.history.slice(-40);
 return {state,reply,readyForHumanReview:state.stage==='ready_for_review'};
}
export {createSession,applyTurn,extractSegment,extractStaff,extractContact,extractFeatures};
