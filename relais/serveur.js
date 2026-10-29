/* Relais Duelio — une adresse IP à soi pour parler à API-Football.
 *
 * API-Football bloque les adresses IP partagées de Cloudflare Workers. Ce relais tourne
 * sur une petite machine à IP fixe : le proxy Cloudflare lui envoie ses appels (avec un
 * mot de passe partagé), le relais les transmet à API-Football avec la clé, et renvoie
 * la réponse telle quelle, en-têtes de quota compris.
 *
 * Aucune dépendance : Node 18 ou plus suffit. Variables d'environnement :
 *   API_FOOTBALL_KEY   la clé API-Football (obligatoire)
 *   RELAY_SECRET       le mot de passe partagé avec le Worker (obligatoire, long et aléatoire)
 *   PORT               port d'écoute (défaut 8787)
 */
const http = require("node:http");
const KEY = process.env.API_FOOTBALL_KEY || "";
const SECRET = process.env.RELAY_SECRET || "";
const PORT = Number(process.env.PORT || 8787);
const API = "https://v3.football.api-sports.io";
const AUTORISES = ["players", "players/profiles", "players/seasons", "teams", "leagues", "standings",
                   "trophies", "transfers", "fixtures", "coachs", "countries", "status"];
if (!KEY || !SECRET) { console.error("API_FOOTBALL_KEY et RELAY_SECRET sont obligatoires."); process.exit(1); }

const stats = { depuis: new Date().toISOString(), appels: 0, refuses: 0, erreurs: 0, derniereHeure: {} };
const repondre = (res, code, corps, type = "application/json") => {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof corps === "string" ? corps : JSON.stringify(corps));
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://relais");
  const chemin = url.pathname.replace(/^\/+/, "");
  // Page de santé, sans secret : à ouvrir dans un navigateur pour vérifier que ça tourne.
  if (chemin === "sante" || chemin === "") return repondre(res, 200, { ok: true, ...stats });
  if (req.method !== "GET") return repondre(res, 405, { erreur: "GET seulement" });
  if (req.headers["x-duelio-secret"] !== SECRET) { stats.refuses++; return repondre(res, 403, { erreur: "secret invalide" }); }
  if (!AUTORISES.some(e => chemin === e || chemin.startsWith(e + "/"))) { stats.refuses++; return repondre(res, 404, { erreur: "chemin non autorisé" }); }
  stats.appels++;
  const h = new Date().toISOString().slice(0, 13);
  stats.derniereHeure = { [h]: (stats.derniereHeure[h] || 0) + 1 };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch(`${API}/${chemin}${url.search}`, { headers: { "x-apisports-key": KEY }, signal: ctrl.signal });
    clearTimeout(t);
    const corps = Buffer.from(await r.arrayBuffer());
    const entetes = { "content-type": r.headers.get("content-type") || "application/json", "cache-control": "no-store" };
    for (const n of ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-requests-limit", "x-ratelimit-requests-remaining"]) {
      const v = r.headers.get(n); if (v != null) entetes[n] = v;
    }
    res.writeHead(r.status, entetes); res.end(corps);
  } catch (e) {
    stats.erreurs++;
    repondre(res, 502, { erreur: "API-Football injoignable : " + (e && e.message) });
  }
}).listen(PORT, () => console.log(`Relais Duelio à l'écoute sur le port ${PORT}`));
