/* Apenas recursos estáticos podem ser armazenados offline.
 * Nunca interceptar endpoints, dados empresariais, documentos ou respostas autenticadas.
 */
const CACHE='lkz-isp-static-v136';
const ASSETS=['./','./index.html','./styles.css?v=134','./src/app.js?v=136','./src/cloud-auth.js?v=135','./src/gestor-simple.js?v=136','./src/gestor-simple.css?v=1','./src/trusted-session.js','./src/engine.js','./src/employee-analytics.js','./src/quality.js','./src/review-analysis.js','./src/importer.js','./src/db.js','./src/roles.js','./src/branding.js','./src/backup.js','./src/offline-crypto.js','./assets/jszip.min.js','./assets/icon.svg','./manifest.webmanifest'];
const staticURLs = new Set(ASSETS.map(p=>new URL(p,self.registration.scope).href));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('lkz-isp-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  if(req.mode==='navigate'){
    event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>caches.match('./index.html')));
    return;
  }
  if(!staticURLs.has(req.url))return; // Fail closed; não fazer cache dinâmico.
  event.respondWith(caches.match(req).then(cached=>cached||fetch(req,{cache:'no-store'}).then(response=>{
    if(response.ok&&response.type==='basic')return caches.open(CACHE).then(c=>c.put(req,response.clone())).then(()=>response);
    return response;
  })));
});
