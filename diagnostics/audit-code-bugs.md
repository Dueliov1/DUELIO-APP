# Audit de code — Duelio (`www/index.html`, `www/compte.js`)

Relecture à froid, par tranches, du script principal (`index.html`, lignes 1786–9858, plus les deux scripts d'en-tête) et de `compte.js`, en suivant les appels au Grep. Les numéros de ligne renvoient à `www/index.html` sauf mention contraire. Version relue : balise `duelio-version` « 2026-10-20-17h ». Date de relecture : 30 octobre 2026 (donc `currentSeasonYear()` = 2026).

Je n'ai rapporté dans les parties 1 à 7 que ce que j'ai vérifié dans le code (et, pour les données, dans `www/data/`). Les points que je n'ai pas pu confirmer sont regroupés en partie 8 (« Doutes »). Ce fichier remplace une version antérieure du même audit, dont plusieurs constats (expiration de l'index, écouteurs non retirés…) ne s'appliquent plus au code actuel.

Gravité : **bloquant** = fonctionnalité cassée ou perte visible ; **gênant** = comportement faux ou blocage dans un scénario courant ; **mineur** = défaut réel mais rare ou cosmétique.

Vérifications globales faites avant le détail : le script principal passe `node --check` ; aucune déclaration `let/const` de premier niveau n'est dupliquée ; aucun `id` n'est rendu deux fois dans le DOM (l'accueil monté en deux moitiés n'emploie que des classes et des `data-*`, voir 7.3) ; toutes les fonctions définies sont référencées au moins une fois en dehors de leur définition, sauf les cas listés en partie 6.

---

## 1. Logique et état

### 1.1 — La « saison de référence » est codée en dur à 2025 alors que la saison en cours (2026-27) est dans la base (gênant — intention à confirmer)
- **Lignes** : 2665 `seasons: [2025, 2024]` ; 3671 `currentSeasonYear()` ; 4260, 4263, 4273, 4329 (choix de la saison affichée) ; 3838.
- **Extrait** (4263) : `const preferee = REAL_DATA_CONFIG.seasons.find(sn => obtenues.includes(sn));`
- **Vérifié dans les données** : `data/full/278.json` (Mbappé), `1100.json` (Haaland), `874.json` (Ronaldo) ont tous une clé `"2026"` avec des matchs ; 240 des 2 181 fiches testées dans `data/players/1*.json` en ont aussi. `_headers` dit que la saison en cours y est remise à jour chaque matin, et l'écran « À propos » promet des stats « remises à jour chaque matin pour la saison en cours ».
- **Scénario** : on ouvre n'importe quel joueur en activité en octobre 2026.
- **Conséquence** : la carte affiche « Saison 2025-26 » par défaut et jamais 2026-27, alors que la promesse de l'appli est la saison en cours. Le commentaire 4324-4326 justifie de préférer la « saison de référence » quand la saison en cours vient de commencer, mais cette préférence est figée dans une constante : en juillet 2027 l'appli affichera encore 2025-26 (deux saisons de retard), et `isRetired`/`seasonCacheTtl`, eux, suivent `currentSeasonYear()` — deux horloges différentes dans le même fichier.
- **Correctif** : dériver la liste de `currentSeasonYear()` (par ex. `[annee, annee-1]`) ou, si l'on veut volontairement rester sur la dernière saison complète tant que la nouvelle a peu de matchs, le décider sur un seuil de matchs plutôt que sur une constante à mettre à jour à la main.

### 1.2 — Le nettoyage de la source (doublons, tournois d'été, saisons futures) ne s'applique qu'au chemin statique, jamais aux données venues de l'API (gênant)
- **Lignes** : 4183 (`ramenerSaisonsFutures(recalerTournoisDEte(nettoyerCarriere(fiche.s)))`, chemin statique) ; 4313-4322 et 3719-3729 + 3731-3742 (chemin API : `attachSeason(p, sn, entry)` directement sur `json.data[k]` / `response[0]`).
- **Scénario** : un duel où l'un des joueurs vient de la base statique (nettoyée) et l'autre de l'API (joueur hors base, ou saison complétée par `completerEnFond` / `loadSeasonList` / sélection d'une saison dans la feuille). Exemple concret : la Coupe du monde 2026 est recalée en 2025-26 pour le joueur statique (3979-4004) mais reste en 2026-27 pour le joueur API ; les blocs dupliqués (« 2 081 buts comptés deux fois », commentaire 3940-3949) ne sont retirés que d'un côté.
- **Conséquence** : des totaux non comparables dans le même duel, et une même saison qui change de contenu selon la provenance. Aggravé par `attachSeason` (3734) qui préfère la version « la plus riche » : une réponse API avec doublons (plus de matchs) remplace la version statique nettoyée.
- **Correctif** : passer le dictionnaire `{saison: lignes}` venu de l'API par les trois mêmes fonctions avant `attachSeason` (elles travaillent déjà sur ce format), et faire de même dans `fetchSeasonEntry`.

