/**
 * Worker Duelio — proxy API-Football, index des joueurs et « pack » d'un joueur.
 *
 * Nécessite :
 *   - Secret  API_FOOTBALL_KEY   la clé API-Football
 *   - Secret  INDEX_BUILD_KEY    OBLIGATOIRE : protège /diag, /diag/usage, /index/status et
 *                                /index/build, et sert de laissez-passer aux sondes (en-tête
 *                                X-Duelio-Key) qui appellent le proxy sans navigateur
 *   - Espace KV lié sous le nom INDEX_KV  (Settings → Bindings → KV Namespace) : index des joueurs
 *   - Déclencheur Cron  "*\/5 * * * *"  (Settings → Triggers → Cron Triggers) : construit et
 *     rafraîchit l'index tout seul, une ligue à la fois, sans jamais dépasser le quota
 *   - Facultatif : RELAY_URL + RELAY_SECRET (relais à IP dédiée), API_PLAN / API_RPM / API_RPS
 *
 * Les comptes utilisateurs ne passent plus par ici (Firebase) : les routes /auth et
 * /favorites ont été retirées avec leur base D1 et l'envoi d'e-mails.
 *
 * Qui peut appeler ce proxy : les navigateurs dont l'origine est dans ORIGINES_AUTORISEES
 * (le site et l'application), et les outils qui présentent la clé INDEX_BUILD_KEY. Tout le
 * reste est refusé : un proxy ouvert à tous laissait n'importe qui vider le quota API.
 *
 * Index des joueurs (recherche instantanée dans l'appli) :
 *   GET /index.json      la liste compacte des joueurs des championnats indexés (cache 1 h)
 *   GET /index/status    état de l'index : ligues, nombre de joueurs, dernière mise à jour
 *   GET /index/build     lance une étape de construction à la main (utile au premier déploiement)
 */

const API_BASE = 'https://v3.football.api-sports.io';
const ALLOWED_ENDPOINTS = [
  'players', 'players/profiles', 'players/seasons',
  'teams', 'leagues', 'standings', 'trophies', 'transfers',
  'fixtures', 'coachs', 'countries', 'status'
];

/* ---------------- INDEX DES JOUEURS (recherche instantanée) ----------------
 * Les championnats indexés. Pour en ajouter un : son identifiant API-Football
 * (ex. 94 = Liga Portugal, 307 = Saudi Pro League, 2 = Ligue des champions).
 */
const INDEX_LEAGUES = [
  { id: 61,  name: 'Ligue 1' },
  { id: 39,  name: 'Premier League' },
  { id: 140, name: 'La Liga' },
  { id: 135, name: 'Serie A' },
  { id: 78,  name: 'Bundesliga' },
];
const INDEX_KEY = 'players-index-v1';     // clé dans KV
const INDEX_PAGES_PER_RUN = 20;           // pages API par exécution : reste sous les 50 sous-requêtes du plan Workers gratuit
const INDEX_REFRESH_HOURS = 24;           // une ligue n'est reconstruite que si elle a plus de 24 h
const INDEX_EDGE_TTL = 3600;              // /index.json servi depuis le cache Cloudflare pendant 1 h
const INDEX_CACHE_URL = 'https://duelio-index.internal/index.json'; // clé fixe du cache, indépendante du domaine
const CACHE_TTL_SECONDS = 60 * 30;
const CACHE_VERSION = 'v3';   // changer ce numéro vide tout le cache edge
/* Les origines qui ont le droit d'appeler le proxy : le site, le futur domaine, et
 * l'application Capacitor (https://localhost sur Android, capacitor://localhost sur iOS).
 * En développement local, http://localhost sur n'importe quel port. */
