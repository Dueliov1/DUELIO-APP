# Audit de conformité — Duelio

**Date de l'audit :** 2 novembre 2026
**Périmètre :** `www/index.html`, `www/compte.js`, `www/sw.js`, `www/_headers`, `www/legal/*`, `firestore.rules`, `capacitor.config.json`, `CONFIGURATION.md`, `worker/duelio-proxy-worker.js`, `relais/serveur.js`
**Site audité :** https://duelio-app.bensouna-ahmed.workers.dev
**Éditeur :** Ahmed Bensouna, particulier établi en Belgique (pas de société)

---

## Avertissement et limites de cet audit

Ce document est une analyse technique de conformité, pas un avis juridique signé par un avocat. Il
distingue systématiquement **l'obligatoire** du **recommandé**, et signale ce que je n'ai pas pu
vérifier.

**Ce que je n'ai pas pu vérifier, et qui reste à faire :**

1. **Les conditions d'API-Football.** Le domaine `api-football.com` est bloqué dans
   l'environnement où tourne cet audit, et la page `/terms` a renvoyé une erreur côté serveur. Je
   n'ai donc **pas lu la licence**. Tout ce que j'écris en section 5 sur la redistribution est un
   cadre d'analyse, pas une citation. **C'est le premier document à lire avant de publier.**
2. **La région de la base Firestore.** `www/firebase-config.json` ne la contient pas.
   `CONFIGURATION.md` (§6, point 4) recommande `europe-west1` « de préférence », ce qui veut dire
   que rien ne garantit que c'est la région réellement choisie. **À vérifier dans la console
   Firebase → Firestore → Paramètres.**
3. **Le comportement exact de la balise Cloudflare Web Analytics en conditions réelles**
   (en-têtes `Set-Cookie` éventuels de `static.cloudflareinsights.com`). Le proxy de
   l'environnement a refusé la requête. Voir section 3, point 3.4.
4. **La politique de propriété intellectuelle de Google Play** (page
   `support.google.com/.../9888072`) n'était pas accessible. Ce que j'en dis en section 4.6 est
   décrit à partir de la structure générale des politiques Play, et doit être relu à la source.
5. **La date de création du compte développeur Google Play.** Elle détermine si l'obligation des
   12 testeurs pendant 14 jours s'applique (section 4.5). Seul le propriétaire le sait.

---

## 0. Verdict en une page

**Rien n'empêche techniquement la publication aujourd'hui, mais cinq choses la mettraient en
danger.** La politique de confidentialité existante est, pour un projet individuel, de très bonne
qualité : elle nomme le responsable, les prestataires, les bases légales, les durées, les droits et
l'APD, et elle décrit déjà les comptes et les notifications. Ce n'est pas le cas le plus fréquent.
Les problèmes réels sont ailleurs :

| # | Problème | Nature |
|---|---|---|
| 1 | Les données personnelles **des footballeurs affichés** ne sont traitées nulle part (nom, photo, année de naissance, taille, nationalité, club). Aucune base légale, aucune information au sens de l'article 14 RGPD, aucun canal de retrait. | **Obligatoire** — angle mort principal |
| 2 | Google Play exige depuis 2023 un **lien web** de suppression de compte, en plus du parcours dans l'app. Le parcours in-app existe ; le lien web n'existe pas. | **Obligatoire** — blocage Play |
| 3 | Le **SDK Firebase est chargé pour tous les visiteurs** dès l'ouverture de la page (`index.html` l. 7356), donc l'IP de chacun part chez Google (`gstatic.com`) même sans compte. Non déclaré dans la politique, et non exempté d'ePrivacy. | **Obligatoire** |
| 4 | L'**image partagée** incorpore les portraits CC BY-SA des légendes **sans crédit ni licence**, ce qui viole la licence que `credits.html` reconnaît lui-même. | **Obligatoire** |
| 5 | **1,3 Go de données d'API-Football** sont republiées en fichiers statiques publics (`www/data/`), avec `Access-Control-Allow-Origin: *`. Licence non vérifiée. Et cela contredit les conditions §5, qui interdisent aux utilisateurs exactement cela. | **À vérifier d'urgence** — risque contractuel maximal |

Deux points de forme sont à corriger en même temps, parce qu'ils sautent aux yeux : la politique
annonce en §10 que les comptes utilisateurs arriveront « un jour » alors qu'ils sont en service, et
l'adresse géographique de l'éditeur manque (obligation de commerce électronique, pas RGPD).

---

## 1. Écart entre ce que disent les textes et ce que fait vraiment l'application

### 1.1 Contradiction interne : la politique annonce les comptes au futur

**`www/legal/confidentialite.html`, l. 95 (§10 « Modifications ») :**

> « Si nous ajoutons un jour des fonctions qui changent ce traitement (**par exemple des comptes
> utilisateurs**), cette politique sera mise à jour avant leur mise en service, et la date en tête
> de page changera. »

Or `CONFIGURATION.md` §6 indique « Mis en place le 28 octobre 2026 », et la politique elle-même
décrit les comptes en §4 bis. Le même texte dit donc, à deux endroits, que les comptes existent et
qu'ils n'existent pas encore. La version anglaise a le même défaut (l. 169).

**À faire :** réécrire §10 sans l'exemple (« par exemple l'ajout d'un paiement, d'une fonction
sociale ou d'une nouvelle source de données »), et avancer la date de mise à jour. La date affichée
(26 octobre 2026) est **antérieure** à l'activation des comptes (28 octobre) : c'est en soi l'aveu
que le texte n'a pas été relu après le changement.
**Nature :** obligatoire (un texte d'information qui se contredit ne remplit pas l'article 12.1
RGPD, qui exige une information « concise, transparente, compréhensible »). **Effort : 10 min.**

### 1.2 Transfert vers Google non déclaré : le SDK Firebase est chargé pour tout le monde

C'est l'écart le plus significatif en matière de transfert de données.

- `www/index.html` l. 7350-7357 : `Compte.charger()` est appelé **sans condition** au chargement de
  la page, pour tout visiteur.
- `www/compte.js` l. 28 : `const SDK = 'https://www.gstatic.com/firebasejs/11.6.1/';`
- `www/compte.js` l. 39 : `fetch('firebase-config.json')` — le fichier existe et est rempli, donc la
  suite s'exécute toujours.
- `www/compte.js` l. 62-69 : `import(SDK + 'firebase-app.js')`, `firebase-auth.js`,
  `firebase-firestore.js`, puis `initializeApp()`, `getAuth()`, `getFirestore()`.

**Conséquences concrètes, dès la première seconde, pour quelqu'un qui ne créera jamais de compte :**

1. Trois requêtes partent vers `www.gstatic.com` (Google LLC, États-Unis). Google reçoit l'adresse
   IP, l'en-tête `User-Agent`, et le `Referer` (donc l'URL de Duelio).
2. `getAuth()` initialise la persistance de session de Firebase, qui crée une base **IndexedDB**
   (`firebaseLocalStorageDb`) dans le navigateur.
3. Le SDK ouvre une connexion vers `duelio-5a550.firebaseapp.com` pour le suivi d'état
   d'authentification.

**Ce que dit le texte :** la politique §5 (l. 66-72) énumère trois destinataires de données
techniques — Cloudflare, API-Sports, **Google Fonts**. Le chargement du SDK Firebase depuis
`gstatic.com` n'y figure pas. §4 bis (l. 60) parle bien de Firebase, mais **seulement dans
l'hypothèse où l'on crée un compte** (« Vous pouvez créer un compte… »). Le texte laisse donc croire
qu'aucune donnée ne part chez Firebase tant qu'on ne s'inscrit pas. C'est faux en l'état du code.

**À faire — et le remède est meilleur que la déclaration :** ne charger le SDK qu'au clic sur le
bouton de compte. Concrètement, remplacer l'appel inconditionnel `Compte.charger()` (l. 7356) par
un appel dans le gestionnaire du bouton `accountBtn` (l. 7336), et afficher le bouton sur la seule
présence de `firebase-config.json` plutôt qu'après chargement du SDK. Cela :

- supprime le transfert vers Google pour 100 % des visiteurs qui ne créent pas de compte ;
- supprime l'écriture IndexedDB non sollicitée (voir section 3) ;
- accélère le premier affichage.

**Nature :** obligatoire (soit déclarer, soit supprimer ; déclarer est le moins bon des deux).
**Effort : 30 min de code.**

### 1.3 Stockage local : la liste de §4 est incomplète, et IndexedDB n'est pas mentionné

**`confidentialite.html` l. 47-54 (§4)** annonce trois catégories dans `localStorage` : préférences
d'affichage + écran d'accueil + tutoriel, joueurs récents, copie des statistiques. Le code écrit en
réalité au moins neuf clés :

| Clé | Ligne (`index.html`) | Couverte par §4 ? |
|---|---|---|
| `duelio_season_v1:…` (cache saisons) | 3695, 3715 | Oui (« copie des statistiques ») |
| `INDEX_LS_KEY` (index de recherche) | 4858, 4877 | Oui, par extension |
| `QCACHE_KEY` (**cache des requêtes de recherche**) | 5183, 5188 | **Non** |
| `RECENT_KEY` (joueurs récents) | 5237-5263 | Oui |
| caches pack / carrière / transferts | 5403-5561 | Oui |
| `duelio_tuto_vu` | 6663, 6688 | Oui |
| `duelio_welcomed` | 9836, 9898 | Oui |
| `duelio_share_style` | 7420, 7489 | Oui (« préférences ») |
| `duelio_notifs` (état de l'abonnement) | 7081-7082 | **Non** |
| `duelio_duels_vus` (**compteur de duels consultés**) | 7110, 7114 | **Non** |

Les trois non couvertes méritent attention, surtout la dernière. `duelio_duels_vus` est un
**compteur de comportement d'usage** : il compte les duels consultés pour déclencher l'invitation
aux notifications au troisième (l. 7103-7114, « Un duel vu = les deux joueurs choisis ; au
troisième, on propose les notifications »). C'est la seule donnée du lot qui ne serve pas à faire
fonctionner ce que l'utilisateur a demandé. Voir section 3 pour la conséquence ePrivacy.

Par ailleurs, §4 ne parle que de `localStorage`. Le SDK Firebase utilise **IndexedDB**, et le cache
hors-ligne utilise l'**API Cache** du service worker (`www/sw.js`, `caches.open(...)` l. 30, 55,
75). Enfin la phrase de clôture de §4 (l. 54) :

> « Ces informations ne quittent jamais votre appareil et ne nous sont pas transmises : nous ne
> pouvons ni les voir ni les récupérer. »

devient inexacte si l'on inclut le stockage local au sens large : le jeton de session Firebase
conservé dans IndexedDB est, lui, émis par Google et présenté à Google à chaque requête.