### 1.3 — Ouverture d'un duel sauvegardé ou d'une notification : échec silencieux dès qu'un joueur n'est pas dans l'index court (gênant)
- **Lignes** : 7233-7238 (`ouvrirDuelSauvegarde`), 7058-7059 (notification), 5246-5265 (`fiche()` dans `loadSuggestedDuel`), 5230-5233 (`joueurParId`), 5281.
- **Extrait** (7236) : `{ id: Number(x), q: '', first: '', label: 'Joueur' }` puis (7238) `loadSuggestedDuel({ a, b }, ()=>{})`.
- **Scénario** : l'utilisateur a sauvegardé « Brrou vs X » (joueur hors des 5 000 de `search-top.json`). Il rouvre l'appli, va dans Mon compte → touche le duel. `joueurParId` ne trouve pas l'identifiant (l'index complet/les tranches ne sont chargés qu'à la recherche), `searchLocalIndex('')` rend `[]` (moins de 2 caractères), puis `searchProfilesByName('')` appelle l'API avec une recherche vide → erreur.
- **Conséquence** : le `statusCb` est `()=>{}` : rien ne s'affiche, la feuille s'est fermée, l'écran ne bouge pas. Même chose pour une notification poussée avec un identifiant hors index. Et si `duelLoading` est déjà vrai (5237), retour immédiat, également muet.
- **Correctif** : quand `side.id` est connu mais absent de l'index, construire la fiche légère directement depuis `/pack?id=` (déjà interrogé par `loadPlayerStats`) ou `/players/profiles?player=<id>` au lieu de retomber sur une recherche par nom vide ; et donner un vrai `statusCb` (message dans la feuille compte ou toast).

### 1.4 — Un joueur sans date de naissance connue est rechargé une fois puis bloqué « Chargement… » dans le sélecteur de saison (mineur)
- **Lignes** : 6531-6534.
- **Extrait** : `if(c.apiId && (c.needsStats || !c.seasonsAvailable || !c.birthYear) && !c._metaRefresh){ c._metaRefresh = true; c.needsStats = true; loadPlayerStats(c)...`
- **Scénario** : joueur dont ni l'API ni la base ne donnent `birth.date`/`_naissance`/`age` (fiche très ancienne ou incomplète). `loadPlayerStats` réussit mais `birthYear` reste `null`.
- **Conséquence** : pendant le rechargement, `needsStats` est à `true` donc `seasonPickHtml` affiche « Chargement… » (6807) et `ensureBasisData` saute le joueur ; ensuite `_metaRefresh` empêche toute boucle (bien), mais si `loadPlayerStats` échoue (réseau), `needsStats` reste `true` pour toute la session : le sélecteur de saison dit « Chargement… » pour toujours et les modes Saison/Carrière restent indisponibles pour lui, sans message ni nouvel essai.
- **Correctif** : en cas d'échec, remettre `c.needsStats` à sa valeur d'avant et afficher l'erreur (comme `seasonPickError`) ; ne pas forcer `needsStats = true` pour un simple manque de `birthYear`.

