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
| `RESEND_API_KEY` | L'envoi des e-mails de confirmation de compte | resend.com → API Keys |
| `RELAY_SECRET` | Le mot de passe partagé avec le relais à IP dédiée | à regénérer si perdu |
| `INDEX_BUILD_KEY` | Protège `/index/build` d'un déclenchement public | facultatif |

### Variables (type « Text », visibles)

| Nom | Valeur actuelle | Effet |
| --- | --- | --- |
| `EMAIL_FROM` | ex. `Duelio <onboarding@resend.dev>` | L'expéditeur des e-mails |
| `RELAY_URL` | l'adresse du relais | Si absente, le Worker appelle API-Football en direct |
| `API_PLAN` | `free` / `pro` / `ultra` / `mega` | Fixe le plafond d'appels. Si absente, détecté automatiquement |
| `API_RPM` / `API_RPS` | nombres | Prioritaires sur `API_PLAN` |
| `API_SAFETY` | `0.8` par défaut | Marge de sécurité sous le plafond |

### Liaisons (Settings → Bindings)

| Type | Nom de la variable | Contenu |
| --- | --- | --- |
| D1 Database | `DB` | Les comptes, les sessions, les comparaisons favorites |
| KV Namespace | `INDEX_KV` | L'index des joueurs et le journal d'usage |

### Déclencheur cron (Settings → Triggers)

```
*/5 * * * *
```

Construit l'index des joueurs une ligue à la fois, sans dépasser le quota.
Sans lui, la recherche instantanée se vide et ne se reconstruit jamais.

---

## 2. Base de données D1

Le schéma doit être exécuté **une seule fois** sur la base, avant la première utilisation.

> ⚠️ Le fichier `schema.sql` n'est pas dans ce dépôt. Il doit y être ajouté.
> Les tables utilisées par le Worker sont `users`, `sessions` et `favorites`.

Colonnes lues par le code, à vérifier contre le schéma réel :

- `users` : `id`, `email`, `password_hash`, `salt`, `verified`, `verify_token`, `verify_expires`, `created_at`
- `sessions` : `token`, `user_id`, `expires_at`
- `favorites` : `id`, `user_id`, `name`, `player_ids`, `created_at`

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
