const base = 'https://nijsafzwxzcfqdevlsxe.supabase.co/auth/v1';
const key = 'sb_publishable_O7yEQwMVQtW2zoIpHTyY1w_2LUguIC0';
const el = id => document.getElementById(id);
const steps = ['login','send','verify','confirm-email','factor','password'];
let email, bearer, factorId;
let recovering = false;

const callback = new URLSearchParams(location.hash.slice(1));
if (callback.has('access_token') || callback.has('refresh_token') || callback.has('error')) {
  history.replaceState(null, '', location.pathname);
}
if (callback.get('type') === 'recovery' && callback.has('access_token')) {
  bearer = callback.get('access_token');
  recovering = true;
  step('confirm-email');
} else if (callback.has('error')) {
  el('status').textContent = 'O link expirou ou já foi usado. Solicite outro em Recuperar senha.';
}
callback.delete('access_token');
callback.delete('refresh_token');
function step(id) {
  for (const name of steps) el(name).hidden = name !== id;
  el('restart').hidden = id === 'login' || id === null;
  if (id) el(id).querySelector('input').focus();
}
async function api(path, method, data) {
  const headers = {apikey:key, 'Content-Type':'application/json'};
  if (bearer) headers.Authorization = 'Bearer ' + bearer;
  const response = await fetch(base + path, {method, headers, body:JSON.stringify(data),
    credentials:'omit', cache:'no-store', redirect:'error', referrerPolicy:'no-referrer', signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error(response.status === 429 ? 'Muitas tentativas. Aguarde antes de repetir.' : 'Confira os dados e tente novamente. Se a sessão expirou, clique em Recomeçar.');
  const body = await response.text();
  return body ? JSON.parse(body) : {};
}
function handle(id, action) {
  const form = el(id);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    if (button.disabled) return;
    button.disabled = true;
    el('restart').disabled = true;
    el('status').textContent = 'Aguarde…';
    try { await action(form.elements); }
    catch (error) { el('status').textContent = error instanceof TypeError ? 'Falha de conexão. Tente novamente.' : error.message; }
    finally {button.disabled = false; el('restart').disabled = false;}
  });
}
function clear() {
  email = bearer = factorId = undefined;
  el('secret').textContent = '';
  for (const id of steps) el(id).reset();
}
el('restart').onclick = () => location.reload();
el('recover').onclick = () => {
  if (el('login').querySelector('button').disabled) return;
  el('send').elements.email.value = el('login').elements.email.value;
  el('login').elements.pass.value = '';
  el('status').textContent = '';
  step('send');
};
handle('login', async fields => {
  email = fields.email.value.trim();
  bearer = undefined;
  const session = await api('/token?grant_type=password','POST',{email,password:fields.pass.value});
  fields.pass.value = '';
  if (!session.access_token) throw new Error('Login sem sessão válida.');
  bearer = session.access_token;
  await prepareFactor();
});
window.addEventListener('pagehide', clear);
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
handle('send', async fields => {
  email = fields.email.value.trim();
  recovering = true;
  const redirect = location.origin + location.pathname;
  await api('/recover?redirect_to=' + encodeURIComponent(redirect), 'POST', {email});
  el('status').textContent = 'Abra o link de recuperação no novo e-mail do Supabase.';
});
el('use-code').onclick = () => {
  const form = el('send');
  if (form.querySelector('button').disabled || !form.reportValidity()) return;
  email = form.elements.email.value.trim();
  recovering = true;
  step('verify');
  el('status').textContent = 'Informe o código recebido por e-mail.';
};
handle('confirm-email', async fields => {
  email = fields.email.value.trim();
  await prepareFactor();
});
async function prepareFactor() {
  const user = await api('/user','GET');
  if (user.email?.toLowerCase() !== email.toLowerCase()) throw new Error('Conta divergente. Recomece o acesso.');
  const existing = user.factors?.find(f => f.status === 'verified' && f.factor_type === 'totp');
  if (existing) {
    factorId = existing.id;
    el('guide').textContent = 'Abra seu autenticador e informe o código desta conta.';
  } else {
    const factor = await api('/factors','POST',{factor_type:'totp',issuer:'LKZ ADM Homologação'});
    if (!factor.totp?.secret || !factor.id) throw new Error('Cadastro do autenticador incompleto. Recomece.');
    factorId = factor.id;
    el('guide').textContent = 'No aplicativo autenticador, adicione uma chave de configuração baseada em tempo. Use a chave abaixo e confirme o código gerado.';
    el('secret').textContent = factor.totp.secret;
  }
  step('factor'); el('status').textContent = '';
}
handle('verify', async fields => {
  if (!bearer) {
    const session = await api('/verify','POST',{type:'recovery',email,token:fields.otp.value.trim()});
    if (!session.access_token) throw new Error('Código sem sessão válida.');
    bearer = session.access_token;
  }
  await prepareFactor();
  fields.otp.value = '';
});
handle('factor', async fields => {
  const path = '/factors/' + encodeURIComponent(factorId);
  const challenge = await api(path + '/challenge','POST',{});
  const session = await api(path + '/verify','POST',{challenge_id:challenge.id,code:fields.code.value});
  if (!session.access_token) throw new Error('Verificação incompleta. Recomece.');
  bearer = session.access_token;
  fields.code.value = ''; el('secret').textContent = '';
  if (!recovering) {
    await finish('Autenticador configurado. Você pode fechar esta página.');
    return;
  }
  step('password'); el('status').textContent = 'Autenticador confirmado.';
});
handle('password', async fields => {
  await api('/user','PUT',{password:fields.newpass.value});
  await finish('Senha salva e autenticador configurado. Você pode fechar esta página.');
});
async function finish(message) {
  try { await api('/logout?scope=local','POST',{}); } catch { /* A falha remota não impede a limpeza local. */ }
  clear();
  step(null);
  el('status').textContent = message;
}