### 1.5 — Flags transitoires sérialisés dans « Consultés récemment » (mineur)
- **Lignes** : 5196-5205 (`rememberRecentPlayer` : `{...p}` puis suppression de quelques champs seulement) ; 5940 (`_nationReq`), 7645 (`_careerAuto`), 6531 (`_metaRefresh`), 5894 (`_careerFailed`), 7555 (`careerTried`).
- **Scénario** : `rememberRecentPlayer` est appelé à chaque `loadPlayerStats`, y compris le rafraîchissement de 6533 qui survient pendant qu'une carrière se charge en fond (`_nationReq = 'low'` posé). La copie emporte le flag. À la session suivante, la fiche de ce joueur appelle `ensureCareerForNation([p], 'low')` (9348) qui sort aussitôt (`p._nationReq === priority`).
- **Conséquence** : « Sélections » et « Buts en sélection » restent sur « … » sur la fiche tant que l'utilisateur n'ouvre pas l'onglet Trophées du comparatif (priorité `'high'`, qui passe). `_careerAuto` persistant empêche aussi `autoBestSeason` de rejouer si `bestSeason` n'avait pas été calculé.
- **Correctif** : dans `rememberRecentPlayer`, ne garder qu'une liste blanche de champs (identité, `statsBySeason`, `seasonsAvailable`, `seasonShown`, `seasonPinned`, `birthYear`, trophées) au lieu de tout copier et de retirer au cas par cas.

### 1.6 — Puces « Duels à essayer » laissées grisées si un duel est déjà en cours (mineur)
- **Lignes** : 5237 (`if(duelLoading) return;`), 6597-6602, 6680-6685, 9406-9410.
- **Scénario** : on touche un duel sur l'onglet Comparer, puis vite l'onglet Partager et une puce de son tutoriel (ou la liste « Joueurs »). Le second appel sort avant d'appeler `statusCb`.
- **Conséquence** : les puces de cet écran restent `disabled` jusqu'au prochain rendu de l'écran (qui n'est pas déclenché par la fin du premier duel pour les écrans Partager/Joueurs).
- **Correctif** : faire que `loadSuggestedDuel` appelle `statusCb('')` (ou un message « un duel se charge déjà ») avant son `return` anticipé.

### 1.7 — `applyScreen('generate')` sur l'onglet déjà actif détruit l'image générée (mineur)
- **Lignes** : 9541-9552 (`navigateTo` appelle `applyScreen` même quand `same`), 9665, 7325-7343.
- **Scénario** : image générée, l'utilisateur retouche l'onglet « Partager » (déjà actif) par réflexe.
- **Conséquence** : `renderGenerate()` réécrit l'écran, l'aperçu et les boutons Partager/Télécharger disparaissent ; il faut regénérer.
- **Correctif** : dans `applyScreen`, ne rappeler `renderGenerate()`/`renderBrowse()` que si `changeDEcran` ou si l'état des slots a changé depuis le dernier rendu.

### 1.8 — Trois `<h1>` dans la page, deux fois le même contenu d'accueil focusable (mineur, accessibilité)
- **Lignes** : 1671 `<h1 id="headerTitle">`, 9721 `<h1 class="wl-title">` rendu dans les deux moitiés (9757) ; 1659-1660 ; `.beam` / `.text-vignette` (329-364) sans balise correspondante dans `accueilHtml`.
- **Conséquence** : un lecteur d'écran lit l'accueil deux fois, la tabulation passe deux fois par les mêmes boutons, et l'`aria-live` (9726) annonce chaque score deux fois ; les éléments de l'application sous l'accueil restent atteignables au clavier (pas d'`inert`, contrairement aux feuilles). Le CSS des « projecteurs » est mort.
- **Correctif** : `aria-hidden="true"` + `inert` sur `.welcome-bottom`, `fondInerte(true)` tant que l'accueil est visible, rétrograder `.wl-title` en `<p>` ou `<h2>`.

---

## 2. Promesses, courses, attentes

### 2.1 — Les fichiers statiques (`data/full`, `data/players`, index, tranches) sont téléchargés sans délai d'expiration ; une connexion muette bloque la fiche indéfiniment (gênant)
- **Lignes** : 3895 et 3924 (`fetch(...)` nus dans `chargerPaquetStatique` / `chargerCarriereComplete`), 4814, 4894, 4923 ; à comparer avec `fetchBorne` (2678) utilisé pour les légendes et le `AbortController` à 20 s des appels API (2750-2751).
- **Scénario** : tunnel, 3G qui décroche : la requête `full/<id>.json` ne répond ni ne tombe en erreur. `packStatique` attend, donc `fetchPack`, donc `loadPlayerStats`.
- **Conséquence** : « Chargement des statistiques de … » sans fin dans le sélecteur (8683) ou sur la fiche (9185-9203), alors que l'API, elle, aurait été coupée à 20 s. Le commentaire 2745-2749 décrit exactement ce symptôme pour l'API ; la même protection manque ici.
- **Correctif** : remplacer ces `fetch` par `fetchBorne(url, 15000)`, et à l'expiration laisser `packStatique` rendre `null` (le repli API existe déjà).

