const segments={new:'Novo cliente',active:'Ativo',followup:'Em acompanhamento',inactive:'Inativo'};
const channels={none:'Não definido',whatsapp:'WhatsApp',email:'E-mail',phone:'Telefone'};
const contactChannels={internal:'Interno',phone:'Telefone',email:'E-mail',whatsapp:'WhatsApp',meeting:'Reunião'};
const permission={unknown:'Não registrado',allowed:'Autorizado',opted_out:'Não contatar'};
const variables=['cliente','empresa','servico','data','horario','responsavel'];
const starters=[
 ['Boas-vindas','Olá, {{cliente}}! Seja bem-vindo à {{empresa}}. Estamos à disposição.'],
 ['Pós-atendimento','Olá, {{cliente}}! Como foi sua experiência com {{servico}}? Podemos ajudar em algo?'],
 ['Follow-up comercial','Olá, {{cliente}}! Gostaria de saber se podemos avançar com sua solicitação.'],
 ['Renovação','Olá, {{cliente}}! Podemos conversar sobre a renovação do seu serviço?'],
 ['Lembrete de cobrança','Olá, {{cliente}}! Gostaria de conversar sobre o pagamento do seu serviço com a {{empresa}}. Podemos ajudar?'],
 ['Envio de proposta','Olá, {{cliente}}! Podemos apresentar nossa proposta para {{servico}}. Estamos à disposição.'],
 ['Aniversário','Feliz aniversário, {{cliente}}! São os votos da equipe {{empresa}}.']
];
export async function buildRelationship({api,element:e,card,form,message,isCurrent,tenantName}){
 const root=e('div'),toolbar=e('div',undefined,'records'),detail=e('div',undefined,'records'),models=e('div',undefined,'records');
 const search=e('input');search.placeholder='Buscar por nome, e-mail ou telefone';search.maxLength=100;search.setAttribute('aria-label','Buscar clientes');
 const list=e('div',undefined,'records'),status=e('p');status.setAttribute('role','status');
 let searchVersion=0,detailVersion=0,canEdit=false,selected=null,templates=[];
 const active=()=>isCurrent();
 function field(parent,label,key,type,value,choices,max){
   const wrap=e('label',label),input=e(type==='select'?'select':type==='textarea'?'textarea':'input');
   input.name=key;if(input.tagName==='INPUT')input.type=type;
   if(choices)for(const [k,v] of Object.entries(choices))input.add(new Option(v,k));
   input.value=value??'';if(max)input.maxLength=max;wrap.append(input);parent.append(wrap);return input;
 }
 function button(parent,label,handler){
   const b=e('button',label);b.type='button';b.onclick=async()=>{if(!active()||b.disabled)return;b.disabled=true;try{await handler();}catch(err){if(active())message(err.message,true);}finally{b.disabled=false;}};
   parent.append(b);return b;
 }
 function save(parent,label,handler){
   const b=e('button',label);b.type='submit';parent.append(b);parent.onsubmit=async ev=>{ev.preventDefault();if(!active()||b.disabled)return;b.disabled=true;try{await handler(Object.fromEntries(new FormData(parent)));}catch(err){if(active())message(err.message,true);}finally{b.disabled=false;}};
 }
 async function lookup(){
   const version=++searchVersion,result=await api('crm/clients',undefined,{q:search.value.trim()});
   if(!active()||version!==searchVersion)return;
   canEdit=result.canEdit;list.replaceChildren();status.textContent=result.more?'Mais de 50 resultados. Refine a busca.':result.items.length+' cliente(s).';
   for(const c of result.items){
     if(canEdit)button(list,c.name+' · '+(segments[c.segment]??'Sem ficha')+(c.followup_on?' · Retorno '+c.followup_on:''),()=>openClient(c.id));
     else list.append(e('p',c.name+' · '+c.email));
   }
 }
 toolbar.append(search);const searchButton=button(toolbar,'Buscar',lookup);toolbar.append(status,list);
 search.addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();searchButton.click();}});
 root.append(card('Carteira de clientes',toolbar),detail,models);
 await lookup();
 if(!canEdit)return root;
 const create=form([['name','Nome / Razão social'],['email','E-mail','email']],'Cadastrar cliente',async data=>{
   if(!active())return;const c=await api('clients',data);if(active()){await lookup();await openClient(c.id);message('Cliente cadastrado.');}
 });
 root.prepend(card('Novo cliente',create));
 async function openClient(id){
   const version=++detailVersion;selected=null;models.replaceChildren();detail.replaceChildren(e('p','Carregando ficha…'));const data=await api('crm/clients/'+id);
   if(!active()||version!==detailVersion)return;
   const current=()=>active()&&version===detailVersion;
   const {client,profile:p,contacts,plans}=data;selected={client,profile:p};
   detail.replaceChildren();detail.append(card(client.name,e('p',client.email)));
   const editor=e('form');
   field(editor,'Pessoa de contato','contact_name','text',p?.contact_name,undefined,160);
   field(editor,'Telefone / WhatsApp (+55...)','phone','tel',p?.phone,undefined,16);
   field(editor,'Segmento','segment','select',p?.segment??'new',segments);
   field(editor,'Canal preferencial','preferred_channel','select',p?.preferred_channel??'none',channels);
   field(editor,'Próximo retorno','followup_on','date',p?.followup_on??'');
   field(editor,'Permissão WhatsApp','whatsapp_permission','select',p?.whatsapp_permission??'unknown',permission);
   field(editor,'Permissão E-mail','email_permission','select',p?.email_permission??'unknown',permission);
   field(editor,'Origem da autorização/recusa (não é prova automática de consentimento)','permission_source','text',p?.permission_source,undefined,300);
   field(editor,'Preferências e observações','notes','textarea',p?.notes,undefined,2000);
   save(editor,'Salvar ficha',async values=>{if(!current())return;await api('crm/clients/'+id+'/profile',{...values,revision:p?.revision??0});if(current()){await lookup();await openClient(id);message('Ficha atualizada.');}});
   detail.append(card('Dados, preferências e contato',editor));
   const timeline=e('div',undefined,'records'),contact=e('form');
   field(contact,'Canal','channel','select','internal',contactChannels);
   field(contact,'Registro do atendimento','note','textarea','',undefined,2000).required=true;
   let pending;
   save(contact,'Registrar atendimento',async values=>{if(!current())return;const signature=JSON.stringify(values);if(pending?.signature!==signature)pending={signature,id:crypto.randomUUID()};await api('crm/clients/'+id+'/contact',{...values,id:pending.id});pending=null;if(current())await openClient(id);});
   timeline.append(contact);
   for(const row of contacts){const item=e('article');item.append(e('strong',(contactChannels[row.channel]??row.channel)+' · '+new Date(row.created_at).toLocaleString('pt-BR')),e('p',row.note));timeline.append(item);}
   if(!contacts.length)timeline.append(e('p','Nenhum atendimento registrado.'));
   detail.append(card('Histórico de relacionamento · últimos 50',timeline));
   const planList=e('div',undefined,'records');
   for(const p of plans)planList.append(e('p',p.product+' · '+p.plan+' · '+new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(p.amount_brl_cents/100)+' · Rascunho'));
   if(!plans.length)planList.append(e('p','Nenhuma assinatura em rascunho.'));
   detail.append(card('Serviços e planos vinculados',planList));
   await refreshTemplates();
 }
 async function refreshTemplates(){
   const version=detailVersion;const result=await api('crm/templates');if(!active()||version!==detailVersion)return;templates=result.items;
   models.replaceChildren();const box=e('div',undefined,'records'),pick=e('select');pick.setAttribute('aria-label','Escolher modelo');
   const showArchived=e('input');showArchived.type='checkbox';const archivedLabel=e('label','Exibir modelos excluídos/inativos');archivedLabel.prepend(showArchived);
   function populate(){const prior=pick.value;pick.replaceChildren(new Option('Novo modelo',''));for(const t of templates.filter(t=>t.active||showArchived.checked))pick.add(new Option(t.title+(t.active?'':' (inativo)'),t.id));if([...pick.options].some(o=>o.value===prior))pick.value=prior;}
   populate();showArchived.onchange=()=>{populate();select();};
   box.append(pick,archivedLabel);const editor=e('form'),head=field(editor,'Título','title','text','',undefined,80);
   const body=field(editor,'Mensagem','body','textarea','',undefined,1000);body.rows=5;
   const state=field(editor,'Situação','active','select','true',{true:'Ativo',false:'Inativo'});
   const preview=e('pre',undefined,'crm-preview'),context=e('div',undefined,'records'),inputs={};
   for(const key of ['servico','data','horario','responsavel'])inputs[key]=field(context,key,'preview_'+key,'text','',undefined,160);
   function update(){const values={cliente:selected?.client?.name??'Cliente de exemplo',empresa:tenantName(),...Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.value||'['+k+']']))};preview.textContent=body.value.replace(/\{\{(\w+)\}\}/g,(m,k)=>Object.hasOwn(values,k)?values[k]:m);}
   const prepared=e('div',undefined,'records');
   function invalidate(){prepared.replaceChildren();update();}
   body.oninput=invalidate;head.oninput=invalidate;state.onchange=invalidate;for(const input of Object.values(inputs))input.oninput=invalidate;
   const chips=e('div',undefined,'crm-chips');
   for(const key of variables)button(chips,'{{'+key+'}}',()=>{if(!result.canEdit)return;body.setRangeText('{{'+key+'}}',body.selectionStart,body.selectionEnd,'end');invalidate();body.focus();});
   const starter=e('select');starter.setAttribute('aria-label','Modelo sugerido');starter.add(new Option('Sugestões de mensagens',''));starters.forEach(([title],i)=>starter.add(new Option(title,String(i))));
   starter.onchange=()=>{if(!result.canEdit||starter.value==='')return;const [t,b]=starters[Number(starter.value)];pick.value='';head.value=t;body.value=b;state.value='true';invalidate();};
   function select(){const t=templates.find(x=>x.id===pick.value);head.value=t?.title??'';body.value=t?.body??'';state.value=String(t?.active??true);invalidate();}
   pick.onchange=select;box.append(starter,editor,chips,context,preview);
   if(result.canEdit)save(editor,'Salvar modelo',async values=>{const t=templates.find(x=>x.id===pick.value);await api('crm/templates'+(t?'/'+t.id:''),{title:values.title,body:values.body,active:values.active==='true',...(t?{revision:t.revision}:{})});if(active()){await refreshTemplates();message('Modelo salvo e versionado.');}});
   else{head.disabled=body.disabled=state.disabled=starter.disabled=true;}
   if(result.canEdit)button(box,'Excluir modelo selecionado',async()=>{const t=templates.find(x=>x.id===pick.value);if(!t?.active)throw new Error('Selecione um modelo ativo.');if(!window.confirm('Excluir este modelo da lista ativa? O histórico será preservado.'))return;await api('crm/templates/'+t.id,{title:t.title,body:t.body,active:false,revision:t.revision});if(active()){await refreshTemplates();message('Modelo excluído da lista ativa. Histórico preservado.');}});
   button(box,'Preparar mensagem no WhatsApp',async()=>{
     prepared.replaceChildren();
     if(!selected)throw new Error('Selecione um cliente.');
     const selection=selected, t=templates.find(x=>x.id===pick.value);
     if(!t?.active||state.value!=='true'||head.value!==t.title||body.value!==t.body)throw new Error('Selecione um modelo ativo e salvo. Salve as alterações antes de continuar.');
     const variables=Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.value]));
     const result=await api('crm/clients/'+selection.client.id+'/whatsapp',{template_id:t.id,revision:t.revision,variables});
     if(!active()||selected!==selection||!prepared.isConnected||pick.value!==t.id||state.value!=='true'||head.value!==t.title||body.value!==t.body||JSON.stringify(variables)!==JSON.stringify(Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.value]))))return;
     if(!/^[1-9]\d{7,14}$/.test(result.phone)||typeof result.message!=='string')throw new Error('Resposta de contato inválida.');
     const content=e('pre',result.message,'crm-preview');
     const link=e('a','Abrir conversa no WhatsApp','crm-whatsapp');link.href='https://wa.me/'+result.phone;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';
     button(prepared,'Copiar texto da mensagem',async()=>{await navigator.clipboard.writeText(result.message);if(active())message('Mensagem copiada. Cole no WhatsApp e revise antes de enviar.');});
     prepared.append(content,link,e('p','Abra a conversa e cole o texto. Nada é enviado automaticamente; a mensagem não é incluída na URL.'));
   });
   box.append(prepared);
   if(result.canEdit)button(box,'Ver versões anteriores',async()=>{if(!pick.value)return;const rows=await api('crm/templates/'+pick.value);if(active()){history.replaceChildren();for(const r of rows)history.append(e('p','Versão '+r.revision+' · '+r.title+' · '+new Date(r.created_at).toLocaleString('pt-BR')+'\n'+r.body));}});
   const history=e('div',undefined,'crm-history');box.append(history,e('p','WhatsApp manual: autorização e modelo ativo são verificados no servidor. O envio é feito por você.'));
   models.append(card('Mensagens personalizáveis',box));select();
 }
 await refreshTemplates();return root;
}