const ORIGINES_AUTORISEES = [
  'https://duelio-app.bensouna-ahmed.workers.dev',
  'https://duelio.app', 'https://www.duelio.app',
  'https://localhost', 'capacitor://localhost', 'ionic://localhost',
];
function origineAutorisee(origin){
  if (!origin) return false;
  if (ORIGINES_AUTORISEES.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
// Un outil (sonde GitHub, script) se présente avec la clé dans l'en-tête X-Duelio-Key ou ?key=.
function cleValide(request, env, url){
  if (!env.INDEX_BUILD_KEY) return false;
  const k = request.headers.get('X-Duelio-Key') || (url && url.searchParams.get('key')) || '';
  return k === env.INDEX_BUILD_KEY;
}
let origineCourante = null;   // posée au début de chaque requête, reprise par corsHeaders()

function corsHeaders(){
  return {
    'Access-Control-Allow-Origin': origineCourante || 'null',
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Duelio-Key',
    // L'appli lit ces en-têtes pour respecter la limite par minute de l'abonnement et savoir si la réponse venait du cache
    'Access-Control-Expose-Headers': 'X-Duelio-Cache, X-Duelio-Pack, X-Duelio-Attempts, X-Duelio-Rpm, X-Duelio-Rps, X-Duelio-Plan, X-RateLimit-Limit, X-RateLimit-Remaining, X-Requests-Limit, X-Requests-Remaining',
  };
}
// En-têtes de quota renvoyés par API-Football (par minute et par jour), retransmis à l'appli
function rateLimitHeaders(apiResponse){
  const out = {};
  const pairs = [['X-RateLimit-Limit','X-RateLimit-Limit'], ['X-RateLimit-Remaining','X-RateLimit-Remaining'],
                 ['x-ratelimit-requests-limit','X-Requests-Limit'], ['x-ratelimit-requests-remaining','X-Requests-Remaining']];
  for (const [from, to] of pairs) { const v = apiResponse.headers.get(from); if (v !== null) out[to] = v; }
  return out;
}
function json(data, status=200){
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type':'application/json', ...corsHeaders() } });
}
function html(str, status=200){
  return new Response(str, { status, headers: { 'Content-Type':'text/html;charset=UTF-8', ...corsHeaders() } });
}
// Saison API-Football en cours : 2026 pour la saison 2026-27 (bascule en juillet)
function currentSeason(){
  const d = new Date();
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}
function posCode(apiPos){
  const p = (apiPos || '').toLowerCase();
  if (p.includes('goal')) return 'GK';
  if (p.includes('def')) return 'DEF';
  if (p.includes('mid')) return 'MID';
  return 'FWD';
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ============ APPEL À API-FOOTBALL : EN DIRECT OU VIA UN RELAIS ============
 * API-Football bloque au niveau réseau les adresses IP partagées, et Cloudflare
 * Workers n'en utilise pas d'autres. Si les variables RELAY_URL et RELAY_SECRET
 * sont définies, le Worker passe par ce relais, installé sur une machine à IP
 * dédiée, qui détient la clé. Sinon il appelle l'API directement, comme avant.
 */
function usingRelay(env){ return !!(env.RELAY_URL && env.RELAY_SECRET); }
function callApi(env, pathAndQuery, init = {}){
  if (usingRelay(env)) {
    const base = String(env.RELAY_URL).replace(/\/+$/, '');
    return fetch(`${base}/${pathAndQuery}`, { ...init, headers: { 'X-Duelio-Secret': env.RELAY_SECRET, ...(init.headers || {}) } });
  }
  return fetch(`${API_BASE}/${pathAndQuery}`, { ...init, headers: { 'x-apisports-key': env.API_FOOTBALL_KEY, ...(init.headers || {}) } });
}

/* ================= LIMITEUR DE DÉBIT CÔTÉ WORKER =================
 * API-Football limite À LA FOIS par minute ET par seconde, et son pare-feu peut bloquer
 * la clé OU l'adresse IP en cas d'abus répété. On ne dépasse donc jamais le plafond :
 * les appels en trop attendent ici au lieu de partir et de se faire refuser.
 *
 * Limites officielles (api-football.com/news/post/how-ratelimit-works) :
 *   Free 10/min · Pro 300/min ou 5/s · Ultra 450/min ou 7/s · Mega 900/min ou 15/s
 *
 * Réglable sans toucher au code, via les variables d'environnement :
 *   API_PLAN = free | pro | ultra | mega        (défaut : pro)
 *   API_RPM / API_RPS = valeurs exactes          (prioritaires sur API_PLAN)
 *   API_SAFETY = marge de sécurité 0.1 à 1       (défaut : 0.8)
 *
 * Note : chaque isolate Cloudflare a son propre compteur. La marge par défaut (80 % du
 * plafond) laisse de quoi absorber plusieurs isolates en parallèle.
 */
const PLAN_LIMITS = { free: { rpm: 10, rps: 1 }, pro: { rpm: 300, rps: 5 }, ultra: { rpm: 450, rps: 7 }, mega: { rpm: 900, rps: 15 } };
const bucket = { minStart: 0, minCount: 0, secStart: 0, secCount: 0, blockedUntil: 0, waited: 0, refused: 0, apiCalls: 0, cacheHits: 0 };
// Offre détectée automatiquement auprès d'API-Football (/status), une fois par isolate.
// La variable API_PLAN, si elle est définie, reste prioritaire.
let detectedPlan = null, detectingPlan = null;
function detectPlan(env){
  if (detectedPlan || detectingPlan) return detectingPlan;
  detectingPlan = (async () => {
    try {
      const r = await callApi(env, 'status');
      const j = await r.json().catch(() => null);
      const name = j && j.response && j.response.subscription && j.response.subscription.plan;
      if (name && PLAN_LIMITS[String(name).toLowerCase()]) {
        detectedPlan = String(name).toLowerCase();
        console.log(JSON.stringify({ e: 'plan_detecte', plan: detectedPlan, limites: PLAN_LIMITS[detectedPlan] }));
      }
    } catch (e) { /* on gardera la valeur par défaut */ }
    finally { detectingPlan = null; }
  })();
  return detectingPlan;
}
function planLimits(env){
  const plan = String(env.API_PLAN || detectedPlan || 'pro').toLowerCase();
  const base = PLAN_LIMITS[plan] || PLAN_LIMITS.pro;
  let safety = parseFloat(env.API_SAFETY || '');
  if (!(safety > 0 && safety <= 1)) safety = 0.8;
  const rpm = parseInt(env.API_RPM || '', 10) || Math.max(1, Math.floor(base.rpm * safety));
  const rps = parseInt(env.API_RPS || '', 10) || Math.max(1, Math.floor(base.rps * safety));
  return { plan, rpm, rps, base };
}
// Attend qu'un créneau se libère. Rend false si l'attente dépasserait maxWaitMs.
async function acquireSlot(env, maxWaitMs = 8000, waitThroughBlock = false){
  const { rpm, rps } = planLimits(env);
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const now = Date.now();
    if (now - bucket.minStart >= 60000) { bucket.minStart = now; bucket.minCount = 0; }
    if (now - bucket.secStart >= 1000)  { bucket.secStart = now; bucket.secCount = 0; }
    let wait = 0;
    // Pare-feu déclenché : on se tait. Si le retrait dure encore longtemps, on rend la main
    // tout de suite plutôt que de faire patienter l'utilisateur pour rien.
    if (bucket.blockedUntil > now) {
      const d = bucket.blockedUntil - now;
      // waitThroughBlock : c'est la 2e tentative d'une requête déjà commencée, elle a le droit d'attendre.
      if (!waitThroughBlock && d > 800) { bucket.refused++; return false; }
      wait = d;
    }
    else if (bucket.minCount >= rpm)  wait = bucket.minStart + 60000 - now + 20;
    else if (bucket.secCount >= rps)  wait = bucket.secStart + 1000 - now + 20;
    if (wait <= 0) { bucket.minCount++; bucket.secCount++; return true; }
    if (now + wait > deadline) { bucket.refused++; return false; }
    bucket.waited++;
    await sleep(Math.min(wait, 250));
  }
}
// L'API nous dit où nous en sommes : on s'aligne sur ses compteurs.
function syncFromApi(apiResponse){
  const rem = parseInt(apiResponse.headers.get('X-RateLimit-Remaining') || '', 10);
  if (!isNaN(rem) && rem <= 1) bucket.blockedUntil = Math.max(bucket.blockedUntil, Date.now() + 5000);
}
// Durée de cache selon la nature de la donnée : plus c'est stable, plus on garde longtemps.
const DAY = 24 * 3600;
function cacheTtlFor(path, params){
  const season = parseInt(params.get('season') || '', 10);
  const closed = !isNaN(season) && season < currentSeason();
  if (path === 'countries') return 30 * DAY;                   // ne change jamais
  if (path === 'leagues' || path === 'teams') return 7 * DAY;  // très stable
  if (path === 'trophies' || path === 'transfers') return 2 * DAY;
  if (path === 'players/profiles' || path === 'players/seasons') return closed ? 30 * DAY : 2 * DAY;
  if (path === 'players') return closed ? 30 * DAY : CACHE_TTL_SECONDS;  // saison finie = figée
  if (path === 'standings') return closed ? 30 * DAY : 3600;
  if (path === 'fixtures') return closed ? 30 * DAY : 600;
  return CACHE_TTL_SECONDS;
}
// Clé de cache normalisée : mêmes paramètres dans un ordre différent = même entrée.
// Les paramètres anti-cache ajoutés par les navigateurs ou les tests sont ignorés.
const CACHE_IGNORED_PARAMS = new Set(['_', 't', 'ts', 'n', 'v', 'r', 'cb', 'nocache', 'rand']);
function normalizedCacheKey(url, path){
  const keep = [...url.searchParams.entries()]
    .filter(([k]) => !CACHE_IGNORED_PARAMS.has(k.toLowerCase()))
    .map(([k, v]) => [k.toLowerCase().trim(), String(v).trim()])
    .filter(([, v]) => v !== '')
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const qs = keep.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return new Request(`https://cache.duelio/${CACHE_VERSION}/${path}${qs ? '?' + qs : ''}`, { method: 'GET' });
}
// API-Football limite aussi le nombre de requêtes PAR SECONDE (le message d'erreur parle
// pourtant de la limite "par minute"). On espace donc les appels de la construction d'index.
const API_GAP_MS = 350;
async function apiGet(env, path, tries = 3){
  for (let attempt = 1; attempt <= tries; attempt++) {
    const r = await callApi(env, path);
    const j = await r.json().catch(() => null);
    const errs = j && j.errors;
    const hasErr = !!errs && (Array.isArray(errs) ? errs.length > 0 : Object.keys(errs).length > 0);
    const limited = r.status === 429 || (hasErr && /too many|rate ?limit/i.test(JSON.stringify(errs)));
    if (limited && attempt < tries) { await sleep(2000 * attempt); continue; }
    if (!r.ok || !j) throw new Error(`API-Football HTTP ${r.status}`);
    if (hasErr) throw new Error('API-Football : ' + JSON.stringify(errs));
    return j;
  }
}
async function readIndexDoc(env){
  if (!env.INDEX_KV) throw new Error('INDEX_KV non configuré (Settings → Bindings → KV Namespace, nom de variable INDEX_KV).');
  return (await env.INDEX_KV.get(INDEX_KEY, 'json')) || { v: 1, updatedAt: null, leagues: {}, build: null };
}

// Une étape de construction : au plus INDEX_PAGES_PER_RUN pages d'une seule ligue.
// Appelée par le Cron toutes les 5 minutes (et par /index/build). Si toutes les ligues
// ont moins de 24 h, ne fait rien : en régime normal, 5 étapes par jour, ~150 requêtes.
async function buildIndexStep(env){
  const doc = await readIndexDoc(env);
  const now = Date.now();
  let build = doc.build;

  if (!build) {
    let target = null, oldest = Infinity;
    for (const lg of INDEX_LEAGUES) {
      const L = doc.leagues[lg.id];
      const t = L && L.updatedAt ? Date.parse(L.updatedAt) : 0;
      if (t < oldest) { oldest = t; target = lg; }
    }
    if (now - oldest < INDEX_REFRESH_HOURS * 3600 * 1000) {
      return { done: true, skipped: true, reason: 'Index à jour.', nextRefreshInMinutes: Math.round((INDEX_REFRESH_HOURS * 3600 * 1000 - (now - oldest)) / 60000) };
    }
    build = { leagueId: target.id, name: target.name, season: currentSeason(), nextPage: 1, totalPages: null, partial: [] };
  }

  const seen = new Map(build.partial.map(p => [p.i, p]));
  let pagesDone = 0, finished = false;
  while (pagesDone < INDEX_PAGES_PER_RUN) {
    if (pagesDone > 0) await sleep(API_GAP_MS); // on n'enchaîne jamais deux appels d'affilée
    const j = await apiGet(env, `players?league=${build.leagueId}&season=${build.season}&page=${build.nextPage}`);
    pagesDone++;
    // Saison pas encore ouverte dans l'API : on repart sur la précédente (une seule fois)
    if (build.nextPage === 1 && (j.results || 0) === 0 && build.season === currentSeason()) {
      build.season = build.season - 1;
      continue;
    }
    const total = (j.paging && j.paging.total) || 1;
    build.totalPages = total;
    for (const e of (j.response || [])) {
      const pl = e.player || {};
      if (!pl.id) continue;
      const stats = e.statistics || [];
      const st = stats.find(x => x.league && x.league.id === build.leagueId) || stats[0] || {};
      seen.set(pl.id, {
        i: pl.id, n: pl.name || '', f: pl.firstname || '', l: pl.lastname || '',
        a: pl.age || null, c: pl.nationality || '',
        p: posCode(st.games && st.games.position),
        t: (st.team && st.team.name) || '', ti: (st.team && st.team.id) || null
      });
    }
    if (build.nextPage >= total) { finished = true; break; }
    build.nextPage++;
  }
  build.partial = [...seen.values()];

  if (finished) {
    doc.leagues[build.leagueId] = {
      name: build.name, season: build.season, updatedAt: new Date().toISOString(),
      count: build.partial.length, players: build.partial
    };
    doc.updatedAt = new Date().toISOString();
    doc.build = null;
  } else {
    doc.build = build;
  }
  await env.INDEX_KV.put(INDEX_KEY, JSON.stringify(doc));
  if (finished) { try { await caches.default.delete(new Request(INDEX_CACHE_URL)); } catch (e) {} }

  return {
    done: finished, league: build.name, season: build.season,
    pagesFetched: pagesDone, playersSoFar: build.partial.length,
    progress: finished ? 'ligue terminée' : `page ${build.nextPage} sur ${build.totalPages}`
  };
}

function indexStatus(doc){
  const leagues = INDEX_LEAGUES.map(lg => {
    const L = doc.leagues[lg.id];
    return { id: lg.id, name: lg.name, season: L ? L.season : null, players: L ? L.count : 0, updatedAt: L ? L.updatedAt : null };
  });
  return {
    updatedAt: doc.updatedAt || null,
    totalPlayers: leagues.reduce((s, l) => s + l.players, 0),
    leaguesReady: leagues.filter(l => l.players > 0).length + ' / ' + INDEX_LEAGUES.length,
    building: doc.build ? { league: doc.build.name, season: doc.build.season, nextPage: doc.build.nextPage, totalPages: doc.build.totalPages } : null,
    leagues
  };
}

// Journal d'usage (24 h glissantes) : permet de voir QUI consomme la clé via ce proxy.
const USAGE_KEY = 'usage-log-v1';
async function noteUsage(env, request, path, body){
  try {
    const log = (await env.INDEX_KV.get(USAGE_KEY, 'json')) || { hours: {} };
    const now = new Date();
    const hour = now.toISOString().slice(0, 13);
    const origin = request.headers.get('Origin') || request.headers.get('Referer') || 'inconnu';
    const host = origin === 'inconnu' ? 'inconnu' : (origin.split('/')[2] || origin);
    const limited = /too many|rate ?limit/i.test(body || '');
    const h = log.hours[hour] || { total: 0, refuses: 0, parSite: {}, parEndpoint: {} };
    h.total++; if (limited) h.refuses++;
    h.parSite[host] = (h.parSite[host] || 0) + 1;
    h.parEndpoint[path] = (h.parEndpoint[path] || 0) + 1;
    log.hours[hour] = h;
    for (const k of Object.keys(log.hours)) { if (k < new Date(Date.now() - 24*3600*1000).toISOString().slice(0,13)) delete log.hours[k]; }
    await env.INDEX_KV.put(USAGE_KEY, JSON.stringify(log));
  } catch (e) { /* le journal ne doit jamais casser une réponse */ }
}


/* ============ UN APPEL API, AVEC CACHE, LIMITEUR, REPRISE ET JOURNAL ============
 * Utilisée par le proxy classique ET par /pack. Rend { json, response, cached, isError }.
 * `response` est prête à être renvoyée telle quelle au navigateur.
 */
async function apiCached(env, ctx, request, path, search, params, budgetMs){
  const cache = caches.default;
  const url = new URL(`https://x/${path}${search || ''}`);
  const cacheKey = normalizedCacheKey(url, path);
  const hit = await cache.match(cacheKey);
  if (hit) {
    bucket.cacheHits++;
    console.log(JSON.stringify({ e: 'cache_hit', path, q: cacheKey.url.split('?')[1] || '', hits: bucket.cacheHits, api: bucket.apiCalls }));
    const body = await hit.clone().text();
    const cached = new Response(body, hit);
    cached.headers.set('X-Duelio-Cache', 'HIT');
    ['X-RateLimit-Limit','X-RateLimit-Remaining','X-Requests-Limit','X-Requests-Remaining'].forEach(h => cached.headers.delete(h));
    Object.entries(corsHeaders()).forEach(([k, v]) => cached.headers.set(k, v));
    let j = null; try { j = JSON.parse(body); } catch (e) {}
    return { json: j, response: cached, cached: true, isError: false };
  }

  if (!detectedPlan && !env.API_PLAN) ctx.waitUntil(detectPlan(env) || Promise.resolve());
  const lim = planLimits(env);
  let apiResponse = null, body = '', isError = true, rateLimited = false, attempts = 0;
  const started = Date.now();
  // Budget court pour une demande isolée : mieux vaut répondre « réessayez » en 2 s que
  // faire attendre 10 s. Un pack, lui, a droit à plus : il économise 15 allers-retours.
  const MAX_TOTAL_MS = budgetMs || 2500;

  for (let attempt = 1; attempt <= 2; attempt++) {
    attempts = attempt;
    const left = MAX_TOTAL_MS - (Date.now() - started);
    const got = left > 150 && await acquireSlot(env, left, attempt > 1);
    if (!got) {
      console.log(JSON.stringify({ e: 'local_throttle', path, plan: lim.plan, rpm: lim.rpm, rps: lim.rps, minCount: bucket.minCount }));
      const out = new Response(JSON.stringify({
        errors: { rateLimit: "Trop de demandes en cours. Réessayez dans quelques secondes." }, results: 0, response: []
      }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '5', 'X-Duelio-Cache': 'THROTTLED', ...corsHeaders() } });
      return { json: null, response: out, cached: false, isError: true, throttled: true };
    }

    apiResponse = await callApi(env, `${path}${search || ''}`);
    bucket.apiCalls++;
    body = await apiResponse.text();
    syncFromApi(apiResponse);

    isError = !apiResponse.ok;
    rateLimited = apiResponse.status === 429;
    if (!isError) {
      try {
        const parsed = JSON.parse(body);
        const errs = parsed && parsed.errors;
        isError = !!errs && (Array.isArray(errs) ? errs.length > 0 : Object.keys(errs).length > 0);
        if (isError && /too many|rate ?limit/i.test(JSON.stringify(errs))) rateLimited = true;
      } catch (e) { isError = true; }
    }

    console.log(JSON.stringify({
      e: rateLimited ? 'api_rate_limited' : isError ? 'api_error' : 'api_ok',
      path, attempt, http: apiResponse.status, ms: Date.now() - started,
      quotaMin: apiResponse.headers.get('X-RateLimit-Remaining'),
      quotaJour: apiResponse.headers.get('x-ratelimit-requests-remaining'),
      apiCalls: bucket.apiCalls, cacheHits: bucket.cacheHits
    }));

    if (!rateLimited) break;
    bucket.blockedUntil = Math.max(bucket.blockedUntil, Date.now() + (attempt === 1 ? 800 : 3000));
    const left2 = MAX_TOTAL_MS - (Date.now() - started);
    if (attempt < 2 && left2 > 700) await sleep(500); else break;
  }

  if (env.INDEX_KV && request) ctx.waitUntil(noteUsage(env, request, path, body));

  const ttl = cacheTtlFor(path, params || url.searchParams);
  const out = new Response(body, {
    status: apiResponse.status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': isError ? 'no-store' : `public, max-age=${ttl}`,
      'X-Duelio-Cache': 'MISS',
      'X-Duelio-Attempts': String(attempts),
      'X-Duelio-Rpm': String(lim.rpm),
      'X-Duelio-Rps': String(lim.rps),
      'X-Duelio-Plan': lim.plan,
      ...rateLimitHeaders(apiResponse),
      ...corsHeaders(),
    },
  });
  if (!isError) ctx.waitUntil(cache.put(cacheKey, out.clone()));
  let j = null; try { j = JSON.parse(body); } catch (e) {}
  return { json: j, response: out, cached: false, isError };
}

