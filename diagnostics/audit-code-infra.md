# Audit infra Duelio — workflows, Worker, en-têtes, chargement des données

Relecture du 30 octobre 2026, dépôt `/home/claude/duelio-app`. Tout ce qui suit a été vérifié dans les fichiers (et, pour les tailles, mesuré sur disque) ; les points que je n'ai pas pu vérifier sont regroupés à la fin, à part.

Chiffres de référence mesurés : `www/` = 995 Mo, 16 427 fichiers (16 187 hors `data/stats/`) ; `data/full` = 550 Mo / 15 002 fichiers (36 Ko en moyenne, 150 Ko max) ; `data/players` = 213 Mo / 1 001 fichiers (220 Ko en moyenne, 330 Ko max) ; `data/search-az` = 8,9 Mo / 27 fichiers (943 Ko max : `m.json`, 229 Ko compressé) ; `search-top.json` = 536 Ko (127 Ko compressé) ; `legendes.json` = 480 Ko (97 Ko compressé) ; `index.html` = 618 Ko (204 Ko compressé).

---

## Les cinq constats à traiter en premier

| # | Constat | Gravité |
|---|---|---|
| 1 | « Réorganiser par joueur » (`par-joueur.yml`) reconstruit `players/*.json` et `search-az/*.json` depuis `data/stats` (figé à 2016-2025) et **efface** la saison en cours, les dates de naissance et les prénoms que les workflows quotidiens y écrivent. | important |
| 2 | Les scripts d'index (`joueurs-complets.yml` l. 225, `ajouter-joueur.yml` l. 63/67) écrasent `ti` (identifiant du club, utilisé pour le logo) avec `matchs / 2` : **2 213 entrées** de `search-az` portent aujourd'hui un logo de club faux. | important |
| 3 | Trois workflows (`saison-courante-ligues`, `saison-courante`, `naissances`) publient avec `for … git pull --rebase && git push && break; sleep` sans `exit 1` ni `rebase --abort` : un conflit laisse le dépôt non publié **et le workflow vert**. | important |
| 4 | Le Worker `/pack` transforme une erreur API (dont le blocage d'IP connu) en `data[saison] = null`, que l'appli enregistre comme « saison sans données » pendant 30 jours. | important |
| 5 | `search-top.json` est copié dans `localStorage` et **jamais rafraîchi** ensuite (`loadPlayerIndex`, l. 4803-4808) : clubs, noms et compteurs de l'index de recherche figés à la première visite. | important |

---

## 1. Workflows GitHub Actions

### 1.1 `par-joueur.yml` écrase les données enrichies par les autres workflows — important

- Fichier : `.github/workflows/par-joueur.yml`, l. 21-26 et 49-62, 139-141, 169-171.
- Extrait : `const SOURCE = "www/data/stats"; … if (existsSync(SORTIE)) rmSync(SORTIE, { recursive: true });` puis `recherche.push({ i: j.i, n: …, f: "", l: "", … })` et `rmSync(AZ, { recursive: true, force: true })`.
- Scénario : `saison-courante-ligues.yml` écrit chaque matin la saison 2026 des joueurs « légers » dans `players/<n>.json` (79 paquets réécrits le 29/10 selon `diagnostics/saison-courante-ligues.txt`) et y pose `f`, `l`, `b` ; `naissances.yml` y ajoute `b`/`sansNaissance` (20 000 appels par passage) et complète `search-az`. Quelqu'un relance « Réorganiser par joueur » (par exemple après `recuperer-saisons`, dont le commentaire l. 16-17 le recommande sous le nom « Index par joueur ») : tout est reconstruit depuis `data/stats`, qui s'arrête à 2025 (`base-statique.yml` l. 59 : `SAISONS = [2025, … , 2016]`).
- Conséquence : perte de la saison en cours de ~40 000 joueurs légers, des dates de naissance (mode « Même âge » faux d'un an), des prénoms ; des dizaines de milliers d'appels API à refaire. `search-top.json` repart avec `f:""`.
- Correctif : faire de `par-joueur` une fusion (relire l'ancien paquet et conserver `s[saison courante]`, `f`, `l`, `b`, `sansNaissance` quand la source ne les a pas), ou le retirer et documenter que la génération « statique » est close.

### 1.2 `ti` (identifiant de club) écrasé par `matchs / 2` — important

- Fichiers : `joueurs-complets.yml` l. 225 — `p.ti = Math.max(p.ti || 0, Math.round(m / 2));` ; `ajouter-joueur.yml` l. 63 — `deja.ti = Math.max(deja.ti || 0, Math.round(matchs / 2));` et l. 67 — `ti: Math.round(matchs / 2)`.
- Côté appli (`www/index.html` l. 4939) : `clubLogo: e.ti ? apiTeamLogo({id: e.ti}) : null` — `ti` est l'identifiant d'équipe généré par `par-joueur.yml` l. 140 (`ti: clubId`).
- Vérifié sur les données : dans `search-az/m.json`, 303 entrées sur 1 869 avec `m > 0` ont un `ti` qui ne correspond à aucun club de la fiche complète (ex. `21137 A. Mandréa, Angers, ti=122, m=244`). Sur l'ensemble des tranches : **2 213 entrées** ont `ti == round(m/2)`.
- Conséquence : logo d'un club étranger au joueur dans les résultats de recherche pour ~2 000 joueurs.
- Correctif : ne plus toucher `ti` dans ces deux scripts (une ligne à supprimer chacun), puis reconstruire `ti` depuis la fiche complète pour les entrées touchées.

### 1.3 Publication silencieusement perdue (pas d'`exit 1`, pas de `rebase --abort`) — important

- `saison-courante-ligues.yml` l. 171 : `for i in 1 2 3 4; do git pull --rebase -q && git push && break; sleep 5; done`
- `saison-courante.yml` l. 102 : même ligne.
- `naissances.yml` l. 138 : `… && break || sleep 20; done` (le dernier `sleep` renvoie 0).
- `audit-saisons.yml` l. 82, `audit-stats.yml` l. 197, `ajouter-joueur.yml` l. 80, `sonde-*.yml` : même motif en 3 essais ; `sonde-saisons.yml` l. 181-182 : `git pull --rebase -q || true ; git push || true`.
- Scénario : `joueurs-complets` (groupe `carrieres-completes`) ou `recuperer-saisons` (groupe `recuperer-saisons`) a poussé entre-temps une modification des mêmes `full/<id>.json` ou d'une même tranche `search-az/x.json` (fichiers JSON sur une ligne : tout chevauchement est un conflit). Le premier `git pull --rebase` échoue et laisse le dépôt en rebase ; les tentatives suivantes échouent aussitôt (« rebase in progress ») ; la boucle se termine, le pas rend 0.
- Conséquence : le passage du jour (1 250 appels pour `ligues`, 15 000 pour `saison-courante`, 20 000 pour `naissances`) est perdu, et rien ne le signale.
- Correctif : reprendre le motif de `joueurs-complets.yml` l. 244-255 (`git rebase --abort` entre deux essais, `exit 1` à la fin) dans tous les workflows qui publient.

### 1.4 Concurrence : `joueurs-complets` et `recuperer-saisons` ne sont pas dans le groupe `saison-courante` — important

- `joueurs-complets.yml` l. 29-31 : `group: carrieres-completes` ; `recuperer-saisons.yml` l. 32-34 : `group: recuperer-saisons` ; `par-joueur.yml`, `base-statique.yml`, `ajouter-joueur.yml` : aucun groupe.
- Pourtant tous écrivent `www/data/full` et/ou `search-az`, comme `saison-courante-ligues` (04:17 UTC), `saison-courante` (mardi 05:30) et `naissances` (groupe commun `saison-courante`).
- Scénario : lancer `joueurs-complets` à la main le matin (5 h de passage) ; à 04:17 `ligues` démarre, modifie 136 fiches et 26 tranches, publie ; `joueurs-complets` rebase ensuite ses 400 nouveaux fichiers + les mêmes tranches `search-az` : conflit, 5 essais, `exit 1` → 40 000 appels perdus (le script a bien écrit sur disque, mais le commit n'est pas fait).
- Correctif : un seul groupe `concurrency` (`donnees`) pour tout ce qui écrit dans `www/data`, et un `if: always()` sur le pas de publication des longs passages (voir 1.6).

### 1.5 Quota : seuls `saison-courante` vérifie le quota avant de partir

- `saison-courante.yml` l. 58-66 lit `x-ratelimit-requests-remaining` et saute si `restant < fiches + 1500`. Bien.
- `naissances.yml` (défaut 20 000), `joueurs-complets.yml` (défaut 40 000), `recuperer-saisons.yml` (20 000), `audit-saisons.yml` (15 000 sans limite) ne vérifient rien.
- Scénario : un mardi, `ligues` (1 250) + `saison-courante` (15 000) + un `joueurs-complets` manuel (40 000) + un `naissances` manuel (20 000) = 76 250 > 75 000, le reste de la journée l'appli en ligne est refusée.
- Gravité : gênant (tout est manuel sauf 16 250 appels hebdomadaires, mais aucun garde-fou).
- Correctif : factoriser la sonde `/status` de `saison-courante.yml` en début de chaque workflow coûteux et refuser de partir sous un seuil (ex. `restant < budget + 5000`).

### 1.6 Compteurs de budget faux de 1 à 6× — gênant

- `saison-courante-ligues.yml` l. 56-67 et 76 : `get()` réessaie jusqu'à 6 fois (y compris sur une erreur non liée au rythme : `throw` l. 63 est rattrapé l. 66) ; `appels++` n'est incrémenté qu'après un `get` réussi.
- `naissances.yml` l. 49-62 et 67 : même `get()` ; `appels++` une fois par joueur avant les 6 tentatives.
- `saison-courante.yml` l. 42-52 : 6 tentatives à 10 s sur **toute** erreur `errors` (clé refusée, abonnement, paramètre) ; `audit-saisons.yml` l. 33-42 et `audit-stats.yml` l. 111-121 idem.
- Scénario : l'API renvoie « Your account is not subscribed » ou bloque l'IP de GitHub : chaque joueur coûte 6 appels réels et 60 s ; `saison-courante` met 15 000 × 60 s = 250 h → `timeout-minutes: 300` coupe le job, rien n'est publié ; `naissances` consomme jusqu'à 6 × 20 000 appels pour un « budget » de 20 000.
- Correctif : compter chaque `fetch` dans `appels`, ne réessayer que sur `rateLimit`/429/erreur réseau, et abandonner le passage entier après N échecs consécutifs (ex. 20).

### 1.7 `timeout-minutes` et pas de `if: always()` : un passage long peut tout perdre — gênant

- `joueurs-complets.yml` l. 36 : `timeout-minutes: 330` pour `BUDGET: 40000` à `PAUSE = 220 ms` + latence API (~250 ms) ≈ 0,47 s × 40 000 ≈ 313 min ; le commentaire l. 18 reconnaît que c'est « trop juste ». Le pas « Enregistrer » l. 234 n'a pas `if: always()`.
- Scénario : API un peu lente (0,55 s/appel) → 367 min → job annulé à 330 min, les ~35 000 fichiers écrits sur disque ne sont jamais commités.
- Correctif : `if: always()` sur le pas de publication (il s'exécute à l'annulation par timeout) et/ou coupure par temps dans le script (`Date.now() - debut > 290 min`), pas seulement par budget.
- Autres : `par-joueur`, `base-statique`, `ajouter-joueur`, `sonde-joueur`, `sonde-saisons`, `sonde-trophees`, `sonde-liste-saisons`, `pilote`, `android` : pas de `timeout-minutes` (défaut 6 h).

### 1.8 `recuperer-saisons.yml` ignore les erreurs `errors` renvoyées en HTTP 200 — gênant

- l. 81-89 : `if (r.ok) return r.json();` sans examiner `j.errors`.
- API-Football renvoie ses refus (quota, rythme, abonnement) en **HTTP 200** avec `errors` non vide et `response: []` (c'est ce que testent tous les autres scripts).
- Scénario : quota épuisé au milieu du passage : `connues = []` → `manquantes = []` → `joueurs_sans_manque++`, le curseur avance ; le rapport dit « balayage terminé » (`rapports/recuperation.json` : `termine: true`).
- Conséquence : des joueurs marqués « sans manque » n'ont jamais été regardés ; aucun moyen de le savoir après coup.
- Correctif : réutiliser le `get()` de `joueurs-complets.yml` (l. 74-87) qui lève sur `errors`.

### 1.9 `saison-courante-ligues.yml` : pagination plafonnée à 80 pages, saisons calendaires — mineur

- l. 89 : `while (page <= total && page <= 80)` : silencieux si une compétition dépasse 80 pages (×20 joueurs = 1 600). Les « Amicaux » (id 10, toutes sélections) peuvent dépasser. Correctif : journaliser `total > 80`.
- l. 44 : `SAISON = mois ≥ juillet ? année : année − 1` appliqué aussi à MLS (253), Brasileirão (71), Liga Argentina (128) : de janvier à juin 2027 leur saison 2027 ne sera pas rafraîchie. Correctif : saison calendaire pour ces trois ligues.

### 1.10 Horaires et chevauchements

- Planifiés : `ligues` tous les jours 04:17 UTC (~10 min, 1 244 appels le 29/10) ; `saison-courante` mardi 05:30 UTC (15 000 appels, ~2 h). Même groupe `concurrency` : pas de chevauchement réel. Rien d'autre n'est planifié (`joueurs-complets` : cron retiré le 26/10).
- Cloudflare Worker : cron `*/5 * * * *` (`CONFIGURATION.md` l. 46) qui reconstruit un index KV que l'appli **n'utilise plus** (`REAL_DATA_CONFIG.searchIndexUrl` est renseigné l. 2654, donc `proxy/index.json` l. 4909 n'est jamais appelé). ~150 appels/jour perdus, et quand l'API bloque, 288 × 3 tentatives/jour. Gênant. Correctif : supprimer le déclencheur cron et le bloc `INDEX_LEAGUES`/`buildIndexStep` du Worker.

### 1.11 Alerte en cas d'échec

- Aucun workflow n'envoie de notification. GitHub envoie par défaut un e-mail à l'auteur de la dernière modification du `cron` quand un passage planifié **échoue** ; mais les publications perdues (1.3), les passages sautés faute de quota (`saison-courante.yml` l. 62-66, `process.exit(0)`) et les 0 mise à jour sont **verts**.
- Correctif en une phrase : terminer chaque workflow par un pas qui `exit 1` si le push a échoué, si `refuses`/`echecs` dépasse un seuil ou si le bilan est « 0 mise à jour », et, en complément, un petit workflow hebdomadaire qui échoue si `diagnostics/saison-courante-ligues.txt` date de plus de 2 jours.

### 1.12 Workflows obsolètes ou en doublon (candidats à la suppression)

| Workflow | Pourquoi |
|---|---|
| `pilote.yml` | Prototype « Ligue 1 2024 » vers un artefact ; remplacé par `base-statique`. |
| `test-api.yml`, `sonde.yml` | Sondes exploratoires d'un seul appel ; `/diag` du Worker fait pareil. |
| `sonde-joueur.yml` | Paramètres codés en dur (ligue 144, « challenger ») pour un cas d'octobre. |
| `sonde-proxy.yml` | Sonde les routes `/auth/*`, `/favorites` (D1) que l'appli n'utilise plus (comptes via Firebase, `compte.js`). |
| `sonde-anciennes-saisons.yml`, `diagnostic-trous.yml` | Questions tranchées : `recuperer-saisons` + `audit-saisons` couvrent le besoin. `diagnostic-trous.yml` l. 80 a `2026` en dur. |
| `base-statique.yml` | Les 240 fichiers `stats/<ligue>-<saison>.json` existent tous ; `SAISONS` s'arrête à 2025 ; le passage ne fait plus rien. À garder uniquement si `par-joueur` est corrigé (1.1). |
| `audit-stats.yml` | Saisons `[2024, 2025, 2026]` en dur l. 148 ; vieillira en juillet 2027. |

Le `sonde-trophees.yml` l. 261 signe ses commits `noreply@anthropic.com` : à harmoniser.

### 1.13 Divers vérifiés

- `ajouter-joueur.yml` l. 32 : `get()` ignore `r.ok` et réessaie 4 × 8 s sur toute erreur ; l. 57 range le joueur sous la seule initiale du nom de famille alors que `par-joueur` l. 181-187 indexe l'initiale de **chaque** mot : un joueur ajouté ainsi n'est pas trouvé par son prénom. Mineur.
- `photos-legendes.yml` avec `refaire=oui` réécrit `legendes/photos/<id>.jpg` sous le même nom, alors que `_headers` les sert `max-age=31536000, immutable` : l'ancien portrait reste un an chez qui l'a déjà vu. Gênant. Correctif : suffixer d'une empreinte ou abaisser le cache.
- `image-apercu.yml` l. 37-41 : sparse-checkout de `www/data/full` (550 Mo, 15 000 fichiers) pour lire deux fiches. Mineur ; `curl` des deux fichiers depuis le site suffirait.
- `saison-courante.yml` l. 3 : « 5 000 fiches » (15 000 en réalité) ; le journal (`diagnostics/saison-courante.txt`) compte « 28 → 28 m » comme mise à jour : le compteur « 3 246 mises à jour » mesure les JSON différents, pas les matchs ajoutés. Mineur.
- Les workflows `audit-*`, `sonde-*` et `ajouter-joueur` utilisent `actions/checkout@v4` sans `fetch-depth: 0` puis `git pull --rebase` : fonctionne tant que `main` n'a avancé que linéairement (voir doutes).

---

## 2. Worker `worker/duelio-proxy-worker.js` et relais

### 2.1 `/pack` convertit une erreur API en « saison vide » — important

- l. 520-527 : `if (r.throttled) { refuses++; continue; }` puis `const entry = r.json && r.json.response && r.json.response[0]; data[sn] = (entry && …) ? {…} : null;` — `r.isError` (HTTP ≠ 200, ou `errors` non vide comme le `rateLimit` du blocage d'IP) n'est pas testé : `response: []` → `data[sn] = null`, `partiel: false`.
- Côté appli `www/index.html` l. 4318-4321 : `else if(entry === null){ p.seasonsNoData[sn] = true; writeSeasonCache(p.apiId, sn, { player: null, statistics: [] }); }` ; `readSeasonCache` l. 3682 garde une saison close 30 jours ; `seasonKnown` l. 4366 la considère connue.
- Scénario (celui du blocage d'IP mesuré le 28/10, `diagnostics/sonde-proxy-pack.txt`) : un joueur hors base statique ; l'API refuse ; le pack répond 200 avec 3 saisons `null` ; l'appli note « pas de données » pour 2026, 2025, 2024, l'inscrit dans `localStorage` et ne redemandera pas ces saisons pendant 30 jours ; la fiche affiche « Aucune statistique trouvée ».
- Correctif : dans la boucle, `if (r.isError) { refuses++; continue; }` (comme pour `throttled`) et `partiel: refuses > 0` ; côté appli, ne pas écrire de cache négatif quand `json.partiel` est vrai.

### 2.2 Blocage d'IP : le Worker amplifie le refus — gênant

- l. 456-457 : à chaque réponse `rateLimited`, `bucket.blockedUntil = max(…, now + 800 ms / 3 s)` ; l. 219-222 : toute demande arrivant pendant ce retrait est refusée localement (429 `THROTTLED`) si `d > 800 ms`.
- Mesuré : `sonde-proxy-pack.txt` du 28/10 — 24 refus HTTP 429 « Trop de demandes en cours » sur 40 appels espacés de 400 ms, émis par le Worker lui-même, pas par l'API.
- Scénario : l'API bloque l'IP (connu) → chaque appel réel renvoie `rateLimit` → `blockedUntil` est repoussé de 3 s à chaque fois → la quasi-totalité des demandes des utilisateurs est refusée localement sans même atteindre l'API ; l'appli (l. 2777-2794) réessaie 5 fois avec pauses et affiche « Trop de recherches d'un coup. Réessaie dans une minute », faux dans ce cas.
- Correctif : après N refus consécutifs sur plusieurs minutes, basculer en état « source indisponible » (réponse immédiate, message distinct, `Retry-After` long) au lieu de prolonger `blockedUntil` à chaque échec ; retransmettre à l'appli un code distinct (`X-Duelio-Cache: BLOCKED`).

### 2.3 Journal d'usage KV : une écriture par appel, non atomique, et incomplet — gênant

- l. 372-388 `noteUsage` : lecture-modification-écriture d'une clé KV à **chaque** appel API non mis en cache (`ctx.waitUntil(noteUsage(…))` l. 462). KV est à cohérence différée : deux isolates qui écrivent dans la même seconde se perdent mutuellement ; sur l'offre Workers gratuite, la limite est de 1 000 écritures/jour.
- l. 516 : les appels de saisons du `/pack` passent `request = null` → `if (env.INDEX_KV && request)` l. 462 les exclut du journal : `/diag/usage` ne compte qu'un appel par pack (sur jusqu'à 25).
- Correctif : compter en mémoire par isolate et n'écrire en KV qu'une fois par minute (ou utiliser Analytics Engine), et passer `request` aux sous-appels.

### 2.4 Proxy ouvert : rien ne borne un tiers — gênant (choix assumé, mais à connaître)

- l. 50-58 CORS `*`, aucune vérification d'origine ni jeton ; `/pack?career=1` l. 509 coûte jusqu'à `PACK_MAX_SEASONS = 24` + 1 appels par requête ; `/players?league=…&page=…` est ouvert.
- Scénario : un script externe appelle `/pack?id=N&career=1` pour 3 000 identifiants : 75 000 appels, quota du jour épuisé. Le limiteur l. 209-232 est par isolate et vise le rythme, pas le volume journalier.
- Correctif : plafond journalier global (compteur Durable Object ou KV horaire) et/ou refus des origines inconnues pour les routes coûteuses.

### 2.5 Code mort et doc contradictoire dans le Worker — mineur

- Routes `auth/*`, `favorites` (l. 557-663), D1, Resend : `CONFIGURATION.md` §6 dit « Tout passe par Firebase… Rien n'est déployé côté Cloudflare », et `compte.js` ne les appelle pas. `/index.json`, `/index/*`, cron (l. 288-354, 542-546) : plus utilisés par l'appli (1.10). ~350 lignes à retirer, 2 liaisons (D1, KV) et 2 secrets (`RESEND_API_KEY`, `INDEX_BUILD_KEY`) qui ne servent plus qu'au journal.
- `/diag` l. 724-725 publie les 4 premiers et 4 derniers caractères de la clé et le nom du compte : à réserver à une clé (`INDEX_BUILD_KEY` existe déjà pour `/index/build`).

### 2.6 Cohérence Worker ↔ appli

- `/pack` : format `{ id, seasons, data: { saison: { player, statistics } | null }, partiel }` attendu par `fetchPack` l. 4308-4335 : conforme, hormis 2.1. `/pack?season=S` renvoie `[seasons[0]]` si S est inconnue (l. 511) ; l'appli accepte toute clé renvoyée : pas de bogue, mais la saison demandée reste « inconnue » et sera redemandée via `/players?id&season` (l. 5269).
- `/players`, `/players/profiles`, `/transfers`, `/trophies` : utilisés (l. 3641, 3722, 5269, 5384-5385) et autorisés (l. 23-27). `/index.json` : non utilisé.
- Cache : `players` saison close → 30 jours, saison en cours → 30 min (l. 247) ; `Cache-Control: public` renvoyé au navigateur avec le même TTL : cohérent. Les erreurs ne sont pas mises en cache (`no-store` l. 469) — donc sous blocage d'IP, chaque demande part vraiment vers l'API.

### 2.7 Relais `relais/`

- `relais/serveur.js` est dupliqué intégralement dans `relais/cloud-init.yaml` l. 25-79 : deux copies à maintenir. Mineur ; générer le second depuis le premier.
- `serveur.js` l. 34 : comparaison du secret non en temps constant ; l. 32 `/sante` public expose les compteurs. Mineur.
- Aucun garde-fou de volume côté relais : il transmet tout ce que le Worker lui envoie. Acceptable puisque seul le Worker connaît le secret.
- `systemd` `User=nobody` avec `EnvironmentFile=/etc/relais.env` (0600 root) : correct (lu par systemd avant la bascule d'utilisateur).

---

## 3. Performance côté appli et en-têtes de cache

### 3.1 Ce qui part au premier affichage (web, première visite)

| Ressource | Taille (brut / gzip) | Quand |
|---|---|---|
| `index.html` | 618 Ko / 204 Ko | immédiat, `max-age=0` |
| `compte.js` | 9 Ko | immédiat |
| Google Fonts (CSS + 2 familles, ~8 graisses) | ~4-6 requêtes | immédiat |
| `firebase-config.json` (`{}`) | 3 o | à chaque visite, `cache: 'no-store'` (`compte.js` l. 39) |
| `data/legendes.json` | 480 Ko / 97 Ko | `init()` l. 9838, à chaque visite (1 h de cache) |
| `data/legendes-credits.json` | 46 Ko / ~10 Ko | juste après |
| `data/search-top.json` | 536 Ko / 127 Ko | `loadPlayerIndex()` l. 9839, **première visite seulement** (voir 3.2) |
| `data/full/<a>.json`, `data/full/<b>.json` (duel vedette) | ~7 Ko gz chacun | `requestIdleCallback` l. 9812-9816 puis `alimenterAccueil` |

Soit une douzaine de requêtes et ~450 Ko compressés avant que la recherche soit utilisable. Les photos `media.api-sports.io` s'ajoutent à l'écran d'accueil. Le commentaire l. 9833 (« légendes (29 Ko) ») est périmé : `legendes.json` pèse 480 Ko, dont **133 Ko de `note`, `sources`, `tNote`** (texte documentaire) et 184 Ko de palmarès `t` ; les 140 légendes ne servent qu'à la recherche tant qu'on n'en ouvre pas une. Gênant. Correctif : un `legendes-index.json` léger (id, nom, pays, poste, années) chargé au démarrage, le reste à la demande comme `full/<id>.json`.

### 3.2 `search-top.json` figé dans `localStorage` — important

- `www/index.html` l. 4802-4808 : `stored = JSON.parse(localStorage.getItem(INDEX_LS_KEY))` → `applyPlayerIndex(stored.data)` → `PLAYER_INDEX.loaded = true` → `if(!PLAYER_INDEX.loaded && …)` : le fichier n'est **plus jamais** redemandé ; `stored.t` n'est pas lu ; `indexRefreshHours` (l. 2670) n'est utilisé nulle part.
- Le commentaire l. 4825-4828 (« on va TOUJOURS vérifier s'il a changé ») décrit un comportement qui n'existe pas.
- Les tranches `search-az` chargées ensuite ne remplacent pas les entrées déjà présentes (`fusionnerIndex` l. 4867-4869 : `if(vus.has(e.i)) continue;`), donc les 5 000 joueurs du « top » gardent pour toujours le club, le nom abrégé (`f:""`) et le `ti` de la première visite. `search-top.json` date du 20/10 (5 000 joueurs, `partiel: true`), `search-az` du 30/10 (avec `f`, `l`, `b` sur 1 499 entrées de `a.json`).
- Conséquence : clubs faux après chaque mercato pour tout visiteur revenu, et une correction de `ti` (1.2) n'atteindra jamais les visiteurs existants sauf changement de `INDEX_LS_KEY`.
- Correctif : redemander `search-top.json` à chaque démarrage après avoir appliqué la copie locale (le cache HTTP 1 h + ETag rend l'appel presque gratuit), et laisser une entrée de tranche remplacer une entrée « top » plus ancienne.

### 3.3 En-têtes `www/_headers` contre fréquence de mise à jour

| Règle | Cache | Mise à jour réelle | Verdict |
|---|---|---|---|
| `/data/full/*` l. 24-26 | 4 h + swr 24 h | quotidienne 04:17 | cohérent |
| `/data/players/*` l. 29-31 | **24 h + swr 7 j** | **quotidienne** (ligues réécrit 79 paquets/jour) ; le commentaire l. 28 « reconstruits par Réorganiser par joueur » est périmé | gênant : l'utilisateur voit toujours la veille ; avec swr 7 jours il reçoit l'ancien et le neuf arrive pour la fois suivante. Aligner sur `/data/full/*` (4 h + swr 24 h). |
| `/data/stats/*` l. 34-36 | 7 j | fichiers **exclus du déploiement** par `.assetsignore` (`data/stats/`) | règle morte, à retirer |
| `/data/search.json`, `/data/search-top.json`, `/data/search-az/*` | 1 h + swr 24 h | `search-az` quotidien, les deux autres le 20/10 | cohérent |
| `/data/legendes.json` l. 69-71 | 1 h | à la main | cohérent |
| `/index.html` l. 50-51 | `max-age=0, must-revalidate` | chaque déploiement | la page est servie sur `/` (voir doutes) |
| `/sw.js` l. 53-54 | `max-age=0` | `sw.js` n'est plus enregistré : `index.html` l. 190-199 désinscrit tout service worker, et le commentaire dit que « le fichier n'existait plus », alors que `www/sw.js` (v26) est bien déployé | fichier et règle morts, à supprimer (la stratégie « cache d'abord » qu'il décrit n'existe donc plus : pas de mode hors ligne) |
| `/legendes/photos/*` l. 77-79 | 1 an immutable | réécrits sous le même nom si `refaire=oui` | voir 1.13 |

`compte.js` et `firebase-config.json` n'ont pas de règle : servis avec les en-têtes par défaut (ETag), et `firebase-config.json` est de toute façon demandé en `no-store`.

### 3.4 Doublons de chargement, rendu

- `search.json` (5,7 Mo) est déployé et régénéré alors qu'il ne sert que de repli si **toutes** les tranches échouent (l. 4900) : 5,7 Mo de déploiement pour rien. Mineur.
- `renderAll()` (l. 6048-6528, 480 lignes) reconstruit tout l'écran de comparaison par un seul `content.innerHTML = …` (l. 6330) et est appelé à 41 endroits, y compris à la fin de chaque chargement de fond (palmarès l. 5939, sélection l. 5929, carrière l. 7601-7623, légendes l. 9838) : pour un duel de 2 à 4 joueurs le coût reste faible, mais chaque appel perd l'état du DOM (défilement, focus, animations en cours). Mineur, non mesuré ici.
- `REAL_DATA_CONFIG.seasons: [2025, 2024]` (l. 2665, « saisons réelles disponibles ») sert de saison préférée dans `fetchPack` l. 4260-4265 et 4329 : la saison affichée par défaut est **2025**, alors que le pipeline dépense 1 250 appels/jour et un commit quotidien pour tenir **2026** à jour, et que `currentSeasonYear()` (l. 3671) renvoie 2026. Si c'est voulu (saison « à peine ouverte »), la règle doit être datée, pas figée ; sinon l'investissement quotidien n'est visible que pour qui change de saison à la main. Gênant.

### 3.5 Limite de fichiers Cloudflare

- Workers Static Assets accepte 20 000 fichiers par version. `www/` hors `data/stats` compte **16 187 fichiers** (81 %). `joueurs-complets` est à sa cible (15 000) mais `ajouter-joueur` et toute hausse de `cible` rapprochent de la limite ; au-delà, le déploiement échoue entier. Gênant. Correctif : surveiller `find www -type f | wc -l` dans un workflow, ou regrouper les fiches peu consultées en paquets.

---

## 4. Dépendances et build

- `package.json` : pas de `package-lock.json` dans le dépôt ; `android.yml` l. 106 fait `npm install` avec des `^7.0.0` : deux compilations peuvent embarquer des versions différentes. Gênant. Correctif : commiter le lockfile et utiliser `npm ci`.
- `@capacitor/share` : aucun usage (`index.html` l. 8441-8468 utilise `navigator.share`). `@capacitor/ios` : aucun workflow iOS. Inutiles aujourd'hui, inoffensifs. Mineur.
- `android.yml` : `cap sync` copie `www/` entier (995 Mo, 16 000 fichiers) dans `android/app/src/main/assets/public` avant que le pas l. 137-147 supprime `data/` et `legendes/` ; le commentaire l. 134 (« 417 Mo ») est périmé. Fonctionne, mais lent ; `.assetsignore` ne s'applique pas à Capacitor. Correctif : `rsync` de `www/` sans `data/` vers un dossier temporaire et `webDir` pointé dessus, ou nettoyer avant `cap sync`.
- `android.yml` l. 153 : `assembleDebug` uniquement, aucune signature : l'APK produit n'est pas publiable sur le Play Store. Gênant si la publication est l'objectif.
- `capacitor.config.json` : `webDir: "www"`, pas de `server.url` : l'appli embarque `index.html` et lit ses données en ligne (adresses absolues l. 2634-2662) : cohérent avec le retrait de `data/`. Rien à signaler.
- `wrangler.toml` : site `duelio-app` en assets seuls (`[assets] directory = "./www"`), pas de `main`. Le Worker `duelio-proxy` n'a **aucun** `wrangler.toml` ni workflow de déploiement dans le dépôt : il est déployé à la main (voir doutes).

---

## 5. `CONFIGURATION.md` vs réalité

- Numérotation : deux sections « 5 » (l. 91 et 112) et deux « 6 » (l. 101 et 147).
- §1-2 décrivent les comptes D1/Resend et §6 (l. 147-151) dit que tout passe par Firebase et que « rien n'est déployé côté Cloudflare » : contradiction ; le code D1 est toujours dans le Worker (2.5).
- §1 l. 44-51 : le cron `*/5` « sans lui, la recherche instantanée se vide » — faux depuis le passage à l'index statique (1.10).
- §3 l. 70-76 : « Cloudflare Pages `dueliov2.pages.dev` » — `index.html` l. 3791-3793 dit que Pages est « une vieille copie qui ne se met plus à jour » et que le site vit sur `duelio-app.bensouna-ahmed.workers.dev` (`wrangler.toml`). À remplacer par la description du déploiement Workers Assets (et de ce qui déclenche le déploiement : voir doutes).
- Absents du document : la liste des **secrets GitHub Actions** (`API_FOOTBALL_KEY`, `GOOGLE_SERVICES_JSON`, `FCM_SERVICE_ACCOUNT` — seuls les deux derniers sont cités, §5) ; les **workflows planifiés** et leurs horaires/quotas (04:17 quotidien, mardi 05:30) ; l'existence et le rôle de `_headers` et `.assetsignore` ; le fait que `par-joueur` est destructeur (1.1).
- `schema.sql` : toujours absent (l. 59), mais devient inutile si D1 est retiré.
- `recuperer-saisons.yml` l. 16 renvoie vers « Index par joueur », nom qui n'existe pas (le workflow s'appelle « Réorganiser par joueur »).

---

## 6. Doutes (non vérifiés, à confirmer)

1. **Règle `/index.html` vs `/`** : Cloudflare sert la page d'accueil sur `/` et redirige `/index.html` vers `/` (`html_handling` par défaut). La règle `_headers` l. 50 ne correspond qu'au chemin `/index.html` ; `/` recevrait alors les en-têtes par défaut (ETag, sans `Cache-Control`). À vérifier avec `curl -I https://duelio-app.bensouna-ahmed.workers.dev/` ; si confirmé, ajouter une règle `/`.
2. **Déclencheur de déploiement** : rien dans le dépôt ne déploie `www/` ; si c'est l'intégration Git de Cloudflare (Workers Builds), chaque commit de bot (diagnostics, rapports) redéploie 16 000 fichiers. À confirmer dans le tableau de bord ; sinon, préciser dans `CONFIGURATION.md` comment le site est publié.
3. **Comptage des appels refusés** : je n'ai pas pu vérifier si API-Football décompte du quota journalier les appels refusés pour rythme ou IP ; si oui, les boucles de retentatives de 1.6 et le cron du Worker (1.10) coûtent réellement.
4. **`if: always()` après `timeout-minutes`** : d'après la documentation GitHub, les pas marqués `always()` s'exécutent lors d'une annulation par timeout (avec un délai de grâce) ; à tester une fois avant de s'y fier pour sauver un passage de 5 h.
5. **Rebase sur clone peu profond** : `audit-*`, `sonde-*`, `ajouter-joueur` font `git pull --rebase` avec `fetch-depth: 1`. Cela fonctionne tant que `main` avance linéairement depuis le commit cloné ; le commentaire de `joueurs-complets.yml` l. 40 dit avoir rencontré un échec. Non reproduit ici.
6. **Limite de 20 000 fichiers** : chiffre issu de la documentation Workers Static Assets telle que je la connais ; à revérifier avant de dimensionner.
7. **Compte Cloudflare gratuit ou payant** : conditionne 2.3 (1 000 écritures KV/jour) et le nombre de sous-requêtes par exécution (`/pack?career=1` : 25 sous-requêtes, `INDEX_PAGES_PER_RUN = 20` l. 41 suppose la limite de 50 du plan gratuit).
