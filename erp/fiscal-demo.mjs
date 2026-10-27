/* LKZ ERP Web Demo: somente simulação. NÃO gera documento fiscal legal, NF-e, NFC-e ou XML autorizado. */
import {uid,cleanName,int,cancelSale} from './core.mjs';
const MAX_XML=512*1024;
export const fiscalStatus={draft:'XML DEMO preparado',authorized:'Autorização FICTÍCIA',rejected:'Rejeição SIMULADA',contingency:'Contingência SIMULADA',cancelled:'Cancelado SIMULADO'};
export function fiscalState(state){
 if(!state.fiscalDemo||typeof state.fiscalDemo!=='object')state.fiscalDemo={sequence:1,documents:[],incoming:[]};
 if(!Array.isArray(state.fiscalDemo.documents))state.fiscalDemo.documents=[];
 if(!Array.isArray(state.fiscalDemo.incoming))state.fiscalDemo.incoming=[];
 if(!Number.isSafeInteger(state.fiscalDemo.sequence)||state.fiscalDemo.sequence<1)state.fiscalDemo.sequence=1;
 return state.fiscalDemo;
}
export function createFiscalDoc(state,saleId,model){
 if(!['65','55'].includes(model))throw Error('Selecione NFC-e 65 ou NF-e 55.');
 const f=fiscalState(state),sale=state.sales.find(s=>s.id===saleId&&!s.cancelled);
 if(!sale)throw Error('Escolha uma venda demonstrativa ativa.');
 if(f.documents.some(x=>x.saleId===saleId&&x.status!=='cancelled'))throw Error('Esta venda já possui um documento demonstrativo.');
 const doc={id:uid(),number:f.sequence++,saleId,model,createdAt:new Date().toISOString(),status:'draft',events:[{status:'draft',at:new Date().toISOString(),note:'Documento de treinamento criado'}],total:sale.total,items:structuredClone(sale.items)};
 f.documents.unshift(doc);
 state.audit.unshift({at:doc.createdAt,event:'fiscal-demo',description:`Documento DEMO ${model} criado para venda ${sale.number}`});
 return doc;
}
export function changeFiscalStatus(state,id,action,reason=''){
 const f=fiscalState(state),doc=f.documents.find(x=>x.id===id);
 if(!doc)throw Error('Documento de demonstração não encontrado.');
 const transitions={draft:['authorized','rejected','contingency'],rejected:['draft'],contingency:['authorized'],authorized:['cancelled']};
 if(!(transitions[doc.status]||[]).includes(action))throw Error('Transição de situação não permitida.');
 const now=new Date().toISOString();
 if(action==='cancelled'){
   const why=cleanName(reason,120);
   // Mesmo o cancelamento fiscal é fictício: a venda de treinamento é estornada de forma atômica na mesma alteração do IndexedDB.
   const reversed=cancelSale(state,doc.saleId,why);
   Object.assign(state,reversed);
   fiscalState(state).documents.find(d=>d.id===id).status='cancelled';
   fiscalState(state).documents.find(d=>d.id===id).events.push({status:action,at:now,note:why});
 }else{
   doc.status=action;
   doc.events.push({status:action,at:now,note:'Evento fictício, sem SEFAZ'});
 }
 state.audit.unshift({at:now,event:'fiscal-demo',description:'Simulação fiscal '+action});
 return fiscalState(state).documents.find(d=>d.id===id);
}
const xmlEscape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function demoXML(doc,sale,company='Empresa exemplo'){
 if(!doc||!sale||doc.saleId!==sale.id)throw Error('Venda não encontrada para XML DEMO.');
 // Raiz deliberadamente incompatível com os esquemas fiscais oficiais.
 return `<?xml version="1.0" encoding="UTF-8"?>\n<LKZDocumentoDemonstrativo versao="1" validoFiscalmente="false">\n <AVISO>SEM VALOR FISCAL - NAO TRANSMITIR A SEFAZ</AVISO>\n <ModeloExibicao>${xmlEscape(doc.model)}</ModeloExibicao>\n <NumeroDemonstracao>${xmlEscape(doc.number)}</NumeroDemonstracao>\n <Situacao>${xmlEscape(fiscalStatus[doc.status])}</Situacao>\n <Empresa>${xmlEscape(company)}</Empresa>\n <Venda>${xmlEscape(sale.number)}</Venda>\n <TotalCentavos>${int(sale.total,0,1e10)}</TotalCentavos>\n <Itens>\n${sale.items.map(i=>`  <Item><Descricao>${xmlEscape(i.name)}</Descricao><Quantidade>${int(i.qty,1)}</Quantidade><UnidadesBase>${int(i.baseQty,1)}</UnidadesBase><ValorCentavos>${int(i.unitPrice,0,1e9)}</ValorCentavos></Item>`).join('\n')}\n </Itens>\n</LKZDocumentoDemonstrativo>\n`;
}
function child(el,localName){return Array.from(el?.children||[]).find(c=>c.localName===localName)||null;}
function val(el,name){return child(el,name)?.textContent?.trim()||'';}
function descendants(el,name){return Array.from(el?.getElementsByTagName('*')||[]).filter(x=>x.localName===name);}
export function parseIncomingXML(xml,Parser=globalThis.DOMParser){
 if(typeof xml!=='string'||!xml.trim()||new TextEncoder().encode(xml).byteLength>MAX_XML)throw Error('XML vazio ou maior que 512 KB.');
 if(/<!\s*(doctype|entity)/i.test(xml)||xml.includes('\0'))throw Error('XML com entidades ou DTD não é permitido.');
 if(!Parser)throw Error('Leitor de XML indisponível.');
 const doc=new Parser().parseFromString(xml,'application/xml');
 if(descendants(doc,'parsererror').length||doc.documentElement?.localName==='parsererror')throw Error('XML malformado.');
 const root=doc.documentElement;
 if(!root)throw Error('XML inválido.');
 let supplier='',number='',lines=[];
 if(root.localName==='LKZDemoEntrada'){
  supplier=val(root,'Fornecedor')||'Fornecedor fictício';number=val(root,'Numero')||'DEMO';
  const list=descendants(root,'Item');
  lines=list.map((d,i)=>({description:cleanName(val(d,'Descricao'),100),barcode:val(d,'Codigo').slice(0,32),quantity:int(val(d,'Quantidade'),1,100000),unitCents:int(val(d,'PrecoCentavos')||0,0,1e9),line:i+1}));
 }else if(['NFe','nfeProc','enviNFe'].includes(root.localName)){
  const inf=descendants(root,'infNFe')[0];if(!inf)throw Error('XML sem estrutura NF-e reconhecível.');
  const ide=child(inf,'ide'),emit=child(inf,'emit');
  supplier=val(emit,'xNome')||'Fornecedor XML';number=val(ide,'nNF')||'—';
  const list=descendants(inf,'det');
  lines=list.map((d,i)=>{const p=child(d,'prod');if(!p)throw Error('Item sem dados de produto.');const q=Number(val(p,'qCom').replace(',','.'));const cost=Number(val(p,'vUnCom').replace(',','.'));if(!Number.isSafeInteger(q)||q<1||q>100000)throw Error('Somente quantidades inteiras no simulador de estoque.');if(!Number.isFinite(cost)||cost<0||cost>10000000)throw Error('Preço inválido no XML.');return {description:cleanName(val(p,'xProd'),100),barcode:val(p,'cEAN').slice(0,32),quantity:q,unitCents:Math.round(cost*100),line:i+1}});
 }else throw Error('Use XML NF-e ou o modelo fictício de entrada LKZ.');
 if(!lines.length||lines.length>200)throw Error('XML precisa ter de 1 a 200 itens.');
 if(lines.some(x=>!x.description))throw Error('Produto sem descrição.');
 return {supplier:cleanName(supplier,100),number:String(number).slice(0,30),lines};
}
export function importIncoming(state,parsed,hash){
 const f=fiscalState(state);
 if(!/^[0-9a-f]{64}$/.test(hash))throw Error('Identificador de arquivo inválido.');
 if(f.incoming.some(i=>i.hash===hash))throw Error('Este XML já foi importado nesta demonstração.');
 const record={id:uid(),hash,at:new Date().toISOString(),supplier:parsed.supplier,number:parsed.number,lines:structuredClone(parsed.lines),status:'pending',appliedAt:null};
 f.incoming.unshift(record);state.audit.unshift({at:record.at,event:'import-demo',description:'XML de entrada importado para conferência, sem baixa de estoque'});return record;
}
export function applyIncoming(state,incomingId,mapping){
 const record=fiscalState(state).incoming.find(x=>x.id===incomingId);
 if(!record||record.status!=='pending')throw Error('XML não está pendente ou já foi aplicado.');
 if(!Array.isArray(mapping)||mapping.length!==record.lines.length)throw Error('Confira o vínculo de todos os produtos.');
 const amounts=new Map();
 for(let i=0;i<record.lines.length;i++){
  const p=state.products.find(x=>x.id===mapping[i]&&x.active);
  if(!p)throw Error(`Vincule o item ${i+1} a um produto ativo.`);
  amounts.set(p.id,(amounts.get(p.id)||0)+int(record.lines[i].quantity,1,100000));
 }
 for(const [pid,qty] of amounts){const p=state.products.find(x=>x.id===pid);int(p.stock+qty,0,1000000)}
 const now=new Date().toISOString();
 for(const [pid,qty] of amounts){const p=state.products.find(x=>x.id===pid);p.stock+=qty;state.stockMovements.unshift({id:uid(),at:now,productId:pid,units:qty,reason:`Entrada DEMO via XML ${record.number}`});}
 record.status='applied';record.appliedAt=now;record.mapping=mapping.slice();
 state.audit.unshift({at:now,event:'xml-demo-stock',description:`Entrada demonstrativa via XML ${record.number}`});
 return record;
}
export const sampleIncomingXML=`<?xml version="1.0" encoding="UTF-8"?>\n<LKZDemoEntrada semValorFiscal="true">\n <Fornecedor>Fornecedor Ficticio LKZ</Fornecedor>\n <Numero>DEMO-0001</Numero>\n <Itens>\n  <Item><Descricao>Refrigerante cola 2L</Descricao><Codigo>DEMO-000001</Codigo><Quantidade>18</Quantidade><PrecoCentavos>590</PrecoCentavos></Item>\n  <Item><Descricao>Agua mineral 500ml</Descricao><Codigo>DEMO-000002</Codigo><Quantidade>24</Quantidade><PrecoCentavos>130</PrecoCentavos></Item>\n </Itens>\n</LKZDemoEntrada>\n`;