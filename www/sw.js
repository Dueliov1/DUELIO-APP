// Service worker Duelio.
//
// Deux rôles, et ils demandent deux stratégies opposées :
//
// 1. La page elle-même (index.html) : RÉSEAU D'ABORD. L'ancienne version servait le
//    cache en priorité, ce qui voulait dire qu'après chaque déploiement les
//    utilisateurs voyaient encore la version précédente au premier chargement, et la
//    nouvelle seulement au suivant. Une correction mettait donc deux visites à
//    arriver. On va maintenant chercher le réseau en premier, avec un délai court :
//    si le réseau ne répond pas à temps, on sert le cache plutôt que de faire attendre.
//
// 2. Les données (index de recherche, carrières des joueurs) : CACHE D'ABORD. Ces
//    fichiers ne changent qu'au moissonnage. Les servir depuis le cache rend les
//    visites suivantes instantanées, et rend surtout l'application utilisable hors
//    ligne : avant, elle s'ouvrait vide.

const VERSION = 'v26';
const CACHE_COQUILLE = 'duelio-shell-' + VERSION;
const CACHE_DONNEES = 'duelio-data-' + VERSION;
const COQUILLE = ['./', './index.html'];

// Au-delà de ce délai on considère le réseau trop lent et on sert le cache.
const DELAI_RESEAU_MS = 2500;
// Plafond du cache de données : une carrière pèse environ 5 Ko compressée, donc
// 600 entrées restent très raisonnables sur un téléphone.
const MAX_DONNEES = 600;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_COQUILLE).then((c) => c.addAll(COQUILLE)).catch(() => {
      // hors ligne à l'installation : on continue quand même
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((noms) => Promise.all(
      noms.filter((n) => n !== CACHE_COQUILLE && n !== CACHE_DONNEES)
          .map((n) => caches.delete(n))
    )).then(() => self.clients.claim())
  );
});

// Garde le cache de données sous son plafond, en retirant les plus anciennes entrées.
async function elaguer(cache){
  const cles = await cache.keys();
  if(cles.length <= MAX_DONNEES) return;
  await Promise.all(cles.slice(0, cles.length - MAX_DONNEES).map((k) => cache.delete(k)));
}

// Réseau d'abord, cache en secours, avec un délai pour ne jamais bloquer l'affichage.
async function coquille(req){
  const cache = await caches.open(CACHE_COQUILLE);
  const enCache = await cache.match('./index.html');

  const reseau = fetch(req).then((res) => {
    if(res && res.ok) cache.put('./index.html', res.clone());
    return res;
  });

  if(!enCache) return reseau;

  // On laisse au réseau le temps imparti ; passé ce délai, le cache prend la main,
  // et la réponse réseau continue en arrière-plan pour rafraîchir le cache.
  const attente = new Promise((resolve) => setTimeout(() => resolve(null), DELAI_RESEAU_MS));
  const gagnant = await Promise.race([reseau.catch(() => null), attente]);
  return gagnant || enCache;
}

// Cache d'abord : ces fichiers ne changent qu'au moissonnage. On rafraîchit en
// arrière-plan pour que la prochaine visite ait la version à jour.
async function donnees(req){
  const cache = await caches.open(CACHE_DONNEES);
  const enCache = await cache.match(req);

  const reseau = fetch(req).then((res) => {
    if(res && res.ok){
      cache.put(req, res.clone()).then(() => elaguer(cache)).catch(() => {});
    }
    return res;
  }).catch(() => null);

  if(enCache){
    reseau.catch(() => {});   // rafraîchissement silencieux
    return enCache;
  }
  const res = await reseau;
  return res || new Response('{}', { status: 504, headers: { 'Content-Type': 'application/json' } });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch(e) { return; }

  if(req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname === '/'){
    event.respondWith(coquille(req));
    return;
  }

  // Index de recherche et carrières des joueurs, servis depuis notre propre domaine.
  if(/\/data\/(full|players|search[\w-]*\.json)/.test(url.pathname)){
    event.respondWith(donnees(req));
    return;
  }

  // Tout le reste (appels à l'API, polices) : réseau direct, sans interception.
});