**À faire :** élargir §4 — citer `localStorage`, IndexedDB et le cache du service worker ; ajouter
« vos termes de recherche récents (mis en cache pour accélérer la saisie) », « votre choix
concernant les notifications » ; garder la phrase de non-transmission mais la limiter explicitement
aux éléments listés, en excluant la session de compte traitée en §4 bis.
**Nature :** obligatoire (exactitude de l'information, art. 12-13). **Effort : 20 min.**

### 1.4 La connexion Apple est annoncée alors qu'elle n'est pas en service

- `confidentialite.html` l. 59 : « Si vous vous connectez avec Google **ou Apple**… ». Idem
  `conditions.html` §8 bis.
- `CONFIGURATION.md` §6, point 1 : Apple à activer « quand le compte Apple Developer existe ».
- `compte.js` l. 186 : `appleDisponible: () => !!(etat.config && (etat.config.apple === true || pluginNatif()))`

`pluginNatif()` est vrai dès que `@capacitor-firebase/authentication` est présent — et il est dans
`package.json` et déclaré dans `capacitor.config.json` avec `"apple.com"`. Donc **dans l'APK
Android, le bouton « Continuer avec Apple » s'affichera** et échouera avec
`auth/operation-not-allowed` (message traduit à `compte.js` l. 176 : « Cette méthode de connexion
n'est pas activée »).

**Deux risques distincts :** une fonctionnalité visible et cassée est un motif classique de rejet
Play au titre de la qualité minimale ; et la politique décrit un traitement qui n'a pas lieu, ce qui
affaiblit la crédibilité de tout le document.

**À faire :** conditionner le bouton Apple à `etat.config.apple === true` **et** à la plateforme
iOS, pas à la simple présence du plugin ; ou activer Apple chez Firebase. Et dans les textes,
écrire « Google (et Apple sur iPhone, lorsque cette option est proposée) ».
**Nature :** obligatoire côté Play ; recommandé côté RGPD. **Effort : 15 min.**

### 1.5 La promesse de suppression après trois ans d'inactivité n'est pas outillée

`confidentialite.html` §4 bis : « Un compte inactif depuis trois ans sera supprimé. »
`CONFIGURATION.md` §6 : « Comptes inactifs : **à purger à la main** dans la console
(Authentication → Utilisateurs, trier par dernière connexion) ».

Aucun script, aucune Cloud Function, aucun rappel. Une durée de conservation annoncée et non tenue
est exactement le genre de point qu'une autorité vérifie, parce qu'il est vérifiable.

**À faire :** le plus simple est une tâche planifiée annuelle (rappel agenda) documentée dans
`CONFIGURATION.md`, et une ligne dans le registre des traitements (voir 2.9). Une Cloud Function
serait plus propre mais sort du plan gratuit.
**Nature :** obligatoire (tenir ce qu'on écrit). **Effort : 15 min pour le rappel.**

### 1.6 Localisation des données de compte : non annoncée, et non vérifiable depuis le dépôt

`confidentialite.html` §4 bis dit « Où : **chez Firebase (Google)** » — exact, mais sans
localisation. Le paragraphe sur les transferts hors UE (l. 74) est rattaché à §5 (données
techniques), pas à §4 bis (données de compte).

Deux faits à établir et à écrire :

- **Firestore** : la région est choisie à la création de la base et n'est plus modifiable. À
  vérifier dans la console. Si c'est `nam5` ou une région américaine, les adresses e-mail et les
  duels sont stockés aux États-Unis.
- **Firebase Authentication** : à ma connaissance, Google ne propose pas de régionalisation du
  stockage pour Authentication (contrairement à Firestore). Les identifiants de compte seraient donc
  traités aux États-Unis quelle que soit la région Firestore. **Je ne suis pas certain de ce point
  et il doit être vérifié dans la documentation Firebase à jour** — mais il faut partir de
  l'hypothèse qu'il y a transfert.

**À faire :** ajouter en §4 bis, après « chez Firebase (Google) », une phrase du type : « La base
des duels est hébergée dans la région <X>. L'authentification est assurée par l'infrastructure
mondiale de Google, ce qui implique un traitement aux États-Unis. Ce transfert repose sur la
décision d'adéquation de la Commission européenne du 10 juillet 2023 relative au cadre de protection
des données UE–États-Unis, auquel Google LLC adhère, complétée par les clauses contractuelles types
figurant dans les conditions de Firebase. »
**Nature :** obligatoire (art. 13.1.f). **Effort : 20 min, dont la vérification console.**

### 1.7 L'affirmation « ne pose aucun cookie » est trop absolue

`confidentialite.html` l. 29 (encart « En bref ») : « Duelio s'utilise sans compte, **ne pose aucun
cookie** et ne contient aucune publicité. »

Nuance nécessaire : §3 dit plus justement « Aucun cookie **de notre part** », et mentionne le cookie
technique de l'hébergeur. Mais dès qu'un utilisateur passe par `signInWithPopup` (web, `compte.js`
l. 91 et 103), la fenêtre Google / `firebaseapp.com` dépose ses propres cookies sur **ses** domaines.
Ce n'est pas un cookie de Duelio, et c'est strictement nécessaire à la connexion demandée, donc
exempté — mais l'encart tel qu'il est écrit est faux au sens littéral.

**À faire :** « ne pose aucun cookie de suivi » dans l'encart. **Nature :** recommandé.
**Effort : 2 min.**

### 1.8 Les données personnelles des footballeurs ne sont traitées nulle part

C'est l'écart de fond. Détail et conséquences en **section 5.5**, parce que la question s'y
rattache aussi. En résumé : l'application affiche, pour des personnes physiques identifiées, leur
nom complet, leur photo, leur nationalité, leur année de naissance ou leur âge, leur taille, leur
pied fort, leur club et l'intégralité de leurs statistiques de carrière (`index.html` l. 3586-3600
pour la construction de la fiche, l. 9415-9424 pour l'affichage). Aucune des trois pages légales ne
contient un mot sur le traitement de ces données.

### 1.9 Ce qui est correct, et qu'il faut savoir pour ne pas « corriger » à tort

Pour éviter des inquiétudes inutiles :

- **La clé API Firebase dans `www/firebase-config.json` est publique par conception.** Ce n'est pas
  une fuite. La sécurité repose sur les règles Firestore, qui sont correctes (voir ci-dessous).
  `CONFIGURATION.md` §6 point 5 le dit déjà.
- **Les règles Firestore sont bonnes** (`firestore.rules`) : un utilisateur ne lit et n'écrit que
  sous `users/<son uid>`, rien d'autre n'est accessible. Réserve mineure : `read, write` sur
  `users/{uid}/{document=**}` laisse écrire des documents arbitraires et de taille arbitraire sous
  son propre dossier. Ce n'est pas un problème RGPD, c'est un risque de coût et d'abus de stockage.
  **Recommandé**, pas obligatoire : contraindre les champs et la taille.
- **Le relais à IP fixe (`relais/serveur.js`) ne voit aucune donnée d'utilisateur.** J'ai vérifié :
  le Worker ne transmet ni `CF-Connecting-IP` ni `X-Forwarded-For` au relais, et le relais ne
  journalise aucune IP (seul `console.log` au démarrage, l. 54). L'hébergeur du relais (Hetzner, OVH,
  DigitalOcean…) n'est donc **pas** un sous-traitant de données personnelles d'utilisateurs, et n'a
  pas à figurer dans la politique. Bonne architecture, par chance ou par choix.
- **Tout est en HTTPS.** Aucun point de terminaison `http://` dans `index.html`, `compte.js`,
  `sw.js` (seul `http://www.w3.org` apparaît, et c'est l'espace de noms XML des SVG, pas une
  requête réseau). Important pour le formulaire Play « chiffré en transit » (section 4.1).
- **La suppression de compte est bien écrite.** `compte.js` l. 119-157 : ré-authentification
  **avant** tout effacement, puis duels, puis `users/{uid}`, puis le compte. Le commentaire explique
  que l'ordre inverse faisait perdre les données sans supprimer le compte. C'est le bon ordre.
- **Pas de publicité, pas de SDK publicitaire, pas d'identifiant publicitaire.** Vérifié : aucune
  trace dans le code. Cela simplifie énormément Play et la Families Policy.
- **Aucun contenu de pari.** Vérifié : le seul mot « paris » du dépôt est dans la clause de
  non-recours aux paris des conditions §3. Bon pour la classification du contenu.

---

## 2. Ce qu'il manque obligatoirement au titre du RGPD

Grille d'évaluation : articles 12, 13 et 14 du RGPD. La colonne « État » vaut pour
`confidentialite.html` dans sa version du 26 octobre 2026.

| Exigence | Article | État | Où / ce qu'il faut |
|---|---|---|---|
| Identité du responsable | 13.1.a | **Partiel** | §1 : « Ahmed Bensouna, établi en Belgique ». **L'adresse géographique manque** (voir 2.1) |
| Coordonnées de contact | 13.1.a | **Présent** | §1 et §9 : `bensouna.ahmed@hotmail.com` |
| Coordonnées du DPO | 13.1.b | **Sans objet** | Aucun DPO requis (voir 2.8) |
| Finalités du traitement | 13.1.c | **Présent** | §2, §4 bis, §5, §6, §7 bis |
| Base légale de chaque finalité | 13.1.c | **Partiel** | 6.1.b pour le compte (§4 bis), 6.1.f pour la technique (§5). **Manque pour les notifications** (§7 bis) et **pour les données des joueurs** (voir 2.3) |
| Intérêts légitimes poursuivis | 13.1.d | **Présent** | §5 : « fournir un service fonctionnel et sécurisé » |
| Destinataires / catégories | 13.1.e | **Partiel** | §4 bis (Firebase) et §5 (Cloudflare, API-Sports, Google Fonts), avec liens. **Manque `gstatic.com` / SDK Firebase** (voir 1.2) |
| Transferts hors UE + garanties | 13.1.f | **Partiel** | §5 dernier § : adéquation UE–É-U + CCT. **Non rattaché aux données de compte** (voir 1.6), et **pas de moyen d'obtenir copie des garanties** (voir 2.2) |
| Durées de conservation | 13.2.a | **Partiel** | §4 bis : compte = durée de vie + 3 ans d'inactivité. §5 : journaux « fixée par eux » — trop vague (voir 2.4) |
| Droits : accès, rectification, effacement, limitation, opposition, portabilité | 13.2.b | **Présent** | §9, liste complète |
| Droit de retirer le consentement | 13.2.c | **Partiel** | Le retrait des notifications est décrit (§7 bis) mais la base « consentement » n'est jamais nommée (voir 2.3) |
| Droit de réclamation auprès d'une autorité | 13.2.d | **Présent et bien fait** | §9 nomme l'APD belge avec le lien `autoriteprotectiondonnees.be`, et mentionne l'autorité du pays de l'utilisateur |
| Caractère obligatoire de la fourniture + conséquences | 13.2.e | **Manquant** | Voir 2.5 |
| Décision automatisée / profilage | 13.2.f | **Présent** | §3 : « aucun profilage, aucune décision automatisée » |
| Information des personnes dont les données ne viennent pas d'elles + source | **14**, 14.2.f | **Manquant** | Les footballeurs. Voir 2.6 et 5.5 |
| Délai de réponse | 12.3 | **Présent** | §9 : « dans un délai d'un mois » |
| Information sur les mineurs | — | **Présent, mais non outillé** | §8 : 13 ans et plus. Voir 2.7 |

### 2.1 Adresse géographique du responsable — manquant (obligatoire)

« Établi en Belgique » n'est pas une adresse. Deux fondements distincts l'exigent :

- **RGPD art. 13.1.a** : « l'identité et les coordonnées du responsable du traitement ». Une adresse
  postale est l'attente standard ; un e-mail seul est généralement jugé insuffisant pour identifier
  un responsable.
- **Commerce électronique.** La directive 2000/31/CE du 8 juin 2000 sur le commerce électronique,
  article 5, paragraphe 1, impose au prestataire de service de la société de l'information de rendre
  « aisément, directement et en permanence accessibles » au minimum : *a)* son nom, *b)* **l'adresse
  géographique où il est établi**, *c)* ses coordonnées, y compris son adresse électronique. En
  Belgique, cette directive est transposée au **Livre XII du Code de droit économique** (« Droit de
  l'économie électronique »), à l'article XII.6 — *je donne cette référence d'article de mémoire et
  elle mérite d'être confirmée, mais l'obligation elle-même ne fait aucun doute : c'est du droit
  harmonisé depuis 2000.*

Duelio est un service de la société de l'information gratuit, ce qui ne change rien : l'obligation
ne dépend pas d'une contrepartie financière.

**Remarque pratique pour un particulier.** Publier son adresse privée est inconfortable. Les options
réalistes : une boîte postale, une adresse de domiciliation, ou accepter de publier l'adresse. À
noter que **Google Play affichera de toute façon publiquement l'adresse complète si l'application
est monétisée** (voir 4.5), et le nom légal et le pays dans tous les cas. Autant anticiper.

**À faire :** ajouter l'adresse en §1 de `confidentialite.html` et en §1 de `conditions.html`, dans
les deux langues. **Effort : 5 min, une fois la décision prise.**

### 2.2 Moyen d'obtenir une copie des garanties de transfert — manquant (obligatoire)

L'article 13.1.f exige, pour les transferts hors UE, « la référence aux garanties appropriées ou
adaptées et **les moyens d'en obtenir une copie** ou l'endroit où elles ont été mises à
disposition ». La politique nomme bien les mécanismes (adéquation / CCT) mais ne dit pas où les
trouver.

**À faire :** une phrase en fin de §5 : « Les clauses contractuelles types applicables figurent
dans les conditions de nos prestataires (liens ci-dessus) ; vous pouvez aussi nous en demander copie
par e-mail. » **Effort : 5 min.**

### 2.3 Base légale des notifications et des données de joueurs — manquant (obligatoire)

§7 bis décrit très bien **comment** fonctionnent les notifications, mais ne nomme aucune base
légale. Pour une notification push sur un terminal, deux fondements se combinent :

- le **consentement** (art. 6.1.a RGPD), matérialisé par la permission système accordée
  explicitement — ce que le code respecte scrupuleusement (`index.html` l. 7083-7096 :
  `checkPermissions` puis `requestPermissions`, invitation seulement au troisième duel, jamais à la
  première ouverture) ;
- l'article 13 de la directive 2002/58/CE pour les communications non sollicitées, même si l'absence
  de tout contenu publicitaire (« jamais de publicité », l. 7117) place Duelio très loin du
  marketing direct.

Pour les données des joueurs, la base est l'**intérêt légitime** (6.1.f) : voir 5.5.

**À faire :** ajouter en §7 bis « Base légale : votre consentement (article 6.1.a du RGPD), que vous
donnez en acceptant la permission de votre téléphone et que vous pouvez retirer à tout moment en
désactivant les notifications. » **Effort : 5 min.**

### 2.4 Durée de conservation des journaux techniques — trop vague (obligatoire de préciser)

§5 : « Les journaux techniques de nos prestataires sont conservés pour une durée limitée, fixée par
eux, puis supprimés ou agrégés. » L'article 13.2.a demande « la durée de conservation **ou**, quand
ce n'est pas possible, les **critères** utilisés pour la déterminer ». « Fixée par eux » n'est ni
l'une ni l'autre.

**À faire :** soit vérifier les durées chez Cloudflare et les citer, soit formuler un critère
vérifiable : « conservés le temps nécessaire à la détection d'abus et à la facturation, et en tout
cas pas au-delà des durées fixées dans la politique de Cloudflare, de l'ordre de quelques jours à
quelques mois selon le type de journal. » **Effort : 15 min.**

### 2.5 Caractère obligatoire de la fourniture de l'e-mail — manquant (obligatoire)

L'article 13.2.e exige d'indiquer si la fourniture des données est une exigence contractuelle, si la
personne est tenue de les fournir, et les conséquences d'un refus. Ici c'est simple et c'est à
écrire.

**À faire :** en §4 bis : « L'adresse e-mail est indispensable pour créer un compte : sans elle,
nous ne pouvons ni vous identifier, ni vous permettre de récupérer votre mot de passe, ni retrouver
vos duels. Refuser de la fournir n'empêche pas d'utiliser Duelio, mais empêche d'avoir un compte. »
**Effort : 5 min.**

### 2.6 Information des footballeurs (article 14) — manquant (obligatoire)

L'article 14 s'applique lorsque les données n'ont pas été collectées auprès de la personne
concernée, ce qui est exactement le cas : les données viennent d'API-Football et de Wikimedia
Commons, pas des joueurs.

L'article 14, paragraphe 5, point b, dispense d'informer individuellement lorsque cela « exigerait
des efforts disproportionnés » — ce qui est manifestement le cas pour 55 000 joueurs. **Mais la même
disposition impose alors une contrepartie : « le responsable du traitement prend les mesures
appropriées pour protéger les droits et libertés ainsi que les intérêts légitimes de la personne
concernée, y compris en rendant l'information publiquement disponible ».** Autrement dit : la
dispense d'envoyer 55 000 e-mails s'achète en **publiant** l'information.

Il faut donc une section dédiée dans la politique de confidentialité. Contenu proposé en 5.5.
**Effort : 45 min de rédaction, dans les deux langues.**

### 2.7 L'âge de 13 ans est annoncé mais jamais vérifié

**Le fait :** la politique §4 bis et §8, et les conditions §8 bis, réservent le compte aux 13 ans et
plus. L'écran d'inscription (`index.html` l. 7244-7253) ne comporte **ni date de naissance, ni case
à cocher, ni écran d'âge neutre**.

**Le droit belge :** l'âge du consentement numérique en Belgique est de **13 ans**, fixé par
l'article 7 de la **loi du 30 juillet 2018** relative à la protection des personnes physiques à
l'égard des traitements de données à caractère personnel, qui met en œuvre l'article 8, paragraphe 1,
du RGPD. Le seuil annoncé par Duelio est donc le bon.

**Nuance importante :** la base légale retenue pour le compte est l'exécution du contrat (6.1.b), pas
le consentement. L'article 8 du RGPD, qui ne concerne que le consentement, **ne s'applique donc pas
directement**. Ce qui reste :

- une promesse écrite non vérifiée, ce qui est un défaut de cohérence ;
- la capacité du mineur à contracter en droit civil belge — sujet réel mais à faible enjeu pour un
  service gratuit sans engagement financier ;
- **surtout, le volet Google Play** : si une tranche d'âge contenant des enfants est déclarée dans
  « Public cible et contenu », la Families Policy s'applique et change beaucoup de choses. Voir 4.4.

**À faire (recommandé, pas obligatoire au sens strict) :** ajouter une case à cocher « J'ai 13 ans
ou plus » à l'inscription, ou un écran d'âge neutre. C'est aussi ce qui rend cohérente la
déclaration Play. **Effort : 20 min.**
**À faire (obligatoire) :** reformuler §8, qui dit aujourd'hui « Duelio convient à tous les âges ».
Cette phrase, lue par un examinateur Play, suggère un public incluant les enfants et déclenche la
lecture Families. Préférer : « Le contenu de Duelio convient à tous les publics. La création d'un
compte est réservée aux 13 ans et plus. »

### 2.8 Ce qui n'est PAS requis — pour éviter du travail inutile

- **Délégué à la protection des données (DPO) : non requis.** L'article 37.1 ne l'impose qu'aux
  autorités publiques, aux traitements à grande échelle de données sensibles, ou au suivi
  systématique à grande échelle. Duelio ne relève d'aucun des trois.
- **Analyse d'impact (AIPD) : très probablement non requise.** L'article 35 la réserve aux
  traitements « susceptibles d'engendrer un risque élevé ». Une adresse e-mail et une liste de duels
  n'y entrent pas. *Réserve : la liste des traitements soumis à AIPD publiée par l'APD belge devrait
  être consultée pour confirmer — je ne l'ai pas vérifiée.*
- **Représentant dans l'UE (art. 27) : sans objet.** Le responsable est établi en Belgique.
- **Notification préalable à l'APD : sans objet.** Supprimée par le RGPD depuis 2018.

### 2.9 Registre des traitements (art. 30) — requis, mais à usage interne

L'exemption de l'article 30, paragraphe 5, vise les organismes de moins de 250 personnes, **sauf**
si le traitement « n'est pas occasionnel ». Le traitement de Duelio est continu, donc l'exemption ne
joue pas : un registre est requis. Il n'a pas à être publié, seulement tenu et produit sur demande.

**À faire :** un tableau de six lignes dans un fichier privé (hors dépôt public) : finalité, base
légale, catégories de personnes, catégories de données, destinataires, durée, transferts. Les six
traitements sont : (1) comptes, (2) duels sauvegardés, (3) données techniques / sécurité,
(4) mesure d'audience, (5) notifications, (6) données des joueurs affichés.
**Nature :** obligatoire. **Effort : 1 h.**

### 2.10 Violation de données — à préparer, pas à publier

Les articles 33 et 34 imposent une notification à l'APD sous 72 heures en cas de violation. Rien
n'oblige à le mentionner dans la politique de confidentialité. Ce qu'il faut, c'est savoir quoi
faire : pour Duelio, le scénario réaliste est une compromission du compte Firebase (donc les
adresses e-mail). **Recommandé :** activer la double authentification sur le compte Google qui
détient le projet Firebase, et noter le lien du formulaire de notification de l'APD.
**Effort : 15 min.**

---

## 3. Mesure d'audience et traceurs

### 3.1 Le cadre juridique applicable

Le texte qui commande est l'**article 5, paragraphe 3, de la directive 2002/58/CE** (« ePrivacy »),
telle que modifiée par la directive 2009/136/CE du 25 novembre 2009. Il soumet à consentement
préalable, après information, « **le stockage d'informations, ou l'obtention de l'accès à des
informations déjà stockées**, dans l'équipement terminal d'un abonné ou d'un utilisateur », sauf
dans deux cas :

- stockage ou accès **strictement nécessaire** à la transmission d'une communication ;
- stockage ou accès **strictement nécessaire** à la fourniture d'un service de la société de
  l'information **expressément demandé** par l'utilisateur.

Point décisif, souvent mal compris : **ce texte ne parle pas de cookies.** Il est neutre
technologiquement. Les **lignes directrices 2/2023 du Comité européen de la protection des données
sur le champ d'application technique de l'article 5, paragraphe 3, de la directive ePrivacy**,
version 1.0 adoptée le **14 novembre 2023** et version 2.0 finale adoptée le **7 octobre 2024**, le
confirment explicitement et citent le *local storage* parmi les informations détenues par le
navigateur (§44). Elles précisent aussi que « le fait que cette information soit produite localement
n'exclut pas l'application de l'article 5, paragraphe 3 » (§53), et que l'« obtention d'accès »
couvre le fait d'instruire le terminal de renvoyer l'information visée (§32).

Côté belge, l'**Autorité de protection des données** a publié en **octobre 2023** une *checklist
cookies* dont la ligne directrice est que **seuls les cookies strictement nécessaires sont exemptés
de consentement**. L'APD n'a, à ma connaissance, **jamais publié d'exemption spécifique pour la
mesure d'audience** — contrairement à la CNIL française, qui en a construit une par doctrine, avec
des conditions et une liste d'outils exemptés. **Je n'ai pas vérifié si Cloudflare Web Analytics
figure sur la liste CNIL des solutions exemptées ; je crois qu'il n'y est pas, mais je ne l'affirme
pas.** Et de toute façon, la doctrine CNIL n'engage pas l'APD belge.

### 3.2 Ce qui est exempté de consentement dans Duelio

Toutes les clés suivantes relèvent du second cas d'exemption — strictement nécessaires au service
expressément demandé — et **ne requièrent pas de consentement** :

| Usage | Clé(s) | Pourquoi exempté |
|---|---|---|
| Préférence de style de partage | `duelio_share_style` | Préférence d'affichage choisie par l'utilisateur lui-même |
| Écran d'accueil et tutoriel déjà vus | `duelio_welcomed`, `duelio_tuto_vu` | Évite de réafficher ce que l'utilisateur a déjà écarté |
| Cache des statistiques, des packs, des carrières | `duelio_season_v1:…`, caches pack/carrière | Nécessaire au fonctionnement rapide et hors connexion, qui *est* le service demandé |
| Index de recherche et cache de requêtes | `INDEX_LS_KEY`, `QCACHE_KEY` | Idem : la recherche instantanée est la fonction centrale |
| Joueurs récents | `RECENT_KEY` | C'est une **fonctionnalité visible** que l'utilisateur utilise et peut effacer (`clearRecentPlayers`, l. 5266) |
| État de l'abonnement aux notifications | `duelio_notifs` | Mémorise un choix exprimé par l'utilisateur ; ne pas le mémoriser reviendrait à le harceler |
| Cache du service worker | `sw.js`, `caches.open(...)` | Fonctionnement hors connexion de l'application installée |
| Session Firebase (IndexedDB), **après connexion** | `firebaseLocalStorageDb` | Maintenir la session est strictement nécessaire au compte que l'utilisateur a demandé |

### 3.3 Ce qui n'est PAS exempté en l'état

**a) L'initialisation de Firebase pour les visiteurs qui n'ont rien demandé.** Comme établi en 1.2,
`Compte.charger()` tourne pour tout le monde (l. 7356) et `getAuth()` crée la base IndexedDB de
persistance. Pour un visiteur qui ne cliquera jamais sur « compte », cette écriture **n'est pas
strictement nécessaire à un service qu'il a expressément demandé**. Elle tombe donc dans le champ de
l'article 5, paragraphe 3, et il faudrait un consentement — ce qui serait absurde pour un simple
module de code chargé trop tôt.

