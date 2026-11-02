# Audit de montée en charge — Duelio

**Date de l'audit : 2 novembre 2026.**
Propriétaire : particulier. Objectif : savoir ce qui casse quand l'application marche, et combien ça coûte.

> **Convention de lecture.** Chaque affirmation est marquée :
> **[VÉRIFIÉ]** = lu dans la documentation officielle à la date indiquée, ou mesuré dans le dépôt.
> **[ESTIMÉ]** = calcul ou hypothèse de ma part, avec le raisonnement donné pour que vous puissiez le contester.

---

## 0. Résumé en dix lignes

1. **Le seul vrai danger de facture est Firebase Blaze** : c'est le seul service de la pile qui facture sans plafond possible. Tant que vous restez sur Spark, aucune facture surprise n'est possible. **[VÉRIFIÉ]**
2. **Cloudflare gratuit ne facture jamais** : il coupe (erreur 1027) ou contourne le Worker. **[VÉRIFIÉ]**
3. **Les fichiers statiques — c'est-à-dire 99 % de Duelio — sont « gratuits et illimités »** chez Cloudflare. Le plafond de 100 000 requêtes/jour ne concerne QUE le Worker `duelio-proxy`. **[VÉRIFIÉ]**
4. **Le premier plafond atteint (~700 utilisateurs/jour) est indolore** : c'est le quota d'écriture Workers KV, utilisé seulement par le journal de diagnostic. L'application ne le remarque pas.
5. **Le premier plafond qui fait mal est la limite par minute d'API-Football**, vers 10 000–15 000 utilisateurs/jour aux heures de pointe — et il fait déjà mal aujourd'hui, à trafic nul (30 % de refus mesurés le 2 novembre 2026).
6. **Le mur des 20 000 fichiers est à 3 813 fichiers de vous.** Il ne dépend pas du trafic. Parade la moins chère : **Workers payant, 5 $/mois → 100 000 fichiers**. **[VÉRIFIÉ]**
7. **Coût à 1 000 utilisateurs/jour : ~1 €/mois** (le nom de domaine) + l'abonnement API-Football.
8. **Coût à 10 000 : ~6 €/mois** + l'abonnement.
9. **Coût à 100 000 : ~7 €/mois d'infrastructure** — mais l'abonnement API-Football devient un devis sur mesure, **sauf si vous finissez la base statique**, ce qui le ramène à l'abonnement actuel.
10. **L'urgence immédiate n'est pas le succès, c'est le 12 novembre 2026** : l'abonnement API-Football expire dans dix jours.

---

## 1. Les plafonds, et à combien d'utilisateurs on les touche

### 1.1 Modèle de consommation par utilisateur — établi en lisant le code

Je n'ai rien inventé ici : voici d'où vient chaque chiffre.

#### Ce que coûte une ouverture de l'application

Trace établie depuis `www/index.html` (fonction `init()`, ligne 9937) et `www/compte.js` :

| Fichier demandé | Taille gzip (mesurée) | Pourquoi, et à quelle fréquence |
|---|---|---|
| `/` (index.html) | **206 Ko** | `Cache-Control: max-age=0, must-revalidate` (`www/_headers`) → revalidé à **chaque** ouverture |
| `compte.js` | 3 Ko | balise `<script>` ligne 1785 ; aucune règle dans `_headers` → revalidation par ETag |
| `firebase-config.json` | 0,3 Ko | `compte.js` ligne 39 : `fetch(..., { cache: 'no-store' })` → **jamais mis en cache, à chaque ouverture** |
| `data/search-top.json` | **205 Ko** | `loadPlayerIndex()` ligne 4869. Copie en `localStorage` périmée après `indexRefreshHours: 6` → **1 téléchargement/jour** pour un visiteur quotidien (le fichier est reconstruit chaque matin par le workflow) |
| `data/legendes.json` | **95 Ko** | `chargerLegendes()` ligne 4709, lancé sans condition dans `init()`. `max-age=3600` → expiré d'un jour sur l'autre |
| `data/legendes-credits.json` | 10 Ko | ligne 4715. `max-age=86400` → ~1 fois sur 2 |
| 2 × `data/full/<id>.json` | 2 × ~10 Ko | `premierDuelAuChaud()` ligne 3997 : le duel Mbappé/Haaland est préchargé pendant un temps mort, **à chaque ouverture** |

**Total ouverture : ≈ 8 requêtes de fichiers statiques, ≈ 540 Ko compressés.** **[VÉRIFIÉ par lecture du code + mesure gzip -9]**

Point important **[VÉRIFIÉ]** : le service worker **est désactivé**. `www/sw.js` existe et est déployé, mais `index.html` ligne 195–199 le *désinscrit* à chaque chargement (« Le service worker est retiré »). Il n'y a donc aucun cache applicatif : seul le cache HTTP du navigateur amortit ces requêtes.

#### Ce que coûte un duel

| Étape | Requêtes | Détail du code |
|---|---|---|
| Taper ≥ 4 caractères | 1 tranche `data/search-az/<initiale>.json` | `chargerTranchesPour()` ligne 4960. **294 Ko gzip pour la tranche `m`**, la plus grosse. Une seule fois par initiale et par session |
| Choisir un joueur **parmi les 15 001 à carrière complète** | 1 × `data/full/<id>.json` (~10 Ko) | `chargerCarriereComplete()` ligne 3966. La fiche contient le champ `t` (palmarès) → **aucun appel au proxy** |
| Choisir un joueur **hors des 15 001** | 1 × `data/players/<n>.json` (14 Ko) **+ 3 invocations du Worker** | Le paquet léger ne contient pas `t` (vérifié : 0/55 entrées du paquet 0). D'où `/pack` (ligne 4346) **+** `/transfers` **+** `/trophies` (lignes 5475–5476, via `fetchRealCareer`) |