### 2.2 — La fiche redemande transferts et palmarès à chaque redessin si la première réponse était partielle (mineur, quota API)
- **Lignes** : 9275-9278 et 9343-9345 (`isReal` → `loadRealTimelineFor(p)` à chaque `renderBrowse()`), 5393-5409 (`fetchRealCareer` ne met en cache que si `transfers && trophies`).
- **Scénario** : `/transfers` répond mais `/trophies` échoue (quota) : rien n'est mis en cache. Chaque redessin de la fiche — progression de la carrière (5946), `autoBestSeason` (9347), choix d'une saison (9346) — relance les deux appels en priorité `'high'`, et réaffiche « Chargement du parcours… » par-dessus un parcours déjà visible.
- **Correctif** : mémoriser l'échec sur la fiche (`p._parcoursRetryAt`, comme `_trophyRetryAt`) et ne relancer `loadRealTimelineFor` que si le conteneur est encore à l'état « Chargement… » ou après le délai.

### 2.3 — Après inscription/connexion, la vue « profil » est demandée avant que Firebase ait publié l'utilisateur : message de confirmation perdu (mineur)
- **Lignes** : 7206-7207, 7211-7212, 7219-7220 ; `compte.js` 46-51 (`onAuthStateChanged` asynchrone, puis `await fb.listerDuels` avant `prevenir()`), 7253-7256.
- **Scénario** : « Créer mon compte » → `await Compte.inscrire(...)` résout → `renderAccountSheet('Compte créé. Un e-mail de confirmation…')` : `compteUser()` est encore `null`, donc la branche « connexion » est rendue (avec le message). Quelques dizaines de ms plus tard `onAuthStateChanged` + `listerDuels` → `prevenir` → `renderAccountSheet('')` : le profil s'affiche, sans le message.
- **Conséquence** : le formulaire de connexion clignote, puis le profil apparaît sans « e-mail de confirmation envoyé ». L'utilisateur peut croire que l'inscription a échoué.
- **Correctif** : conserver le dernier message dans une variable (`accountMessage`) lue par `renderAccountSheet` quand elle est rappelée par l'abonnement, ou attendre la première notification `prevenir` après l'appel avant de redessiner.

### 2.4 — `prefetchPlayers` / `fetchPack` : pas de course détectée, mais un élagage peut faire disparaître un joueur en cours de chargement (mineur)
- **Lignes** : 4476-4486 (`pruneLightPlayers` ne garde que `slots` et les 120 derniers profils), 8684-8687 (`slots[target] = id` après `await`).
- **Scénario** : plus de 400 fiches légères en mémoire (longue session de recherche), l'utilisateur touche un résultat (chargement en cours), continue à taper : `mergeSearchResults` → `pruneLightPlayers` retire la fiche (encore `needsStats`, pas encore dans `slots`). `loadPlayerStats` résout, `slots[target] = id`, `renderAll` ne trouve plus l'id et laisse la carte vide (6068-6072).
- **Correctif** : garder aussi dans `keep` les identifiants présents dans `statsLoading` et `browseDetailId`.

### 2.5 — Points vérifiés et corrects (pour mémoire)
- `loadSuggestedDuel` : la photo des `slots` au départ (5241) et le test 5274 empêchent bien une réponse tardive d'écraser un duel changé entre-temps ; l'attente de l'index est bornée (20 × 100 ms).
- `loadPlayerStats`, `loadPlayerCareer`, `chargerPaquetStatique`, `chargerCarriereComplete`, `chargerTranche`, `chargerIndexComplet` : déduplication par promesse en vol, nettoyée en `then/catch`.
- `apiFetchJson` : deux demandes identiques en attente ne coûtent qu'un appel ; la file n'a pas de boucle sans borne (`while` gardé par `active < maxActive`, timers bornés à 1 s).
- `ensureBasisData` : chaque échec est mémorisé 60 s (`basisFailed`), pas de boucle rendu→chargement→rendu.
- Picker : `pickerSession` + `pickerTarget` protègent contre l'insertion après fermeture/réouverture (8640, 8678).
- Toutes les promesses lancées sans `await` dans `init()`, `renderAll`, `ensureTrophiesLoaded`, `completerEnFond`, `alimenterAccueil` ont un `.catch`.

