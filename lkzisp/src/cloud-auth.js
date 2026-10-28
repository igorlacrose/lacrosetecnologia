/* LKZ ISP - Supabase Auth em memoria, sem token ou senha persistidos no navegador.
 * Acesso a dados empresariais so ocorre apos MFA aal2, com RLS no Postgres.
 */
const ROOT = 'https://syysqoieyycclpfbadwp.supabase.co';
// Chave publica sem privilegios administrativos; acesso protegido por RLS.
const PUBLIC_KEY = 'sb_publishable_VFm25ul2iOl3P_UVVwY5iA_LADSuSIb';

export function jwtAssurance(jwt) {
  try {
    const p = jwt.split('.')[1];
    if (!p || p.length > 16384) return 'aal1';
    const payload = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
    return payload.aal === 'aal2' ? 'aal2' : 'aal1';
  } catch { return 'aal1'; }
}

import {saveTrustedSession,loadTrustedSession,clearTrustedSession} from './trusted-session.js';
export class CloudAccess {
  #token = null;
  #refreshToken = null;
  #factor = null;
  #email = null;
  #userId = null;
  #expiresAt = 0;
  #recovery = false;
  #trustThisDevice = false;
  #lastTrustWrite = 0;
  #fetch;
  constructor(fetchImpl = null) { this.#fetch = fetchImpl ?? globalThis.fetch.bind(globalThis); }
  get email() { return this.#email; }
  get recoveryPending() { return this.#recovery; }
  get hasSession() { return Boolean(this.#token); }
  get aal() { return this.#token ? jwtAssurance(this.#token) : 'none'; }
  get trustDeviceEnabled(){return this.#trustThisDevice;}
  get factor() { return this.#factor ? {id:this.#factor.id,secret:this.#factor.secret||null} : null; }

  async #request(path, options={}) {
    const {method='GET',body=null,auth=true}=options;
    const h={apikey: PUBLIC_KEY, 'Content-Type':'application/json'};
    if (auth && this.#token) h.Authorization = 'Bearer ' + this.#token;
    let response;
    try { response = await this.#fetch(ROOT + path, {method,headers:h,
      ...(body===null?{}:{body:JSON.stringify(body)}), signal: AbortSignal.timeout(12000)});
    } catch { throw Error('Sem conexão com o serviço de identidade.'); }
    let data={};
    try { data = await response.json(); } catch { /* http error without json */ }
    if (!response.ok) {
      if(response.status===422 && (data?.error_code==='mfa_factor_name_conflict'||data?.code==='mfa_factor_name_conflict'))
        throw Error('Autenticador já cadastrado: use o código existente do aplicativo.');
      if (response.status===429) throw Error('Muitas tentativas. Aguarde antes de tentar novamente.');
      if (response.status===401 || response.status===400) throw Error('Acesso não autorizado, código incorreto ou conta ainda não confirmada.');
      if (response.status===403) throw Error('Acesso negado pelo serviço de identidade.');
      throw Error('Serviço temporariamente indisponível.');
    }
    return data;
  }
  #adopt(data) {
    if (!data?.access_token || !data?.refresh_token || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0)
      throw Error('Sessão não confirmada.');
    this.#token = data.access_token;
    this.#refreshToken = data.refresh_token;
    this.#expiresAt = Date.now() + Number(data.expires_in)*1000;
    this.#email = data.user?.email || this.#email;
    this.#userId = data.user?.id || this.#userId;
  }
  async signIn(email,password) {
    if (!email || !password) throw Error('Informe e-mail e senha.');
    this.clear();
    const data = await this.#request('/auth/v1/token?grant_type=password', {
      method:'POST',body:{email:String(email).trim().slice(0,250), password:String(password)},auth:false});
    this.#adopt(data);
    return {email:this.#email,aal:this.aal};
  }
  async setDeviceTrust(enabled){
    this.#trustThisDevice=Boolean(enabled);
    if(!enabled){await clearTrustedSession();return;}
    if(this.aal==='aal2')await this.#writeTrustedSession(true);
  }
  async #writeTrustedSession(force=false){
    if(!this.#trustThisDevice||this.aal!=='aal2'||!this.#refreshToken)return;
    if(!force && Date.now()-this.#lastTrustWrite<60000)return;
    await this.#ensureSession();
    await saveTrustedSession(this.#refreshToken,Date.now());
    this.#lastTrustWrite=Date.now();
  }
  async recordUserActivity(){
    if(this.#trustThisDevice && this.aal==='aal2')
      await this.#writeTrustedSession();
  }
  async restoreTrustedDevice(){
    const stored=await loadTrustedSession();
    if(!stored)return null;
    try{
      this.clear();
      const data=await this.#request('/auth/v1/token?grant_type=refresh_token',{
        method:'POST',body:{refresh_token:stored.refreshToken},auth:false});
      this.#adopt(data);
      if(this.aal!=='aal2')throw Error('É necessário confirmar o segundo fator novamente.');
      const identity=await this.#request('/auth/v1/user');
      if(!identity?.id || identity.id!==this.#userId)throw Error('Sessão de usuário inválida.');
      this.#trustThisDevice=true;
      await this.#writeTrustedSession(true);
      return {email:this.#email,aal:this.aal,restored:true};
    }catch{
      this.clear();this.#trustThisDevice=false;await clearTrustedSession();
      return null;
    }
  }
  async signUp(email,password) {
    if (!email || String(password).length<12) throw Error('Informe e-mail e senha com pelo menos 12 caracteres.');
    this.clear();
    const callback='https://lacrosetecnologia.com.br/lkzisp/';
    const d=await this.#request('/auth/v1/signup?redirect_to='+encodeURIComponent(callback),{method:'POST',body:{email:String(email).trim().slice(0,250),password:String(password)},auth:false});
    if (d.access_token) this.#adopt(d);
    return {confirmationRequired:!d.access_token};
  }

  async requestPasswordReset(email){
    const address=String(email||'').trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length>254)
      throw Error('Informe seu e-mail válido.');
    await this.#request('/auth/v1/recover?redirect_to='+encodeURIComponent('https://lacrosetecnologia.com.br/lkzisp/'),{
      method:'POST',body:{email:address},auth:false});
    return {sent:true};
  }
  async handleAuthCallback(){
    if(typeof location==='undefined'||!location.hash)return null;
    const raw=location.hash.slice(1);
    const args=new URLSearchParams(raw);
    if(!args.has('access_token')||!args.has('refresh_token'))return null;
    const access=args.get('access_token'),refresh=args.get('refresh_token'),type=args.get('type');
    history.replaceState(null,'',location.pathname+location.search);
    if(!access||!refresh||access.length>8192||refresh.length>8192)throw Error('Link de autenticação inválido.');
    const h={apikey:PUBLIC_KEY,Authorization:'Bearer '+access,'Content-Type':'application/json'};
    const response=await this.#fetch(ROOT+'/auth/v1/user',{method:'GET',headers:h,cache:'no-store',signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw Error('Link de confirmação inválido ou expirado.');
    const user=await response.json();
    if(!user?.id||!user?.email)throw Error('Identidade não confirmada.');
    this.clear();
    this.#adopt({access_token:access,refresh_token:refresh,expires_in:Number(args.get('expires_in')||1800),user});
    this.#recovery=type==='recovery';
    return {email:this.email,recovery:this.#recovery};
  }
  async setRecoveredPassword(newPassword){
    if(!this.#recovery)throw Error('Use um link de recuperação válido.');
    if(typeof newPassword!=='string'||newPassword.length<12||newPassword.length>200)
      throw Error('Nova senha deve conter 12 a 200 caracteres.');
    await this.#ensureSession();
    await this.#request('/auth/v1/user',{method:'PUT',body:{password:newPassword}});
    this.clear();
    return {changed:true};
  }
  async #ensureSession() {
    if (!this.#token) throw Error('Faça login primeiro.');
    if (Date.now()+60000 < this.#expiresAt) return;
    const d=await this.#request('/auth/v1/token?grant_type=refresh_token',{
      method:'POST',body:{refresh_token:this.#refreshToken},auth:false});
    this.#adopt(d);
  }
  async listFactors() {
    await this.#ensureSession();
    const result=await this.#request('/auth/v1/user');
    if(!result?.id || result.id!==this.#userId || !Array.isArray(result.factors))
      throw Error('Não foi possível verificar o autenticador existente. Entre novamente.');
    return result.factors.filter(x=>x?.factor_type==='totp' || x?.type==='totp');
  }
  async enrollTotp() {
    await this.#ensureSession();
    const factors=await this.listFactors();
    if(factors.some(f=>f.status==='verified')) throw Error('Seu autenticador já está ativo. Confirme o código existente.');
    if(factors.length) throw Error('Há um autenticador pendente nesta conta. Não crie um duplicado.');
    const d=await this.#request('/auth/v1/factors',{method:'POST',body:{factor_type:'totp',friendly_name:'LKZ ISP Intelligence'}});
    if (!d.id || !d.totp?.secret) throw Error('Não foi possível iniciar autenticação em dois fatores.');
    this.#factor={id:d.id,secret:d.totp.secret};
    return this.factor;
  }
  async verifyTotp(code,factorId=null) {
    if (!/^\d{6}$/.test(String(code))) throw Error('Informe o código de seis dígitos.');
    await this.#ensureSession();
    const id=factorId||this.#factor?.id;
    if (!id || !/^[0-9a-f-]{20,50}$/i.test(id)) throw Error('Selecione o autenticador cadastrado.');
    const challenge=await this.#request('/auth/v1/factors/'+encodeURIComponent(id)+'/challenge',{method:'POST',body:{}});
    if (!challenge?.id) throw Error('Não foi possível iniciar o desafio do autenticador.');
    const result=await this.#request('/auth/v1/factors/'+encodeURIComponent(id)+'/verify',{
      method:'POST',body:{challenge_id:challenge.id,code:String(code)}});
    this.#adopt(result);
    this.#factor=null;
    if(this.#trustThisDevice)await this.#writeTrustedSession(true);
    if (this.aal!=='aal2') throw Error('Segundo fator não confirmado pelo servidor.');
    return {email:this.#email,aal:this.aal};
  }
  async readMemberships() {
    await this.#ensureSession();
    if (this.aal!=='aal2') throw Error('Ative e confirme a autenticação em dois fatores antes de acessar os dados.');
    const result=await this.#request('/rest/v1/lkz_isp_memberships?select=tenant_id,role,sector_id&limit=20');
    if (!Array.isArray(result)) throw Error('Consulta de vínculo inválida.');
    return result.map(x=>({tenant_id:String(x.tenant_id||''),role:String(x.role||''),sector_id:x.sector_id?String(x.sector_id):null}));
  }
  async activateFirstMaster(){
    await this.#ensureSession();
    if(this.aal!=='aal2' || this.email?.toLowerCase()!=='lacrose.igor@gmail.com')
      throw Error('E-mail do proprietário e MFA confirmado são obrigatórios.');
    const data=await this.#request('/functions/v1/lkzisp-owner-bootstrap',{
      method:'POST',body:{action:'activate_master'}});
    if (!['activated','already_active'].includes(data?.status))
      throw Error('Ativação não confirmada pelo servidor.');
    return {status:data.status};
  }
  async listAggregateSnapshots(tenant_id){
    await this.#ensureSession();
    if(this.aal!=='aal2')throw Error('MFA obrigatório para indicadores.');
    if(!/^[0-9a-f-]{36}$/i.test(String(tenant_id||'')))throw Error('Empresa inválida.');
    const results=[];
    // Paginação determinística: a versão anterior consultava somente os últimos 250.
    // O bloqueio de duplicidade já existe no banco; esta paginação permite
    // reconhecer também importações anteriores após meses de uso.
    const pageSize=250;
    for(let offset=0;offset<10000;offset+=pageSize){
      const batch=await this.#request('/rest/v1/lkz_isp_aggregate_snapshots?select=id,tenant_id,fingerprint,snapshot,created_at&tenant_id=eq.'+
        encodeURIComponent(tenant_id)+'&order=created_at.desc,id.desc&limit='+pageSize+'&offset='+offset);
      if(!Array.isArray(batch))throw Error('Resposta de indicadores inválida.');
      results.push(...batch);
      if(batch.length<pageSize)break;
      if(offset+pageSize>=10000)throw Error('Histórico acima do limite de consulta. Use filtros por período.');
    }
    return results.map(row=>{
      if(row.tenant_id!==tenant_id || !row.snapshot || row.fingerprint!==row.snapshot.fingerprint)
        throw Error('Falha de integridade no histórico de indicadores.');
      return {...row.snapshot,id:row.id,tenant_id:row.tenant_id};
    });
  }
  async saveAggregateSnapshot(tenant_id,snapshot){
    await this.#ensureSession();
    if(this.aal!=='aal2')throw Error('MFA obrigatório para importar.');
    if(!/^[0-9a-f-]{36}$/i.test(String(tenant_id||'')))throw Error('Empresa inválida.');
    if(!this.#userId || !snapshot || !/^[0-9a-f]{64}$/.test(String(snapshot.fingerprint||'')))
      throw Error('Resumo de indicadores inválido.');
    // Criar somente o registro canônico; identificadores de clientes, linhas e senha não podem entrar no payload.
    const {cleanBackupSnapshot}=await import('./backup.js');
    const clean=cleanBackupSnapshot(snapshot);
    clean.notes=['SLA do IXC não interpretado nesta versão.','Colaborador individual somente após pseudonimização segura no backend.'];
    let duplicate=false;
    try{
      await this.#request('/rest/v1/lkz_isp_aggregate_snapshots',{method:'POST',body:{tenant_id,
        fingerprint:clean.fingerprint,snapshot:clean,created_by:this.#userId}});
    }catch(e){
      // Em caso de resposta ambígua ou duplicação, somente a leitura de volta do banco pode confirmar a gravação.
      const records=await this.listAggregateSnapshots(tenant_id);
      if(!records.some(x=>x.fingerprint===clean.fingerprint))throw e;
      duplicate=true;
    }
    const rows=await this.listAggregateSnapshots(tenant_id);
    const saved=rows.find(row=>row.fingerprint===clean.fingerprint);
    if(!saved)throw Error('Gravação não confirmada no Supabase: não descarte o arquivo original.');
    return {snapshot:saved,records:rows,duplicate};
  }
  // Persistência atômica: resumo geral + nome/setor dos colaboradores, nunca clientes.
  async saveSnapshotWithEmployees(tenant_id,snapshot,employees){
    await this.#ensureSession();
    if(this.aal!=='aal2')throw Error('MFA obrigatório para importar.');
    if(!/^[0-9a-f-]{36}$/i.test(String(tenant_id||'')))throw Error('Empresa inválida.');
    if(!Array.isArray(employees)||employees.length>500||!snapshot||!/^[a-f0-9]{64}$/.test(String(snapshot.fingerprint||'')))
      throw Error('Relatório individual inválido.');
    const {cleanBackupSnapshot}=await import('./backup.js');
    const clean=cleanBackupSnapshot(snapshot);
    clean.notes=['SLA do IXC não interpretado nesta versão.','Colaborador individual somente após pseudonimização segura no backend.'];
    const safeEmployees=employees.map(x=>({
      name:String(x.name||''),sector:String(x.sector||''),
      total:x.total,finalized:x.finalized,pending:x.pending,
      closedWithDates:x.closedWithDates,closedOver24:x.closedOver24,pendingOlder7d:x.pendingOlder7d
    }));
    let uncertain=null;
    try{
      await this.#request('/rest/v1/rpc/lkz_isp_save_snapshot_with_employees',{
        method:'POST',body:{p_tenant:tenant_id,p_snapshot:clean,p_employees:safeEmployees}
      });
    }catch(err){uncertain=err;}
    const records=await this.listAggregateSnapshots(tenant_id);
    const saved=records.find(x=>x.fingerprint===clean.fingerprint);
    if(!saved)throw uncertain||Error('Gravação não confirmada. Preserve o arquivo original.');
    const persisted=await this.readEmployeeMetrics(tenant_id,clean.fingerprint);
    if(uncertain||persisted.length!==safeEmployees.length)
      throw uncertain||Error('Indicadores individuais não confirmados; preserve o arquivo original.');
    return {records,snapshot:saved,employees:persisted};
  }
  async readEmployeeMetrics(tenant_id,fingerprint){
    await this.#ensureSession();
    if(this.aal!=='aal2')throw Error('MFA obrigatório.');
    if(!/^[0-9a-f-]{36}$/i.test(String(tenant_id||''))||!/^[a-f0-9]{64}$/.test(String(fingerprint||'')))
      throw Error('Empresa ou relatório inválido.');
    const rows=await this.#request('/rest/v1/lkz_isp_employee_metrics?select=employee_name,sector_label,total,finalized,pending,closed_with_dates,closed_over_24,pending_older_7d&tenant_id=eq.'+
      encodeURIComponent(tenant_id)+'&snapshot_fingerprint=eq.'+encodeURIComponent(fingerprint)+'&limit=500');
    if(!Array.isArray(rows))throw Error('Resposta individual inválida.');
    return rows.map(x=>({name:x.employee_name,sector:x.sector_label,total:x.total,finalized:x.finalized,pending:x.pending,
      closedWithDates:x.closed_with_dates,closedOver24:x.closed_over_24,pendingOlder7d:x.pending_older_7d}));
  }
  async createInvitation({tenant_id,invited_email,requested_role,sector_id=null}) {
    await this.#ensureSession();
    if(this.aal!=='aal2')throw Error('MFA obrigatório para gerir convites.');
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const email=String(invited_email||'').trim().toLowerCase();
    if(!uuid.test(String(tenant_id)) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254)
      throw Error('Empresa e e-mail válidos são obrigatórios.');
    if(!['gestor','administrador','lider_setor','financeiro'].includes(requested_role))
      throw Error('O grupo MASTER não pode ser criado por convite.');
    const needSector=['lider_setor','financeiro'].includes(requested_role);
    if(needSector!==Boolean(sector_id) || (sector_id&&!uuid.test(sector_id)))
      throw Error('Setor deve ser informado apenas para Líder ou Financeiro.');
    const memberships=await this.readMemberships();
    const authorized=memberships.some(m=>m.tenant_id===tenant_id &&
      ['master','gestor','administrador'].includes(m.role) &&
      (requested_role!=='gestor'||['master','gestor'].includes(m.role)));
    if(!authorized)throw Error('Seu perfil não autoriza esse convite.');
    const data=await this.#request('/rest/v1/lkz_isp_user_invitations',{
      method:'POST',body:{tenant_id,invited_email:email,requested_role,
        ...(sector_id?{sector_id}:{}) ,created_by:this.#userId}
    });
    return {saved:true,data}; // Somente registro pendente; nenhum e-mail é enviado por esta API.
  }
  async readAudit(tenant_id) {
    await this.#ensureSession();
    if(this.aal!=='aal2')throw Error('MFA obrigatório para auditoria.');
    if(!/^[0-9a-f-]{36}$/i.test(String(tenant_id||'')))throw Error('Empresa inválida.');
    const items=await this.#request('/rest/v1/lkz_isp_audit_events?select=event_name,audit_visibility,occurred_at&tenant_id=eq.'+
      encodeURIComponent(tenant_id)+'&order=occurred_at.desc&limit=30');
    if(!Array.isArray(items))throw Error('Não foi possível consultar a auditoria.');
    return items;
  }
  clear() {
    this.#token = null; this.#refreshToken = null; this.#factor = null;
    this.#expiresAt=0; this.#email=null; this.#userId=null; this.#recovery=false;
  }
  async signOut() {
    await clearTrustedSession();this.#trustThisDevice=false;
    if (this.#token) {try {await this.#request('/auth/v1/logout',{method:'POST'});} catch { /* best effort */ }}
    this.clear();
  }
}
