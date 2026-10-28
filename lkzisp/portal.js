'use strict';
const API='https://syysqoieyycclpfbadwp.supabase.co';
const KEY='sb_publishable_VFm25ul2iOl3P_UVVwY5iA_LADSuSIb'; // Chave publica, sem privilegios
const REDIRECT='https://lacrosetecnologia.com.br/lkzisp/';
let token='',refreshToken='',expires=0,email='',aal='aal1',factorId='',recovery=false;
const el=id=>document.getElementById(id);
function msg(text){el('message').textContent=text}
function visible(id,yes){el(id).hidden=!yes}
function assurance(access){try{const data=access.split('.')[1];return JSON.parse(atob(data.replace(/-/g,'+').replace(/_/g,'/'))).aal||'aal1'}catch{return 'aal1'}}
async function api(path,method='GET',body=null,useAuth=true){
 const headers={'apikey':KEY,'Content-Type':'application/json'};
 if(useAuth&&token)headers.Authorization='Bearer '+token;
 const r=await fetch(API+path,{method,headers,cache:'no-store',signal:AbortSignal.timeout(12000),
  ...(body===null?{}:{body:JSON.stringify(body)})});
 let data={};try{data=await r.json()}catch{}
 if(!r.ok)throw Error(r.status===429?'Muitas tentativas: tente novamente mais tarde.':
  data?.error_code==='mfa_factor_name_conflict'?'Este autenticador ja existe. Saia e entre novamente, depois use seu codigo TOTP.':
  data?.error_code==='mfa_verification_failed'?'Codigo TOTP incorreto ou expirado. Confira o relogio do celular.':
  r.status===401||r.status===400?'Credenciais, código ou confirmação inválidos.':
  r.status===403?'Acesso não autorizado.':'Serviço indisponível (HTTP '+r.status+').');
 return data;
}
function adopt(data){
 if(!data?.access_token||!data?.refresh_token)throw Error('Sessão inválida.');
 token=data.access_token;refreshToken=data.refresh_token;expires=Date.now()+Number(data.expires_in||3600)*1000;
 email=data.user?.email||email;aal=assurance(token);
}
async function current(){
 if(!token)throw Error('Faça login para continuar.');
 if(expires>Date.now()+60000)return;
 const data=await api('/auth/v1/token?grant_type=refresh_token','POST',{refresh_token:refreshToken},false);
 adopt(data);
}
function ui(){
 visible('loginForm',!token);
 visible('mfa',!!token&&aal!=='aal2'&&!recovery);
 visible('authorized',!!token&&aal==='aal2'&&!recovery);
 visible('resetForm',recovery&&!!token);
 visible('signout',!!token);
 el('status').textContent=!token?'Não autenticado':recovery?'Recuperação de senha':aal==='aal2'?'MFA confirmado':'Segundo fator pendente';
}
function clear(){
 token='';refreshToken='';expires=0;email='';aal='aal1';factorId='';recovery=false;
 el('password').value='';el('code').value='';el('secret').textContent='';
 el('memberships').replaceChildren();visible('secretBox',false);ui();
}
async function factors(){
 await current();
 // A API de listagem do Supabase utiliza user.factors, retornado por GET /auth/v1/user.
 // GET /auth/v1/factors responde 405 e nao deve ser usado para listagem.
 const user=await api('/auth/v1/user');
 const list=Array.isArray(user?.factors)?user.factors:[];
 const totp=list.filter(x=>x?.factor_type==='totp');
 const verified=totp.find(x=>x.status==='verified');
 const unverified=totp.find(x=>x.status==='unverified');
 factorId=(verified||unverified)?.id||'';
 visible('enroll',!factorId);
 if(verified)msg('Seu autenticador ja esta configurado. Informe o codigo de seis digitos do aplicativo.');
 else if(unverified)msg('Existe um autenticador em configuracao. Informe o codigo do aplicativo usado na configuracao inicial.');
 else msg('Nenhum autenticador cadastrado. Configure um segundo fator para continuar.');
}
async function memberships(){
 await current();
 if(aal!=='aal2')throw Error('MFA necessário.');
 const data=await api('/rest/v1/lkz_isp_memberships?select=tenant_id,role,sector_id&limit=30');
 if(!Array.isArray(data))throw Error('Erro ao consultar permissões.');
 const root=el('memberships');root.replaceChildren();
 if(!data.length){
  const p=document.createElement('p');p.textContent='Nenhuma empresa autorizada. Aguarde a habilitação administrativa.';root.appendChild(p);
 }
 for(const row of data){
  const p=document.createElement('p');
  p.textContent='Perfil '+String(row.role)+' • Empresa '+String(row.tenant_id)+' • Setor '+String(row.sector_id||'todos');
  root.appendChild(p);
 }
 visible('activate',email.toLowerCase()==='lacrose.igor@gmail.com'&&!data.some(x=>x.role==='master'));
}
async function exec(action){
 document.querySelectorAll('button').forEach(b=>b.disabled=true);msg('');
 try{await action()}catch(e){msg(e?.message||'Falha na requisição.')}
 finally{document.querySelectorAll('button').forEach(b=>b.disabled=false);ui()}
}
el('loginForm').addEventListener('submit',e=>{e.preventDefault();exec(async()=>{
 const d=await api('/auth/v1/token?grant_type=password','POST',
  {email:el('email').value.trim(),password:el('password').value},false);
 el('password').value='';adopt(d);
 if(aal==='aal2')await memberships();else await factors();
})});
el('signup').addEventListener('click',()=>exec(async()=>{
 const address=el('email').value.trim().toLowerCase(),password=el('password').value;
 el('password').value='';
 if(address!=='lacrose.igor@gmail.com')throw Error('Primeiro cadastro reservado ao MASTER. Usuários adicionais serão convidados.');
 if(password.length<12)throw Error('Crie uma senha com pelo menos 12 caracteres.');
 const d=await api('/auth/v1/signup?redirect_to='+encodeURIComponent(REDIRECT),'POST',{email:address,password},false);
 if(d.access_token){adopt(d);await factors();}
 else msg('Cadastro solicitado. Confirme o e-mail recebido. O endereço de retorno deve estar autorizado no Supabase.');
}));
el('recover').addEventListener('click',()=>exec(async()=>{
 const address=el('email').value.trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))throw Error('Informe um e-mail válido.');
 await api('/auth/v1/recover?redirect_to='+encodeURIComponent(REDIRECT),'POST',{email:address},false);
 msg('Se a conta existir, será enviado um link de recuperação. Verifique também a caixa de spam.');
}));
el('enroll').addEventListener('click',()=>exec(async()=>{
 await current();
 await factors();
 if(factorId)throw Error('Autenticador existente encontrado. Informe o codigo TOTP sem cadastrar novamente.');
 const d=await api('/auth/v1/factors','POST',{factor_type:'totp',friendly_name:'LKZ ISP Intelligence'});
 if(!d.id||!d.totp?.secret)throw Error('O autenticador não pôde ser cadastrado.');
 factorId=d.id;el('secret').textContent=d.totp.secret;visible('secretBox',true);
 msg('Adicione o segredo ao autenticador e confirme o código abaixo.');
}));
el('mfaForm').addEventListener('submit',e=>{e.preventDefault();exec(async()=>{
 const code=el('code').value.trim();el('code').value='';
 if(!/^\d{6}$/.test(code)||!factorId)throw Error('Cadastre o autenticador e informe seis dígitos.');
 await current();
 const ch=await api('/auth/v1/factors/'+encodeURIComponent(factorId)+'/challenge','POST',{});
 const data=await api('/auth/v1/factors/'+encodeURIComponent(factorId)+'/verify','POST',{challenge_id:ch.id,code});
 adopt(data);if(aal!=='aal2')throw Error('MFA não foi confirmado.');
 el('secret').textContent='';visible('secretBox',false);await memberships();msg('Autenticação reforçada confirmada.');
})});
el('activate').addEventListener('click',()=>exec(async()=>{
 await current();if(aal!=='aal2'||email.toLowerCase()!=='lacrose.igor@gmail.com')throw Error('Somente o proprietário com MFA pode ativar o MASTER.');
 const data=await api('/functions/v1/lkzisp-owner-bootstrap','POST',{action:'activate_master'});
 if(!['activated','already_active'].includes(data.status))throw Error('Ativação não confirmada.');
 await memberships();msg('MASTER ativado. Permissões verificadas no Supabase.');
}));
el('reload').addEventListener('click',()=>exec(async()=>{await memberships();msg('Permissões atualizadas.')}));
el('signout').addEventListener('click',()=>exec(async()=>{
 if(token)try{await api('/auth/v1/logout','POST',{})}catch{}
 clear();msg('Sessão encerrada; nenhum token foi persistido no navegador.');
}));
el('resetForm').addEventListener('submit',e=>{e.preventDefault();exec(async()=>{
 const password=el('newPassword').value;
 if(password.length<12)throw Error('Senha com no mínimo 12 caracteres.');
 await api('/auth/v1/user','PUT',{password});
 el('newPassword').value='';clear();msg('Senha alterada. Entre novamente e confirme o MFA.');
})});
(async()=>{
 const hash=new URLSearchParams(location.hash.replace(/^#/,''));
 const access=hash.get('access_token'),refresh=hash.get('refresh_token'),type=hash.get('type');
 if(location.hash)history.replaceState({},'',location.pathname+location.search);
 if(!access||!refresh){ui();return}
 try{
  const response=await fetch(API+'/auth/v1/user',{
   headers:{apikey:KEY,Authorization:'Bearer '+access},cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Link de autenticação inválido ou expirado.');
  const who=await response.json();
  token=access;refreshToken=refresh;email=who.email||'';aal=assurance(token);expires=Date.now()+30*60*1000;
  if(type==='recovery'){recovery=true;msg('Defina a nova senha abaixo.');}
  else if(aal==='aal2')await memberships();else await factors();
 }catch(e){clear();msg(e.message||'Não foi possível validar o link.')}
 ui();
})();
