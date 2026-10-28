/** Matriz de UX. Autorização verdadeira: RLS/trigger no Supabase. */
export const GROUPS = Object.freeze([
 {id:'master',name:'MASTER',description:'Autoridade global; revisões não destrutivas e auditoria integral reservada.'},
 {id:'gestor',name:'Gestor',description:'Visão global e aprovação/reprovação auditada de resultados. Sem acesso a configurações nem importações.'},
 {id:'administrador',name:'Administrador',description:'Visão global somente leitura; relatórios e impressão, sem aprovações.'},
 {id:'lider_setor',name:'Líder de setor',description:'Somente leitura do próprio setor.'},
 {id:'financeiro',name:'Financeiro',description:'Consulta e relatórios apenas do próprio setor, sem alterações financeiras.'}
]);
export const PERMISSIONS=Object.freeze(['setor','global','finance_setor','finance_write','settings_write','invite_staff','invite_gestor','audit_regular','audit_master']);
const rights=Object.freeze({
 master:['setor','global','finance_setor','finance_write','settings_write','invite_staff','invite_gestor','audit_regular','audit_master'],
 gestor:['setor','global','finance_setor'],
 administrador:['setor','global','finance_setor'],
 lider_setor:['setor'],
 financeiro:['finance_setor']
});
export function describeAccess(role,permission){return rights[role]?.includes(permission)?'Permitido':'Negado';}
export function mayInvite(role,target){
 if(role!=='master')return false;
 if(!['gestor','administrador','lider_setor','financeiro'].includes(target))return false;
 return true;
}
export function isPrivilegedAuditVisible(viewerRole,actorRole){
 return actorRole==='master'?viewerRole==='master':['master','gestor'].includes(viewerRole);
}
