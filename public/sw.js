// Çevrimdışı çalışma: uygulama kabuğu ilk açılışta önbelleğe alınır.
// Sürüm numarasını her güncellemede artırın (eski önbellek silinir).
const VERSION = 'bep-web-v2.5.0';
const SHELL = ['./', './index.html', './manifest.webmanifest', './gizlilik.html',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin || req.url.includes('/api/') || req.url.includes('config.js')) return;
  // Önce ağ (güncel sürüm), ağ yoksa önbellek
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
