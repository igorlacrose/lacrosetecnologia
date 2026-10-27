/* LKZ Demo — SW v3; preserve IndexedDB, refresh assets on connection. */
const CACHE='lkz-web-demo-static-v3';
const FILES=['./','./index.html','./style.css?v=20261027-fiscal','./app.mjs','./core.mjs','./fiscal-demo.mjs','./manifest.webmanifest','./assets/icon.svg'];
const SCOPE=new URL('./',self.location.href).href;
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('lkz-web-demo-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(SCOPE))return;
 event.respondWith((async()=>{const c=await caches.open(CACHE);try{const res=await fetch(req);if(res.ok&&res.type==='basic')await c.put(req,res.clone());return res}catch(error){const hit=await c.match(req);if(hit)return hit;if(req.mode==='navigate'){const page=await c.match('./index.html');if(page)return page}throw error}})());
});