**[VÉRIFIÉ]** Couverture exacte de la base : 15 001 fiches complètes dans `www/data/full/`, 55 277 joueurs dans l'index `search-az`, et les 15 001 marqués `m` dans l'index correspondent **exactement** aux 15 001 fiches sur le disque — le court-circuit de la ligne 3972 (`if(entree && !entree.m) return null`) ne provoque donc aucun aller-retour perdu. **73 % des joueurs cherchables (40 276) déclenchent en revanche les 3 appels au proxy.**

#### Hypothèse de session retenue — « H »

**[ESTIMÉ]**, à contester si vous avez des mesures réelles :

- 1,3 session par utilisateur actif et par jour ;
- 1 ouverture, 2 duels, 4 joueurs choisis par session ;
- **80 % des choix tombent dans les 15 001 fiches complètes.** Justification : `search-top.json` ne contient que les 5 000 joueurs les plus connus et c'est ce que l'utilisateur voit en premier ; les 15 001 sont les joueurs d'au moins ~20 matchs. 20 % de choix « longue traîne » est déjà prudent ;
- **10 % des utilisateurs ont un compte**, avec **8 duels sauvegardés** en moyenne.

#### Consommation résultante, par utilisateur actif et par jour

| Ressource | Consommation | Calcul |
|---|---|---|
| Requêtes de fichiers statiques Cloudflare | **≈ 17** | (8 + 2 duels × ~2,5) × 1,3 |
| Octets sortants Cloudflare | **≈ 0,9 Mo** | (540 Ko + 0,6 × 294 Ko + 4 × 10 Ko) × 1,3 |
| Invocations du Worker `duelio-proxy` | **≈ 3,1** | 4 choix × 20 % × 3 appels × 1,3 |
| Appels réellement envoyés à API-Football | **≈ 2** | idem, moins les coups au cache de bord du Worker (TTL 2 jours pour `trophies`/`transfers`, 30 jours pour une saison close — `cacheTtlFor()`, ligne 204) |
| Écritures Workers KV | **≈ 1 à 2** | `noteUsage()` ligne 336 : **1 lecture + 1 écriture KV à chaque MISS du cache de bord** |
| Lectures Firestore | **≈ 1,0** | 10 % × 8 duels × 1,3. `onAuthStateChanged` (compte.js ligne 46) appelle `listerDuels` à **chaque** ouverture, et une requête est facturée **un read par document rendu** |
| Écritures Firestore | ≈ 0,05 | 1 par duel sauvegardé |

### 1.2 Les plafonds officiels, et le nombre d'utilisateurs correspondant