---

## 3. DOM

### 3.1 — Écouteurs : pas de fuite constatée
Tous les écouteurs ajoutés dans `renderAll`, `renderGenerateBody`, `renderPickerList`, `renderBrowse`, `renderSeasonSheet`, `openValueSheet`, `wireSaveDuel`, `wireInvitationNotifs` portent sur des nœuds que le `innerHTML` suivant détruit. Les écouteurs globaux (`document`/`window`, lignes 6768, 8503, 8945, 9608, 9636, 9698, 9813) sont posés une fois au chargement. `wireRadars` déconnecte l'`IntersectionObserver` précédent (2423) ; `fitTimeline` ne branche la barre qu'une fois (`_voiles`, 8998). RAS.

### 3.2 — `querySelector` sans garde
- 8473 `previewCanvas.getContext('2d')` et 8460 `area.innerHTML` : `area`/`previewCanvas` peuvent être `null` si l'écran Partager a été redessiné pendant `toBlob` (par ex. `renderGenerate` suite à un changement d'écran). Le `try/catch` englobant (8447, 8490) rattrape l'exception et remet le bouton — correct, mais l'utilisateur ne voit alors ni image ni message si `area` a disparu. Mineur.
- 9461 `browseInput.addEventListener` : `browseInput` existe toujours juste après le `innerHTML`. RAS.

### 3.3 — Focus et défilement
- `renderBrowse()` est rappelé par l'arrivée de l'index ou d'une tranche (4823, 4916, 4931) seulement quand `!browseSearch` : si l'utilisateur a mis le focus dans le champ sans encore taper, le champ est recréé et le focus perdu (clavier qui se referme sur mobile). Mineur. Correctif : ne redessiner que la liste (`renderBrowseList`) et pas le champ.
- Le garde de défilement de `renderAll` (6346, 6414) et de la fiche (9307-9308, 9350) fonctionne. RAS.

---

## 4. Stockage local

### 4.1 — « Consultés récemment » sérialise des fiches entières, saisons et découpages compris : risque réel de saturer les 5 Mo (gênant, à mesurer)
- **Lignes** : 5196-5205 ; appelé à chaque `loadPlayerStats` (3867), y compris après que la carrière complète a été attachée (rafraîchissement 6533).
- **Contenu de la copie** : `statsBySeason` (jusqu'à 20 saisons, chacune avec `split.club/nation/friendly/youth` et `split.comp[<id>]`, soit 5 à 10 blocs d'une cinquantaine de champs + `radar` + `missing` à 35 clés), `cumulByAge` (un bloc par cumul calculé), `trophiesRaw`, `_nationTotals`. Seuls `rawBySeason`, `careerStats`, `_q`, `_idx` sont retirés.
- **Conséquence** : pour huit joueurs à carrière longue, plusieurs Mo d'un seul `setItem`, sur un quota partagé avec `duelio_index_v2` (~0,5-0,9 Mo), `duelio_qcache_v1` (jusqu'à 575 Ko d'après le commentaire 5122) et les centaines de clés `duelio_season_v2:*`. L'écriture échoue en silence (5204) : les récents cessent de se mettre à jour sans que rien le dise, et chaque `loadPlayerStats` paie un `JSON.stringify` de plusieurs Mo sur le fil principal.
- **Correctif** : ne stocker qu'une fiche légère (identité, `seasonsAvailable`, `seasonShown`, `seasonPinned`, `birthYear`, `bestSeason`) ; le cache des saisons permet déjà de reconstruire le reste (`loadRecentPlayers` le fait pour les anciennes versions).

