# Configuration Duelio — ce qui ne vit pas dans ce dépôt

Le code est ici. Le reste vit dans le tableau de bord Cloudflare et **n'est capturé par
aucun fichier**. Si le compte Cloudflare disparaissait, ce dépôt seul ne suffirait pas à
reconstruire Duelio. Ce document est la liste de tout ce qu'il faudrait recréer.

À tenir à jour à chaque fois qu'un réglage change.

---

## 1. Worker `duelio-proxy`

Le fichier : `worker/duelio-proxy-worker.js`
L'adresse actuelle : `https://duelio-proxy.bensouna-ahmed.workers.dev`

### Secrets (Settings → Variables and Secrets → type « Secret »)

Jamais dans le dépôt. À noter dans un gestionnaire de mots de passe, pas ici.

| Nom | À quoi ça sert | Où le retrouver |
| --- | --- | --- |
| `API_FOOTBALL_KEY` | La clé API-Football | dashboard.api-football.com |
| `RELAY_SECRET` | Le mot de passe partagé avec le relais à IP dédiée | à regénérer si perdu |
| `INDEX_BUILD_KEY` | **Obligatoire depuis le 30 octobre 2026.** Protège `/diag`, `/diag/usage`, `/index/status` et `/index/build`, et sert de laissez-passer aux outils (sondes GitHub) qui appellent le proxy sans navigateur : en-tête `X-Duelio-Key` ou `?key=`. Une longue chaîne aléatoire ; la même valeur est à mettre dans les secrets GitHub du dépôt sous le nom `INDEX_BUILD_KEY`. | à regénérer si perdu |

Depuis cette date, le proxy ne répond qu'aux origines de Duelio (le site, le futur domaine,
l'application Android/iOS) ou aux appels munis de la clé : un proxy ouvert à tous laissait
n'importe qui vider le quota API. Les comptes utilisateurs passent par Firebase (section 6) :
les routes `/auth` et `/favorites`, la base D1 et l'envoi d'e-mails Resend ont été retirés
du Worker ; `RESEND_API_KEY` et `EMAIL_FROM` ne servent plus et peuvent être supprimés.
**Après toute modification du fichier `worker/duelio-proxy-worker.js`, le Worker doit être
redéployé à la main** (Cloudflare → Workers → duelio-proxy → Edit code → coller → Deploy).

### Variables (type « Text », visibles)

| Nom | Valeur actuelle | Effet |
| --- | --- | --- |
| `RELAY_URL` | l'adresse du relais | Si absente, le Worker appelle API-Football en direct |
| `API_PLAN` | `free` / `pro` / `ultra` / `mega` | Fixe le plafond d'appels. Si absente, détecté automatiquement |
| `API_RPM` / `API_RPS` | nombres | Prioritaires sur `API_PLAN` |
| `API_SAFETY` | `0.8` par défaut | Marge de sécurité sous le plafond |

### Liaisons (Settings → Bindings)

| Type | Nom de la variable | Contenu |
| --- | --- | --- |
| KV Namespace | `INDEX_KV` | L'index des joueurs et le journal d'usage |

### Déclencheur cron (Settings → Triggers)

```
*/5 * * * *
```

Construit l'index des joueurs une ligue à la fois, sans dépasser le quota.
Sans lui, la recherche instantanée se vide et ne se reconstruit jamais.

---

## 2. Base de données D1 — retirée

Les comptes passent par Firebase (section 6) depuis fin octobre 2026. La base D1 `DB`,
le schéma `schema.sql` et la liaison du Worker ne servent plus : la liaison peut être
retirée et la base supprimée dans Cloudflare.

---

## 3. Cloudflare Pages

Le site : `dueliov2.pages.dev`
Dossier servi : `www/`

À faire : brancher Pages sur ce dépôt GitHub plutôt que sur des envois manuels.
C'est ce qui fait disparaître définitivement le problème des deux copies divergentes.

