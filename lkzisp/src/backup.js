/**
 * Backup local criptografado de AGREGADOS (não é backup do banco nem da nuvem).
 * Importação de backup requer arquivo/segredo do próprio operador.
 * Esse formato não contém dados pessoais, identificadores nem arquivos originais.
 */
const enc=new TextEncoder(),dec=new TextDecoder();
const S='LKZ-ISP-BACKUP-V1';
const LIMIT=2_000_000;
const KDF_ITERS=600_000;
const encode64=a=>{let str='';for(const b of a)str+=String.fromCharCode(b);return btoa(str);};
const decode64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const nonneg=(n,max=50_000)=>Number.isInteger(n)&&n>=0&&n<=max;
const date=s=>typeof s==='string'&&/^20\d\d-\d\d-\d\d$/.test(s)&&!Number.isNaN(Date.parse(s));
const iso=s=>typeof s==='string'&&/^20\d\d-\d\d-\d\dT\d\d:\d\d:/.test(s)&&!Number.isNaN(Date.parse(s));
const SAFE_KEYS={
 statuses:new Set(['Finalizada','Aberta','Encaminhada','Execução','Assumida','Outros']),
 priorities:new Set(['Normal','Crítica','Alta','Baixa','Não informada']),
 subjects:new Set(['Entrega boletos · NSON','Entrega de boletos','DB alto','Instalação','Sem conexão','Lentidão','Organização de caixa','Retirada de equipamento','Mudança de endereço','Comparecimento improdutivo','Manutenção preventiva','Suporte ao técnico','Sem acesso','Solicitação de boleto','Informativo','Logística','Estorno de pagamento','Reativação','Outros assuntos']),
 sectors:new Set(['Entrega de boletos','Técnicos Jequié','Técnicos Jitaúna','Técnicos Ipiaú','Técnicos Itagibá','Financeiro','Administrativo','Atendimento','Call center','NOC','Suporte N2','Outros setores']),
 cities:new Set(['Jequié','Ipiaú','Jitaúna','Itagibá','Itagi','Aiquara','Ponto Novo','Itajuru','Porto Seguro','Outras / não informada'])
};
const fields=new Set(['Status','Assunto','Setor','Cidade','Abertura','Fechamento','Prioridade']);
const groupFields=['total','pending','finalized','over24','age7'];
function canonicalMap(input,kind){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Dados de grupo inválidos.');
 const entries=Object.entries(input);if(entries.length>250)throw new Error('Grupos em excesso.');
 const out=Object.create(null);
 for(const [k,value] of entries){
  if(kind==='daily'?!date(k):!SAFE_KEYS[kind]?.has(k))throw new Error('Categoria não aprovada no backup.');
  if(kind==='statuses'||kind==='priorities'){
   if(!nonneg(value))throw new Error('Contagem inválida.');out[k]=value;continue;
  }
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Agrupamento inválido.');
  const g={};for(const f of groupFields){if(!nonneg(value[f]??0))throw new Error('Contagem de grupo inválida.');g[f]=value[f]??0;}
  if(g.finalized+g.pending!==g.total||g.over24>g.finalized)throw new Error('Contagens inconsistentes.');
  out[k]=g;
 }
 return out;
}
/** Retorna somente os campos permitidos, sem jamais copiar propriedades extras. */
export function cleanBackupSnapshot(s){
 if(!s||typeof s!=='object'||Array.isArray(s)||s.schema!==1||!nonneg(s.total)||s.total===0||!nonneg(s.finalized)||!nonneg(s.pending)||s.finalized+s.pending!==s.total||!iso(s.importedAt))throw new Error('Indicadores inválidos para backup.');
 const countFields=['closedOver24','closedWithDates','pendingOlder7d','invalidDates'];
 const out={schema:1,source:'IXC · Indicadores agregados',importedAt:s.importedAt,total:s.total,finalized:s.finalized,pending:s.pending};
 for(const key of countFields){if(!nonneg(s[key]??0))throw new Error('Indicador inválido.');out[key]=s[key]??0;}
 if(out.closedOver24>out.finalized||out.closedWithDates>out.finalized||out.closedOver24>out.closedWithDates||out.pendingOlder7d>out.pending||out.invalidDates>out.total)throw new Error('Indicadores inconsistentes.');
 for(const key of ['earliest','latest','referenceDate']){if(s[key]!==null&&!date(s[key]))throw new Error('Data inválida.');out[key]=s[key];}
 if(!Array.isArray(s.availableFields)||s.availableFields.length>7||s.availableFields.some(f=>!fields.has(f)))throw new Error('Campos inválidos.');
 out.availableFields=[...new Set(s.availableFields)];
 out.notes=['SLA não interpretado.','Sem identificação pessoal.'];
 for(const kind of ['statuses','subjects','sectors','cities','daily','priorities'])out[kind]=canonicalMap(s[kind],kind);
 if(s.fingerprint!==undefined){if(!/^[a-f0-9]{64}$/.test(s.fingerprint))throw new Error('Assinatura inválida.');out.fingerprint=s.fingerprint;}
 return out;
}
async function key(passphrase,salt){
 const k=await crypto.subtle.importKey('raw',enc.encode(passphrase),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:KDF_ITERS,hash:'SHA-256'},k,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function encryptBackup(snapshots,passphrase){
 if(typeof passphrase!=='string'||passphrase.length<16||passphrase.length>200)throw new Error('Use uma frase secreta exclusiva para backup (16 a 200 caracteres).');
 if(!Array.isArray(snapshots)||snapshots.length===0||snapshots.length>100)throw new Error('Não há análises válidas para backup.');
 const data={type:S,createdAt:new Date().toISOString(),snapshots:snapshots.map(cleanBackupSnapshot)};
 const bytes=enc.encode(JSON.stringify(data));if(bytes.byteLength>LIMIT)throw new Error('Arquivo maior que o limite de backup local.');
 const salt=crypto.getRandomValues(new Uint8Array(16));const iv=crypto.getRandomValues(new Uint8Array(12));
 const secret=await key(passphrase,salt);
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(S)},secret,bytes);
 return {type:S,kdf:'PBKDF2-SHA256',iterations:KDF_ITERS,algorithm:'AES-256-GCM',salt:encode64(salt),iv:encode64(iv),ciphertext:encode64(new Uint8Array(cipher))};
}
export async function decryptBackup(fileText,passphrase){
 if(typeof fileText!=='string'||fileText.length>3_000_000||typeof passphrase!=='string')throw new Error('Backup inválido ou acima do limite.');
 let sealed;try{sealed=JSON.parse(fileText);}catch{throw new Error('Backup JSON inválido.');}
 if(sealed?.type!==S||sealed.algorithm!=='AES-256-GCM'||sealed.kdf!=='PBKDF2-SHA256'||sealed.iterations!==KDF_ITERS)throw new Error('Formato de backup não reconhecido.');
 try{
  const salt=decode64(sealed.salt),iv=decode64(sealed.iv),cipher=decode64(sealed.ciphertext);
  if(salt.length!==16||iv.length!==12||cipher.length>LIMIT+16)throw new Error('Tamanho criptográfico inválido.');
  const secret=await key(passphrase,salt);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:enc.encode(S)},secret,cipher);
  const data=JSON.parse(dec.decode(plain));
  if(data?.type!==S||!Array.isArray(data.snapshots)||data.snapshots.length<1||data.snapshots.length>100)throw new Error('Backup sem registros válidos.');
  return data.snapshots.map(cleanBackupSnapshot);
 }catch{throw new Error('Não foi possível restaurar: senha incorreta, arquivo danificado ou dados inválidos.');}
}