/* ======================= /pack : TOUT EN UN SEUL ALLER-RETOUR =======================
 * Le téléphone demandait jusqu'à 17 fois de suite (1 liste de saisons + 15 saisons de
 * carrière + 1 profil), chaque demande coûtant un aller-retour réseau. Ici le Worker fait
 * tout le travail en parallèle, au bord du réseau, et renvoie UNE réponse.
 *
 *   /pack?id=114413              → saisons disponibles + la saison la plus récente qui a des données
 *   /pack?id=114413&season=2005  → saisons + cette saison précise
 *   /pack?id=114413&seasons=2005,2006,2007
 *   /pack?id=114413&career=1     → saisons + TOUTES les saisons (plafonnées)
 */
const PACK_MAX_SEASONS = 24;   // garde-fou : limite de sous-requêtes d'un Worker
async function handlePack(env, ctx, request, params){
  const id = parseInt(params.get('id') || '', 10);
  if (!id) return json({ error: 'Paramètre id manquant.' }, 400);

  const PACK_BUDGET_MS = 9000;
  const sr = await apiCached(env, ctx, request, 'players/seasons', `?player=${id}`, new URLSearchParams(`player=${id}`), PACK_BUDGET_MS);
  if (sr.throttled) return sr.response;
  const seasons = ((sr.json && sr.json.response) || []).map(Number).filter(Boolean).sort((a, b) => b - a);
  if (!seasons.length) {
    return json({ id, seasons: [], data: {}, erreur: (sr.json && sr.json.errors) || 'Aucune saison dans la base pour ce joueur.' },
      sr.isError ? 502 : 200);
  }

  let want;
  if (params.get('career') === '1') want = seasons.slice(0, PACK_MAX_SEASONS);
  else if (params.get('seasons')) want = params.get('seasons').split(',').map(x => parseInt(x, 10)).filter(x => seasons.includes(x)).slice(0, PACK_MAX_SEASONS);
  else if (params.get('season')) { const sn = parseInt(params.get('season'), 10); want = seasons.includes(sn) ? [sn] : [seasons[0]]; }
  else want = seasons.slice(0, 3);   // les 3 plus récentes : la 1re a souvent 0 match (saison à peine ouverte)

  // Tout en parallèle : c'est là que se joue la vitesse.
  const results = await Promise.all(want.map(sn =>
    apiCached(env, ctx, null, 'players', `?id=${id}&season=${sn}`, new URLSearchParams(`id=${id}&season=${sn}`), PACK_BUDGET_MS)
      .then(r => ({ sn, r })).catch(() => ({ sn, r: null }))
  ));

  const data = {}; let apiAppels = 0, enCache = 0, refuses = 0;
  for (const { sn, r } of results) {
    // Un échec (réseau, API en erreur, IP bloquée) n'est PAS « saison sans données » :
    // la saison est simplement absente de la réponse, et l'appli la redemandera.
    // Avant, elle recevait null et retenait pendant trente jours que le joueur n'avait rien joué.
    if (!r || r.isError) { refuses++; continue; }
    if (r.cached) enCache++; else apiAppels++;
    if (r.throttled) { refuses++; continue; }       // absente = à redemander, surtout pas « vide »
    const j = r.json;
    if (j && j.errors && (Array.isArray(j.errors) ? j.errors.length : Object.keys(j.errors).length)) { refuses++; continue; }
    const entry = j && j.response && j.response[0];
    data[sn] = (entry && entry.statistics && entry.statistics.length) ? { player: entry.player, statistics: entry.statistics } : null;
  }

  const lim = planLimits(env);
  return new Response(JSON.stringify({ id, seasons, data, partiel: refuses > 0 }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',   // chaque morceau a déjà sa propre durée de cache
      'X-Duelio-Pack': `saisons=${want.length} api=${apiAppels} cache=${enCache}${refuses ? ' refuses=' + refuses : ''}`,
      'X-Duelio-Rpm': String(lim.rpm), 'X-Duelio-Rps': String(lim.rps), 'X-Duelio-Plan': lim.plan,
      ...corsHeaders(),
    },
  });
}