---

## 4. Le relais à IP dédiée

API-Football bloque au niveau réseau les adresses IP partagées, et Cloudflare Workers
n'en utilise pas d'autres. Le relais est une petite machine à IP fixe qui détient la clé
et transmet les appels.

Actif uniquement si `RELAY_URL` **et** `RELAY_SECRET` sont tous deux définis.
Pour vérifier lequel des deux chemins est utilisé, ouvrir `…workers.dev/diag`.

---

## 5. Pages de diagnostic

| Adresse | Ce qu'elle montre |
| --- | --- |
| `/diag` | Quel compte, quel abonnement, quel plafond, sortie directe ou via relais |
| `/diag/usage` | Les appels réels envoyés à API-Football, par heure et par site appelant |
| `/index/status` | L'état de l'index des joueurs, ligue par ligue |

---

## 6. Comptes à conserver

- Cloudflare (Workers, Pages, D1, KV)
- API-Football
- Resend
- GitHub
- La machine qui héberge le relais


---

## 5. Notifications push (Firebase Cloud Messaging)

Mis en place le 28 octobre 2026. Rien n'est stocké chez nous : chaque appareil qui active
les notifications s'abonne au sujet FCM `duelio-tous`, et l'envoi part de GitHub.

### À faire une fois (par le propriétaire du compte)

1. Créer un projet sur https://console.firebase.google.com (gratuit).
2. **Android** : ajouter une application Android, package `app.duelio`, puis télécharger
   `google-services.json`. Coller son contenu entier dans le secret GitHub
   `GOOGLE_SERVICES_JSON` (Settings → Secrets and variables → Actions). Sans ce secret,
   l'APK se compile sans notifications.
3. **iOS** : ajouter une application iOS, bundle `app.duelio`, télécharger
   `GoogleService-Info.plist`. Dans le compte Apple Developer, créer une clé APNs
   (Certificates, Identifiers & Profiles → Keys → Apple Push Notifications service) et la
   téléverser dans Firebase (Paramètres du projet → Cloud Messaging → Configuration de
   l'application Apple). À brancher dans le projet Xcode au moment de l'emballage iOS.
4. **Envoi** : Paramètres du projet → Comptes de service → « Générer une nouvelle clé
   privée ». Coller le JSON téléchargé dans le secret GitHub `FCM_SERVICE_ACCOUNT`.

### Envoyer

Onglet Actions → « Envoyer une notification » → Run workflow : titre, message, et
éventuellement un duel à ouvrir (`278,1100` = Mbappé contre Haaland). Le mode test
(`oui`) prépare tout sans envoyer.

### Dans l'application

L'invitation apparaît après trois duels, jamais à la première ouverture. L'état se gère
dans « À propos » (bouton ⓘ). Le site web n'envoie rien : tout ceci ne concerne que
l'application iOS/Android (plugins `@capacitor/push-notifications` et
`@capacitor-community/fcm`).

---

## 6. Comptes utilisateurs (Firebase Authentication + Firestore)

Mis en place le 28 octobre 2026. Tout passe par Firebase : inscription, e-mails de
confirmation et de mot de passe oublié, connexion Google et Apple, duels sauvegardés.
Rien n'est déployé côté Cloudflare. Sans configuration, aucun bouton de compte n'apparaît.

### À faire une fois (même projet Firebase que les notifications)

