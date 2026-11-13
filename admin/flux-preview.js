'use strict';

async function readFluxBackup(file, subtle=crypto.subtle){
  if(file.size>10*1024*1024)throw new Error('O backup ultrapassa 10 MB.');
  const backup=JSON.parse(await file.text());
  const rows=backup?.transactions;
  if(backup?.format!=='lacrose-flux-local'||backup.version!==2||
      !Array.isArray(rows)||rows.length>50000){
    throw new Error('Selecione um backup JSON versão 2 do FluX Local Beta.');
  }
  const ids=new Set();
  const totals={income:0,expense:0};
  const categories=new Map();
  for(const row of rows){
    const date=typeof row?.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row.date)
      ?new Date(row.date+'T00:00:00Z'):null;
    if(!row||typeof row.id!=='string'||!row.id.trim()||row.id.length>100||ids.has(row.id)||
        !date||!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==row.date||
        !['income','expense'].includes(row.type)||!Number.isSafeInteger(row.cents)||
        row.cents<=0||row.cents>99999999900||
        typeof row.description!=='string'||!row.description.trim()||row.description.length>200||
        typeof row.category!=='string'||!row.category.trim()||row.category.length>80){
      throw new Error('O backup contém lançamentos inválidos ou repetidos.');
    }
    ids.add(row.id);
    totals[row.type]+=row.cents;
    const category=categories.get(row.category)||{income:0,expense:0};
    category[row.type]+=row.cents;
    categories.set(row.category,category);
  }
  const serialized=JSON.stringify(rows.slice().sort((a,b)=>a.id.localeCompare(b.id)));
  const digest=await subtle.digest('SHA-256',new TextEncoder().encode(serialized));
  const checksum=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(checksum!==backup.checksum)throw new Error('O checksum do backup não confere.');
  return {count:rows.length,totals,categories};
}

function mountFluxPreview(target){
  const input=target.querySelector('input');
  const status=target.querySelector('[role=status]');
  const result=target.querySelector('[data-flux-summary]');
  const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
  input.onchange=async()=>{
    const file=input.files[0];
    input.value='';
    if(!file)return;
    input.disabled=true;
    result.replaceChildren();
    status.textContent='Conferindo backup…';
    try{
      const {count,totals,categories}=await readFluxBackup(file);
      if(!target.isConnected)return;
      status.textContent=count+' lançamento(s) conferido(s).';
      const lines=[
        'Entradas '+money.format(totals.income/100),
        'Saídas '+money.format(totals.expense/100),
        'Saldo '+money.format((totals.income-totals.expense)/100)
      ];
      for(const [name,category] of [...categories].sort(([a],[b])=>a.localeCompare(b,'pt-BR')).slice(0,30)){
        lines.push(name+' · entradas '+money.format(category.income/100)+
          ' · saídas '+money.format(category.expense/100));
      }
      if(categories.size>30)lines.push('Exibindo 30 de '+categories.size+' categorias.');
      for(const line of lines){
        const item=document.createElement('li');
        item.textContent=line;
        result.append(item);
      }
    }catch(error){
      status.textContent=error instanceof SyntaxError?'O arquivo não contém JSON válido.':
        error.message||'Falha ao conferir backup.';
    }finally{
      input.disabled=false;
    }
  };
}
