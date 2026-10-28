/**
 * LKZ ISP Intelligence - armazenamento VOLÁTIL de desenvolvimento.
 * Gate de segurança: sem identidade/autorização, jamais persistir
 * indicadores empresariais em IndexedDB ou storage do navegador.
 * IMPORTANTE: é proposital perder a sessão quando a aba recarrega.
 */
const snapshots = new Map();
const settings = new Map();
export async function getAllSnapshots(){return Array.from(snapshots.values()).map(v=>structuredClone(v));}
export async function saveSnapshot(snapshot){
  const rec={...structuredClone(snapshot),id:crypto.randomUUID()};
  snapshots.set(rec.id,rec);
  return structuredClone(rec);
}
export async function getSetting(id){
  return settings.has(id)?{id,value:structuredClone(settings.get(id))}:undefined;
}
export async function saveSetting(id,value){settings.set(id,structuredClone(value));}
export async function deleteSnapshots(){
  snapshots.clear();settings.clear();
  // Somente sob ação explícita do usuário, remover snapshots locais de versões antigas.
  if(typeof indexedDB==='undefined')return;
  await new Promise((resolve,reject)=>{
    const request=indexedDB.deleteDatabase('lkz-isp-intelligence-local');
    request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Feche outras abas do LKZ ISP para remover dados antigos.'));
  });
}
