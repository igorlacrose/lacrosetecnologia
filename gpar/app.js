/* Gestão de Parcerias — BI local-first, sem backend nem sincronização.
   Registros financeiros são salvos neste navegador por IndexedDB; exporte backups JSON. */
(() => {
  'use strict';
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_ROWS = 20000;
  const MAX_XML_BYTES = 28 * 1024 * 1024;
  const MAX_UNCOMPRESSED_BYTES = 48 * 1024 * 1024;
  const money = new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'});
  const number = new Intl.NumberFormat('pt-BR', {maximumFractionDigits:1});
  const monthsBR = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const $ = id => document.getElementById(id);
  const state = {rows:[],companies:[],files:new Set(),current:null,preview:null,demo:false,visibleRows:30};
  const newId = () => window.crypto?.randomUUID?.() || (window.crypto?.getRandomValues ? Array.from(crypto.getRandomValues(new Uint8Array(16)), b=>b.toString(16).padStart(2,'0')).join('') : String(Date.now())+String(Math.random()).slice(2));
  const fields = [
    ['date','Data / competência'],['company','Empresa / parceria'],['type','Tipo (receita / despesa)'],
    ['value','Valor único'],['revenue','Coluna receitas'],['expense','Coluna despesas'],
    ['category','Categoria'],['description','Descrição / histórico']
  ];
  const aliases = {
    date:['data','data lancamento','data do lancamento','data pagamento','dt movimento','competencia','vencimento','data movimento','periodo'],
    company:['empresa','parceria','unidade','nome empresa','filial'],
    type:['tipo','movimento','natureza','entrada saida','tipo movimentacao','operacao'],
    value:['valor','valor r','valor total','total','montante','vlr','valor movimentacao'],
    revenue:['receita','receitas','entrada','entradas','credito','creditos','valor recebido','recebido'],
    expense:['despesa','despesas','saida','saidas','debito','debitos','valor pago','pago'],
    category:['categoria','centro de custo','grupo','classificacao','conta','plano de contas'],
    description:['descricao','historico','observacao','detalhe','lancamento','fornecedor cliente','fornecedor','cliente']
  };
  const cleanName = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const clampText = (s, max=100) => String(s ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'').trim().slice(0,max);
  const fmtMoney = n => money.format(Number.isFinite(n)?n:0);
  const formatDate = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso)?iso.slice(8,10)+'/'+iso.slice(5,7)+'/'+iso.slice(0,4):'—';
  const csvTextSafe = s => /^[=+@\-\t\r\n]/.test(String(s)) ? "'"+s : s;
  let toastTimeout = null;
  function toast(msg, error=false){ const el=$('toast'); el.textContent=msg; el.classList.toggle('error',error); el.hidden=false; clearTimeout(toastTimeout); toastTimeout=setTimeout(()=>el.hidden=true,5000); }
  function safeNumber(raw){
    if(typeof raw==='number'){return Number.isFinite(raw)&&Math.abs(raw)<=1e12?raw:null;}
    let s=String(raw??'').trim(); if(!s)return null;
    const paren=/^\(.*\)$/.test(s); s=s.replace(/[^0-9.,+\-]/g,'');
    if(!s || !/^[+-]?[0-9][0-9.,]*$/.test(s))return null;
    const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');
    if(comma>=0 && dot>=0){const decimal=comma>dot?',':'.';s=s.split(decimal).map((part,i,a)=>i===a.length-1?part:part.replace(/[.,]/g,'')).join('.');}
    else if(comma>=0){const digits=s.length-comma-1;if(digits<=2){s=s.replace(/\./g,'').replace(',','.');}else if(digits===3){s=s.replace(/,/g,'');}else return null;}
    else if(dot>=0){const groups=s.split('.');if(groups.length>2 || (groups.length===2 && groups[1].length===3 && groups[0].length<=3)){s=s.replace(/\./g,'');}}
    const v=Number(s);return Number.isFinite(v)&&Math.abs(v)<=1e12?(paren?-Math.abs(v):v):null;
  }
  function dateFromParts(y,m,d){
    y=Number(y);m=Number(m);d=Number(d);if(y<1990||y>2100||m<1||m>12||d<1||d>31)return null;
    const v=new Date(Date.UTC(y,m-1,d));return v.getUTCFullYear()===y&&v.getUTCMonth()===m-1&&v.getUTCDate()===d?`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;
  }
  function safeDate(v,date1904=false){
    if(typeof v==='number'||/^\d{5}(?:\.\d+)?$/.test(String(v??'').trim())){
      const n=Number(v);if(n>30000&&n<80000){const ms=(Math.floor(n)-25569+(date1904?1462:0))*86400000;const d=new Date(ms);return dateFromParts(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate());}
    }
    const s=String(v??'').trim();let m;
    if((m=s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ]|$)/)))return dateFromParts(m[1],m[2],m[3]);
    if((m=s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})(?:\s|$)/))){let y=Number(m[3]);if(y<100)y+=y>=70?1900:2000;return dateFromParts(y,m[2],m[1]);}
    return null;
  }
  function parseCsv(text){
    text=text.replace(/^\uFEFF/,'');if(text.includes('\u0000'))throw Error('CSV contém caracteres binários.');
    const candidates=[';',',','\t'];let best=';', score=-1;
    for(const separator of candidates){let n=0, quoted=false,lines=0;for(let i=0;i<Math.min(text.length,8000)&&lines<8;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){i++;continue;}quoted=!quoted;}else if(!quoted&&c===separator)n++;else if(!quoted&&c==='\n')lines++;}if(n>score){best=separator;score=n;}}
    const rows=[],row=[];let field='',quoted=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
      else if(c===best&&!quoted){row.push(field);field='';}
      else if((c==='\r'||c==='\n')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);field='';if(row.some(x=>x.trim()))rows.push([...row]);row.length=0;if(rows.length>MAX_ROWS+2)throw Error('Planilha excede 20 mil linhas.');}
      else field+=c;
    }
    if(quoted)throw Error('CSV com aspas não fechadas.');
    row.push(field);if(row.some(x=>x.trim()))rows.push(row);
    if(rows.length<2)throw Error('Arquivo sem cabeçalho e registros.');
    const headers=rows.shift().map((v,i)=>clampText(v,100)||'Coluna '+(i+1));
    return {sheets:[{name:'CSV',headers,rows}],date1904:false};
  }
  function ensureXml(bytes){const x=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(/<!DOCTYPE|<!ENTITY/i.test(x))throw Error('XML de planilha contém declarações proibidas.');const doc=new DOMParser().parseFromString(x,'application/xml');if(doc.getElementsByTagName('parsererror').length)throw Error('XML de planilha inválido.');return doc;}
  const xmlNodes=(doc,name)=>Array.from(doc.getElementsByTagNameNS('*',name));
  const first=(node,name)=>xmlNodes(node,name)[0]||null;
  const direct=(node,name)=>Array.from(node.children).filter(x=>x.localName===name);
  function lettersToIndex(v){let n=0;for(const x of String(v).match(/^[A-Z]+/)?.[0]||'')n=n*26+x.charCodeAt(0)-64;return n-1;}
  function resolveZipPath(base,target){const url=target.startsWith('/')?new URL(target,'https://zip.invalid/'):new URL(target,`https://zip.invalid/${base}`);const path=url.pathname.replace(/^\//,'');if(url.hostname!=='zip.invalid'||path.includes('..')||!path.startsWith('xl/'))throw Error('Referência de aba inválida.');return path;}
  function openZip(buf){
    const data=new Uint8Array(buf),v=new DataView(buf);let eocd=-1;
    for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--){if(v.getUint32(i,true)===0x06054b50){eocd=i;break;}}
    if(eocd<0)throw Error('Arquivo XLSX não contém estrutura ZIP válida.');
    const total=v.getUint16(eocd+10,true),size=v.getUint32(eocd+12,true),offset=v.getUint32(eocd+16,true);
    if(total>1000||total===65535||offset===0xffffffff||offset+size>buf.byteLength)throw Error('XLSX excede limites de segurança.');
    const entries=new Map();let pos=offset,sum=0;
    for(let i=0;i<total;i++){
      if(pos+46>buf.byteLength||v.getUint32(pos,true)!==0x02014b50)throw Error('Índice ZIP corrompido.');
      const flags=v.getUint16(pos+8,true),method=v.getUint16(pos+10,true),comp=v.getUint32(pos+20,true),raw=v.getUint32(pos+24,true),nl=v.getUint16(pos+28,true),ex=v.getUint16(pos+30,true),comment=v.getUint16(pos+32,true),local=v.getUint32(pos+42,true);
      if(flags&1||raw===0xffffffff||comp===0xffffffff)throw Error('XLSX compactado não suportado ou protegido por senha.');
      sum+=raw;if(sum>MAX_UNCOMPRESSED_BYTES)throw Error('XLSX descompactado ultrapassa limite de segurança.');
      const name=new TextDecoder('utf-8').decode(data.subarray(pos+46,pos+46+nl));
      if(!name||name.startsWith('/')||name.split('/').includes('..')||entries.has(name))throw Error('Caminho duplicado ou inseguro no XLSX.');
      entries.set(name,{method,comp,raw,local});pos+=46+nl+ex+comment;
      if(pos>buf.byteLength)throw Error('Índice ZIP truncado.');
    }
    async function read(name){
      const entry=entries.get(name);if(!entry)return null;
      if(entry.raw>MAX_XML_BYTES)throw Error('Parte do XLSX é grande demais.');
      let p=entry.local;
      if(p+30>data.length||v.getUint32(p,true)!==0x04034b50)throw Error('Cabeçalho ZIP inválido.');
      p+=30+v.getUint16(p+26,true)+v.getUint16(p+28,true);
      if(p+entry.comp>data.length)throw Error('XLSX truncado.');
      const z=data.subarray(p,p+entry.comp);let output;
      if(entry.method===0)output=new Uint8Array(z);
      else if(entry.method===8){
        if(!('DecompressionStream' in window))throw Error('Seu navegador não suporta Excel local. Atualize o Chrome/Edge ou use CSV.');
        const stream=new Blob([z]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        const reader=stream.getReader(),chunks=[];let count=0;
        try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;
          if(count>entry.raw||count>MAX_XML_BYTES)throw Error('Parte do XLSX descompactada acima do limite.');
          chunks.push(value);
        }}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
        output=new Uint8Array(count);let at=0;for(const chunk of chunks){output.set(chunk,at);at+=chunk.length;}
      }else throw Error('Compressão XLSX não suportada.');
      if(output.length!==entry.raw||output.length>MAX_XML_BYTES)throw Error('Tamanho descompactado divergente.');
      return output;
    }
    return {read};
  }
  async function parseXlsx(buf){
    const zip=openZip(buf),workbook=await zip.read('xl/workbook.xml');if(!workbook)throw Error('Arquivo XLSX sem workbook.xml.');
    const doc=ensureXml(workbook),bookPr=first(doc,'workbookPr');const date1904=bookPr?.getAttribute('date1904')==='1';
    const relsBytes=await zip.read('xl/_rels/workbook.xml.rels'),rels=new Map();
    if(relsBytes){for(const rel of xmlNodes(ensureXml(relsBytes),'Relationship'))rels.set(rel.getAttribute('Id'),rel.getAttribute('Target'));}
    const shared=[];const sharedBytes=await zip.read('xl/sharedStrings.xml');
    if(sharedBytes){const strings=ensureXml(sharedBytes);for(const si of xmlNodes(strings,'si')){const runs=xmlNodes(si,'t');shared.push(runs.map(x=>x.textContent).join(''));if(shared.length>150000)throw Error('Excesso de textos compartilhados no XLSX.');}}
    const sheets=[];
    for(const [index,sh] of xmlNodes(doc,'sheet').entries()){
      if(index>=30)throw Error('Limite de 30 abas excedido.');
      const name=clampText(sh.getAttribute('name'),80)||'Aba '+(index+1),rid=sh.getAttribute('r:id')||sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
      const path=rels.has(rid)?resolveZipPath('xl/workbook.xml',rels.get(rid)):`xl/worksheets/sheet${index+1}.xml`;
      const bytes=await zip.read(path);if(!bytes)continue;
      const sd=first(ensureXml(bytes),'sheetData');if(!sd)continue;
      const rawRows=[];
      for(const row of direct(sd,'row')){
        const values=[];for(const cell of direct(row,'c')){
          const idx=lettersToIndex(cell.getAttribute('r')||'');if(idx<0||idx>200)throw Error('Planilha excede 201 colunas.');
          const type=cell.getAttribute('t');let value='';const v=first(cell,'v');
          if(type==='inlineStr'){value=xmlNodes(cell,'t').map(t=>t.textContent).join('');}
          else if(type==='s'){value=shared[Number(v?.textContent??-1)]??'';}
          else if(type==='b'){value=v?.textContent==='1'?'Sim':'Não';}
          else if(type==='e'){value='';}
          else if(v){value=(v.textContent??'').trim();}
          values[idx]=clampText(value,3000);
        }
        if(values.some(x=>String(x??'').trim()))rawRows.push(values);
        if(rawRows.length>MAX_ROWS+1)throw Error('Aba com mais de 20 mil linhas.');
      }
      if(rawRows.length>1){const head=rawRows.shift().map((x,i)=>clampText(x,100)||'Coluna '+(i+1));sheets.push({name,headers:head,rows:rawRows});}
    }
    if(!sheets.length)throw Error('Nenhuma aba com cabeçalho e registros foi encontrada.');
    return {sheets,date1904};
  }
  function autoMap(headers){const norm=headers.map(cleanName),mapping={};const used=new Set();
    for(const [key] of fields){const possible=aliases[key],found=norm.findIndex((h,i)=>!used.has(i)&&(possible.includes(h)||possible.some(p=>h.startsWith(p+' '))));mapping[key]=found>=0?String(found):'';if(found>=0)used.add(found);}
    return mapping;
  }
  function mappingValues(){const obj={};for(const [key] of fields)obj[key]=$('map-'+key)?.value??'';return obj;}
  function typeFrom(s){const t=cleanName(s);if(!t)return '';
    if(['receita','recebimento','entrada','credito','creditos','credit','r','c','receber','venda','ganho','positivo'].some(x=>t===x||t.startsWith(x+' ')))return 'receita';
    if(['despesa','pagamento','saida','debito','debitos','debit','d','pagar','custo','gasto','negativo'].some(x=>t===x||t.startsWith(x+' ')))return 'despesa';return '';
  }
  function buildCandidate(sheet, opts){
    const m=opts.mapping, idx=k=>m[k]===''?-1:Number(m[k]), get=(row,k)=>idx(k)<0?'':row[idx(k)]??'';
    if(idx('date')<0)throw Error('Mapeie a coluna Data.');
    const separate=idx('revenue')>=0||idx('expense')>=0;
    if(!separate && idx('value')<0)throw Error('Mapeie Valor ou Receitas/Despesas.');
    if(separate && idx('value')>=0)throw Error('Use Valor único OU Receitas/Despesas (não ambos).');
    if(idx('revenue')>=0&&idx('revenue')===idx('expense'))throw Error('Receitas e Despesas não podem ser a mesma coluna.');
    const valid=[], invalid=[];let blank=0,rec=0,exp=0;
    sheet.rows.forEach((row,i)=>{
      if(row.every(x=>String(x??'').trim()==='')){blank++;return;}
      const date=safeDate(get(row,'date'),opts.date1904);const company=clampText(get(row,'company')||opts.company,100);
      let type='',amount=null,reason='';
      if(separate){
        const r=get(row,'revenue'),e=get(row,'expense'),rv=String(r).trim()?safeNumber(r):0,ev=String(e).trim()?safeNumber(e):0;
        if(rv===null||ev===null)reason='Valor inválido';
        else if(rv!==0&&ev!==0)reason='Receita e despesa na mesma linha';
        else if(rv!==0){type='receita';amount=rv;}
        else if(ev!==0){type='despesa';amount=ev;}
        else {blank++;return;}
      }else{
        amount=safeNumber(get(row,'value'));
        if(amount===null||amount===0)reason='Valor vazio ou inválido';
        type=idx('type')>=0?typeFrom(get(row,'type')):'';
        if(!type && !opts.defaultType && idx('type')<0 && amount<0){type='despesa';amount=Math.abs(amount);}
        if(!type)type=opts.defaultType||'';
        if(!type)reason=reason||'Tipo não reconhecido';
      }
      if(amount!==null&&amount<0){amount=Math.abs(amount);}if(amount!==null&&Math.abs(amount*100-Math.round(amount*100))>0.000001)reason=reason||'Valor com mais de duas casas decimais';if(amount!==null)amount=Math.round(amount*100)/100;if(!date)reason=reason||'Data inválida';if(!company)reason=reason||'Empresa não identificada';
      if(reason){invalid.push({line:i+2,reason});return;}
      const category=clampText(get(row,'category'),80)||'Sem categoria';
      valid.push({date,company,type,amount,category,description:clampText(get(row,'description'),240)});
      if(type==='receita')rec+=amount;else exp+=amount;
    });
    return {valid,invalid,blank,revenue:rec,expense:exp};
  }
  function populateMapping(){const sheet=state.current.data.sheets[Number($('sheet-select').value)||0];const map=autoMap(sheet.headers);$('mapping').replaceChildren();
    for(const [key,label] of fields){const wrap=document.createElement('label');wrap.textContent=label;const select=document.createElement('select');select.id='map-'+key;
      const opt=document.createElement('option');opt.value='';opt.textContent='— Não utilizar —';select.appendChild(opt);
      sheet.headers.forEach((header,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=(i+1)+'. '+header;select.appendChild(o);});select.value=map[key];select.addEventListener('change',updatePreview);wrap.appendChild(select);$('mapping').appendChild(wrap);
    }updatePreview();
  }
  function updatePreview(){if(!state.current)return;const sheet=state.current.data.sheets[Number($('sheet-select').value)||0];let preview;
    try{preview=buildCandidate(sheet,{mapping:mappingValues(),company:$('default-company').value,date1904:state.current.data.date1904,defaultType:$('default-type').value});}
    catch(e){state.preview=null;$('preview-result').textContent=e.message;$('preview-rows').replaceChildren();$('commit-import').disabled=true;$('skip-wrap').hidden=true;return;}
    state.preview=preview;const errors=preview.invalid.slice(0,6).map(x=>'Linha '+x.line+': '+x.reason).join(' · ');
    $('preview-result').replaceChildren();const normal=document.createElement('div');normal.textContent=`${preview.valid.length} válidos · ${preview.invalid.length} inválidos · ${preview.blank} vazios | Receitas: ${fmtMoney(preview.revenue)} · Despesas: ${fmtMoney(preview.expense)}`;$('preview-result').append(normal);
    if(errors){const detail=document.createElement('div');detail.className='error';detail.textContent=errors+(preview.invalid.length>6?' …':'');$('preview-result').append(detail);}
    const tbody=$('preview-rows');tbody.replaceChildren();
    for(const r of preview.valid.slice(0,5)){const tr=document.createElement('tr');for(const value of [formatDate(r.date),r.company,r.type,r.category,fmtMoney(r.amount)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}tbody.appendChild(tr);}
    $('skip-wrap').hidden=!preview.invalid.length;if(!preview.invalid.length)$('skip-invalid').checked=false;
    $('commit-import').disabled=!preview.valid.length||(preview.invalid.length>0&&!$('skip-invalid').checked);
  }
  function modal(open){$('import-modal').hidden=!open;if(!open){$('file-input').value='';$('import-steps').hidden=true;state.current=null;state.preview=null;}else $('file-input').focus();}
  async function checksum(file){if(window.crypto?.subtle){const h=new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()));return Array.from(h,x=>x.toString(16).padStart(2,'0')).join('');}return file.name+':'+file.size+':'+file.lastModified;}
  async function onFile(){const file=$('file-input').files[0];if(!file)return;
    $('import-steps').hidden=true;$('loading').hidden=false;state.current=null;
    try{
      if(file.size>MAX_FILE_BYTES)throw Error('Arquivo maior que 10 MB.');if(!/\.(xlsx|csv|tsv)$/i.test(file.name))throw Error('Formato não suportado. Use .xlsx, .csv ou .tsv.');
      const hash=await checksum(file);if(state.files.has(hash))throw Error('Este arquivo já foi importado nesta sessão.');
      let data;if(/\.xlsx$/i.test(file.name))data=await parseXlsx(await file.arrayBuffer());
      else{let txt=await file.text();if(txt.includes('\uFFFD'))throw Error('CSV com codificação inválida. Salve como CSV UTF-8.');data=parseCsv(txt);}
      state.current={name:file.name,hash,data};$('sheet-select').replaceChildren();data.sheets.forEach((s,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=s.name+` (${s.rows.length} linhas)`;$('sheet-select').append(o);});
      $('sheet-box').hidden=data.sheets.length<2;$('default-company').value='';$('default-type').value='';$('skip-invalid').checked=false;$('import-steps').hidden=false;populateMapping();
    }catch(e){toast(e.message,true);$('import-steps').hidden=true;}finally{$('loading').hidden=true;}
  }
  function commitImport(){const p=state.preview;if(!p||!p.valid.length||!state.current)return;
    if(p.invalid.length&&!$('skip-invalid').checked)return;
    if(state.demo){if(!confirm('Os dados de exemplo serão substituídos pela planilha real. Continuar?'))return;state.rows=[];state.companies=[];state.files.clear();state.demo=false;}
    for(const row of p.valid){const company=ensureCompany(row.company);row.companyId=company.id;row.id=newId();row.source='import';state.rows.push(row);}
    state.files.add(state.current.hash);const count=p.valid.length;const skipped=p.invalid.length;
    modal(false);resetFilters();render();fillShareFromCompany();autoSave();toast(`${count} lançamentos importados. ${skipped?skipped+' linhas inválidas ignoradas.':'Dados prontos para análise.'}`);
  }
  function allCompanies(){return [...state.companies].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));}
  function ensureCompany(name){let company=state.companies.find(c=>cleanName(c.name)===cleanName(name));if(!company){company={id:newId(),name:clampText(name,100),base:'net',partners:[],active:true};state.companies.push(company);}return company;}
  function rowCompany(row){return state.companies.find(c=>c.id===row.companyId)?.name || row.company || 'Empresa não identificada';}
  function resetFilters(){const companies=allCompanies(),prevComp=$('filter-company').value,prevMonth=$('filter-month').value,prevShare=$('share-company').value;
    $('filter-company').replaceChildren();let o=document.createElement('option');o.value='__all__';o.textContent='Todas as empresas';$('filter-company').append(o);
    $('share-company').replaceChildren();o=document.createElement('option');o.value='';o.textContent='Selecione uma empresa';$('share-company').append(o);
    $('manual-company').replaceChildren();o=document.createElement('option');o.value='';o.textContent='Selecione a empresa';$('manual-company').append(o);
    for(const c of companies){o=document.createElement('option');o.value=c.id;o.textContent=c.name+(c.active?'':' (inativa)');$('filter-company').append(o);$('share-company').append(o.cloneNode(true));if(c.active){$('manual-company').append(o.cloneNode(true));}}
    const monthSet=[...new Set(state.rows.map(x=>x.date.slice(0,7)))].sort().reverse();$('filter-month').replaceChildren();o=document.createElement('option');o.value='__all__';o.textContent='Todos os meses';$('filter-month').append(o);
    for(const mo of monthSet){o=document.createElement('option');o.value=mo;o.textContent=monthsBR[Number(mo.slice(5))-1]+'/'+mo.slice(0,4);$('filter-month').append(o);}
    $('filter-company').value=companies.some(c=>c.id===prevComp)?prevComp:'__all__';$('filter-month').value=monthSet.includes(prevMonth)?prevMonth:'__all__';
    $('share-company').value=companies.some(c=>c.id===prevShare)?prevShare:'';
  }
  function selectedRows(){const c=$('filter-company').value,m=$('filter-month').value;return state.rows.filter(r=>(c==='__all__'||r.companyId===c)&&(m==='__all__'||r.date.startsWith(m)));}
  function totals(rows){let revenue=0,expenses=0,rc=0,ec=0;
    for(const r of rows){if(r.type==='receita'){revenue+=r.amount;rc++;}else{expenses+=r.amount;ec++;}}
    return {revenue,expenses,result:revenue-expenses,rc,ec,margin:revenue?100*(revenue-expenses)/revenue:null};
  }
  function mk(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
  function showEmpty(target,message){target.replaceChildren(mk('div','empty',message));}
  function monthlyChart(rows){const el=$('chart-monthly');el.replaceChildren();if(!rows.length)return showEmpty(el,'Cadastre e registre movimentações para visualizar a evolução.');
    const map=new Map();for(const r of rows){const m=r.date.slice(0,7);if(!map.has(m))map.set(m,{revenue:0,expenses:0});map.get(m)[r.type==='receita'?'revenue':'expenses']+=r.amount;}
    const all=[...map.keys()].sort().slice(-9),max=Math.max(...all.flatMap(k=>[Math.max(0,map.get(k).revenue),Math.max(0,map.get(k).expenses)]),1);
    for(const m of all){const col=mk('div','month-column'),bars=mk('div','month-bars');for(const [key,cls] of [['revenue','rev'],['expenses','exp']]){const v=Math.max(0,map.get(m)[key]);const b=mk('div',cls);b.style.height=Math.max(2,v/max*100)+'%';b.title=(key==='revenue'?'Receitas':'Despesas')+' '+m+': '+fmtMoney(map.get(m)[key]);bars.append(b);}col.append(bars,mk('span','axis-label',monthsBR[Number(m.slice(5))-1]+'/'+m.slice(2,4)));el.append(col);}
  }
  function categoriesChart(rows){const el=$('chart-category');el.replaceChildren();const map=new Map();for(const r of rows.filter(x=>x.type==='despesa'))map.set(r.category,(map.get(r.category)||0)+r.amount);
    const arr=[...map].filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,7);if(!arr.length)return showEmpty(el,'Nenhuma despesa identificada.');const max=arr[0][1];
    for(const [name,v] of arr){const container=mk('div','bar-row'),lab=mk('div','bar-label');lab.append(mk('span','',name),mk('span','',fmtMoney(v)));const track=mk('div','track'),fill=mk('div','fill');fill.style.width=Math.max(1,100*v/max)+'%';track.append(fill);container.append(lab,track);el.append(container);}
  }
  function companyChart(rows){const el=$('chart-companies');el.replaceChildren();const map=new Map();for(const r of rows){const c=rowCompany(r);if(!map.has(c))map.set(c,[]);map.get(c).push(r);}
    const arr=[...map].map(([c,items])=>[c,totals(items).result]).sort((a,b)=>b[1]-a[1]);if(!arr.length)return showEmpty(el,'Nenhuma empresa com dados.');const max=Math.max(1,...arr.map(x=>Math.abs(x[1])));
    for(const [c,v] of arr.slice(0,10)){const container=mk('div','bar-row'),lab=mk('div','bar-label');lab.append(mk('span','',c),mk('span','',fmtMoney(v)));const track=mk('div','track'),fill=mk('div','fill'+(v<0?' loss':''));fill.style.width=Math.max(1,100*Math.abs(v)/max)+'%';track.append(fill);container.append(lab,track);el.append(container);}
  }
  function recentTable(rows){const el=$('transactions');el.replaceChildren();if(!rows.length){const tr=mk('tr'),td=mk('td','empty','Sem lançamentos');td.colSpan=5;tr.append(td);el.append(tr);$('more-transactions').hidden=true;return;}
    const sorted=[...rows].sort((a,b)=>b.date.localeCompare(a.date));$('more-transactions').hidden=sorted.length<=state.visibleRows;
    for(const r of sorted.slice(0,state.visibleRows)){
      const tr=mk('tr');tr.append(mk('td','',formatDate(r.date)),mk('td','',rowCompany(r)));
      const item=mk('td','',r.category),description=mk('span','mini',(r.type==='receita'?'Entrada':'Saída')+(r.description?' · '+r.description:''));item.append(description);tr.append(item,mk('td',r.type==='receita'?'positive':'negative',fmtMoney(r.amount)));
      const actions=mk('td','row-actions');actions.append(mk('span','source-label',r.source==='manual'?'Manual':r.source==='demo'?'Exemplo':'Planilha'));
      if(r.source==='manual'){
        const edit=mk('button','btn subtle mini-action','Editar');edit.type='button';edit.addEventListener('click',()=>editManual(r.id));
        const del=mk('button','btn subtle mini-action','Excluir');del.type='button';del.addEventListener('click',()=>deleteManual(r.id));actions.append(edit,del);
      }
      tr.append(actions);el.append(tr);
    }
  }
  function render(){const rows=selectedRows(),t=totals(rows),available=state.rows.length>0;
    $('kpi-revenue').textContent=fmtMoney(t.revenue);$('kpi-expenses').textContent=fmtMoney(t.expenses);$('kpi-result').textContent=fmtMoney(t.result);
    $('kpi-result').className='amount '+(t.result>=0?'positive':'negative');$('kpi-margin').textContent=t.margin===null?'—':number.format(t.margin)+'%';
    $('kpi-revenue-count').textContent=t.rc+' lançamentos';$('kpi-expense-count').textContent=t.ec+' lançamentos';$('row-total').textContent=rows.length+' registros';
    $('btn-csv').disabled=!rows.length;$('btn-print').disabled=!rows.length;$('clear-data').hidden=!available&&!state.companies.length;
    const notice=$('notice');notice.classList.toggle('demo',state.demo);const strong=notice.querySelector('strong'),description=notice.querySelector('span');
    strong.textContent=state.demo?'Dados fictícios de demonstração':available?'Lançamentos prontos para análise':state.companies.length?'Empresas cadastradas. Faça seu primeiro lançamento.':'Comece cadastrando sua primeira empresa';
    description.textContent=state.demo?'Exemplo fictício: não representa resultados reais.':available?`${state.rows.length} lançamentos · ${allCompanies().length} empresas · planilhas opcionais. Faça cópias de segurança JSON periodicamente.`:'Você pode lançar tudo manualmente ou importar Excel/CSV.';
    monthlyChart(rows);categoriesChart(rows);companyChart(rows);recentTable(rows);renderCompanies();
  }
  function exportCsv(){const rows=selectedRows();if(!rows.length)return;const parts=[['Data','Empresa','Tipo','Categoria','Descricao','Valor'].join(';')];
    for(const r of rows){const line=[r.date,rowCompany(r),r.type,r.category,r.description].map(x=>'"'+String(csvTextSafe(x)).replace(/"/g,'""')+'"');line.push('"'+r.amount.toFixed(2).replace('.',',')+'"');parts.push(line.join(';'));}
    const blob=new Blob(['\ufeff'+parts.join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=mk('a');a.href=url;a.download='gestao-parcerias-bi-relatorio.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function simulate(){try{const c=$('share-company').value;if(!c)throw Error('Selecione uma empresa para simular.');
    const month=$('filter-month').value,rows=state.rows.filter(x=>x.companyId===c&&(month==='__all__'||x.date.startsWith(month)));
    const t=totals(rows),basis=$('share-base').value,base=basis==='gross'?Math.max(0,t.revenue):Math.max(0,t.result);
    const partners=parseShareText();if(!partners.length)throw Error('Informe ao menos um sócio e sua porcentagem.');
    const el=$('share-output');el.replaceChildren(mk('div','muted','Base simulada: '+(basis==='gross'?'Receita bruta':'Saldo positivo')),mk('div','summary-amount',fmtMoney(base)));
    let totalCents=0;const baseCents=Math.round(base*100);
    for(const {name,percent} of partners){const container=mk('div','bar-row'),label=mk('div','bar-label'),cents=Math.round(baseCents*percent/100);totalCents+=cents;
      label.append(mk('span','',name+' · '+number.format(percent)+'%'),mk('span','',fmtMoney(cents/100)));
      const track=mk('div','track'),fill=mk('div','fill');fill.style.width=percent+'%';track.append(fill);container.append(label,track);el.append(container);}
    el.append(mk('p','footnote',`Total para sócios: ${fmtMoney(totalCents/100)} · Saldo não distribuído: ${fmtMoney((baseCents-totalCents)/100)}. Simulação não constitui pagamento, fechamento ou alteração retroativa.`));
    }catch(err){toast(err.message,true);}
  }
  function demo(){if(state.rows.length&&!state.demo&&!confirm('Substituir os dados em memória pelo exemplo fictício?'))return;
    state.files.clear();state.rows=[];state.companies=[];state.demo=true;const companies=['Parceria Alfa','Parceria Beta','Parceria Gama'];
    for(let mi=4;mi<=9;mi++){const date=`2026-${String(mi).padStart(2,'0')}-15`;companies.forEach((company,ci)=>{
      const comp=ensureCompany(company);if(!comp.partners.length)comp.partners=[{id:newId(),name:'Sócio A',percent:60},{id:newId(),name:'Sócio B',percent:40}];
      const r=23000+mi*1330+ci*7000;const expenses=[['Operação',.32],['Infraestrutura',.18],['Administrativo',.12],['Tributos',.07]];
      state.rows.push({id:newId(),source:'demo',companyId:comp.id,date,company,type:'receita',amount:r,category:'Serviços',description:'Exemplo fictício'});
      expenses.forEach(([category,p])=>state.rows.push({id:newId(),source:'demo',companyId:comp.id,date,company,type:'despesa',amount:Math.round(r*p*100)/100,category,description:'Exemplo fictício'}));
    });}
    resetFilters();render();fillShareFromCompany();autoSave();toast('Exemplo fictício carregado. Nenhum dado real foi usado.');
  }
  // Dados persistem no navegador, sujeitos à limpeza de armazenamento; mantenha backups JSON.
  let editingCompanyId=null,editingRowId=null,pendingManualAfterCompany=false;
  function renderCompanies(){
    const target=$('company-list');target.replaceChildren();const companies=allCompanies();
    if(!companies.length)return showEmpty(target,'Nenhuma empresa cadastrada. Use o botão “Cadastrar empresa”.');
    for(const company of companies){
      const card=mk('article','company-card');if(!company.active)card.classList.add('archived');
      const heading=mk('div','company-card-header');const name=mk('strong','',company.name),tag=mk('span','chip',company.active?'Ativa':'Inativa');heading.append(name,tag);
      const count=state.rows.filter(r=>r.companyId===company.id).length;
      const info=mk('p','',`${company.partners.length} sócio(s) · ${count} lançamento(s) · Base: ${company.base==='gross'?'bruta':'líquida'}`);
      const shares=mk('div','company-shares');if(!company.partners.length)shares.append(mk('span','share-empty','Nenhum sócio cadastrado.'));
      else for(const partner of company.partners){const chip=mk('span','partner-chip',`${partner.name}: ${number.format(partner.percent)}%`);shares.append(chip);}
      const actions=mk('div','company-actions'),edit=mk('button','btn subtle','Editar cadastro');edit.type='button';edit.addEventListener('click',()=>openCompany(company.id));
      const toggle=mk('button','btn subtle',company.active?'Desativar':'Reativar');toggle.type='button';toggle.addEventListener('click',()=>toggleCompany(company.id));
      actions.append(edit,toggle);card.append(heading,info,shares,actions);target.append(card);
    }
  }
  function toggleCompany(companyId){const c=state.companies.find(c=>c.id===companyId);if(!c)return;
    if(!confirm(`${c.active?'Desativar':'Reativar'} ${c.name}? Lançamentos anteriores permanecerão visíveis no histórico.`))return;
    c.active=!c.active;resetFilters();render();fillShareFromCompany();autoSave();toast('Cadastro atualizado neste navegador. Salve uma cópia de segurança.');
  }
  function partnerRow(partner={id:newId(),name:'',percent:0}){
    const el=mk('div','partner-edit-row');el.dataset.id=partner.id;
    const nameLabel=mk('label','','Nome do sócio');const name=mk('input');name.type='text';name.maxLength=80;name.placeholder='Nome';name.value=partner.name;name.dataset.field='name';nameLabel.append(name);
    const percentLabel=mk('label','','Participação (%)');const percent=mk('input');percent.type='number';percent.inputMode='decimal';percent.min='0';percent.max='100';percent.step='0.01';percent.value=String(partner.percent);percent.dataset.field='percent';percentLabel.append(percent);
    const range=mk('input','partner-range');range.type='range';range.min='0';range.max='100';range.step='0.5';range.value=String(partner.percent);range.setAttribute('aria-label','Porcentagem de '+(partner.name||'sócio'));
    const remove=mk('button','btn subtle partner-remove','Remover');remove.type='button';remove.addEventListener('click',()=>{el.remove();updatePartnerTotal();});
    percent.addEventListener('input',()=>{let v=Number(percent.value);if(Number.isFinite(v)&&v>=0&&v<=100)range.value=String(v);updatePartnerTotal();});
    range.addEventListener('input',()=>{percent.value=range.value;updatePartnerTotal();});name.addEventListener('input',()=>range.setAttribute('aria-label','Porcentagem de '+name.value));
    el.append(nameLabel,percentLabel,range,remove);return el;
  }
  function updatePartnerTotal(){let sum=0;let bad=false;for(const row of $('partners-editor').children){const n=Number(row.querySelector('[data-field="percent"]').value);if(!Number.isFinite(n)||n<0||n>100){bad=true;continue;}sum+=n;}
    const el=$('partner-total');el.textContent=`Sócios: ${number.format(sum)}% · Empresa: ${number.format(Math.max(0,100-sum))}%`+(bad||sum>100.000001?' — Confira os percentuais':'');el.classList.toggle('invalid',bad||sum>100.000001);
  }
  function readPartnerEditor(){const rows=[...$('partners-editor').children];if(rows.length>30)throw Error('Limite de 30 sócios por empresa.');
    const out=[],seen=new Set();let sum=0;
    for(const el of rows){const name=clampText(el.querySelector('[data-field="name"]').value,80),raw=el.querySelector('[data-field="percent"]').value.trim().replace(',','.');const percent=Number(raw);
      if(!name||!raw||!/^\d+(?:\.\d{1,2})?$/.test(raw)||!Number.isFinite(percent)||percent<=0||percent>100)throw Error('Preencha nome e percentual válido, maior que 0 e até 100, para cada sócio.');
      if(seen.has(cleanName(name)))throw Error('Há sócios com nomes repetidos.');seen.add(cleanName(name));sum+=percent;out.push({id:el.dataset.id||newId(),name,percent});
    }
    if(sum>100.000001)throw Error('A soma das participações não pode ultrapassar 100%.');return out;
  }
  function openCompany(id=null){editingCompanyId=id;const c=state.companies.find(c=>c.id===id);$('company-title').textContent=c?'Editar empresa e sócios':'Cadastrar empresa';
    $('company-name').value=c?.name||'';$('company-base').value=c?.base||'net';$('partners-editor').replaceChildren();
    for(const partner of c?.partners||[])$('partners-editor').append(partnerRow(partner));updatePartnerTotal();$('company-modal').hidden=false;$('company-name').focus();
  }
  function closeCompany(){$('company-modal').hidden=true;editingCompanyId=null;}
  function submitCompany(e){e.preventDefault();
    try{const name=clampText($('company-name').value,100);if(name.length<2)throw Error('Informe o nome da empresa (ao menos 2 caracteres).');
      if(state.companies.some(c=>cleanName(c.name)===cleanName(name)&&c.id!==editingCompanyId))throw Error('Já existe uma empresa com esse nome.');
      const partners=readPartnerEditor();if(state.demo){throw Error('Saia da demonstração: limpe os dados de exemplo antes de cadastrar empresas reais.');}
      let c=state.companies.find(x=>x.id===editingCompanyId);if(c){c.name=name;c.base=$('company-base').value;c.partners=partners;}
      else{c={id:newId(),name,base:$('company-base').value,partners,active:true};state.companies.push(c);}
      const openEntry=pendingManualAfterCompany;pendingManualAfterCompany=false;closeCompany();resetFilters();render();fillShareFromCompany();autoSave();toast('Empresa salva neste navegador. Não esqueça de baixar uma cópia.');if(openEntry)openManual();
    }catch(err){toast(err.message,true);}
  }
  function fillShareFromCompany(){const c=state.companies.find(x=>x.id===$('share-company').value);
    $('share-base').value=c?.base||'net';$('share-partners').value=(c?.partners||[]).map(x=>x.name+';'+String(x.percent).replace('.',',')).join('\n');
    showEmpty($('share-output'),c?'Clique em “Calcular divisão simulada” para ver os valores.':'Selecione uma empresa para simular.');
  }
  function parseShareText(){const text=$('share-partners').value.trim();if(!text)return [];
    const partners=[],seen=new Set();let sum=0;
    for(const [i,raw] of text.split(/\n/).entries()){
      if(!raw.trim())continue;const parts=raw.split(';');if(parts.length!==2)throw Error(`Linha ${i+1}: use Nome;40.`);
      const name=clampText(parts[0],80),pct=parts[1].trim().replace(',','.');
      if(!name||!/^\d+(?:\.\d{1,2})?$/.test(pct))throw Error(`Linha ${i+1}: informe nome e percentual válido.`);
      const percent=Number(pct);if(percent<=0||percent>100||seen.has(cleanName(name)))throw Error(`Linha ${i+1}: confira nome único e percentual entre 0 e 100.`);
      seen.add(cleanName(name));sum+=percent;partners.push({name,percent});
    }
    if(partners.length>30||sum>100.000001)throw Error('Limite: 30 sócios e soma de até 100%.');return partners;
  }
  function saveShare(){try{const c=state.companies.find(x=>x.id===$('share-company').value);if(!c)throw Error('Selecione uma empresa.');if(!c.active)throw Error('Reative a empresa antes de alterar suas regras.');
      if(state.demo)throw Error('Não altere o cadastro fictício. Limpe o exemplo para cadastrar empresas reais.');
      const parsed=parseShareText();if(!confirm(`Salvar regras de ${c.name}? Novas simulações usarão esses valores; esta prévia não altera fechamentos oficiais.`))return;
      c.base=$('share-base').value;c.partners=parsed.map(p=>({...p,id:c.partners.find(old=>cleanName(old.name)===cleanName(p.name))?.id||newId()}));
      render();simulate();autoSave();toast('Porcentagens salvas neste navegador. Baixe uma cópia de segurança.');
    }catch(err){toast(err.message,true);}
  }
  function todayIso(){const d=new Date();const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);return local.toISOString().slice(0,10);}
  function openManual(id=null){const row=state.rows.find(x=>x.id===id&&x.source==='manual');if(state.demo)return toast('Limpe a demonstração antes de lançar valores reais.',true);
    const active=state.companies.filter(x=>x.active);if(!active.length){toast('Primeiro cadastre uma empresa ativa.',true);pendingManualAfterCompany=true;openCompany();return;}
    editingRowId=row?.id||null;$('manual-title').textContent=row?'Editar lançamento manual':'Novo lançamento';resetFilters();
    if(row){$('manual-date').value=row.date;$('manual-company').value=row.companyId;$('manual-type').value=row.type;$('manual-amount').value=String(row.amount).replace('.',',');$('manual-category').value=row.category;$('manual-description').value=row.description;}
    else{$('manual-form').reset();$('manual-date').value=todayIso();$('manual-company').value=active[0].id;$('manual-type').value='receita';}
    $('manual-summary').textContent='Confira todos os dados antes de salvar.';$('manual-modal').hidden=false;$('manual-date').focus();
  }
  function closeManual(){$('manual-modal').hidden=true;editingRowId=null;}
  function checkManual(){const date=safeDate($('manual-date').value),company=state.companies.find(x=>x.id===$('manual-company').value&&x.active),type=$('manual-type').value;
    const raw=$('manual-amount').value.trim().replace(/^R\$\s*/, '');
    if(!(/^(?:\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?|\d+\.\d{1,2})$/.test(raw)))throw Error('Valor inválido. Use por exemplo 1.250,50 ou 1250,50.');
    const amount=safeNumber(raw);const category=clampText($('manual-category').value,80),description=clampText($('manual-description').value,240);
    if(!date)throw Error('Informe uma data válida.');if(!company)throw Error('Selecione uma empresa ativa.');if(type!=='receita'&&type!=='despesa')throw Error('Selecione entrada ou saída.');
    if(amount===null||amount<=0||Math.round(amount*100)/100<=0||Math.abs(amount-Math.round(amount*100)/100)>0.000001)throw Error('Valor deve ser maior que zero, com no máximo duas casas decimais.');
    if(!category)throw Error('Informe a categoria.');return {date,companyId:company.id,company:company.name,type,amount,category,description};
  }
  function updateManualSummary(){try{const row=checkManual(),c=row.type==='receita'?'Entrada':'Saída';$('manual-summary').textContent=`${c} de ${fmtMoney(row.amount)} para ${row.company} em ${formatDate(row.date)} · ${row.category}`;}
    catch(_){$('manual-summary').textContent='Complete os campos obrigatórios para conferir o lançamento.';}
  }
  function submitManual(e){e.preventDefault();try{const row=checkManual();const previous=state.rows.find(x=>x.id===editingRowId);
      if(!confirm(`${previous?'Alterar':'Registrar'} ${row.type==='receita'?'ENTRADA':'SAÍDA'} de ${fmtMoney(row.amount)} em ${row.company} (${formatDate(row.date)})?`))return;
      const duplicate=state.rows.find(r=>r.id!==editingRowId&&r.companyId===row.companyId&&r.date===row.date&&r.type===row.type&&r.amount===row.amount&&cleanName(r.category)===cleanName(row.category)&&cleanName(r.description)===cleanName(row.description));
      if(duplicate&&!confirm('Existe um lançamento idêntico. Deseja registrar mesmo assim?'))return;
      if(previous){Object.assign(previous,row);}else state.rows.push({...row,id:newId(),source:'manual'});
      closeManual();resetFilters();render();autoSave();toast('Lançamento '+(previous?'atualizado':'registrado')+' nesta sessão. Salve uma cópia.');
    }catch(err){toast(err.message,true);}
  }
  function editManual(id){openManual(id);}
  function deleteManual(id){const row=state.rows.find(r=>r.id===id&&r.source==='manual');if(!row)return;
    if(!confirm(`Excluir o lançamento de ${fmtMoney(row.amount)} (${formatDate(row.date)})? Esta operação não poderá ser desfeita sem uma cópia de segurança.`))return;
    state.rows=state.rows.filter(r=>r.id!==id);resetFilters();render();autoSave();toast('Lançamento excluído do navegador.');
  }
  const BACKUP_VERSION=2;
  // O BI é local-first: dados financeiros não são enviados a servidores.
  // IndexedDB preserva este navegador, mas não substitui um backup externo.
  const DEVICE_DB='lacrose-gpar-local-2026-v1';
  let deviceDb=null,deviceReady=false,saveInFlight=0,lastStorageError='';
  function storageMessage(message,bad=false){
    const el=$('storage-status');if(!el)return;el.textContent=message;el.dataset.status=bad?'error':'ok';
  }
  function storageSnapshot(){
    return {format:'Lacrose GP BI backup',version:BACKUP_VERSION,exportedAt:new Date().toISOString(),companies:state.companies,rows:state.rows,importedHashes:[...state.files],demo:state.demo};
  }
  function openDeviceDB(){return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window))return reject(Error('Este navegador não oferece IndexedDB.'));
    const req=indexedDB.open(DEVICE_DB,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('dados'))req.result.createObjectStore('dados');};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||Error('Não foi possível abrir o armazenamento local.'));
    req.onblocked=()=>reject(Error('Armazenamento bloqueado por outra aba.'));
  });}
  function autoSave(){
    if(!deviceReady)return;
    if(lastStorageError){storageMessage('⚠ Há uma falha de armazenamento. Use “Salvar cópia” e restaure uma cópia válida.',true);return;}
    if(!deviceDb){storageMessage('⚠ Salvamento automático indisponível. Use “Salvar cópia” após cada alteração.',true);return;}
    try{
      const tx=deviceDb.transaction('dados','readwrite');saveInFlight++;storageMessage('Salvando neste dispositivo...');
      tx.objectStore('dados').put(storageSnapshot(),'atual');
      let done=false;
      const complete=(failed)=>{
        if(done)return;done=true;saveInFlight=Math.max(0,saveInFlight-1);
        if(failed){lastStorageError='Não foi possível gravar os dados no navegador.';storageMessage('⚠ Falha ao salvar! Baixe uma cópia JSON agora.',true);toast(lastStorageError,true);}
        else if(saveInFlight===0&&!lastStorageError)storageMessage('✓ Salvo neste navegador · faça cópias JSON periódicas.');
      };
      tx.oncomplete=()=>complete(false);tx.onerror=()=>complete(true);tx.onabort=()=>complete(true);
    }catch(_){lastStorageError='Falha no armazenamento local';storageMessage('⚠ Salvamento indisponível. Baixe uma cópia JSON agora.',true);toast(lastStorageError,true);}
  }
  async function restoreDeviceData(){
    document.body.dataset.loading='true';
    storageMessage('Abrindo os dados salvos neste dispositivo...');
    try{
      deviceDb=await openDeviceDB();
      deviceDb.onversionchange=()=>{deviceDb.close();deviceDb=null;lastStorageError='Versão alterada em outra aba';storageMessage('⚠ Armazenamento atualizado em outra aba. Recarregue esta página.',true);};
      const existing=await new Promise((resolve,reject)=>{
        const request=deviceDb.transaction('dados','readonly').objectStore('dados').get('atual');
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error||Error('Falha ao ler os dados locais.'));
      });
      if(existing){const saved=validateBackup(existing);state.companies=saved.companies;state.rows=saved.rows;state.files=saved.files;state.demo=saved.demo;state.visibleRows=30;}
      storageMessage(existing?'✓ Seus dados anteriores foram restaurados deste navegador.':'✓ Armazenamento local pronto. Faça uma cópia JSON periodicamente.');
    }catch(e){lastStorageError=e?.message||'Falha no armazenamento';storageMessage('⚠ Os dados anteriores não puderam ser carregados. Restaure uma cópia JSON.',true);}
    finally{deviceReady=true;resetFilters();render();fillShareFromCompany();document.body.dataset.loading='false';}
  }
  window.addEventListener('beforeunload',e=>{
    if(saveInFlight>0 || lastStorageError && (state.rows.length||state.companies.length)){e.preventDefault();e.returnValue='';}
  });

  function exportBackup(){const data={format:'Lacrose GP BI backup',version:BACKUP_VERSION,exportedAt:new Date().toISOString(),companies:state.companies,rows:state.rows,importedHashes:[...state.files],demo:state.demo};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=mk('a');a.href=url;a.download='gestao-parcerias-copia-'+todayIso()+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);toast('Cópia baixada. Guarde o arquivo em local seguro.');
  }
  function validateBackup(data){if(!data||data.format!=='Lacrose GP BI backup'||data.version!==BACKUP_VERSION||!Array.isArray(data.companies)||!Array.isArray(data.rows)||!Array.isArray(data.importedHashes))throw Error('Arquivo de cópia incompatível com esta versão.');
    if(data.companies.length>500||data.rows.length>100000||data.importedHashes.length>2000)throw Error('Cópia excede os limites de segurança.');
    const companyIds=new Set(),names=new Set(),companies=[];
    for(const c of data.companies){if(!c||typeof c.id!=='string'||c.id.length>100||!c.id||typeof c.name!=='string'||!c.name.trim()||c.name.length>100||!['gross','net'].includes(c.base)||typeof c.active!=='boolean'||!Array.isArray(c.partners)||c.partners.length>30||companyIds.has(c.id)||names.has(cleanName(c.name)))throw Error('Empresa inválida ou duplicada na cópia.');
      companyIds.add(c.id);names.add(cleanName(c.name));const partners=[],pnames=new Set();let sum=0;
      for(const partner of c.partners){if(!partner||typeof partner.id!=='string'||!partner.id||partner.id.length>100||typeof partner.name!=='string'||!partner.name.trim()||partner.name.length>80||!Number.isFinite(partner.percent)||partner.percent<=0||partner.percent>100||pnames.has(cleanName(partner.name)))throw Error('Sócio inválido na cópia.');pnames.add(cleanName(partner.name));sum+=partner.percent;partners.push({id:partner.id,name:clampText(partner.name,80),percent:partner.percent});}
      if(sum>100.000001)throw Error('Percentuais da cópia ultrapassam 100%.');companies.push({id:c.id,name:clampText(c.name,100),base:c.base,active:c.active,partners});
    }
    const rows=[],rowIds=new Set();for(const r of data.rows){if(!r||typeof r.id!=='string'||!r.id||r.id.length>100||rowIds.has(r.id)||!companyIds.has(r.companyId)||!safeDate(r.date)||!['receita','despesa'].includes(r.type)||!Number.isFinite(r.amount)||r.amount<=0||r.amount>1e12||!['manual','import','demo'].includes(r.source)||typeof r.category!=='string'||r.category.length>80||typeof r.description!=='string'||r.description.length>240)throw Error('A cópia contém lançamentos inválidos.');
      rowIds.add(r.id);rows.push({id:r.id,companyId:r.companyId,company:companies.find(c=>c.id===r.companyId).name,source:r.source,date:r.date,type:r.type,amount:r.amount,category:clampText(r.category,80),description:clampText(r.description,240)});
    }
    return {companies,rows,files:new Set(data.importedHashes.filter(x=>typeof x==='string'&&x.length<300)),demo:data.demo===true};
  }
  async function importBackup(e){const file=e.target.files?.[0];e.target.value='';if(!file)return;
    try{if(file.size>15*1024*1024)throw Error('Cópia maior que 15 MB.');const validated=validateBackup(JSON.parse(await file.text()));
      if(!confirm(`Restaurar ${validated.companies.length} empresa(s) e ${validated.rows.length} lançamento(s)? Todos os dados atuais desta sessão serão substituídos.`))return;
      state.companies=validated.companies;state.rows=validated.rows;state.files=validated.files;state.demo=validated.demo;state.visibleRows=30;resetFilters();render();fillShareFromCompany();lastStorageError='';autoSave();toast('Cópia restaurada neste navegador.');
    }catch(err){toast('Não foi possível restaurar: '+err.message,true);}
  }
  function bindManagement(){
    $('new-company').addEventListener('click',()=>openCompany());$('close-company').addEventListener('click',()=>{pendingManualAfterCompany=false;closeCompany();});$('cancel-company').addEventListener('click',()=>{pendingManualAfterCompany=false;closeCompany();});
    $('company-form').addEventListener('submit',submitCompany);$('add-partner').addEventListener('click',()=>{if($('partners-editor').children.length>=30)return toast('Máximo de 30 sócios.',true);$('partners-editor').append(partnerRow());updatePartnerTotal();});
    $('company-modal').addEventListener('click',e=>{if(e.target===$('company-modal')){pendingManualAfterCompany=false;closeCompany();}});
    $('close-manual').addEventListener('click',closeManual);$('cancel-manual').addEventListener('click',closeManual);$('manual-form').addEventListener('submit',submitManual);
    $('manual-modal').addEventListener('click',e=>{if(e.target===$('manual-modal'))closeManual();});
    for(const id of ['manual-date','manual-company','manual-type','manual-amount','manual-category','manual-description']){$(id).addEventListener('input',updateManualSummary);$(id).addEventListener('change',updateManualSummary);}
    $('more-transactions').addEventListener('click',()=>{state.visibleRows+=30;recentTable(selectedRows());});
    $('backup-download').addEventListener('click',exportBackup);$('backup-file').addEventListener('change',importBackup);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('company-modal').hidden){pendingManualAfterCompany=false;closeCompany();}if(!$('manual-modal').hidden)closeManual();}});
  }
  // White label local somente para aparência. O crédito Lacrose Tecnologia é estático e não tem opção de edição.
  const BRAND_KEY='lacrosetecnologia_gestao_parcerias_bi_mvp_visual_v1';
  const BRAND_DEFAULT={name:'Gestão de Parcerias',subtitle:'Seu painel financeiro',theme:'ocean',logo:null};
  const BRAND_THEMES=new Set(['ocean','emerald','plum','graphite']);
  let brandSettings={...BRAND_DEFAULT},pendingBrandLogo=null;
  const validLogoUrl=s=>typeof s==='string'&&s.length<300000&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s);
  function sanitizeSettings(value){
    const input=value&&typeof value==='object'?value:{};
    return {name:clampText(input.name||BRAND_DEFAULT.name,56)||BRAND_DEFAULT.name,
      subtitle:clampText(input.subtitle||BRAND_DEFAULT.subtitle,70)||BRAND_DEFAULT.subtitle,
      theme:BRAND_THEMES.has(input.theme)?input.theme:'ocean',
      logo:validLogoUrl(input.logo)?input.logo:null};
  }
  try{const old=localStorage.getItem(BRAND_KEY);if(old)brandSettings=sanitizeSettings(JSON.parse(old));}catch(_){/* navegação privada ou armazenamento indisponível */}
  function logoIn(target,url,name){
    target.replaceChildren();
    if(url&&validLogoUrl(url)){const img=document.createElement('img');img.alt='Logotipo da empresa';img.src=url;target.append(img);}
    else{const parts=String(name||'Gestão de Parcerias').trim().split(/\s+/).filter(Boolean);target.textContent=(parts.length>=2?parts[0][0]+parts[1][0]:parts[0]?.slice(0,2)||'GP').toUpperCase();}
  }
  function showBrand(){
    document.body.dataset.theme=brandSettings.theme;
    $('client-name-side').textContent=brandSettings.name;
    $('client-subtitle-side').textContent=brandSettings.subtitle;
    $('client-label-top').textContent=brandSettings.name.toLocaleUpperCase('pt-BR');
    document.title=brandSettings.name+' — Painel financeiro';
    logoIn($('brand-mark'),brandSettings.logo,brandSettings.name);
  }
  function refreshBrandPreview(){
    const name=clampText($('brand-name').value,56)||BRAND_DEFAULT.name;
    $('brand-preview-name').textContent=name;
    $('brand-preview-subtitle').textContent=clampText($('brand-subtitle').value,70)||BRAND_DEFAULT.subtitle;
    logoIn($('brand-logo-preview'),pendingBrandLogo,name);
  }
  function editBrand(open){
    $('brand-modal').hidden=!open;
    if(open){
      pendingBrandLogo=brandSettings.logo;
      $('brand-name').value=brandSettings.name;$('brand-subtitle').value=brandSettings.subtitle;
      $('brand-theme').value=brandSettings.theme;$('brand-logo').value='';refreshBrandPreview();
      $('brand-name').focus();
    }else pendingBrandLogo=null;
  }
  function saveBrand(){
    const next=sanitizeSettings({name:$('brand-name').value,subtitle:$('brand-subtitle').value,theme:$('brand-theme').value,logo:pendingBrandLogo});
    try{localStorage.setItem(BRAND_KEY,JSON.stringify(next));}
    catch(_){return toast('Não foi possível salvar a identidade neste navegador. Verifique o espaço e as permissões de armazenamento.',true);}
    brandSettings=next;showBrand();editBrand(false);toast('Identidade visual salva neste navegador. A assinatura Lacrose Tecnologia foi preservada.');
  }
  async function readBrandLogo(){
    const file=$('brand-logo').files?.[0];if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>200*1024||file.size<12){toast('Selecione PNG, JPG ou WebP de até 200 KB.',true);$('brand-logo').value='';return;}
    try{
      const bytes=new Uint8Array(await file.arrayBuffer());
      const type=file.type;const isPng=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
      const isJpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
      const isWebp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
      if(!((type==='image/png'&&isPng)||(type==='image/jpeg'&&isJpeg)||(type==='image/webp'&&isWebp)))throw Error('Assinatura da imagem inválida.');
      const blob=new Blob([bytes],{type});
      const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Falha ao ler logomarca.'));reader.readAsDataURL(blob);});
      if(!validLogoUrl(dataUrl))throw Error('Formato da logomarca não suportado.');
      await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{if(img.naturalWidth>4000||img.naturalHeight>4000||!img.naturalWidth||!img.naturalHeight)reject(Error('Logomarca tem dimensões fora do limite.'));else resolve();};img.onerror=()=>reject(Error('Imagem inválida ou corrompida.'));img.src=dataUrl;});
      pendingBrandLogo=dataUrl;refreshBrandPreview();
    }catch(e){toast(e.message,true);$('brand-logo').value='';}
  }
  // Relatórios v1.3. Documento gerado localmente: nenhum dado é enviado para servidores.
  const REPORT_MAX_ROWS=5000;
  const REPORT_TYPES={summary:'Resumo financeiro',transactions:'Movimentações detalhadas',partners:'Divisão dos sócios — simulação'};
  const pdfWinAnsi={8364:128,8218:130,402:131,8222:132,8230:133,8224:134,8225:135,710:136,8240:137,352:138,8249:139,338:140,381:142,8216:145,8217:146,8220:147,8221:148,8226:149,8211:150,8212:151,732:152,8482:153,353:154,8250:155,339:156,382:158,376:159};
  function pdfEncoded(value){
    let out='';for(const c of String(value??'')){const n=c.codePointAt(0);out+=String.fromCharCode(n>=32&&n<=126||n>=160&&n<=255?n:(pdfWinAnsi[n]||63));}
    return out;
  }
  function pdfString(value){return '('+pdfEncoded(value).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')+')';}
  function currentLogoForPdf(){
    // Se existir uma logomarca white-label carregada, inclua-a no PDF sem upload.
    try{
      if(typeof document==='undefined')return null;
      const img=document.querySelector('#brand-mark img');if(!img?.complete||!img.naturalWidth||!img.naturalHeight)return null;
      const canvas=document.createElement('canvas');canvas.width=canvas.height=96;
      const ctx=canvas.getContext('2d');if(!ctx)return null;
      ctx.fillStyle='#fff';ctx.fillRect(0,0,96,96);
      const scale=Math.min(96/img.naturalWidth,96/img.naturalHeight),w=Math.round(img.naturalWidth*scale),h=Math.round(img.naturalHeight*scale);
      ctx.drawImage(img,Math.round((96-w)/2),Math.round((96-h)/2),w,h);
      return {bytes:atob(canvas.toDataURL('image/jpeg',.84).split(',')[1]),width:96,height:96};
    }catch(_){return null;}
  }
  class PdfDocument{
    constructor(title,details){this.pages=[];this.page=null;this.y=0;this.title=title;this.details=details;this.logo=currentLogoForPdf();this.addPage();}
    color(hex){const h=hex.replace('#','');return [0,2,4].map(i=>(parseInt(h.slice(i,i+2),16)/255).toFixed(3)).join(' ');}
    text(value,x,y,size=10,bold=false,color='#172d43'){
      const s=Math.min(18,Math.max(7,size));
      this.page.push(`BT /${bold?'F2':'F1'} ${s} Tf ${this.color(color)} rg 1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm ${pdfString(value)} Tj ET\n`);
    }
    line(x1,y1,x2,y2,color='#b4c5d5',width=1){this.page.push(`${width} w ${this.color(color)} RG ${x1} ${y1} m ${x2} ${y2} l S\n`);}
    rect(x,y,w,h,color='#e8f0f8') {this.page.push(`${this.color(color)} rg ${x} ${y} ${w} ${h} re f\n`);}
    addPage(){this.page=[];this.pages.push(this.page);
      const themeColors={ocean:'#12548b',emerald:'#056555',plum:'#5d3986',graphite:'#25354c'};
      const brandColor=themeColors[brandSettings.theme]||themeColors.ocean;
      this.rect(0,817,595,25,brandColor);
      this.text(brandSettings.name,42,794,brandSettings.name.length>36?10:15,true,brandColor);
      if(this.logo)this.page.push('q 43 0 0 43 505 770 cm /Im1 Do Q\n');
      this.text(brandSettings.subtitle,42,776,9,false,'#415972');
      this.line(42,761,553,761,'#a0b4c8',1);
      this.text(this.title+(this.pages.length>1?' (continuação)':''),42,739,14,true);
      this.text(this.details,42,720,9,false,'#3b526a');
      this.y=701;
    }
    ensure(height){if(this.y-height<70)this.addPage();}
    space(p=8){this.ensure(p);this.y-=p;}
    heading(value){this.ensure(38);this.y-=16;this.text(value,42,this.y,11.5,true);this.y-=8;this.line(42,this.y,553,this.y,'#b4c7d8');this.y-=12;}
    paragraph(value,opts={}){
      const str=String(value);const size=opts.size||9.5,limit=opts.limit||94,indent=opts.indent||0;
      const words=str.split(/\s+/);let current='';const wrapped=[];
      for(const word of words){if(!word)continue;let part=word;
        while(part.length>limit){if(current){wrapped.push(current);current='';}wrapped.push(part.slice(0,limit));part=part.slice(limit);}
        if(!part)continue;
        if((current+' '+part).trim().length>limit){wrapped.push(current);current=part;}else current=(current+' '+part).trim();
      }
      if(current)wrapped.push(current);if(!wrapped.length)wrapped.push(' ');
      for(const line of wrapped){this.ensure(14);this.text(line,42+indent,this.y,size,false,opts.color||'#1e364b');this.y-=15;}
    }
    pair(label,value){this.ensure(18);this.text(label,44,this.y,9.5,false);this.text(value,410,this.y,9.5,true);this.y-=18;}
    transaction(row){
      this.ensure(30);
      const company=rowCompany(row);const category=row.category;
      this.text(formatDate(row.date),42,this.y,8,false);
      this.text(row.type==='receita'?'ENTRADA':'SAÍDA',105,this.y,8,true,row.type==='receita'?'#126342':'#9c491c');
      this.text(company.length>24?company.slice(0,23)+'…':company,171,this.y,8,false);
      this.text(category.length>23?category.slice(0,22)+'…':category,313,this.y,8,false);
      this.text(fmtMoney(row.amount),465,this.y,8,true);
      this.y-=14;
      // Preserve textos longos completos em linhas secundárias, sem omissão silenciosa.
      if(company.length>24)this.paragraph('Empresa completa: '+company,{size:8,limit:112,indent:63,color:'#3d546c'});
      if(category.length>23)this.paragraph('Categoria completa: '+category,{size:8,limit:112,indent:63,color:'#3d546c'});
      if(row.description)this.paragraph('Detalhe: '+row.description,{size:8,limit:112,indent:63,color:'#3d546c'});
      this.ensure(8);this.line(42,this.y+4,552,this.y+4,'#dae3eb',.5);this.y-=8;
    }
    build(){
      // IDs fixos de catálogo, páginas e fontes. Streams inteiramente WinAnsi/ASCII.
      const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [] /Count 0 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
      const imageId=this.logo?objects.push(`<< /Type /XObject /Subtype /Image /Width ${this.logo.width} /Height ${this.logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${this.logo.bytes.length} >>\nstream\n${this.logo.bytes}\nendstream`)-1:null;
      const ids=[];
      for(let i=0;i<this.pages.length;i++){
        const page=this.pages[i];page.push(`BT /F1 8 Tf 0.27 0.34 0.43 rg 1 0 0 1 42 38 Tm ${pdfString('Desenvolvido por Lacrose Tecnologia')} Tj ET\n`);
        page.push(`BT /F1 8 Tf 0.27 0.34 0.43 rg 1 0 0 1 430 38 Tm ${pdfString('Página '+(i+1)+' / '+this.pages.length)} Tj ET\n`);
        const content=page.join('');const streamId=objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`)-1;
        const extra=imageId?` /XObject << /Im1 ${imageId} 0 R >>`:'';
        const pageId=objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${extra} >> /Contents ${streamId} 0 R >>`)-1;
        ids.push(pageId);
      }
      objects[1]=`<< /Type /Catalog /Pages 2 0 R >>`;
      objects[2]=`<< /Type /Pages /Count ${ids.length} /Kids [${ids.map(id=>id+' 0 R').join(' ')}] >>`;
      let binary='%PDF-1.4\n%PDF\n';const offsets=[0];
      for(let id=1;id<objects.length;id++){offsets[id]=binary.length;binary+=`${id} 0 obj\n${objects[id]}\nendobj\n`;}
      const xref=binary.length;binary+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
      for(let id=1;id<objects.length;id++)binary+=String(offsets[id]).padStart(10,'0')+' 00000 n \n';
      binary+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i)&255;
      return new Blob([bytes],{type:'application/pdf'});
    }
  }
  function reportCompanyLabel(){
    const id=$('filter-company').value;return state.companies.find(c=>c.id===id)?.name||'Todas as empresas';
  }
  function reportMonthLabel(){const m=$('filter-month').value;return m==='__all__'?'Todos os períodos':`${monthsBR[Number(m.slice(5))-1]}/${m.slice(0,4)}`;}
  function reportCurrent(){
    const rows=selectedRows();if(!rows.length)throw Error('Não há lançamentos no filtro atual. Selecione outro período ou registre um lançamento.');
    const kind=$('report-kind').value;if(!Object.hasOwn(REPORT_TYPES,kind))throw Error('Tipo de relatório inválido.');
    if(kind==='transactions'&&rows.length>REPORT_MAX_ROWS)throw Error(`Relatório com mais de ${REPORT_MAX_ROWS} linhas. Filtre uma empresa ou um mês para emitir sem omitir dados.`);
    return {rows,kind,totals:totals(rows),company:reportCompanyLabel(),month:reportMonthLabel()};
  }
  function reportFileName(r){const safe=brandSettings.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase().slice(0,40)||'gestao-parcerias';const m=$('filter-month').value==='__all__'?'todos-periodos':$('filter-month').value;return `${safe}-${r.kind}-${m}.pdf`;}
  function reportPdf(){
    const r=reportCurrent();const p=new PdfDocument(REPORT_TYPES[r.kind],`Empresa: ${r.company}   |   Período: ${r.month}   |   ${r.rows.length} lançamentos`);
    p.paragraph(`Gerado em: ${new Date().toLocaleString('pt-BR')}. ${state.demo?'DADOS DE DEMONSTRAÇÃO — VALORES FICTÍCIOS.':'Valores originados dos lançamentos desta sessão.'}`,{size:9,color:state.demo?'#994813':'#34526c'});
    p.space(6);
    p.heading('Resultado financeiro');
    p.pair('Receitas (dinheiro que entrou)',fmtMoney(r.totals.revenue));
    p.pair('Despesas (dinheiro que saiu)',fmtMoney(r.totals.expenses));
    p.pair('Saldo (receitas - despesas)',fmtMoney(r.totals.result));
    p.pair('Margem',r.totals.margin===null?'Não aplicável':number.format(r.totals.margin)+'%');
    if(r.kind==='summary'){
      const byCompany=new Map();for(const item of r.rows){const key=rowCompany(item);if(!byCompany.has(key))byCompany.set(key,[]);byCompany.get(key).push(item);}
      p.heading('Resultado por empresa');
      for(const [name,items] of [...byCompany].sort((a,b)=>a[0].localeCompare(b[0],'pt-BR'))){const t=totals(items);p.paragraph(name,{size:10});p.pair('   Entradas / saídas',`${fmtMoney(t.revenue)} / ${fmtMoney(t.expenses)}`);p.pair('   Saldo',fmtMoney(t.result));}
      const categories=new Map();for(const item of r.rows.filter(item=>item.type==='despesa'))categories.set(item.category,(categories.get(item.category)||0)+item.amount);
      p.heading('Principais categorias de despesa');
      for(const [name,value] of [...categories].sort((a,b)=>b[1]-a[1]).slice(0,30)){p.pair(name.length>48?name.slice(0,45)+'...':name,fmtMoney(value));}
      const byMonth=new Map();for(const item of r.rows){const key=item.date.slice(0,7);if(!byMonth.has(key))byMonth.set(key,[]);byMonth.get(key).push(item);}
      p.heading('Evolução mensal');for(const [month,items] of [...byMonth].sort((a,b)=>a[0].localeCompare(b[0]))){p.pair(month+' (saldo)',fmtMoney(totals(items).result));}
    }else if(r.kind==='transactions'){
      p.heading('Relação completa de movimentações');
      p.paragraph('Sem limitação de registros visíveis no painel: todas as movimentações do filtro selecionado estão relacionadas abaixo.',{size:9});
      p.space(4);
      for(const row of [...r.rows].sort((a,b)=>a.date.localeCompare(b.date)||rowCompany(a).localeCompare(rowCompany(b))))p.transaction(row);
    }else{
      p.heading('Distribuição estimada pelas regras atuais');
      p.paragraph('SIMULAÇÃO — Não representa pagamento, aprovação, fechamento nem histórico de percentuais. Cálculos usam as porcentagens atualmente cadastradas.',{size:9.2,color:'#91451d'});
      const companyIds=$('filter-company').value==='__all__'?[...new Set(r.rows.map(row=>row.companyId))]:[$('filter-company').value];
      for(const companyId of companyIds){const c=state.companies.find(x=>x.id===companyId);if(!c)continue;const rows=r.rows.filter(row=>row.companyId===companyId),t=totals(rows);
        const gross=c.base==='gross',basis=Math.max(0,gross?t.revenue:t.result);const amountCents=Math.round(basis*100);
        p.heading(c.name);
        p.paragraph('Base de cálculo configurada: '+(gross?'Receita bruta':'Saldo positivo (resultado líquido)'));
        p.pair('Valor disponível para simulação',fmtMoney(basis));
        let paid=0;
        if(!c.partners.length)p.paragraph('Nenhum sócio cadastrado nesta empresa.');
        for(const partner of c.partners){const cents=Math.min(amountCents-paid,Math.round(amountCents*partner.percent/100));paid+=cents;
          p.pair((partner.name+' — '+number.format(partner.percent)+'%').slice(0,50),fmtMoney(cents/100));}
        p.pair('Valor não distribuído',fmtMoney(Math.max(0,amountCents-paid)/100));
      }
    }
    p.space(7);p.paragraph('Relatório gerado no módulo demonstrativo local do Gestão de Parcerias. Confira a consistência dos valores antes de qualquer decisão. Os dados desta sessão não são fechamento contábil.',{size:8.5,color:'#45586a'});
    return {report:r,file:new File([p.build()],reportFileName(r),{type:'application/pdf'})};
  }
  function savePdf(file){const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  function printPdf(){try{const {file}=reportPdf(),url=URL.createObjectURL(file);const tab=window.open(url,'_blank','noopener,noreferrer');if(!tab){URL.revokeObjectURL(url);savePdf(file);toast('Janela bloqueada. Baixei o PDF: abra o arquivo e use Imprimir.',true);return;}setTimeout(()=>URL.revokeObjectURL(url),120000);toast('O relatório foi aberto em PDF. Use o botão Imprimir do leitor para escolher a impressora.');}catch(e){toast(e.message,true);}}
  function downloadPdf(){try{const {file}=reportPdf();savePdf(file);toast('PDF gerado no seu computador. Confira o arquivo antes de compartilhar.');}catch(e){toast(e.message,true);}}
  function phoneWhatsApp(raw){const digits=String(raw||'').replace(/\D/g,'');if(!digits)return '';
    const normalized=digits.length===10||digits.length===11?'55'+digits:digits;
    if(!/^\d{8,15}$/.test(normalized))throw Error('Número de WhatsApp inválido. Informe DDD e telefone, por exemplo (73) 99999-9999.');
    return normalized;
  }
  async function sharePdfWhatsApp(){
    try{
      const phone=phoneWhatsApp($('report-phone').value),{file}=reportPdf();
      // Compartilhamento nativo permite selecionar o WhatsApp quando o sistema disponibiliza o alvo.
      if(navigator.canShare?.({files:[file]})&&typeof navigator.share==='function'){
        try{await navigator.share({files:[file],title:'Relatório financeiro em PDF'});toast('Compartilhamento solicitado ao dispositivo. Confira a conversa para confirmar o envio.');return;}
        catch(err){if(err?.name==='AbortError'){toast('Compartilhamento cancelado. Nenhum envio foi confirmado.');return;}}
      }
      // wa.me abre apenas conversa com mensagem pronta. Não consegue anexar um PDF por URL.
      savePdf(file);
      const msg='Olá! Segue o relatório financeiro em PDF. Vou anexar o arquivo nesta conversa.';
      const url=phone?`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`:`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
      window.open(url,'_blank','noopener,noreferrer');
      toast('PDF baixado. No WhatsApp, anexe manualmente o PDF baixado e confirme o envio.');
    }catch(e){toast(e.message,true);}
  }
  function updateReportOverview(){
    const output=$('report-overview');output.replaceChildren();let r;
    try{r=reportCurrent();}
    catch(e){output.append(mk('p','muted',e.message));for(const id of ['report-print','report-download','report-whatsapp'])$(id).disabled=true;return;}
    for(const id of ['report-print','report-download','report-whatsapp'])$(id).disabled=false;
    output.append(mk('strong','',REPORT_TYPES[r.kind]));
    output.append(mk('div','report-meta',`${r.company} · ${r.month} · ${r.rows.length} lançamentos${state.demo?' · DADOS FICTÍCIOS':''}`));
    const totalsEl=mk('div','report-totals');
    for(const [label,amount] of [['Entradas',r.totals.revenue],['Saídas',r.totals.expenses],['Saldo',r.totals.result]]){
      const cell=mk('div');cell.append(mk('span','',label),mk('b','',fmtMoney(amount)));totalsEl.append(cell);
    }output.append(totalsEl);
    if(r.kind==='partners')output.append(mk('p','report-meta','SIMULAÇÃO com as regras e percentuais atuais de cada empresa. Não corresponde a fechamento histórico.'));
  }
  function openReports(){if(!selectedRows().length)return toast('Cadastre uma receita ou despesa para emitir relatório.',true);
    $('report-modal').hidden=false;updateReportOverview();$('report-kind').focus();}
  function closeReports(){$('report-modal').hidden=true;}
  $('nav-reports').addEventListener('click',openReports);
  $('close-report').addEventListener('click',closeReports);
  $('report-modal').addEventListener('click',e=>{if(e.target===$('report-modal'))closeReports();});
  $('report-kind').addEventListener('change',updateReportOverview);
  $('report-print').addEventListener('click',printPdf);
  $('report-download').addEventListener('click',downloadPdf);
  $('report-whatsapp').addEventListener('click',sharePdfWhatsApp);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('report-modal').hidden)closeReports();});

  $('nav-brand').addEventListener('click',()=>editBrand(true));
  $('btn-brand-top').addEventListener('click',()=>editBrand(true));
  $('close-brand').addEventListener('click',()=>editBrand(false));
  $('brand-modal').addEventListener('click',e=>{if(e.target===$('brand-modal'))editBrand(false);});
  $('brand-name').addEventListener('input',refreshBrandPreview);
  $('brand-subtitle').addEventListener('input',refreshBrandPreview);
  $('brand-logo').addEventListener('change',readBrandLogo);
  $('save-brand').addEventListener('click',saveBrand);
  $('reset-brand').addEventListener('click',()=>{
    if(!confirm('Restaurar apenas nome, cores e logomarca deste navegador? As planilhas não serão alteradas.'))return;
    try{localStorage.removeItem(BRAND_KEY);}catch(_){/* pode estar desabilitado */}
    brandSettings={...BRAND_DEFAULT};showBrand();editBrand(false);toast('Identidade visual padrão restaurada.');
  });
  $('step-company').addEventListener('click',()=>openCompany());
  $('step-manual').addEventListener('click',()=>openManual());
  $('step-report').addEventListener('click',openReports);
  $('btn-guide').addEventListener('click',()=>{const guide=$('guide-box');guide.hidden=!guide.hidden;$('btn-guide').textContent=guide.hidden?'O que significam esses números?':'Ocultar explicação';});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('brand-modal').hidden)editBrand(false);});
  showBrand();
  $('btn-manual').addEventListener('click',()=>openManual());$('nav-manual').addEventListener('click',()=>openManual());
  $('btn-import').addEventListener('click',()=>modal(true));$('nav-import').addEventListener('click',()=>modal(true));$('close-modal').addEventListener('click',()=>modal(false));
  $('import-modal').addEventListener('click',e=>{if(e.target===$('import-modal'))modal(false);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('import-modal').hidden)modal(false);});
  $('file-input').addEventListener('change',onFile);$('sheet-select').addEventListener('change',populateMapping);$('default-company').addEventListener('input',updatePreview);$('default-type').addEventListener('change',updatePreview);
  $('btn-preview').addEventListener('click',updatePreview);$('skip-invalid').addEventListener('change',updatePreview);$('commit-import').addEventListener('click',commitImport);
  $('filter-company').addEventListener('change',render);$('filter-month').addEventListener('change',()=>{render();$('share-output').replaceChildren(mk('div','empty','O período mudou. Recalcule a simulação.'));});$('share-company').addEventListener('change',fillShareFromCompany);$('save-share').addEventListener('click',saveShare);$('btn-share').addEventListener('click',simulate);
  $('btn-demo').addEventListener('click',demo);$('clear-data').addEventListener('click',()=>{if(!confirm('Apagar todas as empresas, sócios e movimentações desta sessão? Faça uma cópia antes se precisar recuperar.'))return;state.rows=[];state.companies=[];state.files.clear();state.demo=false;state.visibleRows=30;resetFilters();render();fillShareFromCompany();lastStorageError='';autoSave();toast('Dados locais limpos.');});
  $('btn-csv').addEventListener('click',exportCsv);$('btn-print').addEventListener('click',openReports);
  bindManagement();restoreDeviceData();
})();