**Le bon remède n'est pas une bannière, c'est le chargement différé** décrit en 1.2. Après
correction, l'exemption redevient évidente : l'utilisateur qui clique sur « Mon compte » demande
expressément le service.

**b) `duelio_duels_vus`, le compteur de duels consultés** (l. 7110, 7114). Sa seule raison d'être
est de décider quand proposer les notifications. Ce n'est pas une fonction demandée par
l'utilisateur ; c'est une mécanique de sollicitation. **Strictement, cette écriture n'est pas
exemptée.** En pratique : c'est un entier local, jamais transmis, sans identifiant, dont le risque
réel pour la vie privée est nul, et aucune autorité ne poursuivra ça. Je le signale parce que la
question demandait la rigueur, pas parce qu'il faut s'en inquiéter.

**Remède, 10 minutes :** garder le compteur en mémoire (variable JavaScript) plutôt qu'en
`localStorage`. L'invitation apparaîtrait alors au troisième duel **de la session**, ce qui est
même préférable du point de vue produit. Ou, à défaut, l'intégrer explicitement à la liste de §4
comme une préférence.

### 3.4 Le cas de Cloudflare Web Analytics

**Ce que fait le code.** `index.html` l. 53-64 : une IIFE injecte
`https://static.cloudflareinsights.com/beacon.min.js` avec le jeton
`11fe3e7e1c074ed1b305b5bbacd1040f`, **sans condition et à chaque chargement de page**. Le commentaire
du développeur (l. 50-52) est d'ailleurs honnête : « Ce traceur ne pose pas de cookie et ne suit
personne d'un site à l'autre, ce qui le place hors du champ du bandeau de consentement selon la
lecture la plus courante — je ne suis pas juriste, et c'est à vérifier si vous avez un doute. »
C'est exactement la bonne intuition, et voici la vérification.

