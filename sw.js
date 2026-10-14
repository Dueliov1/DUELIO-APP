// Service worker Duelio — permet à l'appli installée de s'ouvrir même sans connexion,
// en mettant en cache la coquille de l'appli (le fichier index.html) au premier chargement.
const CACHE_NAME = 'duelio-shell-v25';
const APP_SHELL = ['./', './index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(()=>{
      // si la mise en cache initiale échoue (ex: hors ligne à l'installation), on continue quand même
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return;

  // La coquille de l'appli (le HTML) : on sert le cache en priorité pour une ouverture
  // instantanée hors ligne, et on met à jour le cache en arrière-plan dès que le réseau répond.
  if(req.mode === 'navigate' || req.url.endsWith('/index.html') || req.url.endsWith('/')){
    event.respondWith(
      caches.match('./index.html').then((cached) => {
        const network = fetch(req).then((res) => {
          if(res && res.ok){
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', res.clone()));
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Le reste (appels API, polices...) : on privilégie toujours le réseau, sans jamais bloquer
  // l'appli si l'utilisateur est hors ligne (les vraies données ne sont simplement pas dispo).
});
