'use strict';
const CACHE_PREFIX = 'lacrose-flux:' + self.registration.scope + ':';
const CACHE = CACHE_PREFIX + 'v2';
const SHELL = ['./','./index.html','./manifest.webmanifest','./pwa.js','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./lacrose-tecnologia.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  const known = SHELL.some(path => new URL(path,self.registration.scope).href === url.href);
  if(event.request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match('./index.html')) || fetch(event.request)));
  } else if(known) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request)) || fetch(event.request)));
  }
});