1. **Authentication → Méthodes de connexion** : activer « E-mail/Mot de passe »,
   « Google » (choisir une adresse d'assistance) et, quand le compte Apple Developer
   existe, « Apple » (il faut un Services ID et une clé créés chez Apple, Firebase donne
   la marche à suivre).
2. **Authentication → Paramètres → Domaines autorisés** : ajouter le domaine du site
   (`duelio-app.bensouna-ahmed.workers.dev`, puis le futur domaine). Sans cela, la
   connexion Google sur le web est refusée.
3. **Authentication → Modèles** : les e-mails (confirmation, mot de passe oublié) partent
   d'une adresse `noreply@<projet>.firebaseapp.com`. Un expéditeur personnalisé demande un
   domaine vérifié ; à faire quand le nom de domaine sera choisi.
4. **Firestore Database** : créer la base (mode production, région `europe-west1`
   de préférence), puis coller dans l'onglet Règles :
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
5. **Paramètres du projet → Vos applications → Application Web** (en créer une si
   besoin) : copier l'objet de configuration (`apiKey`, `authDomain`, `projectId`,
   `appId`…) dans le fichier `www/firebase-config.json` du dépôt. Cette configuration
   est publique par conception (la sécurité repose sur les règles ci-dessus). Clés
   facultatives dans ce fichier : `"apple": true` pour afficher le bouton Apple sur le
   web, `"google": false` pour cacher Google.

### Dans l'application native

Google et Apple passent par `@capacitor-firebase/authentication` (déjà dans
`package.json` et `capacitor.config.json`). Android : `google-services.json` suffit (secret
`GOOGLE_SERVICES_JSON`). iOS : `GoogleService-Info.plist` + la capacité « Sign in with
Apple » dans Xcode ; à brancher au moment de l'emballage iOS.

### Où sont les données

`users/{uid}` (e-mail, date de création) et `users/{uid}/duels/{id}` (nom, identifiants des
joueurs, date). Suppression du compte : depuis l'application (« Mon compte » → « Supprimer
mon compte »), qui efface les duels puis le compte. Comptes inactifs : à purger à la main
dans la console (Authentication → Utilisateurs, trier par dernière connexion), comme la
politique de confidentialité le promet (trois ans).

---

## 7. Le relais à IP fixe (dossier `relais/`)

API-Football bloque les adresses IP partagées de Cloudflare Workers : mesuré le 28 octobre
2026, 34 appels refusés sur 50. Le relais est une petite machine (4 à 5 €/mois chez
Hetzner, OVH, DigitalOcean…) à adresse IP fixe, par laquelle le Worker fait passer ses
appels. Le Worker est déjà prévu pour (`RELAY_URL` + `RELAY_SECRET`).

### Mise en place (une fois, sans ligne de commande)

1. Ouvrir `relais/cloud-init.yaml`, remplacer `REMPLACER_PAR_LA_CLE_API_FOOTBALL` par la
   clé API-Football et `REMPLACER_PAR_UN_SECRET` par un mot de passe long et aléatoire
   (30 caractères, lettres et chiffres). Ne pas enregistrer ce fichier modifié dans le dépôt.
2. Créer un serveur chez l'hébergeur : Ubuntu, le plus petit modèle, en collant le contenu
   du fichier dans le champ « Cloud config » / « User data ».
3. Attendre 5 minutes, puis ouvrir `https://<IP>.sslip.io/sante` : la page doit afficher
   `{"ok":true,…}`.
4. Dans Cloudflare → Workers → duelio-proxy → Settings → Variables and Secrets : ajouter
   `RELAY_URL` = `https://<IP>.sslip.io` (texte) et `RELAY_SECRET` = le mot de passe (secret).
5. Vérifier sur `…workers.dev/diag` : « sortie » doit indiquer « RELAIS à IP dédiée ».

### Ce que fait le relais

`relais/serveur.js` : accepte uniquement les GET portant le bon secret, sur les chemins
d'API autorisés, transmet à API-Football avec la clé, renvoie la réponse et les en-têtes
de quota. `/sante` (sans secret) donne le nombre d'appels. HTTPS fourni par Caddy via un
nom `<IP>.sslip.io` (certificat Let's Encrypt automatique).

### Avant le relais : demander au support

`relais/MESSAGE-SUPPORT.md` contient un message prêt à envoyer à API-Football pour demander
si leur protection IP peut être assouplie pour la clé. S'ils acceptent, le relais devient
inutile.