export default {
  // Déclencheur Cron (Settings → Triggers → Cron Triggers, ex. "*/5 * * * *")
  async scheduled(event, env, ctx) {
    ctx.waitUntil(buildIndexStep(env).catch(err => console.error('index:', err && err.message)));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, '');
    const origin = request.headers.get('Origin') || '';
    origineCourante = origineAutorisee(origin) ? origin : null;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: origineCourante ? 204 : 403, headers: corsHeaders() });
    }
    // Contrôle d'accès : une origine autorisée (le site, l'appli) ou la clé des outils.
    // Les requêtes sans origine (curl, scripts) n'entrent qu'avec la clé.
    if (!origineCourante && !cleValide(request, env, url)) {
      return json({ error: 'Accès réservé à Duelio.' }, 403);
    }
    // Les pages de diagnostic et la construction de l'index exigent la clé, toujours :
    // /diag révélait des informations sur le compte API-Football à qui passait par là.
    if ((path === 'diag' || path === 'diag/usage' || path === 'index/status' || path === 'index/build') && !cleValide(request, env, url)) {
      return json({ error: env.INDEX_BUILD_KEY ? 'Clé requise.' : 'Clé requise : définir le secret INDEX_BUILD_KEY.' }, 403);
    }

    /* ---------------- INDEX DES JOUEURS ---------------- */
    if (path === 'index.json' && request.method === 'GET') {
      const cache = caches.default;
      const key = new Request(INDEX_CACHE_URL);
      let res = await cache.match(key);
      if (!res) {
        let doc;
        try { doc = await readIndexDoc(env); }
        catch (err) { return json({ error: err.message, players: [] }, 503); }
        // Fusion des ligues : la ligue mise à jour le plus récemment a le dernier mot pour un même joueur
        const ordered = INDEX_LEAGUES.map(lg => doc.leagues[lg.id]).filter(Boolean)
          .sort((a, b) => Date.parse(a.updatedAt || 0) - Date.parse(b.updatedAt || 0));
        const byId = new Map();
        for (const L of ordered) for (const p of (L.players || [])) byId.set(p.i, p);
        const players = [...byId.values()].sort((a, b) => (a.n || '').localeCompare(b.n || ''));
        const body = JSON.stringify({
          v: 1, updatedAt: doc.updatedAt || null,
          leagues: ordered.map(L => ({ name: L.name, season: L.season, players: L.count })),
          count: players.length, players
        });
        res = new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${INDEX_EDGE_TTL}` } });
        if (players.length) ctx.waitUntil(cache.put(key, res.clone()));
      }
      const out = new Response(res.body, res);
      Object.entries(corsHeaders()).forEach(([k, v]) => out.headers.set(k, v));
      return out;
    }
    if (path === 'index/status' && request.method === 'GET') {
      try { return json(indexStatus(await readIndexDoc(env))); }
      catch (err) { return json({ error: err.message }, 503); }
    }
    if (path === 'index/build' && request.method === 'GET') {
      try {
        const step = await buildIndexStep(env);
        const status = indexStatus(await readIndexDoc(env));
        return json({ step, status });
      } catch (err) { return json({ error: err.message }, 500); }
    }

    /* ---------------- DIAGNOSTIC ----------------
     * Ouvrir  …workers.dev/diag  dans le navigateur : dit à quel compte et à quel abonnement
     * appartient la clé utilisée par CE Worker, et ce qu'API-Football compte comme requêtes. */
    if (path === 'diag/usage') {
      if (!env.INDEX_KV) return json({ error: "Journal indisponible : le KV n'est pas configuré." });
      const log = (await env.INDEX_KV.get(USAGE_KEY, 'json')) || { hours: {} };
      const hours = Object.keys(log.hours).sort().reverse();
      return json({
        explication: "Appels RÉELS envoyés à API-Football par ce proxy (le cache n'est pas compté), par heure UTC. « parSite » indique d'où venaient les appels.",
        heures: hours.map(h => ({ heureUTC: h, ...log.hours[h] }))
      });
    }
    if (path === 'diag') {
      const key = env.API_FOOTBALL_KEY || '';
      const out = {
        sortie: usingRelay(env)
          ? `RELAIS à IP dédiée → ${String(env.RELAY_URL).replace(/\/+$/, '')} (la clé est sur le relais, pas ici)`
          : 'DIRECTE depuis Cloudflare Workers (adresses IP partagées : API-Football peut les bloquer au niveau réseau)',
        cleUtiliseeParCeWorker: usingRelay(env)
          ? (key ? 'présente — inutilisée tant que le relais est actif' : 'aucune (normal avec un relais)')
          : (key ? `présente (${key.length} caractères)` : 'AUCUNE CLÉ CONFIGURÉE'),
        api: API_BASE,
        indexKV: env.INDEX_KV ? 'configuré' : 'NON configuré (facultatif : sert à /diag/usage et à la recherche instantanée)',
        limiteurLocal: (() => { const l = planLimits(env); return {
          planDeclare: l.plan, origine: env.API_PLAN ? 'variable API_PLAN' : (detectedPlan ? 'détecté auprès d\'API-Football' : 'valeur par défaut (pro) en attendant la détection'),
          plafondReel: `${l.base.rpm}/min et ${l.base.rps}/s`,
          plafondApplique: `${l.rpm}/min et ${l.rps}/s`,
          appelsCetteMinute: bucket.minCount, appelsAPI: bucket.apiCalls, reponsesEnCache: bucket.cacheHits,
          misesEnAttente: bucket.waited, refusLocaux: bucket.refused,
          enRetraitPendant: bucket.blockedUntil > Date.now() ? Math.ceil((bucket.blockedUntil - Date.now())/1000) + ' s' : 'non'
        }; })(),
        heureUTC: new Date().toISOString()
      };
      try {
        const r = await callApi(env, 'status');
        const j = await r.json().catch(() => null);
        const h = {};
        r.headers.forEach((v, k) => { if (/ratelimit|requests/i.test(k)) h[k] = v; });
        out.httpStatus = r.status;
        out.enTetesDeQuota = h;
        const rep = j && j.response;
        if (rep && rep.account) {
          out.compte = `${rep.account.firstname || ''} ${rep.account.lastname || ''}`.trim() || null;
          // adresse masquée : /diag est une URL publique
          const em = rep.account.email || '';
          out.email = em ? em.replace(/^(.{2}).*(@.*)$/, '$1***$2') : null;
        }
        if (rep && rep.subscription) {
          out.abonnement = rep.subscription.plan;
          out.actif = rep.subscription.active;
          out.finAbonnement = rep.subscription.end;
        }
        if (rep && rep.requests) {
          out.requetesAujourdHui = rep.requests.current;
          out.limiteParJour = rep.requests.limit_day;
        }
        if (j && j.errors && (Array.isArray(j.errors) ? j.errors.length : Object.keys(j.errors).length)) out.erreurAPI = j.errors;
        if (!rep && !out.erreurAPI) out.reponseBrute = j;
      } catch (err) { out.erreurReseau = err.message; }
      out.aLire = [
        "Si « email » n'est pas celui de votre compte payant, ou si « abonnement » n'est pas votre offre : la clé de ce Worker n'est pas la bonne.",
        "Si « requetesAujourdHui » est très différent du chiffre de votre tableau de bord : les deux ne parlent pas de la même clé.",
        "Si « erreurAPI » dit « Too many requests » alors que cette page est ouverte seule : le pare-feu d'API-Football bloque la clé ET/OU l'adresse IP. Leur documentation précise que la protection « prend aussi en compte l'adresse IP » et que le blocage « peut viser la clé API, mais aussi l'adresse IP ». Les Workers Cloudflare partagent leurs adresses de sortie.",
        "Si « plafondApplique » ne correspond pas à votre offre, réglez la variable API_PLAN (free, pro, ultra ou mega).",
        "Si « sortie » indique DIRECTE et que l'API refuse tout : c'est le blocage réseau des IP partagées. Installez le relais (dossier relais/) sur une machine à IP dédiée et renseignez RELAY_URL et RELAY_SECRET.",
      ];
      return json(out);
    }

    if (path === 'pack') return handlePack(env, ctx, request, url.searchParams);

    /* ---------------- PROXY API-FOOTBALL ---------------- */
    if (!ALLOWED_ENDPOINTS.some(e => path === e || path.startsWith(e + '/'))) {
      return json({ error: 'Endpoint non autorisé.' }, 403);
    }
    const r = await apiCached(env, ctx, request, path, url.search, url.searchParams);
    return r.response;
  },
};