| Service | Plafond officiel | Source et date | Utilisateurs/jour avant le mur |
|---|---|---|---|
| **Workers KV — écritures** | **1 000 écritures/jour** (clés différentes) | docs Cloudflare KV, **maj 30 oct. 2026** **[VÉRIFIÉ]** | **≈ 500 à 900** ← *premier plafond, et indolore* |
| **API-Football — débit/minute** | **450/min, 7/s** (Ultra) | documentée dans le Worker ligne 131 (`PLAN_LIMITS`), le Worker s'auto-bride à 80 % → **360/min** **[VÉRIFIÉ dans le code]** | **≈ 10 000 à 15 000** aux heures de pointe ← *premier plafond douloureux* |
| **Workers — requêtes/jour (plan gratuit)** | **100 000/jour**, remise à zéro à minuit UTC | docs Cloudflare Limits, **maj 29 oct. 2026** **[VÉRIFIÉ]** | **≈ 32 000** (`(100 000 − 288 crons) ÷ 3,1`) |
| **API-Football — requêtes/jour** | **75 000/jour** (Ultra) | page tarifaire api-football.com, consultée le **2 nov. 2026** **[VÉRIFIÉ]** | **≈ 37 000** (`(75 000 − 1 250) ÷ 2`) |
| **Firestore — lectures/jour** | **50 000 lectures/jour** | firebase.google.com/pricing + cloud.google.com/firestore/pricing, consultés le **2 nov. 2026** **[VÉRIFIÉ]** | **≈ 48 000** |
| **Firestore — écritures/jour** | **20 000 écritures/jour** | idem **[VÉRIFIÉ]** | ≈ 400 000 |
| **Firestore — suppressions/jour** | **20 000 suppressions/jour** | idem **[VÉRIFIÉ]** | jamais atteint en usage normal |
| **Firestore — stockage** | **1 Gio** | idem **[VÉRIFIÉ]** | ≈ 5 millions de duels sauvegardés **[ESTIMÉ : ~200 octets/duel]** |
| **Firestore — sortie réseau** | **10 Gio/mois** | idem **[VÉRIFIÉ]** | jamais atteint (un duel pèse quelques centaines d'octets) |
| **Authentication — utilisateurs actifs** | **50 000 MAU** | firebase.google.com/pricing, **2 nov. 2026** **[VÉRIFIÉ]** | ≈ 500 000 utilisateurs/jour, à 10 % de comptes **[ESTIMÉ]** |
| **Cloud Messaging (FCM)** | **Gratuit, aucun quota chiffré publié** | firebase.google.com/pricing, **2 nov. 2026** **[VÉRIFIÉ]** | — |
| **Workers — fichiers statiques** | **20 000 fichiers / version · 25 Mio / fichier** | docs Cloudflare Limits, **maj 29 oct. 2026** **[VÉRIFIÉ]** | **indépendant du trafic** → voir §3 |
| **Workers — requêtes aux fichiers statiques** | **« gratuites et illimitées »** | docs Cloudflare Pricing (**maj 2 oct. 2026**) et Static Assets Billing (**maj 23 avr. 2026**), formulation identique **[VÉRIFIÉ]** | **jamais** |
| **GitHub Actions, dépôt public** | **Gratuit et non décompté** sur les runners standards | docs.github.com, consulté le **2 nov. 2026** : « Standard GitHub-hosted runners in public repositories » figure parmi les usages qui « remain free independently and does not reduce the included compute usage » **[VÉRIFIÉ]** | **jamais** |

### 1.3 Le classement, et ce qu'il signifie

```
   ~700          ~12 000        ~32 000   ~37 000   ~48 000      jamais
     │               │              │         │         │          │
  Écritures      API-Football   Workers    API-Foot  Firestore   Fichiers
     KV          450/min au       100k/j    75k/j    50k lect/j  statiques
  (indolore)      pic (DUR)      (coupe)   (erreurs)  (coupe)   (illimités)
```

Trois enseignements :

1. **Les deux plafonds les plus bas ne sont pas les plus graves.** Le quota KV est consommé par un journal de diagnostic, pas par l'application.
2. **Le vrai goulet est API-Football**, et il l'est déjà. Le relevé `diagnostics/sonde-proxy-pack.txt` du **2 novembre 2026** montre, sur 50 appels séquentiels à trafic nul : **34 succès, 15 refus HTTP 429, 1 réponse vide.** Soit **30 % de refus avant même d'avoir un seul utilisateur.** La cause est documentée dans `CONFIGURATION.md` ligne 201 : API-Football bloque au niveau réseau les adresses IP partagées de Cloudflare Workers. Le dossier `relais/` contient déjà la parade (relais sur machine à IP dédiée) mais `RELAY_URL` n'est pas renseigné.
3. **Tout ce qui est statique passe à l'échelle sans rien faire.** 100 000 utilisateurs/jour = **2,1 To/mois** de sortie **[ESTIMÉ : 0,9 Mo × 100 000 × 23 jours ouvrés équivalents]**, servis gratuitement. Vous n'avez pas de problème de bande passante.

---

## 2. Ce qui casse, et comment

### 2.1 Cloudflare Workers gratuit — 100 000 requêtes/jour

- **Qui est concerné :** uniquement le Worker `duelio-proxy`. `wrangler.toml` ne déclare **aucun `main`** : `duelio-app` est un Worker « assets-only », ses requêtes ne sont pas des invocations de script. **[VÉRIFIÉ : wrangler.toml ne contient que `name`, `compatibility_date` et `[assets]`]**
- **Ce qui se passe :** **[VÉRIFIÉ, docs Limits maj 29 oct. 2026]** « When a Worker exceeds this limit, Cloudflare returns **Error 1027** ». Deux modes, réglables sur la route : *fail open* (« Bypasses the Worker. Requests behave as if no Worker is configured ») ou *fail closed* (page d'erreur 1027).
- **Effet concret sur Duelio : dégradation partielle, pas de panne.** Le site, les 15 001 fiches, les légendes, la recherche, les comparaisons : **tout continue**, ce sont des fichiers statiques. Seuls les joueurs de la longue traîne perdent leur saison en cours et leur palmarès. Le code est écrit pour ça (`fetchPack`, ligne 4286 : « Filet de sécurité : ce que la base statique a su fournir, même partiellement »).
- **Prévenu ?** **Non, pas par défaut.** Cloudflare n'envoie pas d'alerte de dépassement sur le plan gratuit. Vous le découvrirez dans le tableau de bord. **[ESTIMÉ — à confirmer dans Notifications du tableau de bord]**
- **Facturé ?** **Jamais.** Le plan gratuit coupe, il ne facture pas. **[VÉRIFIÉ]**
- **Remise à zéro :** minuit UTC. **[VÉRIFIÉ]**

### 2.2 Workers KV gratuit — 1 000 écritures/jour

- **Ce qui se passe :** **[VÉRIFIÉ, docs Pricing maj 2 oct. 2026]** « If you exceed any one of these limits, further operations of that type will fail with an error. »
- **Effet concret : aucun, pour l'utilisateur.** L'unique écriture KV du chemin chaud est `noteUsage()` (ligne 336), et elle est enveloppée dans un `try { … } catch (e) { /* le journal ne doit jamais casser une réponse */ }`. L'erreur est avalée. **[VÉRIFIÉ par lecture du code]**
- **Ce que vous perdez :** `/diag/usage` cesse d'être à jour — c'est-à-dire votre seul moyen de voir qui consomme votre clé API. Ironie : vous perdez l'instrument de mesure précisément au moment où il devient utile.
- **Facturé ?** Non.
- **Parade, 10 minutes :** n'écrire le journal qu'une fois sur N, ou le remplacer par les `console.log` déjà présents (`api_ok`, `cache_hit`) lus via Workers Logs.

### 2.3 Firebase Spark — lectures Firestore

- **Ce qui se passe :** **[VÉRIFIÉ, cloud.google.com/firestore/pricing, 2 nov. 2026]** « Quotas are applied daily and reset around midnight Pacific time. » Au-delà, les opérations échouent (`RESOURCE_EXHAUSTED`).
- **Attention à une formulation de la FAQ Firebase [VÉRIFIÉ, firebase.google.com/support/faq, 2 nov. 2026] :** pour un projet Spark qui dépasse ses limites, Firebase indique que l'app « se désactivera pour le reste de ce mois ». Cette phrase vise les plafonds **mensuels** (Hosting, Storage). Les quotas Firestore sont **journaliers** et se réinitialisent chaque nuit. **[ESTIMÉ — la FAQ ne tranche pas explicitement le cas Firestore ; prévoyez le pire, c'est-à-dire une désactivation mensuelle, jusqu'à vérification.]**
- **Effet concret sur Duelio : dégradation localisée.** Le reste de l'application ne dépend pas de Firebase. Ce qui casse : la connexion, la liste des duels sauvegardés (`listerDuels` échoue, et le `catch` ligne 49 de `compte.js` se contente d'un `console.warn` → **la liste apparaît vide, sans message d'erreur**). Un utilisateur conclura que ses duels ont été perdus. C'est le pire mode de panne de toute la pile : silencieux et alarmant.
- **Prévenu ?** Firebase envoie des e-mails d'approche de quota sur Spark. **[ESTIMÉ — à vérifier dans les réglages d'alertes du projet.]**
- **Facturé ?** **Jamais sur Spark.** Spark ne demande aucun moyen de paiement. **[VÉRIFIÉ]**

### 2.4 Firebase Blaze — le seul vrai risque de facture

**C'est le point le plus important de cet audit pour un propriétaire particulier.**

**[VÉRIFIÉ, FAQ Firebase, 2 nov. 2026]** À la question de plafonner la dépense sur Blaze : « **No, actuellement il n'est pas possible de restreindre l'usage sur le plan Blaze.** » Google « évalue les options ». Le seul garde-fou disponible est une **alerte** de budget, qui prévient — et ne bloque rien.

Conséquence : le jour où vous passez sur Blaze, vous troquez « l'application se dégrade » contre « la facture monte, sans limite haute ». Pour un particulier, ce n'est pas un détail. Et **lier un compte de facturation fait basculer le projet sur Blaze automatiquement** **[VÉRIFIÉ, même FAQ]** — y compris si vous le liez pour une raison sans rapport (par exemple l'authentification par SMS, qui exige Blaze).

Tarifs au-delà du gratuit **[VÉRIFIÉ, cloud.google.com/firestore/pricing, 2 nov. 2026]** :

| Opération | Prix |
|---|---|
| Lectures de documents | **0,03 $ / 100 000** |
| Écritures | **0,09 $ / 100 000** |
| Suppressions | **0,01 $ / 100 000** |
| Stockage | **0,000205479 $ / Gio / jour** (~0,006 $/Gio/mois) |
| Authentication au-delà de 50 000 MAU | **0,0055 $/MAU** jusqu'à 100 000, puis 0,0046 $ **[VÉRIFIÉ, cloud.google.com/identity-platform/pricing]** |

En usage normal ce sont des centimes (voir §4). Le risque n'est pas le trafic : c'est un bug. Un `onSnapshot` mal posé ou une boucle de rendu peut produire des millions de lectures en une nuit. Aujourd'hui, `compte.js` n'utilise que `getDocs` (pas d'écouteur temps réel), ce qui est **la bonne architecture pour éviter exactement ce risque** — à préserver.

### 2.5 GitHub Actions, dépôt public

- **Pas de mur de minutes** : gratuit et non décompté sur runners standards. **[VÉRIFIÉ]**
- **Mais un piège de silence [VÉRIFIÉ, docs.github.com, 2 nov. 2026]** : « In a public repository, **scheduled workflows are automatically disabled when no repository activity has occurred in 60 days.** » Si vous ne poussez rien pendant deux mois, le rafraîchissement quotidien de 04:17 UTC s'arrête — **sans vous prévenir**, et la saison en cours se périme dans toutes les fiches.
- **Facturé ?** Non. Les runners « larger » le seraient, mais vous n'en utilisez pas (`runs-on: ubuntu-latest` partout — vérifié sur les 19 workflows).

### 2.6 Tableau de synthèse des modes de panne

| Plafond | L'appli devient | Prévenu ? | Facturé ou coupé ? |
|---|---|---|---|
| KV 1 000 écritures/j | **inchangée** (journal muet) | non | ni l'un ni l'autre |
| API-Football 450/min | **lente puis partielle** : longue traîne sans saison en cours ni palmarès | non | coupé (429) |
| Workers 100 000 req/j | **partiellement dégradée** : idem, de minuit UTC à minuit UTC | non | **coupé** (1027), jamais facturé |
| Firestore 50 000 lect./j | **comptes cassés en silence** : liste de duels vide | e-mail probable | **coupé** |
| Firebase Blaze | **rien ne casse** | alerte budget seulement | **facturé, sans plafond possible** |
| 20 000 fichiers | **inchangée ; c'est le déploiement qui est refusé** | oui, erreur de `wrangler` | ni l'un ni l'autre |
| Actions, 60 j d'inactivité | **données périmées** | non | ni l'un ni l'autre |

---

## 3. Le mur des 20 000 fichiers

### 3.1 La limite, vérifiée

**[VÉRIFIÉ — docs Cloudflare Workers, page Limits, section « Static assets », dernière mise à jour affichée : 29 octobre 2026]**

| | Workers Free | Workers Paid |
|---|---|---|
| **Fichiers par version du Worker** | **20 000** | **100 000** |
| Taille d'un fichier | 25 Mio | 25 Mio |
| Règles `_headers` | 100 | 100 |
| Caractères par ligne de `_headers` | 2 000 | 2 000 |

Note de la même page : « To use the increased file count limits in Wrangler, you must use version 4.34.0 or higher. »

**Aucune limite de taille totale n'est publiée.** Vos 1 007 Mo ne posent donc pas de problème de volume — seulement de *nombre*. Et aucun de vos fichiers n'approche les 25 Mio : le plus gros déployé est `data/search-az/m.json`, **1,16 Mo**. **[VÉRIFIÉ par mesure]**

Deuxième limite confirmée au passage : **`_headers` est à 21 règles sur 100** (12 blocs de chemins). Aucune marge inquiétante.

### 3.2 Où vous en êtes exactement

**[VÉRIFIÉ par comptage]**

```
Sur le disque, dans www/            16 427 fichiers
dont www/data/stats/                   240  ← exclus par www/.assetsignore
dont www/data/search.json                1  ← index complet héritier, 5,9 Mo
                                   ─────────
Déployés                            16 187 fichiers  (16 427 − 240)
Plafond gratuit                     20 000
MARGE                                3 813 fichiers
```

Détail : 15 002 dans `data/full/` (15 001 fiches + `index.json`), 1 001 dans `data/players/`, 240 dans `data/stats/` (exclus), 27 dans `data/search-az/`, 140 portraits de légendes, 5 pages légales, 8 fichiers racine.

### 3.3 Quand le mur est-il atteint ?

**[ESTIMÉ — trois régimes de croissance]**

| Régime | Rythme | Mur atteint |
|---|---|---|
| **Actuel** : ajouts à la main via `ajouter-joueur.yml` (`workflow_dispatch` seul) | ~10 joueurs/mois | **dans ~32 ans** |
| **Vous remettez le cron de `joueurs-complets.yml`** avec `cible: 20000` | 5 000 fiches en quelques passages | **en une semaine** |
| **Vous visez tous les joueurs indexés** (55 277) | +40 276 fichiers | **impossible sur le plan gratuit** |

Le point de vigilance est précis : `joueurs-complets.yml` ligne 9 porte `cible` par défaut à **15 000**, et son cron quotidien a été retiré le 26 octobre 2026 parce que la cible était atteinte. **Le mur n'est pas un risque passif : il se déclenche le jour où vous relancez ce workflow avec une cible plus haute.** Entre 15 001 et 18 814 fiches vous êtes tranquille ; au-delà, le déploiement casse.

### 3.4 Ce qui se passe au déploiement

**[ESTIMÉ — le comportement exact n'est pas documenté sur la page Limits ; déduit de la formulation « Files per Worker **version** »]**

L'échec survient à l'**envoi**, dans `wrangler deploy`, avant que la nouvelle version n'existe. La version en ligne reste donc intacte et l'application continue de fonctionner normalement. Vous obtenez un code de sortie non nul et un message d'erreur, pas une panne de production.

**Conséquence pratique à ne pas négliger :** comme aucun workflow GitHub ne fait de `wrangler deploy` (**vérifié : zéro occurrence de `wrangler` dans `.github/workflows/`**), le déploiement est manuel. Vous verrez l'erreur. Mais les workflows, eux, continueront de *committer* des fiches dans `main` sans jamais vous alerter — et l'écart entre le dépôt et la production grandira en silence.

### 3.5 Les parades, chiffrées

| # | Parade | Coût | Effort **[ESTIMÉ]** | Effet |
|---|---|---|---|---|
| **1** | **Passer `duelio-app` sur Workers Paid** | **5 $/mois ≈ 4,60 €** | **5 minutes** | 20 000 → **100 000 fichiers**. Marge : 84 000 fiches, soit bien au-delà des 55 277 joueurs indexés. Supprime aussi le plafond de 100 000 requêtes/jour du proxy (§2.1) |
| 2 | **Regrouper les fiches en paquets**, comme `data/players/` | 0 € | 1 à 2 jours | 15 001 fichiers → 1 500 paquets de 10 = **−13 500 fichiers**. **Mais** : un paquet de 10 fiches pèse ~100 Ko gzip contre 10 Ko pour une fiche seule → **10× plus de données téléchargées à chaque sélection de joueur**. Mauvais échange sur mobile |
| 3 | **Servir `data/full/` depuis R2** | **0 €** jusqu'à ~80 000 utilisateurs/jour | 0,5 à 1 jour | −15 001 fichiers. R2 Standard : **10 Go-mois gratuits** (vous en utilisez 0,56), **10 millions d'opérations de classe B gratuites/mois**, **sortie gratuite**. Au-delà : **0,36 $/million**. À 100 000 utilisateurs/jour ≈ 12 M opérations/mois → ~0,72 $/mois. **[VÉRIFIÉ : developers.cloudflare.com/r2/pricing, consultée le 2 nov. 2026]**. Il faut un domaine personnalisé sur le bucket, sinon chaque fiche redevient une invocation de Worker |
| 4 | Déplacer les 1 001 paquets `data/players/` vers R2 | 0 € | 2 heures | −1 001 fichiers seulement. Insuffisant seul |

**La moins chère en argent est la n°3 (0 €). La moins chère tout compris est la n°1 : 4,60 €/mois pour cinq minutes de travail, aucune modification de code, aucune régression de performance, et elle règle deux plafonds d'un coup.** Pour un propriétaire particulier dont le temps est la ressource rare, c'est le bon choix.

---

## 4. Le coût si ça marche

Hypothèses de conversion : **1 $ = 0,92 €** **[ESTIMÉ, taux approximatif de novembre 2026]**. Mois de 30 jours. Modèle « H » du §1.1.

### Scénario A — 1 000 utilisateurs actifs/jour

| Poste | Consommation | Coût/mois |
|---|---|---|
| Cloudflare — fichiers statiques | 17 000 requêtes/j, **27 Go/mois** | **0 €** (gratuit et illimité) |
| Cloudflare — Worker proxy | 3 100 invocations/j, soit 3 % du plafond gratuit | **0 €** |
| Cloudflare — KV | ~1 500 écritures/j → **plafond dépassé**, journal muet | **0 €** |
| Firebase Firestore | ~1 000 lectures/j (2 % du gratuit), ~50 écritures/j | **0 €** (Spark) |
| Firebase Auth + FCM | ~300 MAU | **0 €** |
| API-Football Ultra | 2 000 appels/j + 1 250 (workflow) = **4 % du quota** | abonnement en cours |
| GitHub Actions | ~2 h/mois, runners standards, dépôt public | **0 €** |
| Nom de domaine `.app` | Cloudflare Registrar : **14,20 $/an** de renouvellement **[VÉRIFIÉ, relevé daté du 26 oct. 2026 ; chez d'autres registrars, 14 à 28 $/an]** | **1,10 €** |
| **TOTAL infrastructure** | | **≈ 1 €/mois** + abonnement API-Football |

Le plan gratuit tient sans forcer. Ce qui coûte le plus : **le nom de domaine**, suivi de l'abonnement API.

### Scénario B — 10 000 utilisateurs actifs/jour

| Poste | Consommation | Coût/mois |
|---|---|---|
| Cloudflare — fichiers statiques | 170 000 requêtes/j, **270 Go/mois** | **0 €** |
| Cloudflare — Worker proxy | 31 000 invocations/j = **31 %** du plafond gratuit | **0 €** techniquement |
| Cloudflare — Workers Paid *recommandé* | pour le mur des fichiers + la marge sur le proxy | **4,60 €** |
| Firebase Firestore | ~10 400 lectures/j = **21 %** du gratuit | **0 €** (Spark) |
| Firebase Auth | ~3 000 MAU | **0 €** |
| API-Football Ultra | 20 000 appels/j + 1 250 = **28 %** du quota journalier… | abonnement en cours |
| …**mais le pic par minute** | ~14 appels/min en moyenne ; un pic ×25 (soirée de match) → **350/min**, contre 360 autorisés | **le mur est ici** |
| Nom de domaine | | **1,10 €** |
| **TOTAL infrastructure** | | **≈ 6 €/mois** + abonnement API-Football |

À ce palier, **aucun quota journalier n'est dépassé** : c'est le débit instantané d'API-Football qui lâche aux heures de pointe. Les symptômes sont ceux déjà mesurés aujourd'hui : HTTP 429, « Trop de recherches d'un coup », et un palmarès qui reste sur « Chargement… » pour les joueurs de la longue traîne.

### Scénario C — 100 000 utilisateurs actifs/jour

| Poste | Consommation | Coût/mois |
|---|---|---|
| Cloudflare — fichiers statiques | 1,7 M requêtes/j, **2,1 To/mois** | **0 €** |
| Cloudflare — Workers Paid | 310 000 invocations/j = **9,3 M/mois**, sous les 10 M inclus. CPU : ~9,3 M × 5 ms = 46,5 M CPU-ms, soit **16,5 M au-delà** des 30 M inclus → 16,5 × 0,02 $ = 0,33 $ **[ESTIMÉ sur 5 ms de CPU par invocation, majoritairement des coups au cache de bord]** | **4,90 €** |
| Firebase Firestore (Blaze obligatoire) | 104 000 lectures/j → **54 000 facturables/j** = 1,62 M/mois × 0,03 $/100 k = **0,49 $**. Écritures : 5 000/j, sous le gratuit. Stockage : négligeable | **0,45 €** |
| Firebase Auth | ~30 000 MAU, sous les 50 000 gratuits | **0 €** |
| API-Football | **200 000 appels/j** : au-dessus d'Ultra (75 000) **et** de Mega (150 000) → palier sur devis, « up to 1 500 000 requests per day » **[VÉRIFIÉ : mention sur la page tarifaire, sans prix]** | **inconnu, probablement le premier poste de dépense** |
| Nom de domaine | | **1,10 €** |
| **TOTAL hors API** | | **≈ 7 €/mois** |

**C'est le résultat le plus important de cet audit.** À 100 000 utilisateurs par jour, l'infrastructure coûte **sept euros par mois**. Pas sept cents : sept. Parce que 99 % de Duelio est un tas de fichiers statiques, et que Cloudflare les sert gratuitement sans limite de nombre de requêtes.

**Et le poste API-Football est évitable.** La dépendance vient uniquement des 40 276 joueurs qui n'ont pas de fiche complète. Finissez la base statique — c'est-à-dire étendez `data/full/` aux 55 277 joueurs indexés — et les appels à API-Football tombent de 200 000/jour à **~1 250/jour**, c'est-à-dire au seul workflow de rafraîchissement quotidien. L'abonnement Ultra actuel suffirait alors **à n'importe quel niveau de trafic**, puisque la consommation ne dépend plus du nombre d'utilisateurs. Cette extension exige le plan Workers Paid (§3.5, parade n°1) ou R2 (parade n°3) pour franchir les 20 000 fichiers.

### Ce qui coûte, et ce qui est négligeable

| | Poste |
|---|---|
| **Le plus cher** | **L'abonnement API-Football.** À tous les paliers, et de loin. C'est aussi le seul poste dont le prix n'est pas public |
| **Deuxième** | **Workers Paid, 4,60 €/mois.** Non pas pour le trafic, mais pour le plafond de 20 000 fichiers |
| **Troisième** | **Le nom de domaine, ~1,10 €/mois** — qui dépasse la facture Firebase à 100 000 utilisateurs/jour |
| **Négligeable** | **Firestore** (0,45 € à 100 000 utilisateurs/jour), **Auth** (0 € jusqu'à 50 000 MAU), **FCM** (gratuit), **GitHub Actions** (gratuit, dépôt public), **la bande passante** (0 € pour 2,1 To/mois), **R2** si vous l'utilisez (0 € jusqu'à ~80 000 utilisateurs/jour) |

---

## 5. Les trois choses à faire avant le lancement

### n°1 — Renouveler l'abonnement API-Football, et poser un relais à IP dédiée

**Effort : 1 heure pour le renouvellement, 2 heures pour le relais. Coût : abonnement + ~5 €/mois de serveur. [ESTIMÉ]**

Deux raisons de le mettre en premier, et la première n'a rien à voir avec le succès :

**L'abonnement expire le 12 novembre 2026 — dans dix jours.** S'il n'est pas renouvelé, le proxy répond en erreur et les 40 276 joueurs de la longue traîne perdent leur saison en cours et leur palmarès. Pire : le workflow quotidien de 04:17 UTC cesse de rafraîchir la base, et *toutes* les fiches se périment lentement.

**Et même renouvelé, le proxy est déjà cassé à 30 %.** Mesure du 2 novembre 2026 (`diagnostics/sonde-proxy-pack.txt`) : 15 refus HTTP 429 sur 50 appels, à trafic nul. `CONFIGURATION.md` ligne 201 en donne la cause (blocage des IP partagées de Cloudflare) et le dossier `relais/` contient déjà la solution complète — `cloud-init.yaml` à coller chez n'importe quel hébergeur, puis renseigner `RELAY_URL` et `RELAY_SECRET` dans les variables du Worker. **Tout est écrit. Il reste à le faire.** Lancer sur le Play Store avec 30 % des appels refusés, c'est garantir des avis négatifs dès la première semaine.

Vérification finale : `…workers.dev/diag` doit afficher « sortie : RELAIS à IP dédiée ».

### n°2 — Passer `duelio-app` sur Workers Paid (5 $/mois)

**Effort : 5 minutes. Coût : 4,60 €/mois.**

Un seul clic règle les deux plafonds structurels :

- **20 000 → 100 000 fichiers.** Vous passez de 3 813 fichiers de marge à 83 813, c'est-à-dire de quoi couvrir les 55 277 joueurs indexés et le travail des années à venir.
- **Le plafond de 100 000 requêtes/jour du proxy disparaît** (10 millions inclus par mois), ce qui retire du tableau le risque « erreur 1027 » décrit au §2.1.

Cinq minutes et quatre euros contre un déploiement qui casse et une coupure quotidienne : c'est le meilleur rapport effort/risque de toute cette liste. Et si le trafic ne décolle pas, vous repassez sur le plan gratuit sans rien casser.

### n°3 — Instrumenter, avant d'avoir besoin de l'instrument

**Effort : 2 à 3 heures.**

Vous n'avez aujourd'hui **aucune alerte** sur aucun des sept plafonds du §1.2, et le seul journal qui existe (`/diag/usage`) s'éteindra tout seul vers 700 utilisateurs/jour quand le quota d'écriture KV sera épuisé (§2.2). Trois gestes, par ordre de rendement :

1. **Réparer la panne silencieuse de `compte.js`.** Ligne 49 : `catch(e){ console.warn('duels :', e && e.message); }`. Quand Firestore refuse la lecture, la liste des duels s'affiche **vide, sans un mot**. Un utilisateur en déduira que ses données ont disparu. Il faut afficher « Tes duels sont momentanément inaccessibles, réessaie dans quelques minutes » — c'est quelques lignes, et c'est la différence entre un incident et un avis à une étoile. **30 minutes.**
2. **Alerte de budget Firebase à 1 €, et rester sur Spark jusqu'à la dernière minute.** Blaze n'a **aucun plafond de dépense possible** (§2.4, vérifié). Tant que vous êtes sur Spark, une facture surprise est *structurellement impossible*. Ne liez un compte de facturation que le jour où vous dépassez réellement 48 000 utilisateurs/jour, et pas un jour avant. **30 minutes.**
3. **Un rappel calendaire de 55 jours sur l'activité du dépôt**, et des notifications Cloudflare. Un dépôt public sans activité pendant 60 jours voit ses workflows planifiés désactivés **sans avertissement** (§2.5, vérifié) : la base se périmerait en silence. Un commit vide tous les deux mois suffit. **1 heure** avec la configuration des notifications Cloudflare.

### Ce qui peut attendre après le lancement

- **Le journal KV** (§2.2) : s'éteindra, sans conséquence utilisateur.
- **Finir la base statique** (55 277 fiches) : c'est le grand chantier, celui qui rend le coût indépendant du trafic. Il n'est pas urgent, mais c'est lui qui décide si 100 000 utilisateurs/jour coûtent 7 € ou plusieurs centaines. À lancer dès que la parade n°2 est en place.
- **Réactiver un service worker** : `www/sw.js` est déployé mais désinscrit à chaque chargement (§1.1). Le remettre en service diviserait par deux ou trois les octets servis par visiteur récurrent. Comme la bande passante est gratuite, c'est un gain de confort utilisateur, pas d'argent.
- **`www/data/search.json`** (5,9 Mo, daté du 28 octobre) n'est plus l'index principal, mais il reste le filet de secours de `chargerIndexComplet()` — et il ne marque que **5 000 joueurs** comme ayant une carrière complète, contre 15 001 dans les tranches `search-az` à jour. Si les tranches venaient à manquer, 10 001 joueurs perdraient l'accès à leur fiche complète et déclencheraient 3 appels au proxy chacun. À régénérer ou à retirer.

---

## Annexe — Toutes les sources, avec leur date

| Source | Consultée le | Date de la page |
|---|---|---|
| developers.cloudflare.com/workers/platform/limits — requêtes/jour, erreur 1027, static assets, `_headers` | 2 nov. 2026 | **maj 29 oct. 2026** |
| developers.cloudflare.com/workers/platform/pricing — 5 $/mois, 10 M req., 30 M CPU-ms, « Requests to static assets are free and unlimited » | 2 nov. 2026 | **maj 2 oct. 2026** |
| developers.cloudflare.com/workers/static-assets/billing-and-limitations | 2 nov. 2026 | **maj 23 avr. 2026** |
| developers.cloudflare.com/kv/platform/limits — 1 000 écritures/j, 100 000 lectures/j, 1 Go, valeur 25 Mio | 2 nov. 2026 | **maj 30 oct. 2026** |
| developers.cloudflare.com/r2/pricing — 0,015 $/Go-mois, 10 Go + 10 M classe B gratuits, sortie gratuite | 2 nov. 2026 | pas de date affichée |
| firebase.google.com/pricing — Spark : 1 Gio, 50 k lectures, 20 k écritures, 20 k suppressions, 10 Gio/mois, 50 k MAU, FCM gratuit | 2 nov. 2026 | pas de date affichée |
| firebase.google.com/support/faq — Spark désactivé au dépassement ; **aucun plafond de dépense sur Blaze** | 2 nov. 2026 | pas de date affichée |
| cloud.google.com/firestore/pricing — 0,03 $ / 0,09 $ / 0,01 $ par 100 k ; remise à zéro « around midnight Pacific time » | 2 nov. 2026 | pas de date affichée |
| firebase.google.com/docs/firestore/pricing — facturation par document et par lot de 1 000 entrées d'index | 2 nov. 2026 | pas de date affichée |
| cloud.google.com/identity-platform/pricing — 0 $ jusqu'à 50 k MAU, puis 0,0055 $ | 2 nov. 2026 | pas de date affichée |
| docs.github.com — runners standards gratuits en dépôt public ; **workflows planifiés désactivés après 60 jours d'inactivité** | 2 nov. 2026 | pas de date affichée |
| api-football.com/pricing — Free 100, Pro 7 500, **Ultra 75 000**, Mega 150 000, « up to 1 500 000 » sur devis ; **aucun prix publié** | 2 nov. 2026 | pas de date affichée |
| Relevé de prix `.app` Cloudflare Registrar — 8,20 $ la 1re année, **14,20 $ au renouvellement** | 2 nov. 2026 | relevé daté du **26 oct. 2026** |

### Ce que je n'ai pas pu vérifier

1. **Le prix de l'abonnement API-Football Ultra n'est publié nulle part** — ni sur leur page tarifaire, ni ailleurs. À lire dans votre tableau de bord. C'est le premier poste de dépense de tous les scénarios, et c'est le seul dont je ne peux pas vous donner le montant.
2. **Si les requêtes aux fichiers statiques comptent dans les 100 000/jour du plan gratuit.** Deux pages officielles affirment « free and unlimited », et le `wrangler.toml` ne déclare aucun `main` (Worker « assets-only », sans script à invoquer). Je conclus que non, mais la page Limits ne tranche pas explicitement. **C'est l'hypothèse la plus lourde de cet audit** : si elle était fausse, le mur passerait de ~32 000 à ~6 000 utilisateurs/jour. **Test de 5 minutes pour lever le doute :** regardez le compteur de requêtes du tableau de bord Cloudflare pour `duelio-app` après une journée de navigation, et comparez-le au nombre de fichiers servis.
3. **Le message d'erreur exact de `wrangler deploy` au-delà de 20 000 fichiers**, et si l'échec survient avant ou après la création de la version. J'ai déduit « avant » de la formulation « Files per Worker *version* ».
4. **Si Firebase envoie bien un e-mail d'approche de quota sur Spark**, et si Cloudflare notifie l'approche des 100 000 requêtes/jour sur le plan gratuit. À vérifier dans les réglages de notification des deux tableaux de bord — c'est le genre de détail qui décide si vous apprenez un incident par un graphique ou par un commentaire sur le Play Store.