### 4.2 — `pruneSeasonCache` ne libère que les saisons et ne réessaie pas l'écriture ; quand ce sont d'autres clés qui saturent, chaque saison échouée relance un balayage complet (gênant sur appareil lent)
- **Lignes** : 3695-3717 ; appelé par `writeSeasonCache` qui est lui-même appelé une fois par saison et par `fetchPack` (4247, 4316, 4320).
- **Scénario** : quota saturé par 4.1. Chargement d'une carrière de 20 saisons : 20 `setItem` échouent, 20 appels à `pruneSeasonCache`, chacun relisant toutes les clés (`Object.keys(localStorage)` + `getItem` par clé — « 274 ms de gel pour cinq cents clés » selon le commentaire 3706-3707), chacun supprimant la moitié des saisons restantes, sans que l'écriture réussisse jamais si l'espace est pris ailleurs.
- **Correctif** : après `pruneSeasonCache()`, retenter une fois le `setItem` ; limiter la purge à un appel par minute (horodatage) ; et surtout traiter 4.1.

### 4.3 — Points vérifiés et corrects
- Tous les `JSON.parse` de `localStorage` sont dans un `try/catch` (3684, 3697, 4803, 5128, 5182, 5199, 5329, 5396, 5443, 5472). Toutes les écritures aussi.
- `getCachedSearch` protège contre `__proto__`/`constructor` (5140). Les clés `duelio_season_v1:*` sont purgées (3680) ; `duelio_qcache_v1` est borné à 80 entrées ; l'index court passe par un `replacer` qui retire les champs dérivés (4822).
- Clés jamais purgées mais bornées : `duelio_career2_<id>` (48 h, une par joueur ouvert ; jamais supprimées même périmées — mineur), `duelio_roster_*`/`duelio_pinned_*`/`duelio_extra_*` (code conditionnellement mort, voir 6.1).

---

## 5. Canvas et images

### 5.1 — Les polices chargées avant le dessin ne couvrent qu'« Unbounded » (mineur)
- **Lignes** : 7730 (`document.fonts.load("800 20px 'Unbounded'")` et `700`), alors que le dessin emploie `'Plus Jakarta Sans'` en 700 et 800 (7922, 7929, 7958, 8032, 8246, 8270, 8323, 8346, 8356, 8405, 8421, 8438…).
- **Scénario** : première visite, la feuille Google Fonts arrive en `display=swap` (79) ; l'utilisateur génère vite une image, ou `Plus Jakarta Sans 800` n'a encore jamais été utilisée à l'écran.
- **Conséquence** : sous-titres, libellés et prénoms rendus en `sans-serif` du système sur l'image partagée. Pas d'erreur, mais une image qui ne ressemble pas à l'aperçu. Si la feuille de polices n'est pas encore chargée du tout, `fonts.load` résout sans rien charger et même « Unbounded » manque.
- **Correctif** : charger aussi `"700 20px 'Plus Jakarta Sans'"` et `"800 20px 'Plus Jakarta Sans'"`, et attendre `document.fonts.ready` en plus de `fonts.load`.

### 5.2 — Points vérifiés et corrects
- Toutes les images dessinées sur le canvas sont soit des `data:` (logo 7702, stade 7703, monogrammes 7411/7423), soit chargées avec `crossOrigin='anonymous'` (7408) avec repli sur le monogramme en cas de refus CORS : le canvas ne peut pas être « tainted », `toBlob` ne lèvera pas de `SecurityError`. (Voir 8.1 pour la réserve sur les en-têtes serveur.)
- `toBlob` nul et exceptions dans le rappel sont gérés (8448-8453, 8490-8497) ; le bouton revient toujours.
- Les canvas intermédiaires (`calque`, `t`, grain) sont des variables locales relâchées à la fin ; `shareGeneratedBlobUrl` est révoqué à chaque nouvelle image (8454). Le canvas d'aperçu de 1080×1920 reste dans le DOM jusqu'au prochain `renderGenerateBody` : acceptable.
- Les divisions : `extractSeasonStats` garde toutes ses moyennes par `appearances > 0` (3472-3487, 3511) ; `butsParMatch` est déclaré « manquant » quand `appearances` vaut 0 (3346) ; `ecartPct` et la barre de rapport de force testent `ref > 0` / `tot > 0` (6238, 6257). Aucun `NaN` affichable trouvé. Les saisons circulent partout en `Number` (`parseInt`/`Number` à 4246, 4314, 6706, 6903) : pas de comparaison chaîne/nombre trouvée.

