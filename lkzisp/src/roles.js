/** Matriz de UX. Autorização verdadeira: RLS/trigger no Supabase. */
export const GROUPS = Object.freeze([
 {id:'master',name:'MASTER',description:'Autoridade global; revisões não destrutivas e auditoria integral reservada.'},
 {id:'gestor',name:'Gestor',description:'Gestão da empresa; pode convidar outros gestores e demais grupos.'},
 {id:'administrador',name:'Administrador',description:'Visão global em leitura; pode convidar administrativo, líderes e financeiro.'},
 {id:'lider_setor',name:'Líder de setor',description:'Somente leitura do próprio setor.'},
 {id:'financeiro',name:'Financeiro',description:'Somente seu setor financeiro; correções exigem evidência e aprovação.'}
]);
export const PERMISSIONS=Object.freeze(['setor','global','finance_setor','finance_write','settings_write','invite_staff','invite_gestor','audit_regular','audit_master']);
const rights=Object.freeze({
 master:['setor','global','finance_setor','finance_write','settings_write','invite_staff','invite_gestor','audit_regular','audit_master'],
 gestor:['setor','global','finance_setor','finance_write','settings_write','invite_staff','invite_gestor','audit_regular'],
 administrador:['setor','global','finance_setor','invite_staff'],
 lider_setor:['setor'],
 financeiro:['finance_setor','finance_write']
});
export function describeAccess(role,permission){return rights[role]?.includes(permission)?'Permitido':'Negado';}
export function mayInvite(role,target){
 if(!['administrador','gestor','master'].includes(role))return false;
 if(!['gestor','administrador','lider_setor','financeiro'].includes(target))return false;
 return target!=='gestor'||role==='gestor'||role==='master';
}
export function isPrivilegedAuditVisible(viewerRole,actorRole){
 return actorRole==='master'?viewerRole==='master':['master','gestor'].includes(viewerRole);
}