**Ce que Cloudflare affirme.** Sur sa page produit Web Analytics, Cloudflare écrit :

> « Cloudflare Web Analytics does not use any client-side state, such as cookies or localStorage, to
> collect usage metrics. »

Et indique ne pas constituer d'empreinte (*fingerprint*) à partir de l'adresse IP ou de l'en-tête
`User-Agent`.

**L'analyse en deux branches.**

- *Y a-t-il **stockage** dans le terminal ?* Si l'affirmation de Cloudflare est exacte, non. Donc la
  première branche de l'article 5, paragraphe 3, ne s'applique pas.
- *Y a-t-il **obtention d'accès à des informations déjà stockées** ?* La balise lit l'API
  Performance du navigateur (temps de chargement détaillés des images et scripts), le `Referer`, le
  type de navigation, le chemin de page, et génère un `pageloadId` (UUID) par chargement — d'après la
  revue technique indépendante de Daniel Aleksandersen (ctrl.blog, **16 décembre 2020**), et ces
  données sont envoyées hors de l'appareil. Or les lignes directrices 2/2023 du CEPD disent au §44 :
  tant que l'information « ne quitte pas l'appareil » il n'y a pas d'accès, mais « lorsque cette
  information ou une quelconque dérivation de celle-ci est consultée, l'article 5, paragraphe 3,
  s'applique ». **Une lecture stricte place donc la balise dans le champ**, et comme la mesure
  d'audience n'est pas strictement nécessaire au service, un consentement serait requis.

**Deux réserves de fait que je n'ai pas pu lever :**

1. La revue ctrl.blog, qui a **presque six ans**, affirme que la balise « dépose un cookie avec un
   identifiant unique quand le navigateur la télécharge ». Si c'était encore vrai, cela
   contredirait Cloudflare et ferait basculer l'analyse. Mon hypothèse est qu'il s'agissait du
   cookie d'infrastructure de Cloudflare (`__cf_bm` / `__cfruid`), posé par le CDN qui sert le
   fichier et non par l'outil de mesure — mais **je n'ai pas pu le vérifier** (le proxy de cet
   environnement a refusé la requête vers `static.cloudflareinsights.com`).
2. Je n'ai pas vérifié si Cloudflare Web Analytics figure sur une liste d'outils exemptés d'une
   autorité européenne.

**Vérification à faire soi-même, 5 minutes :** ouvrir le site dans un navigateur, F12 →
Application → Cookies et Local Storage, et regarder s'il existe quoi que ce soit lié à
`cloudflareinsights.com`. S'il y a un cookie d'identification persistant, la conclusion ci-dessous
change.

### 3.5 Faut-il une bannière de consentement ? Conclusion

> ## **Non.**

Pas de bannière, **à deux conditions et sous une réserve.**

**Conditions :**

1. **Corriger le chargement du SDK Firebase** pour qu'il n'ait lieu qu'au clic sur « Mon compte »
   (section 1.2). Sans cette correction, il y a une écriture non exemptée dans le terminal de tous
   les visiteurs, et la réponse devient discutable.
2. **Ne rien changer à la configuration de Cloudflare Web Analytics** : pas de cookie, pas
   d'identifiant persistant, pas de croisement entre sites, chiffres agrégés uniquement.

**Réserve :** la vérification empirique du 3.4 (absence de cookie d'identification). Si un tel
cookie existe, il faut soit le neutraliser, soit poser une bannière.

**Et la réponse devient « oui » le jour où** l'un de ces éléments apparaît : Google Analytics ou tout
outil posant un identifiant persistant ; une régie publicitaire ; un pixel Meta, TikTok ou autre ;
un identifiant de visiteur, même pseudonyme, qui survit au rechargement ; ou le partage de
statistiques de visite avec un tiers. La bannière doit alors être conforme à la checklist de l'APD
d'octobre 2023 : refus aussi accessible que l'acceptation, pas de pré-cochage, pas de *cookie wall*,
consentement granulaire par finalité, et conservation de la preuve du consentement.

### 3.6 Un point connexe : Google Fonts

Ce n'est pas un problème ePrivacy (aucun stockage), mais c'en est un de transfert sous le RGPD.
`index.html` l. 66-78 et les trois pages légales chargent les polices depuis
`fonts.googleapis.com` et `fonts.gstatic.com` : l'adresse IP de chaque visiteur part chez Google
avant toute action de sa part. La politique le déclare honnêtement (§5), ce qui est déjà mieux que
la plupart des sites.

Le point de vigilance : le **tribunal régional de Munich I (LG München I), jugement du 20 janvier
2022, affaire 3 O 17493/20**, a condamné un exploitant de site à 100 € de dommages et intérêts pour
avoir transmis l'IP d'un visiteur à Google via Google Fonts en ligne sans consentement. *C'est une
décision allemande de première instance, non contraignante en Belgique, et dont la portée est
discutée* — mais elle a provoqué une vague de courriers de mise en demeure en Allemagne, et le
risque est de nature « plainte », ce que la question demandait d'identifier.

**Remède définitif, et il est facile :** héberger les deux familles de polices (Unbounded, Plus
Jakarta Sans) en local, dans `www/fonts/`, avec une règle `@font-face`. Cela supprime le transfert,
supprime la ligne Google Fonts de la politique, **et accélère le premier affichage** — ce qui, vu
les commentaires de performance dans `index.html` l. 74-79, devrait plaire à l'auteur.
**Nature :** recommandé (pas obligatoire). **Effort : 1 h.**

---

## 4. Règles du Google Play Store

Sources officielles consultées le 2 novembre 2026 ; aucune de ces pages d'aide n'affiche de date de
dernière mise à jour, ce qui est une limite de la documentation Google elle-même. Les dates citées
sont celles mentionnées *dans* le contenu.

### 4.1 Formulaire « Sécurité des données » — ce qu'il faut déclarer exactement

Référence : *Provide information for Google Play's Data safety section*,
`support.google.com/googleplay/android-developer/answer/10787469` (dernière entrée du journal des
modifications de la page : **5 décembre 2023**).

**La définition qui commande tout :** « collect » signifie « transmitting data from your app **off a
user's device** ». Donc :

- tout ce qui reste dans `localStorage` **n'est pas** à déclarer (joueurs récents, caches,
  préférences, compteur de duels) ;
- tout ce qui part vers Firebase, Cloudflare ou gstatic **est** à déclarer.

Autre définition décisive : **« sharing »** exclut explicitement les « service providers acting on
the developer's instructions ». Firebase et Cloudflare étant des sous-traitants, **tout se déclare
en « Collected: Yes / Shared: No »**. C'est une erreur fréquente de déclarer Firebase comme un
partage ; ne pas la commettre.

**Déclaration proposée pour Duelio :**

| Type de donnée | Collecté | Partagé | Obligatoire ? | Finalités | Supprimable ? |
|---|---|---|---|---|---|
| **Personal info → Email address** | Oui | Non | **Optionnel** | Account management, App functionality | Oui |
| **Personal info → User IDs** (l'UID Firebase) | Oui | Non | **Optionnel** | Account management, App functionality | Oui |
| **App activity → Other actions** (les duels sauvegardés : nom + identifiants de joueurs) | Oui | Non | **Optionnel** | App functionality | Oui |
| **App info and performance → Diagnostics** (balise Cloudflare : temps de chargement, chemin de page, referrer, pays) | Oui | Non | **Obligatoire** (non désactivable) | **Analytics** | Non |
| **Device or other IDs** (jeton d'enregistrement FCM) | Oui | Non | **Optionnel** | App functionality | Oui |
| Location, Financial info, Health and fitness, Messages, Photos and videos, Audio, Files and docs, Calendar, Contacts, Web browsing | **Non** | — | — | — | — |

**Points de vigilance sur ce tableau :**

- **La ligne « Diagnostics » est celle qu'on oublie.** La balise Cloudflare tourne aussi dans la
  WebView Capacitor : `index.html` est la page de l'application, le jeton est non vide, donc la
  balise se charge dans l'APK comme sur le web. Et elle **n'est pas désactivable** par
  l'utilisateur, d'où « obligatoire » et finalité « Analytics ». C'est une déclaration qui coûte peu
  et dont l'absence est facilement détectée par Google (analyse automatique du trafic de l'app).
  La politique de confidentialité est d'ailleurs déjà cohérente là-dessus (§5 bis : « Les versions
  iOS et Android font exactement la même chose que le site »).
- **La ligne « Device or other IDs » est discutable.** La taxonomie Play décrit cette catégorie
  comme couvrant « an advertising identifier, Android ID, IMEI, BSSID, MAC address ». Le jeton FCM
  n'y figure pas nommément. **Je ne suis pas certain que la déclaration soit exigée.** La déclarer
  est le choix prudent : sur-déclarer n'a jamais fait rejeter une application, sous-déclarer si.
  À noter que `index.html` l. 7074 et 7092 montrent un abonnement **à un sujet** (`duelio-tous`) et
  non un envoi ciblé, et que le jeton n'est stocké nulle part chez l'éditeur — ce que la politique
  §7 bis décrit correctement.
