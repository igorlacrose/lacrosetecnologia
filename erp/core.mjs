/* LKZ ERP Web Demo - regras puras de treinamento. Nao usar para faturamento real. */
export const MAX_UNITS=1000000;
export const cashTypes=Object.freeze(['cash','pix','credit','debit','other']);
export const icons=Object.freeze(['📦','🥤','💧','🍞','🍚','🫘','🥛','🍪','☕','🍫','🧃','🍬','🧴','🥫','🥖','🛒','🍎','🧀','🥩','🧻','🧼','🧊','🌾','🫒']);
const time=()=>new Date().toISOString();
export const uid=()=>crypto.randomUUID();
export function seedState(){
 const cats=['Bebidas','Mercearia','Laticínios','Biscoitos'].map((name,i)=>({id:'cat-'+(i+1),name,active:true}));
 const data=[
 ['Refrigerante cola 2L','cat-1','🥤',9.99,54,9,79.90,12],['Água mineral 500ml','cat-1','💧',2.49,120,12,24.90,20],
 ['Suco de uva 1L','cat-1','🧃',12.90,35,6,68.90,10],['Arroz branco 5kg','cat-2','🍚',27.90,48,0,0,8],
 ['Feijão carioca 1kg','cat-2','🫘',8.49,29,0,0,9],['Óleo de soja 900ml','cat-2','🫒',7.99,68,0,0,12],
 ['Café 500g','cat-2','☕',18.90,25,0,0,8],['Leite integral 1L','cat-3','🥛',5.79,62,12,59.90,12],
 ['Biscoito recheado 120g','cat-4','🍪',3.99,45,0,0,10],['Açúcar cristal 1kg','cat-2','🍬',4.89,80,0,0,15]
 ];
 const products=data.map((p,i)=>({id:'prod-'+(i+1),name:p[0],categoryId:p[1],icon:p[2],unitPrice:cents(p[3]),stock:p[4],packSize:p[5],packPrice:cents(p[6]),minStock:p[7],barcode:'DEMO-'+String(i+1).padStart(6,'0'),active:true}));
 return {schema:1,createdAt:time(),updatedAt:time(),demo:true,branding:{company:'Distribuidora Exemplo',theme:'emerald',logo:null},categories:cats,products,
  paymentMethods:[{id:'pm-cash',name:'Dinheiro',kind:'cash',active:true},{id:'pm-pix',name:'Pix',kind:'pix',active:true},{id:'pm-credit',name:'Crédito',kind:'credit',active:true},{id:'pm-debit',name:'Débito',kind:'debit',active:true}],
  cashReasons:[{id:'rs-change',name:'Troco adicional',kind:'in',active:true},{id:'rs-expense',name:'Despesa operacional',kind:'out',active:true},{id:'rs-safe',name:'Retirada para cofre',kind:'out',active:true}],
  cash:{open:false,session:0,openedAt:null,closedAt:null,openingFloat:0},cashMovements:[],sales:[],stockMovements:[],audit:[],sequence:1001};
}
export function cents(n){const v=Number(n);if(!Number.isFinite(v)||v<0||v>10000000)throw Error('Informe um valor positivo válido.');return Math.round(v*100);}
export function money(c){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(c/100);}
export function int(v,min=0,max=MAX_UNITS){const n=Number(v);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Quantidade inválida.');return n;}
export function cleanName(name,max=90){const v=String(name??'').trim().replace(/\s+/g,' ');if(!v||v.length>max)throw Error('Informe um nome válido.');return v;}
export function validateProduct(p){cleanName(p.name);int(p.stock);int(p.minStock);int(p.packSize);int(p.unitPrice,0,1e9);int(p.packPrice,0,1e9);if(p.packSize===1)throw Error('Pacote precisa ter 2 ou mais unidades.');if(p.packSize>=2&&!p.packPrice)throw Error('Informe o preço do pacote.');return true;}
export function stockDelta(current,qty,packSize,kind,direction){const q=int(qty,1),factor=kind==='pack'?int(packSize,2):1;if(!['unit','pack'].includes(kind)||!['in','out'].includes(direction))throw Error('Unidade ou movimento inválido.');const units=q*factor;const next=current+(direction==='in'?units:-units);int(next);return {units:direction==='in'?units:-units,next};}
export function computeCart(cart,products){if(!cart.length)throw Error('Adicione produtos ao carrinho.');const lines=[];const counts=new Map();let total=0;
 for(const i of cart){const p=products.find(p=>p.id===i.id&&p.active);if(!p)throw Error('Produto indisponível.');const qty=int(i.qty,1),factor=i.kind==='pack'?int(p.packSize,2):i.kind==='unit'?1:0;if(!factor)throw Error('Embalagem inválida.');const baseQty=qty*factor;int(baseQty,1);counts.set(p.id,(counts.get(p.id)||0)+baseQty);const unitPrice=i.kind==='pack'?p.packPrice:p.unitPrice;total+=qty*unitPrice;lines.push({productId:p.id,name:p.name,kind:i.kind,qty,factor,baseQty,unitPrice});}
 int(total,0,1e10);for(const [id,used] of counts){const p=products.find(p=>p.id===id);if(used>p.stock)throw Error('Estoque insuficiente para '+p.name+'.');}return {lines,counts,total};}
export function validatePayments(parts,total,methods){if(!Array.isArray(parts)||!parts.length||parts.length>5)throw Error('Informe uma forma de pagamento.');let paid=0;const normalized=[];for(const p of parts){const method=methods.find(x=>x.id===p.methodId&&x.active);if(!method)throw Error('Pagamento indisponível.');const amount=int(p.amount,1,1e10);paid+=amount;normalized.push({methodId:method.id,name:method.name,kind:method.kind,amount});}if(paid!==total)throw Error('Os pagamentos precisam somar '+money(total)+'.');return normalized;}
export function cashBalance(s){let result=s.cash.open?s.cash.openingFloat:0;const sid=s.cash.session;
 for(const m of s.cashMovements.filter(m=>m.session===sid)){result+=m.kind==='in'?m.amount:-m.amount;}
 for(const sale of s.sales.filter(x=>x.session===sid&&!x.cancelled)){result+=sale.payments.filter(p=>p.kind==='cash').reduce((acc,p)=>acc+p.amount,0);}
 return result;
}
export function executeSale(state,cart,payments){if(!state.cash.open)throw Error('Abra o caixa antes de vender.');const calc=computeCart(cart,state.products);const paid=validatePayments(payments,calc.total,state.paymentMethods);const next=structuredClone(state);for(const [id,count] of calc.counts){const p=next.products.find(p=>p.id===id);p.stock-=count;}
 const sale={id:'SALE-'+next.sequence,number:next.sequence,at:time(),session:next.cash.session,total:calc.total,items:calc.lines,payments:paid,cancelled:false};next.sequence++;next.sales.unshift(sale);next.stockMovements.unshift(...calc.lines.map(i=>({id:uid(),at:sale.at,productId:i.productId,units:-i.baseQty,reason:'Venda demonstrativa '+sale.number})));next.audit.unshift({at:sale.at,event:'sale',description:'Venda de treinamento '+sale.number});return {next,sale};}
export function cancelSale(state,saleId,reason){const sale=state.sales.find(x=>x.id===saleId);if(!sale||sale.cancelled)throw Error('Venda não encontrada ou já cancelada.');if(!reason.trim())throw Error('Informe o motivo.');const next=structuredClone(state),s=next.sales.find(x=>x.id===saleId);s.cancelled=true;s.reason=cleanName(reason,120);s.cancelledAt=time();for(const i of s.items){const p=next.products.find(x=>x.id===i.productId);if(p)p.stock+=i.baseQty;next.stockMovements.unshift({id:uid(),at:s.cancelledAt,productId:i.productId,units:i.baseQty,reason:'Cancelamento demonstrativo '+s.number});}next.audit.unshift({at:s.cancelledAt,event:'cancel',description:'Cancelamento de treinamento '+s.number});return next;}
export function validateImport(d){if(!d||typeof d!=='object'||d.schema!==1||d.demo!==true||!Array.isArray(d.products)||!Array.isArray(d.categories)||!Array.isArray(d.sales)||!Array.isArray(d.paymentMethods)||!Array.isArray(d.cashReasons)||d.products.length>1000||d.categories.length>100||d.sales.length>2000||d.paymentMethods.length>50||d.cashReasons.length>100)throw Error('Arquivo de demonstração inválido.');for(const p of d.products){validateProduct(p);if(!d.categories.some(c=>c.id===p.categoryId))throw Error('Categoria desconhecida no backup.');}for(const m of d.paymentMethods)if(!cashTypes.includes(m.kind))throw Error('Tipo de pagamento inválido.');return true;}