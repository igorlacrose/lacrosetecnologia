const PREFIX='lacrose-card:'+self.registration.scope+':';
const CACHE=PREFIX+'v6-premium-approved';
const ASSETS=['./','index.html','styles.css','actions.js','art-card.webp','qr.png','manifest.webmanifest','icon-192.png','icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin||!u.href.startsWith(self.registration.scope))return;
event.respondWith((async()=>{const cache=await caches.open(CACHE);if(event.request.mode==='navigate'){try{const res=await fetch(event.request);if(res.ok)await cache.put(event.request,res.clone());return res;}catch{return(await cache.match(event.request))||(await cache.match('index.html'))||Response.error();}}return(await cache.match(event.request))||fetch(event.request);})());});