- **Chiffrement en transit : répondre Oui.** Vérifié : tous les points de terminaison sont en HTTPS.
- **Suppression des données : répondre Oui**, et fournir le lien web (voir 4.3).

**Nature :** obligatoire. **Effort : 1 h dans la console.**

### 4.2 Politique de confidentialité : obligatoire, et à deux endroits

Référence : *User Data policy*,
`support.google.com/googleplay/android-developer/answer/10144311`.

Le texte exige : « All apps must post a privacy policy link in the designated field within Play
Console » **et** « a privacy policy link or text within the app itself ». Les deux, pas l'un ou
l'autre. Et même une application qui ne collecte rien doit en fournir une.

Elle doit « comprehensively disclose how your app accesses, collects, uses, and shares user data »
— explicitement **au-delà** de ce qui figure dans la section Sécurité des données — et inclure
l'identité du développeur, un contact pour les questions de confidentialité, et « the developer's
data retention and deletion policy ».

**État de Duelio :**

- **Lien dans l'app : présent.** `index.html` l. 1743-1745 (écran « À propos » : confidentialité,
  conditions, crédits photos) et l. 7249 (sous le formulaire d'inscription, avant la création du
  compte — bonne pratique).
- **Champ Play Console : à remplir à la publication.** URL :
  `https://duelio-app.bensouna-ahmed.workers.dev/legal/confidentialite.html`. Elle doit rester
  accessible en permanence, sans authentification, et ne pas rediriger vers une page générique.
  **Attention au changement de domaine prévu** (`duelio.app` apparaît dans `_headers` et dans le
  Worker) : si l'URL déclarée meurt, c'est un motif de retrait.
- **Contenu : le plus gros manque est la rétention et la suppression** (couverte en §4 bis, mais à
  compléter par le lien web de suppression, 4.3), **et le point de contact**, qui est une adresse
  Hotmail personnelle. Ce n'est pas interdit, mais une adresse au nom du service
  (`contact@duelio.app`) est plus crédible et évite d'exposer une adresse privée.

**Sur la « divulgation bien visible » (prominent disclosure) :** la politique exige une divulgation
*dans l'application*, avant toute demande de permission, pour les collectes que l'utilisateur
n'attendrait pas — et elle « cannot only be placed in a privacy policy or terms of service ».
Duelio est en bonne position : la permission de notification est demandée avec un écran
d'explication juste avant (l. 7112-7120, « Les grands duels de la semaine, directement sur ton
téléphone ? … Une notification de temps en temps, jamais de publicité »), et l'inscription affiche
les liens légaux avant la création. **Ce point est déjà conforme, et c'est rare.**

### 4.3 Suppression de compte — le seul vrai blocage à la publication

Référence : *App account deletion requirements*,
`support.google.com/googleplay/android-developer/answer/13327111`. Historique indiqué par la page :
annonce en **avril 2023**, échéance de réponse au questionnaire le **7 décembre 2023** (extension
possible au **31 mai 2024**), et après le **31 mai 2024** « non-compliant apps may face additional
enforcement, such as **removal from Google Play** ».

L'exigence, pour toute application qui permet la création de compte, est **double** :

1. « an **in-app path** to delete their app accounts and associated data », visible, typiquement
   dans les réglages de compte ;
2. « a **web link resource** where users can request app account deletion and associated data
   deletion ». Ce lien doit fonctionner, mentionner l'application ou le nom du développeur, et
   permettre la demande **sans renvoyer l'utilisateur dans l'application**. Il se saisit dans le
   champ dédié du formulaire Sécurité des données.

**État de Duelio :**

- **Parcours in-app : conforme.** `index.html` l. 7224 (« Supprimer mon compte » depuis « Mon
  compte »), l. 7226-7235 (écran de confirmation explicite : « Ton compte et tes duels sauvegardés
  seront effacés définitivement. Cette action ne peut pas être annulée. »), puis `compte.js`
  l. 145-157. La mécanique est bonne : ré-authentification d'abord, puis duels, puis `users/{uid}`,
  puis le compte Firebase.
- **Lien web : ABSENT.** C'est le point bloquant. L'application web expose certes le même panneau à
  l'adresse du site, mais il n'existe aucune page qui l'explique, aucun lien direct, et rien sur
  quoi un examinateur Google puisse atterrir. La politique de confidentialité, elle, dit seulement
  « dans « Mon compte » → « Supprimer mon compte » » (§4 bis) — ce qui renvoie dans l'application,
  exactement ce que la règle interdit pour le lien web.

**À faire — obligatoire, et c'est la première action de la liste finale :** créer
`www/legal/supprimer-compte.html`, en français et en anglais comme les autres pages légales, qui
contienne :

1. le nom de l'application et de l'éditeur (exigence explicite de Google) ;
2. un lien direct vers le site qui ouvre le panneau de compte — par exemple
   `https://duelio-app.bensouna-ahmed.workers.dev/?compte=suppression`, avec quelques lignes dans
   `index.html` pour lire ce paramètre et appeler `openAccountSheet()` avec
   `accountVue = 'suppression'` ;
3. **une voie de recours par e-mail** pour qui ne peut plus se connecter (adresse perdue, mot de
   passe oublié), avec le délai d'un mois — c'est indispensable, parce que la suppression in-app
   exige une ré-authentification (`compte.js` l. 125-144) et qu'un utilisateur bloqué n'y a pas
   accès ;
4. **la liste exacte de ce qui est supprimé** (compte, adresse e-mail, date de création, tous les
   duels) **et de ce qui ne l'est pas** ;
5. la mention que les données locales de l'appareil disparaissent en vidant les données du site ou
   en désinstallant l'application.

Puis saisir cette URL dans le formulaire Sécurité des données, et ajouter le lien en §4 bis de la
politique et dans l'écran « À propos ».

**Une précision d'honnêteté à apporter au texte :** §4 bis promet que « le compte et les duels sont
effacés **immédiatement et définitivement** ». C'est vrai de la base active, mais les sauvegardes du
prestataire persistent un certain temps. Formulation plus sûre : « effacés sans délai de nos
registres actifs, et des sauvegardes de notre prestataire dans les délais que celui-ci applique ».