---

## 6. Code mort et doublons

### 6.1 — Toute la chaîne « effectif préchargé » est inatteignable avec la configuration actuelle
- `fetchLeagueRoster` (5325), `fetchOneLeagueRoster` (5297), `fetchPlayerSeasonStats` (5285), `loadPinnedPlayer` (5440), `loadExtraLeaguePlayers` (5469), `genPlayers`/`genCareer`/`varySeasonStats` (2447-2625), `avatarSVG` et ses tables (2185-2277), `ageFactor`/`statAtAge`/`radarAtAge` (2289-2313), `FALLBACK_REASON`, la bannière « Mode démonstration » (9843-9848) et le mode `estimate` de `getStatSource` : tout cela n'est appelé que si `REAL_DATA_CONFIG.preloadRoster` est vrai (5415-5417 sort avant). Vérifié par Grep : chaque fonction est bien référencée, mais uniquement depuis cette branche. Environ 700 lignes, plus les clés de cache `duelio_roster_*`, `duelio_pinned_*`, `duelio_extra_*` et `REAL_DATA_CONFIG.leagueIds/maxPages/maxPlayers/requestDelayMs/cacheHours`.

### 6.2 — `compareBasis === 'nation'`, `NATION_STATS`, `showCapsBasis`
- `compareBasis` est recalculé à chaque rendu depuis `compareMode` (6147) et ne peut valoir que `current/season/age/ageCumul/seasonCumul/career` (6154). Les branches `'nation'` (6177-6181, 6214-6220, 6298-6311, 6391, 7335, 7348, 7733, 8007, 8190, 8219, 8225) et la constante `NATION_STATS` (2314) sont mortes ; `showCapsBasis` (6131) est calculé et jamais lu.

