/* LKZ ERP Web Demo v0.1.1: atualização sem perder IndexedDB */
const CACHE='lkz-web-demo-static-v2';
const FILES=['./','./index.html','./style.css?v=20261027-contrast','./app.mjs','./core.mjs','./manifest.webmanifest','./assets/icon.svg'];
const SCOPE=new URL('./',self.location.href).href;
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('lkz-web-demo-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const req=event.request;
 const url=new URL(req.url);
 if(req.method!=='GET'||!url.href.startsWith(SCOPE)||url.origin!==self.location.origin)return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  try{
   const res=await fetch(req);
   if(res.ok&&res.type==='basic')await cache.put(req,res.clone());
   return res;
  }catch(err){
   const hit=await cache.match(req);
   if(hit)return hit;
   if(req.mode==='navigate'){
    const page=await cache.match('./index.html');
    if(page)return page;
   }
   throw err;
  }
 })());
});
