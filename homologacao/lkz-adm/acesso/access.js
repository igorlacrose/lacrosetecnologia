const base = 'https://nijsafzwxzcfqdevlsxe.supabase.co/auth/v1';
const key = 'sb_publishable_O7yEQwMVQtW2zoIpHTyY1w_2LUguIC0';
const el = id => document.getElementById(id);
const steps = ['send','verify','factor','password'];
let email, bearer, factorId;
function step(id) {
  for (const name of steps) el(name).hidden = name !== id;
  el('restart').hidden = id === 'send' || id === null;
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
window.addEventListener('pagehide', clear);
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
handle('send', async fields => {
  email = fields.email.value.trim();
  await api('/recover', 'POST', {email});
  step('verify'); el('status').textContent = 'Confira o código na sua caixa de entrada.';
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
  step('password'); el('status').textContent = 'Autenticador confirmado.';
});
handle('password', async fields => {
  await api('/user','PUT',{password:fields.newpass.value});
  try { await api('/logout?scope=local','POST',{}); } catch { /* Drop the in-memory session even if offline. */ }
  clear(); step(null); el('status').textContent = 'Senha salva e autenticador configurado. Você pode fechar esta página.';
});