### 6.3 — Divers
- `compareMode === 'until'` (6143, 6147, 6366) : aucun bouton ne le pose ; seule la valeur `'career'` emprunte ce chemin.
- `pickerPos` (5497, 7287) écrit, jamais lu ; `browsePos` (5962) jamais utilisé ; `CURRENT_YEAR` (2442) n'est utilisé que par la démo.
- `fetchWithRetry` (2826) n'est plus qu'un alias d'`apiFetchJson` ; `fetchBorne` et l'`AbortController` de `runApiJob` font deux fois la même chose avec deux délais différents.
- `www/sw.js` existe dans le dépôt alors que l'en-tête (190-199) le déclare retiré et désinscrit toute ancienne inscription ; `_headers` lui réserve encore une règle. Fichier mort.
- Trois `h1`, CSS `.beam`/`.text-vignette` sans balise (voir 1.8).
- `mapApiPlayerToDuelio(entry, idx, seasonLabel = …)` : le paramètre masque la fonction `seasonLabel` dans son corps (non utilisé à l'intérieur, donc sans effet, mais piégeux).

---

## 7. Robustesse

### 7.1 — Crédits photo des légendes cherchés en relatif : absents hors de workers.dev (gênant, portée juridique)
- **Ligne** : 4660 `fetchBorne(REAL_DATA_CONFIG.legendesCredits || 'data/legendes-credits.json', 12000)` ; `legendesCredits` n'existe pas dans `REAL_DATA_CONFIG` (2630-2671, vérifié par Grep : une seule occurrence dans tout le fichier).
- **Scénario** : page servie depuis `duelio.app` ou depuis `https://localhost` (Android). Le fichier est demandé sur l'origine de la page — exactement le défaut documenté et corrigé pour `legendesUrl` (2645-2648). `_headers` prévoit pourtant une règle CORS pour `/data/legendes-credits.json`.
- **Conséquence** : `LEGENDES.credits` reste vide ; la ligne « Photo : auteur · licence » (9270-9273) n'apparaît sur aucune fiche de légende, alors que les licences Wikimedia exigent l'attribution (et que « À propos » promet des crédits « sur leur fiche »).
- **Correctif** : ajouter `legendesCredits: 'https://duelio-app.bensouna-ahmed.workers.dev/data/legendes-credits.json'` à la configuration.

### 7.2 — Proxy injoignable, fichier 404, index absent, `firebase-config.json` vide : comportements vérifiés
- Proxy injoignable : `runApiJob` coupe à 20 s, trois essais, puis rejette ; `fetchPack` retombe sur `secours` quand la base statique a quelque chose (4297-4302) ; sinon l'erreur remonte en français (`apiErrorMessage`). Correct. Nuance : une réponse 429 persistante au-delà de 5 essais est résolue avec `res.ok === false` et `fetchSeasonEntry`/`fetchPack` testent `!res.ok` avant `json.errors` (3723-3724, 4300-4302) : le message devient « Réponse invalide du serveur » au lieu de « Trop de recherches d'un coup ». Mineur.
- Fichier statique 404 : `chargerPaquetStatique`/`chargerCarriereComplete` rendent `null` → repli API. `chargerTranche` rend `null` → `chargerIndexComplet`. Correct. Mais `chargerIndexComplet` mémorise une promesse résolue à `false` si le fichier répond 404 (4924) : plus jamais retenté dans la session. Mineur.
- `PLAYER_INDEX` jamais chargé (hors ligne au premier lancement, sans copie locale) : la recherche locale rend `[]`, l'API prend le relais après 4 lettres, `loadSuggestedDuel` attend 2 s puis passe par l'API ; `chargerCarriereComplete` tente `full/<id>.json` sans filtrage par `m`. Correct. `alimenterAccueil` attend 6 s puis abandonne en silence (vitrine sans chiffres) : acceptable.
- `firebase-config.json` égal à `{}` (c'est le cas dans le dépôt) : `charger()` sort proprement, `etat.dispo` reste faux, le bouton compte reste `hidden` (7254), « Sauvegarder ce duel » n'est pas rendu (7073). Si `compte.js` lui-même manque, `window.Compte` est indéfini et tout est gardé par `compteDispo()`/`if(window.Compte)`. Correct.
- Légendes injoignables : `chargerLegendes` avale l'erreur (4673-4676), l'appli continue sans elles. Correct.

### 7.3 — Accueil monté en deux moitiés : pas d'identifiant dupliqué
`accueilHtml` (9711-9734) n'emploie que des classes et `data-sub`/`data-aduel` ; les mises à jour passent par `querySelectorAll` (9772, 9789). Le seul souci est d'accessibilité (1.8).

---

## 8. Doutes (non vérifiés)

1. **CORS de `media.api-sports.io`** : si ce CDN n'envoie pas `Access-Control-Allow-Origin`, `loadImageForCanvas` (7408) échoue pour toutes les photos de joueurs actuels et l'image partagée ne montre que des monogrammes. Le code le gère proprement, mais je n'ai pas pu interroger le serveur depuis cet environnement. À vérifier avec une génération d'image réelle sur Android (origine `https://localhost`).
2. **Prise en compte de `_headers` sur Workers** : le fichier est au format Cloudflare Pages ; s'il n'est pas appliqué par le déploiement Workers, les portraits de légendes (`/legendes/photos/*`) perdraient leur `Access-Control-Allow-Origin` et tomberaient eux aussi en monogramme sur le canvas, et `legendes.json` serait refusé depuis `duelio.app`.
3. **Intention de 1.1** : le commentaire 4324-4326 laisse penser que rester sur la dernière saison complète est voulu en début de saison ; mais la constante ne bouge pas toute seule, et nous sommes fin octobre avec 8 à 12 matchs déjà joués.
4. **Taille réelle de `duelio_recent_v1`** (4.1) : estimation par lecture des structures, non mesurée. Un `localStorage.getItem('duelio_recent_v1').length` après avoir ouvert Ronaldo et Messi avec leur carrière tranchera.
5. **`onAuthStateChanged` avant ou après la résolution de `createUserWithEmailAndPassword`** (2.3) : d'après la documentation du SDK web, l'observateur est notifié de façon asynchrone ; le clignotement décrit dépend de ce détail d'implémentation. Facile à vérifier avec un compte de test.
6. **Mise en cache de `compte.js`** : `_headers` fixe `max-age=0` pour `/index.html` mais ne dit rien pour `/compte.js` ; selon le défaut du déploiement, un `index.html` neuf pourrait tourner avec un `compte.js` ancien.
