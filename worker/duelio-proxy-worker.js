/**
 * Worker Duelio — proxy API-Football + comptes utilisateurs + comparaisons favorites.
 *
 * Nécessite :
 *   - Secret  API_FOOTBALL_KEY   (déjà en place)
 *   - Secret  RESEND_API_KEY     (nouveau — clé API de resend.com, plan gratuit)
 *   - Variable EMAIL_FROM        (nouveau — ex: "Duelio <onboarding@resend.dev>" pour tester
 *                                  sans domaine vérifié, ou "Duelio <hello@votredomaine.com>")
 *   - Base D1 liée sous le nom  DB   (Settings → Bindings → D1 Database)
 *   - Espace KV lié sous le nom INDEX_KV  (Settings → Bindings → KV Namespace) : index des joueurs
 *   - Déclencheur Cron  "*\/5 * * * *"  (Settings → Triggers → Cron Triggers) : construit et
 *     rafraîchit l'index tout seul, une ligue à la fois, sans jamais dépasser le quota
 *
 * Exécutez schema.sql une seule fois sur cette base avant utilisation.
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
const SESSION_DAYS = 30;
const VERIFY_HOURS = 24;

function corsHeaders(){
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
function uid(){
  return crypto.randomUUID();
}
function randomToken(bytes=32){
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function hashPassword(password, saltHex){
  const enc = new TextEncoder();
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(h=>parseInt(h,16)));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name:'PBKDF2', salt, iterations:100000, hash:'SHA-256' }, keyMaterial, 256
  );
  return Array.from(new Uint8Array(bits)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function isValidEmail(email){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendVerificationEmail(env, toEmail, token, origin){
  const verifyUrl = `${origin}/auth/verify?token=${token}`;
  const body = {
    from: env.EMAIL_FROM || 'Duelio <onboarding@resend.dev>',
    to: [toEmail],
    subject: 'Confirmez votre compte Duelio',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="color:#123832;">Bienvenue sur Duelio ⚽</h2>
        <p>Confirmez votre adresse email pour activer votre compte et sauvegarder vos comparaisons favorites.</p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${verifyUrl}" style="background:#22D3EE;color:#04231a;font-weight:bold;padding:12px 28px;border-radius:24px;text-decoration:none;display:inline-block;">Confirmer mon email</a>
        </p>
        <p style="color:#888;font-size:12px;">Ce lien expire dans 24h. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
      </div>`
  };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if(!res.ok){
    const errText = await res.text();
    throw new Error('Échec envoi email: ' + errText);
  }
}

async function getSessionUser(request, env){
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if(!token) return null;
  const now = Date.now();
  const row = await env.DB.prepare(
    'SELECT sessions.user_id as user_id, sessions.expires_at as expires_at, users.email as email, users.id as id FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ?'
  ).bind(token).first();
  if(!row || row.expires_at < now) return null;
  return { id: row.id, email: row.email };
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
    if (!r) { data[sn] = null; continue; }
    if (r.cached) enCache++; else apiAppels++;
    if (r.throttled) { refuses++; continue; }       // absente = à redemander, surtout pas « vide »
    const entry = r.json && r.json.response && r.json.response[0];
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
    const origin = `${url.protocol}//${url.host}`;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    /* ---------------- AUTH: inscription ---------------- */
    if (path === 'auth/register' && request.method === 'POST') {
      const { email, password } = await request.json().catch(()=>({}));
      if (!email || !isValidEmail(email)) return json({ error: 'Email invalide.' }, 400);
      if (!password || password.length < 8) return json({ error: 'Mot de passe trop court (8 caractères min).' }, 400);

      const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
      if (existing) return json({ error: 'Un compte existe déjà avec cet email.' }, 409);

      const salt = randomToken(16);
      const passwordHash = await hashPassword(password, salt);
      const id = uid();
      const verifyToken = randomToken(32);
      const verifyExpires = Date.now() + VERIFY_HOURS*3600*1000;

      await env.DB.prepare(
        'INSERT INTO users (id, email, password_hash, salt, verified, verify_token, verify_expires, created_at) VALUES (?,?,?,?,0,?,?,?)'
      ).bind(id, email, passwordHash, salt, verifyToken, verifyExpires, Date.now()).run();

      try {
        await sendVerificationEmail(env, email, verifyToken, origin);
      } catch (e) {
        return json({ error: 'Compte créé mais email non envoyé: ' + e.message }, 500);
      }
      return json({ ok: true, message: 'Compte créé. Vérifiez votre boîte mail pour confirmer.' });
    }

    /* ---------------- AUTH: vérification email ---------------- */
    if (path === 'auth/verify' && request.method === 'GET') {
      const token = url.searchParams.get('token');
      const user = token ? await env.DB.prepare('SELECT * FROM users WHERE verify_token = ?').bind(token).first() : null;
      if (!user || user.verify_expires < Date.now()) {
        return html('<h2 style="font-family:sans-serif;text-align:center;margin-top:80px;">Lien invalide ou expiré.</h2>', 400);
      }
      await env.DB.prepare('UPDATE users SET verified = 1, verify_token = NULL WHERE id = ?').bind(user.id).run();
      return html(`
        <div style="font-family:sans-serif;text-align:center;margin-top:80px;">
          <h2 style="color:#123832;">✅ Email confirmé !</h2>
          <p>Vous pouvez fermer cette page et vous connecter dans Duelio.</p>
        </div>`);
    }

    /* ---------------- AUTH: connexion ---------------- */
    if (path === 'auth/login' && request.method === 'POST') {
      const { email, password } = await request.json().catch(()=>({}));
      const user = email ? await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first() : null;
      if (!user) return json({ error: 'Email ou mot de passe incorrect.' }, 401);

      const hash = await hashPassword(password || '', user.salt);
      if (hash !== user.password_hash) return json({ error: 'Email ou mot de passe incorrect.' }, 401);
      if (!user.verified) return json({ error: 'Email non confirmé. Vérifiez votre boîte mail.' }, 403);

      const token = randomToken(32);
      const expiresAt = Date.now() + SESSION_DAYS*24*3600*1000;
      await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').bind(token, user.id, expiresAt).run();

      return json({ ok: true, token, email: user.email });
    }

    /* ---------------- AUTH: déconnexion ---------------- */
    if (path === 'auth/logout' && request.method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
      if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
      return json({ ok: true });
    }

    /* ---------------- AUTH: qui suis-je ---------------- */
    if (path === 'auth/me' && request.method === 'GET') {
      const user = await getSessionUser(request, env);
      if (!user) return json({ error: 'Non connecté.' }, 401);
      return json({ ok: true, email: user.email });
    }

    /* ---------------- FAVORIS: lister ---------------- */
    if (path === 'favorites' && request.method === 'GET') {
      const user = await getSessionUser(request, env);
      if (!user) return json({ error: 'Non connecté.' }, 401);
      const { results } = await env.DB.prepare(
        'SELECT id, name, player_ids, created_at FROM favorites WHERE user_id = ? ORDER BY created_at DESC'
      ).bind(user.id).all();
      return json({ ok: true, favorites: results.map(r => ({ ...r, player_ids: JSON.parse(r.player_ids) })) });
    }

    /* ---------------- FAVORIS: ajouter ---------------- */
    if (path === 'favorites' && request.method === 'POST') {
      const user = await getSessionUser(request, env);
      if (!user) return json({ error: 'Non connecté.' }, 401);
      const { name, playerIds } = await request.json().catch(()=>({}));
      if (!name || !Array.isArray(playerIds) || playerIds.length < 2) {
        return json({ error: 'Nom et au moins 2 joueurs requis.' }, 400);
      }
      const id = uid();
      await env.DB.prepare(
        'INSERT INTO favorites (id, user_id, name, player_ids, created_at) VALUES (?,?,?,?,?)'
      ).bind(id, user.id, name, JSON.stringify(playerIds), Date.now()).run();
      return json({ ok: true, id });
    }

    /* ---------------- FAVORIS: supprimer ---------------- */
    if (path.startsWith('favorites/') && request.method === 'DELETE') {
      const user = await getSessionUser(request, env);
      if (!user) return json({ error: 'Non connecté.' }, 401);
      const favId = path.split('/')[1];
      await env.DB.prepare('DELETE FROM favorites WHERE id = ? AND user_id = ?').bind(favId, user.id).run();
      return json({ ok: true });
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
      if (env.INDEX_BUILD_KEY && url.searchParams.get('key') !== env.INDEX_BUILD_KEY) return json({ error: 'Clé requise.' }, 403);
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
          ? (key ? `${key.slice(0, 4)}…${key.slice(-4)} — inutilisée tant que le relais est actif` : 'aucune (normal avec un relais)')
          : (key ? `${key.slice(0, 4)}…${key.slice(-4)} (${key.length} caractères)` : 'AUCUNE CLÉ CONFIGURÉE'),
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