**Effort : 2 h (page + paramètre d'URL + textes).**

### 4.4 Classification du contenu et public cible

**Classification du contenu.** Référence :
`support.google.com/googleplay/android-developer/answer/188189`. Le questionnaire IARC est de fait
obligatoire : « To receive a rating for each of your apps and games, fill in a rating questionnaire
in Google Play Console ». Les notes sont attribuées par les organismes de classification
indépendants d'après les réponses, et — point important — « **Misrepresentation of your app's
content may result in its removal or suspension** ». Une nouvelle soumission du questionnaire est
requise si une mise à jour change le contenu d'une manière qui affecte les réponses.

**Réponses attendues pour Duelio.** Aucune violence, aucun contenu sexuel, aucun langage grossier,
aucune drogue. Deux questions méritent de l'attention :

- **Jeux d'argent et paris : non.** Vérifié : aucune cote, aucun lien vers un bookmaker, et les
  conditions §3 écartent explicitement l'usage pour les paris. C'est propre.
- **Interactions entre utilisateurs / contenu généré / partage.** À répondre avec précision. Les
  duels sauvegardés sont **privés** (règles Firestore : lecture et écriture par le seul
  propriétaire). Il n'y a **aucun** contenu visible d'un utilisateur à l'autre, aucun chat, aucun
  profil public. Le partage d'image passe par la feuille de partage du système d'exploitation vers
  une application tierce (`index.html` l. 8583, `navigator.share`), ce qui n'est en principe pas une
  « interaction entre utilisateurs » au sens du questionnaire. En cas de doute sur la formulation
  exacte de la question, répondre dans le sens le plus prudent : **sur-classer n'a jamais fait
  retirer une application ; sous-classer, oui.**

**Résultat prévisible :** PEGI 3 / ESRB Everyone / « Tous publics », sans descripteur.

**Public cible — et c'est le choix le plus lourd de conséquences.** Référence : *Manage target
audience and app content settings*, `support.google.com/googleplay/android-developer/answer/9867159`.
Les tranches proposées sont : 5 ans et moins, 6-8, 9-12, 13-15, 16-17, 18 et plus. La page précise
que si l'application cible, même partiellement, une tranche contenant des enfants, elle « must
comply with Google Play's Families Policy Requirements ».

**Recommandation ferme : déclarer 13-15, 16-17 et 18+. Ne pas cocher les tranches en dessous de
13 ans.** Raisons :

1. c'est cohérent avec la règle des 13 ans des textes légaux de Duelio et avec l'âge belge du
   consentement numérique ;
2. cocher une tranche enfant fait entrer dans la Families Policy, et il faudrait alors justifier le
   traitement de données d'enfants par Firebase et la collecte analytique, avec consentement
   parental le cas échéant ;
3. l'application n'a aucune publicité, ce qui évite la question des SDK publicitaires
   auto-certifiés — un avantage qu'il serait dommage de perdre en se compliquant la vie.

**Conséquence sur les textes :** reformuler §8 de la politique (« Duelio convient à tous les âges »),
comme indiqué en 2.7. Garder la phrase telle quelle, c'est se contredire soi-même face à un
examinateur.

### 4.5 Compte développeur de particulier : vérifications et contrainte de test

Référence : `support.google.com/googleplay/android-developer/answer/13628312`.

**Ce qui est demandé à un compte personnel :**

| Élément | Détail |
|---|---|
| Nom du développeur | Peut différer du nom légal (« Duelio » est possible) |
| Nom légal | Repris du profil Google Payments lié |
| Adresse légale | Idem |
| E-mail et téléphone de contact | Vérifiés par code à usage unique, et doivent **rester opérationnels pendant toute la vie du compte** |
| E-mail développeur | Vérifié, et **affiché publiquement** |
| Numéro D-U-N-S | **Non requis** — c'est une exigence des comptes « organisation » uniquement |
| Pièce d'identité | **Non exigée** par cette page pour un compte personnel ; des documents bancaires officiels peuvent l'être selon le pays, pour la vérification du moyen de paiement |

**Ce que Google Play affiche publiquement :** le nom légal, le pays (déduit de l'adresse légale) et
l'e-mail développeur. **Et l'adresse complète si l'application est monétisée.** Certaines régions
peuvent imposer l'affichage du téléphone ou de l'adresse complète. La vérification du paiement
« can take up to 5 days ». L'identité doit être vérifiée **avant** toute publication.

**La contrainte qui bloque le plus souvent, et qui n'est pas juridique :** référence
`support.google.com/googleplay/android-developer/answer/14151465`. « Google Play requires personal
developer accounts created **after 13 November 2023** to test their apps » :

- **au moins 12 testeurs inscrits** à un test fermé (« At least 12 testers must be opted in to your
  closed test ») ;
- **inscrits en continu pendant les 14 jours précédents** (« must have been opted in continuously
  for the preceding 14 days ») ;
- un testeur qui se désinscrit puis revient repart à zéro pour 14 jours ;
- ensuite seulement, « Apply for production » dans le tableau de bord, avec un formulaire en trois
  parties, et un examen qui prend « about a week », parfois plus.

**Si le compte développeur a été créé après le 13 novembre 2023, il faut donc compter au minimum
trois semaines entre « l'application est prête » et « l'application est publique », et trouver douze
personnes réelles.** Ce n'est pas un point de conformité, c'est un point de planning — mais c'est le
mur sur lequel butent la plupart des développeurs individuels, et il vaut mieux lancer le test fermé
**pendant** qu'on corrige les textes légaux, pas après.

### 4.6 Applications affichant des données sportives tierces

**À ma connaissance, Google Play n'a pas de politique spécifique aux données sportives.** Je n'en ai
trouvé aucune, et je préfère le dire plutôt que d'en inventer une. Les politiques qui s'appliquent
réellement sont générales :

- **Propriété intellectuelle.** Interdit l'utilisation non autorisée de contenu protégé par le droit
  d'auteur et de marques de tiers. Google agit sur notification (procédure de retrait), sans se
  prononcer sur le fond : un signalement d'un club ou d'une ligue peut suffire à faire retirer
  l'application le temps du litige. *Je n'ai pas pu accéder à la page officielle de cette politique
  depuis cet environnement ; elle doit être relue à la source.*
- **Fausses déclarations / usurpation.** Interdit de laisser croire à une affiliation ou à une
  approbation par une marque ou une organisation qu'on ne représente pas.

**Ce qui compte en pratique, et c'est la fiche Play qui est le point faible :**

Les conditions §4 disent déjà très bien : « Duelio n'est affilié ni à la FIFA, ni à l'UEFA, ni à
aucune ligue, fédération, club ou joueur. » **Mais cette phrase est dans les conditions, c'est-à-dire
là où personne ne regarde.** Elle doit se trouver :

1. **dans la description de la fiche Play**, de préférence dans les premières lignes ;
2. **dans l'écran « À propos » de l'application** (où l'on trouve déjà la source des données,
   `index.html` l. 1736 — il suffit d'y ajouter la phrase) ;
3. **dans les captures d'écran**, si l'une d'elles met en avant un club.

Et surtout, **aucun blason de club, aucun logo de compétition, aucune photo de joueur ne doit
apparaître dans l'icône, l'image de présentation (feature graphic) ou les captures d'écran de la
fiche Play.** C'est la surface de risque numéro un pour une plainte en marque : c'est public,
indexé, et c'est exactement ce que surveillent les services juridiques des clubs. L'icône actuelle
est générée en SVG abstrait (`index.html` l. 85-118) : parfait, ne pas y toucher.

---

## 5. Droits sur les données affichées

Cinq couches juridiques distinctes se superposent, et il faut les traiter séparément.

### 5.1 Les statistiques : droit des bases de données, et c'est le risque majeur

**Les faits bruts ne sont pas protégés.** Qu'un joueur ait marqué 23 buts en 2024 est un fait ; il
n'y a pas de droit d'auteur sur un fait.

**Mais la base qui les rassemble l'est.** La **directive 96/9/CE du 11 mars 1996** concernant la
protection juridique des bases de données crée, à son **article 7**, un droit *sui generis* au
profit du fabricant d'une base qui atteste d'un « investissement substantiel » dans **l'obtention,
la vérification ou la présentation** du contenu. Ce droit permet d'interdire « l'extraction et/ou la
réutilisation de la totalité ou d'une partie substantielle » du contenu. La base d'API-Sports entre
très probablement dans ce champ.

**Nuance importante, et elle joue dans les deux sens.** La Cour de justice a jugé le **9 novembre
2004**, dans deux arrêts rendus le même jour — *Fixtures Marketing* (C-444/02) et *British
Horseracing Board c. William Hill* (C-203/02) — que l'investissement consacré à la **création** des
données ne compte pas : seul compte celui consacré à les **obtenir, vérifier ou présenter**. Ces
affaires portaient précisément sur des données sportives (calendriers de football, courses
hippiques). Cela affaiblit certaines prétentions de titulaires, mais ne protège pas celui qui
recopie massivement une base constituée par un tiers.

**Ce que fait Duelio, et c'est beaucoup plus que « afficher ».** Le dépôt contient **1,3 Go** de
données sous `www/data/` : `data/stats/<ligue>-<saison>.json` par championnat et par saison,
`data/full/*` (carrières complètes, un fichier par joueur), `data/players/*`, `data/search*.json`.
Ces fichiers sont **servis publiquement** par Cloudflare, en lecture directe, et `www/_headers` leur
ajoute `Access-Control-Allow-Origin: *`.

Autrement dit, Duelio ne consulte pas l'API à la demande : il **republie une copie statique et
publique d'une partie substantielle de la base d'API-Football**, téléchargeable par quiconque connaît
l'URL.

**Et c'est contradictoire avec ses propres conditions.** `conditions.html` §5 interdit à
l'utilisateur d'« extraire, copier ou aspirer de façon automatisée les données du Service (scraping)
ni les redistribuer, en tout ou partie, sous quelque forme que ce soit » — alors que `_headers`
organise techniquement cette redistribution. Un juriste adverse relèverait l'incohérence en une
minute.

**Précision technique, pour ne pas se tromper de remède :** retirer `Access-Control-Allow-Origin: *`
**ne protégerait rien**. CORS n'empêche pas le téléchargement d'une URL publique (un simple `curl`
suffit) ; il n'empêche que la lecture par du JavaScript d'une autre origine. Et les commentaires de
`_headers` expliquent pourquoi l'en-tête est là : l'application tourne sur une origine différente de
celle des données (et sur `https://localhost` dans l'APK Android). La supprimer casserait
l'application sans rien gagner.

**Le seul vrai remède**, si la licence interdit la redistribution, est de placer les données brutes
derrière une route du Worker avec contrôle d'origine et de clé — le Worker sait déjà le faire
(`ORIGINES_AUTORISEES` dans `worker/duelio-proxy-worker.js`, qui note d'ailleurs qu'« un proxy
ouvert à tous laissait n'importe qui vider le quota API »). C'est un chantier d'une journée, et
l'ironie est que la protection existe déjà pour l'API en direct mais pas pour la copie statique, qui
est bien plus facile à aspirer.

**Donc, par ordre :**

1. **Lire la licence d'API-Football** (`https://www.api-football.com/terms`, et les conditions
   propres à l'abonnement souscrit). Chercher : *redistribution*, *resale*, *caching*, *storage*,
   *public display*, *attribution*, *derivative*. **Je n'ai pas pu le faire : le domaine est bloqué
   dans cet environnement et la page a renvoyé une erreur.** Les licences d'API de données
   sportives restreignent très couramment la redistribution en masse et le réhébergement public ;
   mais je ne l'affirme pas pour celle-ci.
2. **Écrire au support d'API-Football** pour poser la question en toutes lettres : « je sers des
   copies statiques publiques de vos données depuis mon CDN pour mon application ; est-ce autorisé
   par mon abonnement ? ». Le dépôt contient déjà `relais/MESSAGE-SUPPORT.md`, donc le canal est
   connu. Une réponse écrite est la meilleure protection possible, et elle est gratuite.
3. **Selon la réponse** : conserver l'architecture, ou passer les données derrière le Worker.

**Nature :** vérification obligatoire avant publication. **Effort :** 1 h pour lire et écrire ;
jusqu'à une journée si la migration s'impose.

### 5.2 Les logos de clubs

Les blasons cumulent deux protections : la **marque** (le signe) et le **droit d'auteur** (le dessin,
lorsqu'il est original).

**Ce qui joue en faveur de Duelio :** le **règlement (UE) 2017/1001 sur la marque de l'Union
européenne, article 14, paragraphe 1, point c**, prévoit que le titulaire ne peut interdire l'usage
de sa marque « pour désigner ou mentionner des produits ou des services comme étant ceux du
titulaire de cette marque », lorsque cet usage est nécessaire pour indiquer la destination d'un
produit ou d'un service — à condition qu'il soit conforme aux usages loyaux. Afficher le blason du
PSG à côté d'un joueur **pour dire qu'il joue au PSG** est un usage référentiel typique.

**Ce qui joue contre :** le droit d'auteur sur le dessin du blason est une question **distincte** de
la marque, et l'usage référentiel ne l'excuse pas automatiquement. Et les clubs et ligues ont des
services juridiques actifs, qui envoient des courriers avant de réfléchir au fond.

**Mesures concrètes :**

- garder les logos **petits et strictement identificatoires**, jamais décoratifs — c'est déjà le cas
  (`.club-logo`, `index.html` l. 2177-2178) ;
- **jamais** dans l'icône, l'image de présentation, les captures d'écran ni aucun support marketing
  (voir 4.6) ;
- garder la clause « aucune affiliation » et la rendre visible dans l'app (voir 4.6) ;
- **prévoir un canal de signalement visible** : un lien « Signaler un problème de droits » dans
  l'écran « À propos », et répondre vite. Un titulaire qui obtient satisfaction en deux jours ne
  saisit pas Google ; un titulaire ignoré, oui. C'est la mesure la plus rentable de toute cette
  section.

**À écrire dans les textes :** `conditions.html` §4 dit déjà l'essentiel (« Les noms des joueurs,
des clubs et des compétitions, ainsi que les logos des clubs, appartiennent à leurs titulaires
respectifs et sont utilisés **à seule fin d'identification** »). Il manque une **procédure de
réclamation** : « Titulaires de droits : si vous estimez qu'un contenu affiché porte atteinte à vos
droits, écrivez-nous à <adresse> en indiquant le contenu concerné et le droit invoqué ; nous
retirerons le contenu dès vérification. » **Effort : 15 min.**

### 5.3 Les photos des joueurs en activité : le double problème

Les photos viennent de `https://media.api-sports.io/football/players/<id>.png`
(`index.html` l. 5013). Deux droits se cumulent :

1. **Le droit d'auteur du photographe.** Duelio ne les héberge pas (simple lien), ce qui est
   favorable, mais les intègre dans ses pages — et surtout les **redessine dans l'image partagée**
   (voir 5.4), ce qui est une reproduction.
2. **Le droit à l'image du joueur.** En droit belge, le droit au portrait est consacré au **Livre XI
   du Code de droit économique, article XI.174** (qui reprend l'article 10 de la loi du 30 juin 1994
   relative au droit d'auteur) : ni l'auteur, ni le propriétaire d'un portrait n'a le droit de le
   reproduire ou de le communiquer au public sans l'assentiment de la personne représentée. *Je
   donne cette référence d'article avec une légère réserve sur sa numérotation exacte, mais le
   principe est solidement établi en droit belge.* Pour les personnalités publiques, dans un contexte
   d'information et pour des faits liés à leur activité professionnelle, la jurisprudence admet une
   tolérance large — mais une application commerciale (même gratuite aujourd'hui ; les conditions §6
   réservent des « fonctions payantes à l'avenir ») se situe sur un terrain moins confortable qu'un
   article de presse.

**Le point dur : API-Sports garantit-il les droits ?** La plupart des fournisseurs de données
sportives fournissent les images « telles quelles » **sans garantir** les droits à l'image ni les
droits photographiques. Si c'est le cas ici, **le risque reste intégralement chez l'éditeur de
Duelio**. C'est une question précise à poser au support en même temps que celle de 5.1.

**Mesures :** garder le crédit photo visible (déjà fait pour les légendes, `index.html` l. 9370) ;
**étendre ce crédit aux photos de joueurs en activité** avec la mention « Photo : API-Sports » ;
tenir prête la procédure de retrait de 5.2 ; et savoir que le repli existe déjà techniquement
(`handlePhotoError`, l. 2145, et `portraitSansPhoto`) — retirer la photo d'un joueur qui le demande
ne casserait donc rien.

### 5.4 L'image partagée viole la licence CC BY-SA des portraits de légendes

**C'est un manquement net, concret, et vérifiable — et il contredit un texte que Duelio a lui-même
écrit.**

**Les faits :**

- `www/data/legendes-credits.json` contient 140 portraits, chacun avec `auteur`, `licence`
  (majoritairement **CC BY-SA 2.0**, le reste en domaine public) et l'URL de la page Wikimedia
  Commons.
- `www/legal/credits.html` les crédite correctement, et va jusqu'à reconnaître l'obligation de
  partage à l'identique : « Une licence « CC BY-SA » impose que toute œuvre dérivée reste sous la
  même licence ; **les portraits recadrés le sont donc.** » C'est exact, et c'est rare de le voir
  écrit.
- La fiche de joueur affiche bien le crédit pour les légendes (`index.html` l. 9370 : « Photo :
  <auteur> · <licence> · crédits »).
- **Mais l'image générée pour le partage incorpore la photo sans aucun crédit.** Le chargement se
  fait en `loadImageForCanvas` (l. 7503-7524), le dessin en `ctx.drawImage` (l. 7995, 8174, 8407,
  8488 selon le style choisi), et **aucun des trois styles (`affiche`, `stade`, `papier`) n'écrit de
  mention d'auteur ni de licence sur le canvas.** J'ai vérifié : aucune occurrence de « CC BY »,
  « Wikimedia » ou « Photo : » dans le code de génération.
- Cette image est ensuite partagée publiquement par l'utilisateur
  (`navigator.share`, l. 8583), et `conditions.html` §4 l'y encourage : « vous pouvez la partager
  librement sur vos réseaux, **sans en retirer la marque Duelio** » — en exigeant la marque Duelio,
  mais sans un mot sur le crédit photo.

**Pourquoi c'est un manquement.** Les licences CC BY et CC BY-SA imposent, pour toute reproduction
ou œuvre dérivée **diffusée**, de mentionner l'auteur, la licence, et de fournir un lien vers la
licence. La page de crédits du site remplit cette obligation **pour le site** ; elle ne voyage pas
avec un PNG posté sur Instagram. Et pour les portraits en CC BY-SA, la clause de partage à
l'identique impose en outre que l'œuvre dérivée — l'image de comparaison — soit elle-même diffusée
sous CC BY-SA, ce qui est incompatible avec une diffusion sans mention de licence.

**Le risque réel est modéré** (un auteur de photo Commons qui repère une story Instagram), mais le
manquement est caractérisé, le remède est simple, et les données nécessaires sont **déjà dans
`legendes-credits.json`**.

**Trois remèdes, par ordre de préférence :**

1. **Graver une micro-mention sur l'image** quand au moins un portrait de légende y figure :
   « Photo : <auteur> · CC BY-SA 2.0 · Wikimedia Commons » en petit, en pied d'image, à côté de la
   marque Duelio. Les trois fonctions de génération écrivent déjà du texte en pied avec
   `drawImage(logoImg, …)` : l'emplacement existe. **Environ 20 lignes, les données sont là.**
2. Utiliser le portrait de repli (silhouette / initiales, `portraitSansPhoto`) dans l'image partagée
   pour les légendes sous CC BY-SA, en gardant la vraie photo dans la fiche. Plus simple, moins beau.
3. Réserver les photos de l'image partagée aux portraits en **domaine public / CC0**, qui n'imposent
   aucune attribution. Le JSON porte déjà le champ `type` (`'CC BY-SA'` / `'domaine public'`) :
   le filtre est immédiat.

**À ajouter aussi dans `conditions.html` §4**, après la phrase sur la marque : « Lorsque l'image
contient un portrait sous licence Creative Commons, la mention de l'auteur et de la licence qui y
figure doit être conservée. »

**Nature :** obligatoire (respect d'une licence que Duelio invoque lui-même). **Effort : 2 h.**

### 5.5 Les données personnelles des joueurs affichés — l'angle mort

**Le fait, vérifié dans le code.** Pour chaque joueur, `index.html` l. 3586-3600 construit et
l. 9415-9424 affiche : nom complet, photo, poste, club, **nationalité**, **âge** et/ou **année de
naissance** (`birthYear`, calculé l. 3572-3580), **taille en centimètres**, **pied fort**, et
l'intégralité des statistiques de carrière.

Ce sont des **données personnelles de personnes physiques identifiées**, au sens de l'article 4,
point 1, du RGPD. Il n'y a aucun doute possible. Et il y en a 55 000.

**Aucune des trois pages légales ne dit un mot de ce traitement.** La politique de confidentialité
ne parle que de l'utilisateur. Les conditions traitent les joueurs sous l'angle de la **propriété
intellectuelle** (§4), ce qui est un autre sujet.

**Pourquoi c'est le point le plus important de cet audit.** Le scénario de plainte le plus probable,
pour une application comme celle-ci, n'est pas un utilisateur mécontent : c'est **un joueur, un
agent ou un avocat qui écrit pour demander le retrait d'une photo, d'une statistique inexacte ou
d'une fiche entière**. Si Duelio n'a ni base légale documentée, ni section d'information, ni canal
d'exercice des droits, il n'a aucune réponse à apporter — et une plainte à l'APD devient simple à
déposer et difficile à défendre.

**L'analyse, et elle est plutôt favorable sur le fond :**

- **Base légale : l'intérêt légitime (article 6.1.f).** Les trois conditions de l'article 6.1.f sont
  réunies de manière défendable : (i) un intérêt légitime réel — informer et divertir le public sur
  le sport professionnel, activité d'intérêt public notoire ; (ii) la nécessité — on ne peut pas
  comparer des footballeurs sans les nommer ; (iii) la mise en balance — il s'agit de données
  **professionnelles**, relatives à l'activité publique de personnes dont la performance est
  commentée quotidiennement par la presse mondiale, et **déjà rendues publiques** par les clubs et
  les ligues. L'attente raisonnable d'un footballeur professionnel quant à la publication de ses
  statistiques est très différente de celle d'un particulier.
- **Pas de catégorie particulière (article 9).** Attention toutefois : la **taille** affichée est à
  la limite. Prise seule, c'est une donnée physique banale, pas une donnée de santé. **Elle le
  deviendrait si l'application ajoutait un jour des données de blessures.** J'ai vérifié : aucune
  donnée de blessure aujourd'hui (aucune occurrence de `injur`/`blessure` dans le code). **Ne pas en
  ajouter sans réexaminer ce point**, car les données de santé relèvent de l'article 9 et changeraient
  complètement l'analyse.
- **Pas de décision automatisée au sens de l'article 22.** Les « verdicts » de Duelio sont des
  calculs affichés, qui ne produisent aucun effet juridique ni aucune conséquence significative sur
  la personne. Les conditions §3 le disent déjà très bien (« fournis à titre informatif et de
  divertissement… ne doivent pas servir de base à une décision »). **C'est une clause bien écrite,
  à conserver telle quelle.**
- **Article 14 : l'information est due, mais par publication.** Voir 2.6.

**À écrire — une nouvelle section dans `confidentialite.html`, en français et en anglais.**
Proposition de contenu, à placer après §7 bis :

> **8. Les données des footballeurs affichés dans l'application**
>
> Duelio affiche le nom, la photographie, la nationalité, l'année de naissance ou l'âge, la taille,
> le pied fort, le club et les statistiques sportives de footballeurs professionnels. Ces
> informations concernent des personnes identifiées et constituent des données à caractère
> personnel. Nous les traitons comme suit.
>
> **D'où elles viennent.** Les statistiques et les photographies des joueurs en activité proviennent
> d'API-Football (API-Sports), un fournisseur de données sportives. Les carrières des légendes ont
> été établies à partir de sources publiques, et leurs portraits proviennent de Wikimedia Commons
> sous licences libres. Nous ne les recueillons pas auprès des joueurs eux-mêmes.
>
> **Pourquoi, et sur quelle base.** Nous les traitons pour informer le public et permettre la
> comparaison de carrières sportives, sur la base de notre intérêt légitime et de celui du public à
> accéder à une information sportive factuelle (article 6.1.f du RGPD). Il s'agit exclusivement de
> données relatives à l'activité professionnelle publique de ces personnes, déjà largement rendues
> publiques par les clubs, les ligues et la presse. Nous ne traitons aucune donnée de santé, aucune
> donnée de vie privée, et nous ne prenons aucune décision automatisée produisant un effet à l'égard
> de ces personnes : les « verdicts » affichés sont des calculs présentés à titre informatif et de
> divertissement.
>
> **Combien de temps.** Les statistiques historiques sont conservées sans limite de durée, par
> nature : il s'agit d'archives sportives. Les données d'un joueur sont retirées sur demande fondée.
>
> **Information individuelle.** Compte tenu du nombre de joueurs concernés, informer chacun
> individuellement exigerait des efforts disproportionnés au sens de l'article 14, paragraphe 5,
> point b, du RGPD. La présente section constitue l'information rendue publiquement disponible que
> cette disposition prévoit en contrepartie.
>
> **Vos droits, si vous êtes un joueur affiché, ou son représentant.** Vous disposez d'un droit
> d'accès, de rectification, d'effacement, de limitation et d'opposition. Écrivez-nous à
> <adresse> en indiquant le joueur concerné et votre demande. Nous répondons dans un délai d'un
> mois. En cas d'opposition, nous cessons le traitement à moins de pouvoir démontrer des motifs
> légitimes impérieux ; en pratique, nous retirons la photographie sans discussion sur simple
> demande du joueur ou de son représentant, et nous corrigeons toute statistique dont l'inexactitude
> est établie. Vous pouvez également introduire une réclamation auprès de l'Autorité de protection
> des données belge.

**Nature :** obligatoire. **Effort : 45 min de rédaction (× 2 langues).**

### 5.6 Les noms de clubs et de compétitions

Marques verbales. L'usage référentiel (article 14, paragraphe 1, point c, du règlement 2017/1001)
couvre l'emploi de « Ligue 1 », « Premier League », « Bundesliga », « La Liga », « Serie A » comme
filtres et étiquettes (`worker/duelio-proxy-worker.js`, `INDEX_LEAGUES`). **À éviter :** reproduire
les logotypes stylisés de ces compétitions, et les employer dans le nom ou la fiche de
l'application d'une manière suggérant une licence officielle. Rien à changer dans le code
aujourd'hui.

---

## 6. Les cinq actions à mener avant publication

Classées par priorité : ce qui bloque la publication d'abord, ce qui expose à une plainte ensuite.

### Action 1 — Créer la page web de suppression de compte

**Pourquoi d'abord :** c'est la seule exigence de cette liste qui **empêche formellement** la
publication. Elle se saisit dans le formulaire Sécurité des données ; sans elle, la déclaration est
incomplète.

**Quoi :** `www/legal/supprimer-compte.html` (FR/EN), un paramètre d'URL `?compte=suppression` dans
`index.html` pour ouvrir directement le panneau de suppression, la voie de recours par e-mail pour
les utilisateurs bloqués, la liste de ce qui est supprimé. Puis l'URL dans Play Console, dans
`confidentialite.html` §4 bis, et dans l'écran « À propos ».

**Risque si on ne le fait pas :** formulaire Sécurité des données incomplet, donc soumission
rejetée ; et pour une application déjà en ligne, Google indique explicitement un risque de
« removal from Google Play » depuis le 31 mai 2024.

**Effort : 2 h.** *Obligatoire.*

### Action 2 — Lire la licence d'API-Football et décider du sort des 1,3 Go publics

**Pourquoi en deuxième :** c'est la seule exposition de cet audit qui peut coûter **de l'argent** et
faire **couper la source de données** du jour au lendemain. Tout le reste se corrige par du texte.
Et c'est aussi la seule action dont le résultat peut imposer de réarchitecturer l'application : il
faut donc la connaître **avant** d'investir dans le reste.

**Quoi :** lire `api-football.com/terms` et les conditions de l'abonnement ; écrire au support la
question en toutes lettres (« je sers des copies statiques publiques de vos données depuis mon
CDN ; est-ce autorisé ? ») et **conserver la réponse écrite** ; selon la réponse, laisser
l'architecture en place ou passer `www/data/` derrière le Worker avec contrôle d'origine. En
profiter pour poser la question des droits sur les photos (5.3).

**Risque si on ne le fait pas :** résiliation de l'abonnement, donc application morte ;
réclamation pour atteinte au droit *sui generis* sur la base de données (directive 96/9/CE,
article 7) ; et le fait que `conditions.html` §5 interdise aux utilisateurs ce que `_headers`
organise rendrait toute défense inconfortable.

**Effort : 1 h pour lire et écrire ; jusqu'à 1 journée si la migration s'impose.**
*Vérification obligatoire ; la suite dépend de la réponse.*

### Action 3 — Mettre la politique de confidentialité à jour sur sept points

**Quoi, dans l'ordre d'écriture :**

1. ajouter la **section sur les données des footballeurs** (texte proposé en 5.5) — le plus
   important ;
2. corriger la **contradiction de §10** et la date de mise à jour (1.1) ;
3. ajouter l'**adresse géographique** de l'éditeur en §1, et en §1 des conditions (2.1) ;
4. déclarer le **chargement du SDK Firebase depuis `gstatic.com`** — ou, mieux, le différer et ne
   rien avoir à déclarer (1.2) ;
5. compléter §4 : **IndexedDB, cache du service worker, cache de recherche, état des
   notifications, compteur de duels** (1.3) ;
6. ajouter en §4 bis la **localisation de la base et le transfert hors UE** (1.6), le **caractère
   obligatoire de l'e-mail** (2.5), et le **lien web de suppression** (action 1) ;
7. ajouter la **base légale des notifications** en §7 bis (2.3), le **moyen d'obtenir copie des
   garanties de transfert** en §5 (2.2), et reformuler §8 sur les âges (2.7 et 4.4).

**Risque si on ne le fait pas :** la politique est le premier document que lit une autorité saisie
d'une plainte, et le seul que lit un examinateur Play. Un texte qui annonce les comptes utilisateurs
au futur alors qu'ils sont en service, et qui omet le transfert vers Google, décrédibilise
l'ensemble — y compris les parties qui sont bonnes. En cas de contrôle, le manquement à
l'article 14 (les joueurs) est le plus difficile à rattraper après coup : on peut corriger un texte,
on ne peut pas corriger l'absence d'information passée.

**Effort : 3 h, dans les deux langues.** *Obligatoire.*

### Action 4 — Trois corrections de code

Regroupées parce qu'elles se font dans la même séance et que chacune supprime un risque distinct.

| Correction | Fichier / lignes | Supprime |
|---|---|---|
| **a.** Charger le SDK Firebase au clic sur « Mon compte », plus au chargement de la page | `index.html` l. 7356 ; `compte.js` l. 36-60 | Le transfert vers Google pour tous les visiteurs **et** la seule écriture non exemptée d'ePrivacy — c'est ce qui permet de répondre « non » à la bannière de consentement |
| **b.** Graver le crédit CC BY-SA sur l'image partagée | `index.html` l. 7960-8540 (les trois styles) ; données déjà dans `data/legendes-credits.json` | La violation de licence de 5.4 |
| **c.** N'afficher le bouton Apple que si le fournisseur est réellement activé | `compte.js` l. 186 | Une fonctionnalité visible et cassée dans l'APK, motif classique de rejet Play |

**Risque si on ne le fait pas :** (a) une bannière de consentement devient défendable, donc une
plainte ePrivacy devient recevable, et la politique devient inexacte ; (b) réclamation d'un auteur
de photographie, et incohérence avec `credits.html` qui reconnaît l'obligation ; (c) rejet Play pour
fonctionnalité défaillante.

**Effort : 3 h au total** (30 min + 2 h + 15 min). *Obligatoire pour (a) et (b) ; (c) obligatoire
côté Play.*

### Action 5 — Remplir Play Console correctement, et lancer le test fermé maintenant

**Quoi :**

- **Sécurité des données** : le tableau de 4.1, sans oublier la ligne « App info and performance →
  Diagnostics » pour la balise Cloudflare, et « Shared: No » partout (Firebase et Cloudflare sont
  des sous-traitants, pas des destinataires de partage) ;
- **Politique de confidentialité** : l'URL dans le champ dédié (4.2) ;
- **Classification du contenu** : questionnaire IARC, non aux paris, et réponse précise sur les
  interactions entre utilisateurs (4.4) ;
- **Public cible** : **13-15, 16-17, 18+. Pas de tranche en dessous de 13 ans** (4.4) ;
- **Fiche Play** : la mention « non affilié à la FIFA, l'UEFA, aucune ligue, fédération, club ou
  joueur » dans les premières lignes de la description ; **aucun blason, logo de compétition ou
  photo de joueur dans l'icône, l'image de présentation ou les captures d'écran** (4.6) ;
- **Vérification d'identité** : nom légal, adresse légale, e-mail et téléphone vérifiés par code ;
  prévoir jusqu'à 5 jours pour la vérification du paiement (4.5) ;
- **Test fermé** : si le compte développeur a été créé après le **13 novembre 2023**, lancer
  immédiatement un test fermé avec **12 testeurs inscrits en continu pendant 14 jours**, puis
  « Apply for production » et environ une semaine d'examen (4.5).

**Risque si on ne le fait pas :** une déclaration Sécurité des données inexacte est un motif de
suspension, et c'est le manquement le plus facile à détecter pour Google, qui analyse
automatiquement le trafic réseau des applications. Cocher une tranche d'âge enfant déclenche la
Families Policy et toutes ses exigences. Et si le test fermé n'est pas lancé tôt, l'application
restera prête mais impubliable pendant trois semaines.

**Effort : 2 h dans la console + 3 semaines de calendrier** pour le test fermé, à lancer en
parallèle des actions 1 à 4. *Obligatoire.*

---

### Recommandé mais non bloquant, si le temps le permet

| Action | Gain | Effort |
|---|---|---|
| **Héberger les polices en local** au lieu de Google Fonts | Supprime le transfert d'IP vers Google pour tous les visiteurs, et accélère le premier affichage (3.6) | 1 h |
| **Tenir le registre des traitements** (art. 30) | Obligation réelle, mais interne et jamais vérifiée spontanément (2.9) | 1 h |
| **Lien « Signaler un problème de droits »** dans « À propos » | La mesure la plus rentable contre une plainte de club ou de photographe (5.2) | 30 min |
| **Case « J'ai 13 ans ou plus »** à l'inscription | Tient la promesse des textes, et aligne la déclaration Play (2.7) | 20 min |
| **Adresse e-mail au nom du service** (`contact@duelio.app`) | Évite d'exposer une adresse privée dans trois pages légales et sur la fiche Play | 30 min |
| **Rappel annuel de purge des comptes inactifs** | Tient la promesse des trois ans (1.5) | 15 min |
| **Double authentification sur le compte Google** du projet Firebase | Le scénario de violation de données le plus probable (2.10) | 15 min |
| **Contraindre les champs dans les règles Firestore** | Évite l'écriture de documents arbitraires sous `users/<uid>` (1.9) | 30 min |
| **Lien direct vers le texte des licences** dans `credits.html` | Referme le dernier interstice de l'attribution CC (5.4) | 15 min |
| **Crédit « Photo : API-Sports »** sur les fiches de joueurs en activité | Symétrie avec les légendes, et bonne foi démontrée (5.3) | 20 min |

---

## Annexe — Sources, avec leurs dates

**Textes européens**

| Texte | Date | Usage ici |
|---|---|---|
| Règlement (UE) 2016/679 (RGPD) | 27 avril 2016 | Articles 6, 8, 9, 12, 13, 14, 22, 30, 33, 34, 35, 37 |
| Directive 2002/58/CE (ePrivacy), art. 5, § 3 | 12 juillet 2002 | Consentement au stockage et à l'accès dans le terminal |
| Directive 2009/136/CE | 25 novembre 2009 | Modifie l'article 5, § 3, dans sa version applicable |
| Directive 2000/31/CE (commerce électronique), art. 5, § 1 | 8 juin 2000 | Nom, **adresse géographique**, coordonnées du prestataire |
| Directive 96/9/CE (bases de données), art. 7 | 11 mars 1996 | Droit *sui generis* du fabricant de base de données |
| Règlement (UE) 2017/1001 (marque de l'UE), art. 14, § 1, c | 14 juin 2017 | Usage référentiel d'une marque |
| Décision d'adéquation UE–États-Unis (*Data Privacy Framework*) | 10 juillet 2023 | Base des transferts vers Google et Cloudflare |

**Lignes directrices et doctrine**

| Source | Date | Usage |
|---|---|---|
| CEPD, **lignes directrices 2/2023** sur le champ technique de l'art. 5, § 3, ePrivacy, v1.0 | adoptées le 14 novembre 2023 | Champ d'application au-delà des cookies |
| Idem, **version 2.0 finale** | adoptée le **7 octobre 2024** | §32 (accès), §44 (*local storage*), §50-51 (pixels), §53 (production locale), §54-55 (IP seule) |
| **APD / GBA (Belgique)**, *checklist cookies* | octobre 2023 | Seuls les cookies strictement nécessaires sont exemptés ; pas d'exemption « mesure d'audience » publiée |

**Droit belge**

| Texte | Date | Usage |
|---|---|---|
| Loi relative à la protection des personnes physiques à l'égard des traitements de données à caractère personnel, **art. 7** | **30 juillet 2018** | Âge du consentement numérique en Belgique : **13 ans** |
| Code de droit économique, **Livre XI, art. XI.174** | — | Droit au portrait *(numérotation d'article à confirmer)* |
| Code de droit économique, **Livre XII, art. XII.6** | — | Information générale du prestataire *(numérotation d'article à confirmer)* |

**Jurisprudence**

| Décision | Date | Usage |
|---|---|---|
| CJUE, *Fixtures Marketing*, C-444/02 | 9 novembre 2004 | L'investissement dans la **création** des données ne fonde pas le droit *sui generis* |
| CJUE, *British Horseracing Board c. William Hill*, C-203/02 | 9 novembre 2004 | Notions d'extraction et de réutilisation d'une partie substantielle |
| LG München I, 3 O 17493/20 | 20 janvier 2022 | Google Fonts en ligne sans consentement — 100 € *(première instance allemande, non contraignante en Belgique)* |

**Documentation Google Play** (pages consultées le 2 novembre 2026 ; aucune n'affiche de date de
mise à jour, les dates indiquées sont celles citées dans le contenu)

| Page | Référence | Date interne |
|---|---|---|
| *App account deletion requirements* | `support.google.com/googleplay/android-developer/answer/13327111` | annonce avril 2023 ; échéances 7 décembre 2023 et 31 mai 2024 |
| *Provide information for Google Play's Data safety section* | `.../answer/10787469` | dernière entrée du journal : 5 décembre 2023 |
| *User Data policy* | `.../answer/10144311` | — |
| *Content ratings* (IARC) | `.../answer/188189` | — |
| *Manage target audience and app content settings* | `.../answer/9867159` | — |
| *Personal developer account requirements* | `.../answer/13628312` | — |
| *Closed testing requirement* | `.../answer/14151465` | comptes personnels créés **après le 13 novembre 2023** ; 12 testeurs, 14 jours |
| *Intellectual property policy* | `.../answer/9888072` | **non accessible depuis cet environnement — à relire à la source** |

**Autres**

| Source | Date | Usage |
|---|---|---|
| Cloudflare, page produit *Web Analytics* | consultée le 2 novembre 2026 | « does not use any client-side state, such as cookies or localStorage » |
| D. Aleksandersen, *A technical and privacy review of Cloudflare Web Analytics*, ctrl.blog | **16 décembre 2020** | Champs transmis par la balise. **Ancien ; à revérifier** |
| API-Football, conditions d'utilisation | — | **NON LU — domaine inaccessible depuis cet environnement** |
| `CONFIGURATION.md` du dépôt, §6 | mise en place des comptes : **28 octobre 2026** | Région Firestore recommandée, purge manuelle des comptes inactifs |
