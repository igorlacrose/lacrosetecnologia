import { MAX_BYTES,MAX_ROWS,MAX_CELL_CHARS,detectMapping } from './engine.js';

function readCell(cell, getString){
  const type=cell.getAttribute('t')||'';
  if(cell.getElementsByTagName('f').length>0)return null; // Ignora fórmulas não confiáveis.
  const v=cell.getElementsByTagName('v')[0];
  if(type==='inlineStr'){return (cell.getElementsByTagName('is')[0]?.textContent||'').slice(0,MAX_CELL_CHARS)}
  if(!v)return null;
  const raw=(v.textContent||'').slice(0,MAX_CELL_CHARS);
  if(type==='s')return getString(Number(raw))?.slice(0,MAX_CELL_CHARS)||'';
  if(type==='b')return raw==='1';
  if(type==='str')return raw;
  const n=Number(raw);return raw!=='' && Number.isFinite(n)?n:raw;
}
const getColIndex = ref => {
 const m=/^[A-Z]+/.exec((ref||'').toUpperCase());if(!m)return -1;
 let num=0;for(const ch of m[0])num=num*26+ch.charCodeAt(0)-64;return num-1;
};
function parseXml(text){const p=new DOMParser().parseFromString(text,'application/xml');if(p.querySelector('parsererror'))throw new Error('XML inválido no arquivo Excel.');return p;}
export async function readWorkbook(file){
  if(!file || file.size===0 || file.size>MAX_BYTES)throw new Error('Arquivo vazio ou maior que 15 MB.');
  if(typeof JSZip==='undefined')throw new Error('Leitor local XLSX indisponível.');
  const zip=await JSZip.loadAsync(await file.arrayBuffer(),{checkCRC32:true});
  const entries=Object.values(zip.files).filter(f=>!f.dir);
  if(entries.length>300)throw new Error('Arquivo XLSX com quantidade excessiva de componentes.');
  const total=entries.reduce((n,f)=>n+(f._data?.uncompressedSize||0),0);
  if(total>55*1024*1024)throw new Error('Arquivo XLSX excede o limite seguro de descompactação.');
  const strFile=zip.file('xl/sharedStrings.xml');
  let getString=()=>'';
  if(strFile){
    const strXML=parseXml(await strFile.async('string'));
    const shared=strXML.getElementsByTagName('si');
    if(shared.length>350000)throw new Error('Tabela de textos excede o limite.');
    // Nunca criar lista de strings brutas (poderia conter CPF, nomes e senhas).
    // Recuperar somente as strings referenciadas pelas colunas aprovadas.
    getString=i=>(shared.item(i)?.textContent||'').slice(0,MAX_CELL_CHARS);
  }
  const workbookSheet=zip.file('xl/worksheets/sheet1.xml') || zip.file(/^xl\/worksheets\/sheet\d+\.xml$/)[0];
  if(!workbookSheet)throw new Error('Nenhuma aba de dados encontrada na planilha.');
  const xml=parseXml(await workbookSheet.async('string'));
  const nodes=xml.getElementsByTagName('row');
  if(nodes.length>MAX_ROWS+1)throw new Error('Quantidade de linhas superior ao limite.');
  let headers=null, allowed=new Set();const rows=[];
  for(const rowNode of nodes){
    const obj=[];const cells=rowNode.getElementsByTagName('c');
    if(cells.length>150)throw new Error('Número excessivo de colunas.');
    for(const c of cells){const i=getColIndex(c.getAttribute('r'));if(i>=0 && i<150 && (headers===null||allowed.has(i)))obj[i]=readCell(c,getString);}
    if(headers===null){headers=obj.map(x=>String(x??'').trim().slice(0,80));allowed=new Set(Object.values(detectMapping(headers)).filter(i=>i>=0));}
    else rows.push(obj);
  }
  // rows contêm SOMENTE os valores das colunas aprovadas, sem identificadores ou texto livre.
  return {headers:headers||[], rows};
}
export function parseCsv(text){
 if(text.length>MAX_BYTES*2)throw new Error('Arquivo CSV excede o limite de tamanho.');
 // Parser RFC4180 simples com aspas duplas e novas linhas escapadas.
 const firstLine=text.split(/\r?\n/,1)[0]||'';
 const delimiter=(firstLine.match(/;/g)||[]).length>(firstLine.match(/,/g)||[]).length?';':',';
 let rows=[],row=[],field='',quoted=false,headers=null,allowed=new Set();
 const pushField=()=>{row.push(field.slice(0,MAX_CELL_CHARS));field='';};
 const pushRow=()=>{pushField();if(row.length>150)throw new Error('Número excessivo de colunas.');
  if(headers===null){headers=row.map(x=>String(x||'').replace(/^\uFEFF/,'').trim());allowed=new Set(Object.values(detectMapping(headers)).filter(i=>i>=0));}
  else {const projected=[];for(const i of allowed)projected[i]=row[i];rows.push(projected);if(rows.length>MAX_ROWS)throw new Error('Limite de linhas excedido.');}
  row=[];};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else if(field.length<MAX_CELL_CHARS)field+=c;}
  else if(c==='"')quoted=true;
  else if(c===delimiter){pushField();}
  else if(c==='\n'){pushRow();}
  else if(c!=='\r'&&field.length<MAX_CELL_CHARS)field+=c;
 }
 if(quoted)throw new Error('CSV com aspas não fechadas.');
 if(field||row.length)pushRow();
 return {headers, rows};
}
export async function readReport(file){
 if(!file || file.size>MAX_BYTES)throw new Error('Arquivo maior que 15 MB.');
 if(/\.xlsx$/i.test(file.name))return readWorkbook(file);
 if(/\.csv$/i.test(file.name))return parseCsv(await file.text());
 throw new Error('Formato não suportado. Use XLSX ou CSV.');
}
