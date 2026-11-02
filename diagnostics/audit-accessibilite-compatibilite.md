# Audit accessibilité et compatibilité réelle des appareils — Duelio

Périmètre : `www/index.html` (CSS 220‑1602, HTML 1604‑1785, script 1786‑9957, plus deux scripts d'en‑tête 54‑64 et 81‑219), `www/compte.js`, `www/legal/*.html`, `www/legal/legal.css`.
Hors périmètre (déjà traité par `audit-code-securite.md`, `audit-code-bugs.md`, `audit-code-infra.md`) : injections, bugs de logique, courses, workflows, textes, formats de nombres.

Tout ce qui suit a été lu dans le code. Ce qui demande un appareil réel pour être tranché est rassemblé à la fin, dans « Doutes ».

---

## Résumé — ce qui casse vraiment

Sur les cinquante et quelques fonctionnalités relevées, **quatre** cassent franchement quelque chose ; le reste se dégrade en silence.

| # | Constat | Gravité | Qui est touché |
|---|---|---|---|
| C‑1 | `inset:0` sans repli : le sélecteur de joueur, les quatre feuilles modales et l'écran d'accueil n'ont plus ni taille ni position | **bloquant** | iOS 14.0‑14.4, WebView Android < 87 |
| C‑2 | `/\p{L}/u` : erreur de syntaxe à l'analyse → **tout** le bloc `<script>` (1786‑9957) est rejeté, page blanche | **bloquant** | iOS < 11.3, WebView < 64 |
| C‑3 | `navigator.share` + `<a download>` : dans la WebView Capacitor, ni partage ni téléchargement de l'image | **bloquant** (fonction phare) | build Play Store / App Store, tous appareils |
| A‑1 | Hauteurs fixes en px autour de texte (`.stat-row{height:52px}`, `.dr-val{height:46px}`) | **bloquant** | Android, taille de police système ≥ 150 % |
| A‑2 | Bordures `--line` à 1,57‑1,81:1 : on ne voit pas où sont les boutons | gênant | basse vision |
| C‑4 | `ctx.filter` : les portraits de l'affiche de partage sortent pixelisés, en couleur, très sombres | gênant | iOS < 16.4 |
| A‑3 | `.slot-remove` : 18 × 18 px | gênant | tout le monde, au doigt |

Bonne nouvelle d'ensemble : **aucun** `?.`, `??` sur des chaînes critiques, `structuredClone`, `Array.at`, `Object.hasOwn`, `replaceAll`, `Intl.*`, `crypto.randomUUID`, `OffscreenCanvas`, `:has()`, `backdrop-filter`, `color-mix()`, `@container` n'est utilisé. Et la palette de couleurs est solide : sur 49 couples texte/fond calculés, 44 passent le 4,5:1.

---

# Partie 1 — Compatibilité réelle des appareils

## 1.0 Le plancher réel

`package.json` épingle Capacitor 7 (`@capacitor/core: ^7.0.0`), dont le plancher est **iOS 14.0** et **Android 6 / API 23**. `capacitor.config.json` ne relève rien. Conséquence directe : un iPhone en **iOS 14.0 à 14.4** est un appareil *supporté* par la coque, et c'est précisément la fenêtre où `inset` (14.5) et `gap` sur flex (14.5) manquent. Sur Android, la WebView se met à jour par le Play Store indépendamment du système, donc le cas « WebView ancienne » concerne surtout les appareils sans services Google ou restés hors ligne.

## 1.1 Ce qui casse vraiment

### C‑1 — `inset:0` sans repli : le sélecteur de joueur et les feuilles modales ne s'affichent plus (bloquant)

**Lignes** : 276, 301, 324, 330, 378, 385, 407, 453, 635, 984, 1345, 1422, 1439 — treize occurrences, **aucune** précédée d'un `top:0; right:0; bottom:0; left:0` de repli (vérifié : 0 occurrence du motif long).

```css
301:  .welcome-screen{ position:absolute; inset:0; z-index:50; overflow:hidden; }
635:  .sheet{ position:absolute; inset:0; z-index:20; background: rgba(3,8,20,.55); display:flex; align-items:flex-end; }
1439:  .picker{ position:absolute; inset:0; background: var(--bg); ... transform: translateY(100%); }
```

**Versions minimales** : `inset` = iOS Safari **14.5**, Chrome / WebView Android **87**.

**Ce que vit l'utilisateur.** Une déclaration CSS invalide est jetée en entier : `top/right/bottom/left` repassent à `auto`, et comme aucun de ces trois blocs n'a de `width`/`height`, les éléments s'effondrent à zéro.
- `.picker` (1439) : taper sur une carte de joueur **n'ouvre rien**. L'écran « Choisir un joueur » existe dans le DOM mais mesure 0 × 0. L'application est inutilisable — c'est le seul chemin pour composer un duel.
- `.sheet` (635) : les quatre feuilles (saison, compte, à propos, choix générique) ne s'affichent pas. « Mon compte », « À propos », le choix de saison : rien ne se passe.
- `.welcome-screen` (301) : l'accueil disparaît, on arrive directement sur le comparatif vide. Celui‑là est inoffensif.
- Les dix autres sont décoratifs (filigrane de terrain, projecteurs, pastilles pulsées) ou protégés par un `width:100%; height:100%` qui suit (407, 453, 984).

**Correctif** : ajouter `top:0; right:0; bottom:0; left:0;` avant chaque `inset:0` (la propriété longue est universelle et `inset` l'écrase là où il est compris).

### C‑2 — `/\p{L}/u` : page blanche sur WebView ancienne (bloquant)

**Lignes 3812 et 4998** :

```js
3812:  return /^\p{L}\.\s/u.test(n) ? n.split(' ').slice(-1)[0] : n;
4998:  const m = /^(\p{L})\.\s+(.+)$/u.exec(n);
```

**Versions minimales** : échappements de propriétés Unicode = iOS Safari **11.3**, Chrome / WebView **64**.

**Ce que vit l'utilisateur.** C'est un *littéral* d'expression régulière, pas un `new RegExp()` : un moteur qui ne connaît pas `\p{…}` avec le drapeau `u` lève une `SyntaxError` **au moment de l'analyse du script**, avant d'exécuter la moindre ligne. Le bloc `<script>` des lignes 1786 à 9957 — soit toute l'application — est rejeté d'un coup. L'utilisateur voit l'en‑tête « Duelio / Comparer », la barre d'onglets, et **rien d'autre, pour toujours** : pas de message d'erreur, pas de contenu, aucun bouton qui réagisse.

À relativiser : iOS 11.3 date de mars 2018 et WebView 64 de janvier 2018, bien en dessous du plancher Capacitor. Le risque est réel surtout pour la version **web** ouverte depuis un vieil appareil.

**Correctif** : remplacer par `/^[A-Za-zÀ-ÖØ-öø-ÿ]\.\s/` (ces deux fonctions ne traitent que des initiales de noms de joueurs), ou bâtir le regex par `new RegExp()` dans un `try/catch`.

### C‑3 — Le partage et le téléchargement de l'image, dans la WebView Capacitor (bloquant pour la fonction phare)

**Lignes 8552‑8583** :

```js
8556:    const canNativeShare = !!(navigator.share && navigator.canShare && navigator.canShare({files:[file]}));
8563:          ${canNativeShare ? `<button ... id="shareNativeBtn">Partager</button>` : ''}
8575:      a.download = `duelio-comparaison-${Date.now()}.png`;
8576:      a.click();
```

La détection est correctement gardée (triple test, et le repli « Télécharger » est bien prévu). Le problème est ailleurs : **les deux chemins reposent sur des API de navigateur que la WebView n'expose pas**.

- `navigator.share` avec des fichiers est une fonctionnalité de Chrome et de Safari, **pas de la `android.webkit.WebView`** ni du `WKWebView` embarqué. Dans l'application du Play Store, `canNativeShare` vaut donc `false` : le bouton « Partager » n'apparaît jamais.
- Reste « Télécharger », qui fait `a.download` + `a.click()` sur une URL `blob:`. Une WebView sans `DownloadListener` enregistré ignore purement et simplement cette navigation : **le bouton ne fait rien du tout** (pas d'erreur, pas de fichier, pas de notification).

**Ce que vit l'utilisateur.** Il choisit ses stats, attend la génération, voit « Ton image est prête », appuie sur « Télécharger »… et rien. Aucune trace de l'image. C'est la fonction mise en avant par l'onglet « Partager » et par les métadonnées Open Graph.

**Signal fort** : `@capacitor/share` est déjà dans `package.json` (ligne 15 des dépendances) et **n'est utilisé nulle part** (`grep Plugins.Share` → aucun résultat), contrairement à `Haptics` (6162) et `PushNotifications` (7075‑7079) qui le sont correctement.

**Correctif** : en natif, écrire le PNG avec `@capacitor/filesystem` puis appeler `Share.share({files:[uri]})` ; garder le chemin web actuel quand `Capacitor.isNativePlatform()` est faux. Le même garde‑fou que `haptique()` (6162) convient.

## 1.2 Dégradations visibles, mais pas bloquantes

### C‑4 — `ctx.filter` sur canvas : les portraits de l'affiche de partage (gênant)

**Lignes 7923‑7938**, style « Affiche » de l'image de partage :

```js
7925:      const flou = Math.max(6*S, sc*2.2);
7926:      try{ tc.filter = `grayscale(1) contrast(1.35) brightness(1.05) blur(${flou}px)`; }catch(e){}
7927:      tc.drawImage(img, x, y, wImg, hImg);
7928:      try{ tc.filter = 'none'; }catch(e){}
7929:      tc.globalCompositeOperation = 'multiply';
```

**Versions minimales** : `CanvasRenderingContext2D.filter` = iOS Safari **16.4** (mars 2023), Chrome / WebView **52**. Android va donc bien ; **c'est iOS qui est en cause**, et la fenêtre est large : tout iPhone resté en iOS 14, 15 ou 16.0‑16.3 (iPhone 6s, 7, SE 1re génération plafonnent à iOS 15).

**Le `try/catch` ne protège rien.** Affecter une propriété inconnue à un objet JavaScript ne lève pas d'exception : `tc.filter = "grayscale(1)…"` crée simplement une propriété ordinaire sur l'objet contexte et le dessin l'ignore. Les deux `catch(e){}` des lignes 7926 et 7928 ne se déclenchent jamais. Le seul test valable est `('filter' in tc)`.

**Ce que verrait l'utilisateur, concrètement.** Le filtre devait faire trois choses d'un coup : passer la photo en nuances de gris, et surtout la **flouter fortement** (`flou` vaut au moins `6*S`, soit une quinzaine de pixels à l'échelle de l'affiche) parce que les portraits sources ne font que 150 px et sont agrandis à 50‑62 % de la hauteur de l'image. Sans le filtre :
1. la photo de 150 px est étirée telle quelle sur ~600 px de haut → **gros pâtés de pixels et artefacts JPEG bien visibles** ;
2. elle reste **en couleur** ;
3. le `globalCompositeOperation = 'multiply'` (7929) qui suit multiplie cette photo couleur par le cyan ou l'ambre du joueur — une multiplication de deux couleurs saturées donne un résultat **très sombre et boueux**, là où le gris de départ devait donner une bichromie propre.

Donc : au lieu de deux portraits fondus en bichromie dans la nuit, deux rectangles sombres, tachés et pixelisés, de part et d'autre du badge VS. L'image se génère, se partage et se télécharge — elle est simplement laide, et c'est l'image que l'utilisateur publie à son nom. Le style « Affiche » est le seul concerné (les styles « Stade » et « Papier » n'utilisent pas `filter`).

**Correctif** : tester `if('filter' in tc)` et, en repli, pré‑réduire le portrait sur un canvas intermédiaire puis le redessiner agrandi (le lissage bilinéaire du navigateur approche un flou), et désaturer à la main en parcourant les pixels ou en dessinant un gris par‑dessus en `saturation`/`color` avant le `multiply`.

### C‑5 — `gap` sur conteneur flex : 73 occurrences (gênant sur iOS 14.0‑14.4)

**Versions minimales** : `gap` sur flex = iOS Safari **14.5**, Chrome / WebView **84**. (Sur grid c'est beaucoup plus ancien : iOS 12, Chrome 66 — les sept `display:grid` ne risquent rien.)

Sans support, tous les espacements tombent à zéro. Les endroits où ça se voit le plus :
- `.dr-vals{ display:flex; gap:14px }` (1265) : les deux valeurs comparées se **touchent**, on ne distingue plus la case du joueur A de celle du joueur B ;
- `.tabbar-btn{ gap:3px }` (544) : l'icône collée au libellé ;
- `.share-download-row{ gap:8px }` (1235) et `.invite-notifs .btns{ gap:8px }` (709) : boutons jointifs, on tape à côté ;
- `.duel-chips{ flex-wrap:wrap; gap:8px }` (604) : les puces « Duels à essayer » forment un bloc compact illisible ;
- `.compare-cols{ gap:14px }` (1086) : les colonnes de joueurs se touchent, et le séparateur lumineux `.player-col::after{ right:-8px }` (1088) tombe alors **sur** la colonne voisine.

Pas d'écran cassé, mais une mise en page nettement abîmée. **Correctif** : un `@supports not (gap: 1px)` avec des marges, ou plus simplement accepter la dégradation et relever le plancher iOS à 14.5 côté App Store.

### C‑6 — `inert` : le piège de focus n'existe plus (gênant, clavier et lecteurs d'écran)

**Lignes 9659‑9663** :

```js
function fondInerte(actif){
  for(const sel of ['.screens', '.tabbar', '.app-header']){
    const el = document.querySelector(sel);
    if(el) el.inert = actif;
  }
}
```

**Versions minimales** : `inert` = iOS Safari **15.5**, Chrome / WebView **102**.

Le commentaire de 9651‑9658 est explicite : `inert` est le *seul* mécanisme qui rend vrai l'`aria-modal="true"` des feuilles. Sans support, `el.inert = true` écrit une propriété JavaScript inerte (sans jeu de mots) et rien ne se passe. L'arrière‑plan reste tabulable et lu par les lecteurs d'écran : la tabulation repart « se promener dix à douze fois dans l'écran qu'on ne voit plus », exactement ce que le commentaire décrit. Les clics, eux, restent bloqués par le voile de `.sheet` et le fond opaque de `.picker`.

Pas de garde (`'inert' in HTMLElement.prototype`), pas de repli. **Correctif** : si `inert` manque, poser `aria-hidden="true"` sur les trois conteneurs et enregistrer un gestionnaire `keydown` qui boucle la tabulation dans le panneau ouvert.

### C‑7 — `Element.scrollTo({behavior})` : saut en haut de page (mineur)

**Ligne 8586**, juste après la génération de l'image :

```js
if(scr){ const top = area.getBoundingClientRect().top - ... ; scr.scrollTo({top, behavior:'smooth'}); }
```

**Versions minimales** : `scrollTo` avec un objet d'options = iOS Safari **14**, Chrome 45. Un moteur plus ancien interprète la signature à deux arguments : `x = undefined → 0`, `y = undefined → 0`, et **remonte l'écran tout en haut** au lieu d'amener l'image sous les yeux. L'utilisateur ne voit pas son image apparaître et doit redescendre à la main.

Deux remarques en plus : cette ligne **ne respecte pas `prefers-reduced-motion`**, contrairement au `scrollIntoView` de la ligne 8568 juste au‑dessus qui le fait correctement ; et elle double ce `scrollIntoView` (deux défilements concurrents vers la même cible). Le `scrollIntoView` de 8568, lui, est bien gardé par un `try/catch` et dégrade proprement (un objet est « vrai », donc `scrollIntoView(true)` → alignement en haut, instantané).

### C‑8 — `100dvh`, `env(safe-area-inset-*)`, `position:sticky`

- **`dvh`** (ligne 288) : `height:100vh; height:100dvh;` — le motif de repli est **correct**. iOS Safari 15.4 / Chrome 108 pour `dvh`. En dessous, `100vh` tient, et sur le web mobile la barre d'onglets du bas peut passer sous la barre d'adresse du navigateur. Dans la coque Capacitor il n'y a pas de barre d'adresse : sans effet.
- **`env(safe-area-inset-*)`** (291, 292, 293, 390, 640, 1207) : iOS 11.2, Chrome / WebView 69. Sur un moteur plus ancien la déclaration entière est jetée. Quatre des six n'en souffrent pas (la valeur de repli est 0, soit le comportement voulu hors encoche). La sixième est à surveiller : `.share-sticky{ padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); }` (1207) est un **raccourci** `padding` — s'il est invalide, c'est tout le rembourrage qui disparaît, y compris les 12 px du haut et les 16 px latéraux, et le bouton « Générer l'image » se colle aux bords.
- **`position:sticky`** (1207) : iOS 13 sans préfixe, Chrome 56. Sans support, le bouton « Générer l'image » cesse d'être épinglé en bas et défile avec la liste des stats : il faut descendre pour le trouver. Dégradation silencieuse et supportable.

### C‑9 — La requête média principale utilise la syntaxe Media Queries 4

**Ligne 285** :

```css
@media (max-width: 480px), ((hover: none) and (pointer: coarse) and (max-width: 640px)){
```

Les parenthèses qui **groupent** une conjonction relèvent de Media Queries niveau 4 (Chrome 88 ; côté Safari, à confirmer — voir « Doutes »). Bonne nouvelle : une requête mal formée dans une liste séparée par virgules est remplacée par `not all` et **n'invalide pas les autres** ; `(max-width: 480px)` continue donc de s'appliquer. Les téléphones usuels déclarent 360 à 430 px CSS et restent couverts.

Qui tombe à côté : un appareil déclarant plus de 480 px CSS — grand modèle, réglage « taille d'affichage » réduit, pliable ouvert. Celui‑là reçoit la **maquette de téléphone** destinée au bureau : `.phone{ width:390px; height:812px; border:6px solid #000; border-radius:36px; max-height:92vh }` centrée dans un `body` à `padding:24px`. L'application s'affiche dans un petit cadre noir arrondi au milieu de l'écran, avec des marges partout. Visuellement incongru, mais utilisable.

**Correctif** : dupliquer le second critère dans un `@media` séparé, ce qui ne demande aucune syntaxe de niveau 4.

### C‑10 — `(update: slow)` (mineur, sans risque)

**Ligne 335** : `@media (prefers-reduced-motion: reduce), (update: slow){ .welcome-content > .beam{ animation:none; } }`.
`update` est très récent (Chrome 113, Safari 17). Même mécanique protectrice qu'en C‑9 : la branche inconnue devient `not all`, la branche `prefers-reduced-motion` continue de fonctionner. Sur un écran lent et sans réglage « animations réduites », les projecteurs de l'accueil continueront de pulser — conséquence : un peu de batterie et de processeur, rien de visible.

### C‑11 — `:focus-visible` (mineur)

**Lignes 295** (`:focus-visible{ outline:2px solid var(--gold); outline-offset:2px; }`) et 781. iOS Safari 15.4, Chrome 86. Sélecteur inconnu ⇒ règle entière jetée ⇒ on retombe sur l'anneau de focus natif du navigateur, qui existe. Dégradation acceptable. Attention toutefois : `.search-field input:focus{ outline:none; }` (562) supprime l'anneau natif du champ de recherche, et le remplacement passe par `.search-field:focus-within` (556) — `:focus-within` est, lui, ancien (iOS 10.1). Les champs restent donc signalés partout.

### C‑12 — `overscroll-behavior` (mineur)

**Lignes 246‑247**. iOS Safari **16**, Chrome 63. Le commentaire de 243‑245 explique le problème qu'il corrige : sans lui, la page entière rebondit en fin de défilement et un panneau arrivé en bas transmet le geste à l'écran derrière. Sur iOS 14 et 15 ce comportement revient. Gênant à l'usage, sans casse.

### C‑13 — Le reste, par ordre de non‑événement

| Fonctionnalité | Ligne(s) | iOS Safari min. | WebView min. | Sans support |
|---|---|---|---|---|
| `-webkit-mask-image` **et** `mask-image` | 338‑354, 387‑388 | WebKit (préfixé) : universel | Blink (préfixé) : universel | Rien : les deux formes sont déclarées, la préfixée suffit partout |
| `conic-gradient` | 337, 342, 347, 352 | 12.1 | 69 | Projecteurs de l'accueil invisibles (décoratif) |
| `aspect-ratio` (en ligne sur un SVG) | 2377 | 15 | 88 | Rien : le `viewBox` fixe déjà le ratio |
| `-webkit-line-clamp` | 823, 1132, 1168, 1171, 1251 | universel (WebKit) | universel (Blink) | Rien |
| `place-items:center` | 403, 416, 449 | 11 | 59 | Monogrammes et badge VS décentrés |
| `scrollbar-width:none` | 778 | très récent | 121 | Rien : `::-webkit-scrollbar{width:0}` (780) prend le relais |
| `touch-action:none` | 790 | 13 | 36 | Traîner la barre de chronologie fait aussi défiler la page |
| `color-scheme: dark` | 984 | 13 | 81 | Le `<select>` natif masqué s'affiche en thème clair (invisible, `opacity:0`) |
| `appearance:none` (sans `-webkit-`) | 576, 1469 | 15.4 | 84 | Rien : ce sont des `<button>` dont fond et bordures sont déjà réécrits |
| `loading="lazy"` | 2145 | 15.4 | 77 | Les portraits se chargent tous d'un coup : un peu de réseau en trop |
| `will-change` | 332, 1424, 1564 | 9.1 | 36 | Rien |
| Événements Pointer (`pointerdown`, `setPointerCapture`) | 9128‑9142, 9911 | 13 | 55 | La barre de chronologie dessinée n'est plus traînable (le balayage natif marche toujours) ; le préchargement au contact du doigt est perdu |
| `IntersectionObserver` | 2383, 2425 | 12.1 | 51 | **Gardé** : `('IntersectionObserver' in window)` (2383), et `data-radar-key` n'est posé que si le garde passe (2365) — `new IntersectionObserver` (2425) est donc inatteignable sans support. Le radar s'affiche à sa valeur finale, sans animation |
| `requestIdleCallback` | 5189, 9929 | 16.4 | 47 | **Gardé** deux fois sur deux, avec repli `setTimeout` |
| `AbortController` | 2680, 2751 | 12.2 | 66 | **Non gardé**, mais iOS 12.2 est sous le plancher Capacitor. En dessous : `ReferenceError` dans `fetchBorne` (2679) et dans la file d'appels (2751) ⇒ plus aucune donnée ne charge |
| `Promise.prototype.finally` | 2683 et 12 autres | 11.3 | 63 | Idem : sous le plancher |
| `canvas.toBlob` | 8545 | 11 | 50 | L'appel n'est pas gardé mais le `try/catch` de `generateShareImage` l'englobe (cf. commentaire 8589‑8591) ⇒ message « L'image n'a pas pu être créée. Réessaie. » et bouton réactivé. Dégradation propre |
| `new File([blob], …)` | 8555 | 10.1 | 38 | Dans le `try/catch` du rappel (8545‑8596), explicitement prévu par le commentaire |
| `navigator.share` / `canShare` | 8556, 8583 | 15 (fichiers) | Chrome Android 89 | **Gardé** par triple test. Mais voir C‑3 : le garde réussit trop bien, il désactive la fonction en WebView |
| `navigator.vibrate` | 9797, 9802 | jamais sur iOS | WebView : nécessite la permission `VIBRATE` | **Gardé** (`if(!navigator.vibrate) return;`). Les vibrations passent par `@capacitor/haptics` en natif (6162, correctement gardé par `isNativePlatform()`) |
| `import()` dynamique | compte.js:64 | 11.1 | 63 | Firebase ne se charge jamais : le panneau « Mon compte » reste sur son état initial. Sous le plancher |
| `localStorage` en navigation privée | 36 occurrences | — | — | **Quasi partout gardé.** Toutes les écritures sont dans un `try/catch` (3715, 4877, 5188, 5263, 5460, 5481, 5535, 5561, 6688, 7082, 7110, 7420, 7489, 9836). Les lectures « nues » (3699, 3712, 5237, 5254, 5403, 5470, 5517, 5546) sont toutes à l'intérieur d'un `try` englobant vérifié. Rien à signaler |
| `rel="preload"` sur la feuille de polices | 79 | à confirmer | 50 | `onload` ne se déclenche jamais ⇒ Unbounded et Plus Jakarta Sans ne chargent pas ⇒ repli `sans-serif` partout. Visible (les titres perdent leur caractère) mais pas cassé. Le `<noscript>` de la ligne 80 ne couvre que l'absence de JavaScript, pas ce cas |

### C‑14 — `toLocaleString` avec options : dépend des données ICU embarquées

**Lignes 6124, 6129, 7689** :

```js
7689:  return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
```

L'API elle‑même est ancienne (iOS 10, Chrome 24). Le risque n'est pas la version du moteur mais les **données de locale** : une WebView compilée sans ICU complet ignore `'fr-FR'` et retombe sur la locale par défaut. Les chiffres s'affichent alors en format anglais — `1,234.5` au lieu de `1 234,5` — ce qui, sur un comparateur de statistiques, est carrément trompeur (un lecteur français lira « 1,234 » comme « 1,23 »). Les WebView Android du Play Store embarquent ICU complet ; le cas vise les ROM allégées et les émulateurs. À noter, pas à corriger en priorité.

### C‑15 — Icône d'application et manifeste PWA fabriqués au canvas (gênant, à confirmer)

**Lignes 144‑187** : l'icône est un SVG dessiné dans un `<img>` puis exporté en PNG via `canvas.toDataURL` (152), et le **manifeste n'est posé que si cette conversion réussit** (159‑160, `if(!pngHref) return;`).

Le SVG source (86‑135) ne porte **que** `viewBox`, sans attributs `width` ni `height`. Historiquement, WebKit refuse de charger une image SVG sans dimensions intrinsèques : `img.onerror` se déclenche, `resolve(null)` passe, et alors **ni `apple-touch-icon` ni `<link rel="manifest">`** ne sont ajoutés. Conséquence : « Sur l'écran d'accueil » sur iPhone donne une capture d'écran générique au lieu de l'icône, et sur Android Chrome l'absence de manifeste empêche l'installation en vraie PWA. À tester sur appareil (voir « Doutes »).

**Correctif en une ligne** : ajouter `width="120" height="120"` à la balise `<svg>` de la ligne 86, et sortir la pose du manifeste du `then` de la conversion.

---

# Partie 2 — Accessibilité

## 2.1 Contrastes

Méthode : les couleurs composées (`rgba` sur un fond connu, `opacity`) ont été aplaties sur leur fond réel, puis la luminance relative et le ratio WCAG 2.x ont été calculés. 49 couples testés. Seuils : **4,5:1** pour du texte normal, **3:1** au‑delà de 18,66 px gras ou 24 px.

**La palette de base est très bonne.** Les gris sur fond sombre dont il faut souvent se méfier passent largement :

| Couple | Classes concernées | Taille | Ratio | Verdict |
|---|---|---|---|---|
| `--chalk-dim` #A9CFC5 sur `--bg` #0B1730 | `.browse-empty`, `.empty-state`, `.tuto-sub`, `.wl-lead`, `.picker-empty`, `.duel-avis`, `.tuto-or`, `.reset-btn` | 11‑13 px | **10,53** | OK |
| `--chalk-dim` sur `--surface` #16234A | `.tabbar-btn`, `.tab-btn`, `.period-btn`, `.csel-option`, `.about-notifs-txt span` | 10,5‑13 px | **9,04** | OK |
| `--chalk-dim` sur `--surface-2` #1E2F5C | `.ct-label`, `.csel-hint`, `.palmares-head`, `.p-physique-item` | 9,5‑10,5 px | **7,68** | OK |
| `--chalk-dim` sur `rgba(30,47,92,.55)` | **`.stat-row .k`, `.solo-stat-row .k`, `.dr-label`, `.dr-val.unknown`** — les libellés de statistiques | 8,5‑12 px | **8,99** | OK |
| `--gold` #22D3EE sur `--bg` | `.career-progress`, `.tuto-status`, `.scope-link`, `.palmares-plus`, `.lien-inline`, `.pos-lbl` | 10,5‑12,5 px | **9,85** | OK |
| `--win` #2FE88A sur `--bg` | `.account-msg.ok`, `.tlh-badge`, `.pd-cell.lead`, `.save-duel-btn.ok` | 9,5‑14 px | **11,05** | OK |
| `--danger` #FF5A5A sur `--bg` | `.account-msg.err`, `.season-pick-err`, `.tuto-status.error` | 10‑12,5 px | **5,82** | OK |
| `#04231a` sur `--win` | `.stat-row.lead .v`, `.dr-val.lead`, `.ct-val.ct-lead`, `.season-row .best` | 9,5‑15 px | **10,34** | OK |
| `#04231a` sur `#22D3EE` | `.welcome-cta`, `.wl-go`, `.tuto-cta`, `.share-generate-btn`, `.account-btn.primaire` | 11,5‑15,5 px | **9,22** | OK |
| `#2A1A00` sur `#FFB020` | `.palmares-res.or` | 9 px | **9,21** | OK |
| `#FFB020` sur `rgba(255,176,32,.14)`/bg | `.tlh-trophy-name` | 8,5 px | **7,56** | OK |
| `#E9C46A` sur `rgba(234,179,8,.13)`/bg | `.marque-legende` | 10 px | **8,52** | OK |
| `#ffb3b3` sur `rgba(255,90,90,.12)`/bg | `#globalFallbackBanner` | 10,5 px | **9,22** | OK |
| `rgba(255,255,255,.82)` sur `--grad` ~#3B5BA8 | `.brand-name` | 13 px | **4,96** | OK, mais à 0,46 du seuil |
| `--chalk-dim` sur `rgba(169,207,197,.12)`/surface | `.palmares-res.argent` | 9 px | **6,93** | OK |
| `#E8B98A` sur `rgba(232,185,138,.12)`/surface | `.palmares-res.bronze` | 9 px | **6,70** | OK |

### Les échecs

#### A‑4 — `.pd-cell.vide .pd-n` : 2,96:1 (gênant)

**Ligne 889** : `.pd-cell.vide .pd-n{ color:var(--chalk-dim); opacity:.45; font-size:12px; }`
`--chalk-dim` à 45 % sur `--surface` donne **2,96:1** — sous les 3:1 même en étant indulgent, et c'est du 12 px.

Ce n'est pas de la décoration : c'est le **« 0 » affiché dans la comparaison des palmarès** quand un joueur n'a jamais gagné telle compétition (généré en 9002, `x.n === 0 ? 'vide' : ''`). L'utilisateur malvoyant ne distingue pas si la case est vide ou si elle contient un zéro — donc ne sait pas si l'information manque ou si le joueur n'a rien gagné. **Correctif** : passer `opacity` de `.45` à `.7` (≈ 5,3:1) ou supprimer l'`opacity` et garder `--chalk-dim` seul.

#### A‑5 — `.picker-item.disabled` : 2,06:1 (gênant)

**Ligne 1479** : `.picker-item.disabled{ opacity:.3; pointer-events:none; }` → **2,06:1** pour le nom (13,5 px) et le méta (10,5 px).

Les éléments désactivés sont hors du champ de la règle 1.4.3, mais la finalité est ici informative : ces lignes signalent *les joueurs déjà choisis dans un autre emplacement*. À 2,06:1 l'utilisateur ne peut pas lire **de qui il s'agit**, donc ne comprend pas pourquoi la ligne ne réagit pas. **Correctif** : `opacity:.5` (3,54:1) et un `aria-disabled="true"` plus un libellé « déjà dans le duel », au lieu de tout atténuer.

#### A‑6 — Placeholder du champ de recherche : 4,18:1 (mineur)

**Ligne 563** : `.search-field input::placeholder{ color: rgba(169,207,197,.6); }` → **4,18:1** sur `--surface`, à 14 px. Un placeholder est du texte au sens WCAG. Il manque 0,32. **Correctif** : passer à `.72` d'opacité (≈ 4,9:1).

#### A‑2 — Bordures `--line` : 1,57 à 1,81:1 (gênant, règle 1.4.11)

`--line: #2C4272` donne **1,81:1** sur `--bg` #0B1730 et **1,57:1** sur `--surface` #16234A. La règle 1.4.11 (contraste des éléments non textuels) demande 3:1 pour la **limite visuelle d'un composant d'interface** quand c'est elle qui permet de l'identifier. Or c'est exactement le rôle de `--line` ici :

- `.search-field{ border:1px solid var(--line) }` (553) — le champ de recherche ;
- `.icon-btn{ border:1px solid var(--line) }` (955) — les boutons‑icônes de la barre d'outils ;
- `.share-chip{ border:1px solid var(--line) }` (1219) — les 10+ cases à cocher de statistiques ;
- `.account-form input`, `.account-btn`, `.duel-saved`, `.save-duel-btn`, `.sheet-action`, `.season-pick`, `.col-head`, `.tab-switch`, `.period-seg`, `.duel-chip`, `.pf-chip`, `.csel-btn`, `.reset-btn`, `.palmares` — soit la quasi‑totalité des contrôles.

**Ce que vit l'utilisateur** : sur l'écran « Partager », une grille de puces dont il ne distingue pas les contours — il ne voit qu'une colonne de textes et ne devine pas qu'il faut taper dessus. Même chose pour le champ de recherche, qui ne se lit pas comme un champ. À noter que le travail a été fait par ailleurs : `.col-head.empty{ border-color: rgba(255,255,255,.55) }` (1135) atteint 6,04:1, `.share-chip.on` et `.icon-btn.active` passent à `--gold`. C'est l'état **au repos** qui manque. **Correctif** : éclaircir `--line` jusqu'à ≈ #4A6AA8 (3:1 sur `--bg`), ou introduire un second jeton `--line-fort` réservé aux bordures de contrôles.

#### A‑7 — `--lose: #6B5C82` : 2,95:1 (mort, à supprimer)

**Ligne 239**. Déclaré, **jamais utilisé** (vérifié : aucun `var(--lose)` dans tout le fichier). Il échoue à 2,95:1 sur `--bg`. À retirer, ou à corriger avant qu'un développeur ne s'en serve pour marquer le perdant.

### Cas limites vérifiés et jugés acceptables

`.radar-note{ opacity:.8 }` → 7,12 · `.picker-empty small{ opacity:.85 }` → 7,89 · `.tlh-sansdate{ opacity:.72 }` → 5,99 · `.browse-item .chev{ opacity:.6 }` → 4,54 (icône) · `.stat-row.lead .k{ color:#04231a; opacity:.8 }` → 6,36 · `.duel-chip:disabled{ opacity:.5 }` → 3,54 (désactivé) · `.account-btn:disabled{ opacity:.55 }` → 6,04 · `.gm-lbl` → 8,72 · `.wl-score .l` sur #050B18 → 11,63 · `.wl-mt .vs` → 6,90.

### Pages légales : rien à signaler

`legal.css` passe en mode sombre **et** en mode clair (le seul `@media (prefers-color-scheme: light)` du projet, ligne 34) :
`#4B5B78` sur `#F5F8FC` → **6,43** · `#4B5B78` sur `#FFFFFF` → **6,85** · `#0E7C9A` sur `#F5F8FC` → **4,51** (juste au‑dessus) · `#0E7C9A` sur `#FFFFFF` → **4,81** · `#1C2A45` sur `#F5F8FC` → **13,44** · titres `#0B1730` sur `#F5F8FC` → **16,72**. Le `#0E7C9A` des liens, à 4,51, n'a aucune marge : le moindre ajustement de fond le fait passer sous le seuil.

## 2.2 Zones tactiles

Un travail sérieux a déjà été fait : le bloc commenté « Zones tactiles » (1482‑1518) relève `.tab-btn`, `.period-btn`, `.reset-btn`, `.duel-chip`, `#addSlotCard`, `.share-chip`, `.icon-btn`, `.search-field input`, `.season-pick`, `.scope-link` à 44 px, et pose des `::after` invisibles de 44 × 44 sur `.slot-swap`, `.picker-close`, `.nav-back` et `#clearRecentsBtn`. Ce qui reste :

#### A‑3 — `.slot-remove` : 18 × 18 px, oublié par le bloc correctif (gênant)

**Lignes 1137‑1141** et **1502**. Le `::after` de 44 px est posé sur `.slot-swap::after, .picker-close::after, .nav-back::after` — **`.slot-remove` n'y est pas**, alors que c'est le jumeau exact de `.slot-swap` (même taille, même coin de carte, l'un à gauche, l'autre à droite) et que le commentaire de 1482‑1485 cite nommément « l'échange de joueurs (18 px) ».

```css
1137:  .slot-remove{ position:absolute; top:5px; right:5px; width:18px; height:18px; ... }
1502:  .slot-swap::after, .picker-close::after, .nav-back::after{ ... width:44px; height:44px; ... }
```

**Ce que vit l'utilisateur** : retirer un joueur du duel demande trois ou quatre tentatives ; chaque raté tombe sur la carte, dont le gestionnaire (6582‑6589) ouvre la fiche du joueur. On veut l'enlever, on ouvre sa fiche. **Correctif** : ajouter `.slot-remove` aux deux sélecteurs des lignes 1500 et 1502. Une virgule.

#### A‑8 — `.season-pick` retombe à 34 px à trois ou quatre joueurs (gênant)

**Ligne 1007** : `.compare-cols.count-3 .season-pick, .compare-cols.count-4 .season-pick{ font-size:10.5px; padding:0 6px; min-height:34px; }`
**Ligne 1497** : `.season-pick{ min-height:44px; }`

Le bloc correctif est placé en fin de feuille pour « l'emporter sans avoir à alourdir chacune des règles d'origine » (commentaire 1489‑1490) — mais la cascade se joue d'abord sur la **spécificité**, et `.compare-cols.count-3 .season-pick` (0,3,0) bat `.season-pick` (0,1,0) quelle que soit la position. Dès qu'on compare trois ou quatre joueurs, les sélecteurs de saison repassent donc à **34 px** de haut, avec des colonnes de 88 px de large. **Correctif** : ajouter `min-height:44px` dans la règle de la ligne 1007 (et retirer le `min-height:34px`).

#### A‑9 — Cibles sous 44 px, par ordre de gêne

| Classe | Ligne | Taille réelle | Rôle | Gravité |
|---|---|---|---|---|
| `.slot-remove` | 1137 | **18 × 18** | retirer un joueur du duel | gênant |
| `.tlh-scroll` + `.tlh-scroll-thumb` | 788, 793 | **3 px / 5 px de haut** | traîner la chronologie | mineur (`aria-hidden`, le balayage natif reste) |
| `.lien-inline`, `.tuto-lien` | 903‑907 | ~16‑18 px de haut (`padding:0`) | « Comment ça marche ? », « Réessayer » (6489, 6678, 9205) | gênant |
| `.pf-chip` | 1461 | ~26 px (`padding:6px 10px`, 11 px) | filtres du sélecteur de joueur | gênant |
| `.season-note` | 992 | **28 px** (`min-height:28px`) | « Données à partir de … ⓘ » | mineur |
| `.account-switch button`, `.lien-compte` | 678 | ~29 px (`padding:6px`, 13 px) | « Créer un compte », « Supprimer mon compte » | gênant |
| `.palmares-plus` | 871 | ~34 px (`padding:10px`, 11 px) | « Voir les N autres titres » | mineur |
| `.season-pick` à 3‑4 joueurs | 1007 | **34 px** | choisir la saison | gênant |
| `.csel-option` | 1036 | ~35 px (`padding:10px 14px`, 12,5 px) | options de menu déroulant | mineur |
| `.sheet-action` | 729 | ~36 px (`padding:10px 14px`, 12 px) | action de bas de feuille | mineur |
| `.wl-m` sous 600 px de hauteur | 498 | ~36 px (`padding:5px 8px`) | duels du jour sur l'accueil | mineur |
| `.about-notifs-btn` | 703 | **38 px** (`min-height:38px`) | activer les notifications | mineur |
| `.duel-saved .sup` | 691 | **40 × 40** | supprimer un duel sauvegardé | mineur |
| `.invite-notifs button` | 710 | **40 px** | accepter / refuser les notifications | mineur |
| `.share-format-btn` (rangée Format) | 1184 | ~40 px (`padding:12px`, 12,5 px) | Carré / Story | mineur |
| `.share-download-btn` | 1236 | ~43 px (`padding:13px`, 13 px) | Partager / Télécharger | mineur |

Les quatre premières lignes valent une correction ; le reste tient entre 34 et 43 px, c'est‑à‑dire manquable mais rattrapable.

#### A‑10 — Champs de saisie sous 16 px : zoom automatique sur iOS (gênant)

**Ligne 560** : `.search-field input{ ... font-size:14px; }` · **ligne 664** : `.account-form input{ ... font-size:15px; }`

Le `<meta viewport>` (ligne 5) est exemplaire — `width=device-width, initial-scale=1.0, viewport-fit=cover`, **sans** `maximum-scale` ni `user-scalable=no`, donc le pincement reste possible (règle 1.4.4 respectée). Mais la contrepartie est connue : **Safari iOS zoome la page de lui‑même quand on prend le focus sur un champ dont la police fait moins de 16 px**, et ne dézoome pas en sortant. L'utilisateur tape un nom de joueur et se retrouve avec une interface agrandie et décalée, qu'il doit repincer à la main — à chaque recherche, et à chaque champ du formulaire de compte.

Le code montre que le problème est connu ailleurs : `.season-pick select{ font-size:16px }` (984) porte précisément cette valeur pour cette raison. **Correctif** : passer les deux règles à `font-size:16px`.

## 2.3 Clavier et lecteurs d'écran

**Le socle ARIA est bon**, nettement au‑dessus de ce qu'on voit d'ordinaire sur une application sans cadriciel. Vérifié et correct :

- `aria-label` sur tous les boutons‑icônes : « Retour » (1664), « Mon compte » (1672), « À propos de Duelio » (1675), « Fermer » × 4 (1709, 1721, 1732, 1758, 1768), « Effacer » (1776, 9459), « Retirer » (6181), « Changer de joueur » (6190), « Supprimer » (7220), le bouton de vue compacte (6457), les `<select>` de saison (6887, 6915), le duel de l'accueil (9821). **Aucun bouton‑icône sans étiquette n'a été trouvé.**
- Les 37 SVG purement décoratifs portent `aria-hidden="true" focusable="false"` (1608, 1668, 2077, 2226, 6360, 6713, 6726, 6862, 6888, 6916, 7204, 7205, 8701, 8813, 9818).
- `role="tablist"` **avec** `role="tab"` et `aria-selected` à jour sur les enfants (6453‑6468). Fait correctement.
- `role="table"` **avec** `role="row"`, `role="columnheader"` et `role="cell"` sur toute la descendance des deux palmarès (8934‑8950, 9002‑9032). Fait correctement.
- `aria-current="page"` posé et retiré sur la barre d'onglets (9750‑9757), avec un commentaire qui explique pourquoi.
- `aria-pressed` sur `.pf-chip` (1465) et sur les puces de statistiques (7477).
- Échap ferme la couche du dessus (9706‑9712), le bouton Retour d'Android suit l'historique (9734‑9737), le focus revient sur l'élément d'origine à la fermeture d'un panneau (9676‑9699, avec un repère reconstruit par sélecteur puisque le nœud est détruit par le rendu suivant).
- Entrée et Espace activent les cartes `role="button"` (6573‑6576).
- Les panneaux fermés sortent de l'ordre de tabulation : `.sheet[hidden]{display:none}` (636) et `.picker:not(.open){visibility:hidden}` (1457, avec `visibility` différée pour ne pas couper la transition).
- `role="status"` sur les deux zones d'état de recherche (1778, 9461) et `aria-live="polite"` sur l'avis d'attente API (1681) et le score de l'accueil (9824).

Ce qui manque :

#### A‑11 — Le résultat du duel n'est jamais annoncé (gênant)

Choisir un joueur reconstruit tout `#content` par `innerHTML` (6165 et suivantes). Aucune région vivante ne couvre le comparatif. Un utilisateur de lecteur d'écran choisit « Mbappé », le panneau se ferme, le focus revient sur la carte — et **rien n'est dit**. Il doit repartir explorer l'écran pour découvrir si les chiffres sont arrivés, ou s'ils sont encore en chargement.

**Correctif** : un `<div role="status" aria-live="polite" class="sr-only">` mis à jour par `renderAll()` avec une phrase courte du type « Mbappé 38 buts, Haaland 44 buts, Haaland devant sur 4 statistiques sur 6 ».

#### A‑12 — Six zones d'état changeantes sans `aria-live` (gênant)

| Élément | Ligne | Contenu |
|---|---|---|
| `.account-msg` | 7211 | erreurs et confirmations d'inscription, connexion, suppression de compte |
| `.tuto-status` / `#genTutoStatus` | 6674, 6760 | « Chargement… », messages d'erreur du tutoriel |
| `.season-pick-err` | 6917 | échec de chargement d'une saison |
| `.career-progress` | 6477, 9424 | avancement du chargement de carrière |
| `#globalFallbackBanner` | 1680 | panne de la source de données |
| `.detail-loading` | 9287 | « Chargement de la fiche… » |

Les deux premiers sont les plus graves : un échec d'authentification (mot de passe refusé, adresse déjà prise) est affiché **silencieusement**. L'utilisateur appuie sur « Se connecter » et n'apprend jamais pourquoi rien ne bouge. **Correctif** : `role="alert"` sur `.account-msg`, `role="status"` sur les cinq autres.

#### A‑13 — `.share-format-btn` : l'état sélectionné est invisible au lecteur d'écran (gênant)

**Lignes 7458‑7470** : les six boutons Format (Carré / Story) et Style (Affiche / Stade / Papier) ne portent que la classe `.active`. Ni `aria-pressed`, ni `role="radio"` + `aria-checked`, ni `aria-current`. Un lecteur d'écran annonce « Carré · publication, bouton » et « Story, bouton » sans jamais dire lequel est retenu. L'utilisateur ne peut pas savoir quel format il est en train de générer — alors que `.pf-chip` (1465) et `.share-chip` (7477) juste à côté font la chose correctement.

**Correctif** : `role="radiogroup"` sur `.share-format-row` et `role="radio" aria-checked="…"` sur les boutons, ou au minimum `aria-pressed`.

#### A‑14 — Boutons imbriqués dans un `role="button"` (gênant)

**Lignes 6190‑6192** : la carte de joueur est un `<div role="button" tabindex="0">` qui **contient** deux vrais `<button>` (`.slot-swap`, `.slot-remove`).

```html
6190:    const swapBtn = `<button class="slot-swap" data-swap="${idx}" type="button" aria-label="Changer de joueur">⇄</button>`;
6192:      <div class="col-head" data-slot="${idx}" ... role="button" tabindex="0" aria-label="Fiche de ${escapeHtml(p.name)}">
```

Un `role="button"` est, pour l'ARIA, une feuille de l'arbre : son contenu est aplati en nom accessible. Selon le mode du lecteur d'écran, « Changer de joueur » et « Retirer » deviennent inatteignables, ou se retrouvent collés au nom de la carte (« Fiche de Kylian Mbappé Changer de joueur Retirer »). La logique de clic prévoit bien le cas (`if(e.target.closest('.slot-remove') || e.target.closest('.slot-swap')) return;`, 6584) — c'est la sémantique qui ne suit pas.

**Correctif** : sortir `.slot-swap` et `.slot-remove` du conteneur (les positionner en absolu par rapport à `.player-col` plutôt qu'à `.col-head`), et faire de `.col-head` un vrai `<a>` ou `<button>` frère.

#### A‑15 — Seize intertitres en `<div>` : aucune navigation par titres (gênant)

Toute la page compte **trois** titres : un `<h1>` en 1671, un `<h1>` en 9819 (l'accueil) et un `<h3>` en 6751. Les seize sections du contenu dynamique passent par des `<div>` de pure présentation : `.share-section-label` (« Format », « Style », « Statistiques », 7456‑7472), `.browse-section-label` (925), `.list-section-title` (« Consultés récemment », « Duels à essayer », « Quelques noms pour commencer », 8719‑8720, 9485‑9487), `.sheet-title` (712, et 1708/1720/1731/1757 — ceux‑là sont au moins rattachés par `aria-labelledby`).

Un lecteur d'écran sur mobile se navigue beaucoup par titres (geste de balayage sur le rotor). Ici la liste est vide : il faut parcourir l'écran élément par élément. **Correctif** : passer `.share-section-label`, `.browse-section-label` et `.list-section-title` en `<h2>`/`<h3>` et neutraliser les styles par défaut (`font-size`/`margin` sont déjà définis sur les classes).

#### A‑16 — Ordre de tabulation : correct, avec une subtilité bien traitée

Rien à signaler. L'en‑tête masque vraiment le bouton Retour replié (`visibility:hidden` en plus de `width:0`, 1522‑1523) avec un commentaire qui explique le problème évité : « sinon il reste la première tabulation de chaque écran, sans rien de visible à l'arrivée ». La chronologie horizontale reçoit `tabIndex = 0` + `role="group"` + `aria-label` **seulement quand elle défile** (9083‑9091), et les retire sinon — c'est exactement la bonne logique. La barre de défilement dessinée est `aria-hidden="true"` (9114) puisque le conteneur porte déjà le rôle.

Le seul point d'attention reste C‑6 : sur iOS < 15.5, `inert` ne fonctionnant pas, la tabulation sort des panneaux ouverts.

## 2.4 Agrandissement du texte système (jusqu'à 200 %)

Rappel utile : **aucune police n'est exprimée en `rem` ou `em`** dans `index.html` — tout est en px (de 7 px pour `.tart-picks span` à 40 px pour `.wl-title`). Les conséquences diffèrent selon la plateforme :

- **iOS** : le Dynamic Type n'agit pas sur des tailles en px. Le seul levier est le zoom de page de Safari, qui agrandit *tout* proportionnellement — donc **rien ne casse**, mais l'utilisateur qui a réglé « Texte plus grand » dans les réglages système ne voit aucun changement dans l'application. Fonctionnellement : la règle 1.4.4 est satisfaite par le pincement (le `<meta viewport>` ne le bride pas), l'accessibilité système est ignorée.
- **Android** : la WebView applique l'échelle de police du système (`fontScale` → `textZoom`). Les px de **texte** grossissent ; les px de **boîte** ne grossissent pas. C'est là que ça casse.

#### A‑1 — Hauteurs fixes en px autour de texte : le comparatif se coupe (bloquant sur Android)

| Règle | Ligne | Contenu | À 200 % |
|---|---|---|---|
| `.stat-row{ height:52px; overflow:hidden; }` | 1244‑1247 | `.k` (8,5 px, clampé 2 lignes) + `.v` (14 px, gras) | 2 lignes de libellé à ~20 px + une valeur à 28 px ≈ **68 px dans une boîte de 52**, `overflow:hidden` ⇒ le libellé ou le chiffre est **tronqué**. C'est le cœur du comparatif |
| `.compare-cols.count-4 .stat-row{ height:46px }` | 1107 | idem, à quatre joueurs | encore 6 px de moins |
| `.dr-val{ height:46px; overflow:hidden; }` | 1267, 1292 | valeur (15 px) + `.ecart` « +N % » (9 px) | ≈ 30 + 18 + rembourrage > 46 ⇒ le **« +12 % » disparaît**, et la valeur peut se couper |
| `.wl-duel{ height:262px }` avec `.wl-n{ position:absolute; top:164px }` | 1401, 1412‑1414 | noms des deux joueurs de l'accueil, en absolu | les noms (13 px → 26 px, sur deux lignes) **chevauchent** le bloc de score ; `.welcome-content{ overflow:hidden }` (321) les rogne |
| `.api-wait-notice{ white-space:nowrap; max-width:calc(100% - 32px) }` | 1012‑1015 | « Chargement des statistiques… » | `nowrap` sans `overflow:hidden`, centré par `translateX(-50%)` ⇒ le texte **dépasse des deux côtés** et se fait couper par `.phone{overflow:hidden}` (265) |
| `.tlh-item{ flex:0 0 118px }` + `-webkit-line-clamp:2` | 807, 823 | noms de clubs de la chronologie | largeur figée ⇒ à 200 % un nom de club tient en ~8 caractères sur 2 lignes, puis est coupé |

Ce qui résiste, et c'est à saluer : `.col-head{ min-height:138px }` (1127), `.account-btn{ min-height:46px }`, `.season-pick{ min-height:44px }`, `.sheet-panel{ max-height:78% }` + `.sheet-list{overflow-y:auto}` (638, 715), `.csel-menu{ max-height:380px; overflow-y:auto }` (1031‑1034) — autant de `min-height` et de conteneurs défilants qui grandissent correctement. Les `min-height: 2.5em` et `1.25em` de `.tlh-club` et `.tlh-years` (827, 835) sont même en `em`, donc à l'échelle.

**Correctif** : remplacer `height` par `min-height` sur `.stat-row`, `.dr-val` et `.compare-cols.count-4 .stat-row`, et retirer leur `overflow:hidden`. Pour `.wl-duel`, remplacer le positionnement absolu des noms par un flux normal. Pour `.api-wait-notice`, retirer `white-space:nowrap`.

**Note secondaire** : `index.html` ne déclare pas `-webkit-text-size-adjust`, contrairement à `legal.css` (ligne 6, `html{ -webkit-text-size-adjust:100% }`). Avec un `<meta viewport>` correct l'agrandissement automatique est normalement désactivé, mais la ligne ne coûte rien et rend le comportement explicite.

## 2.5 `prefers-reduced-motion`

**Globalement très bien respecté.** La règle balai de la ligne 296‑298 est la bonne approche :

```css
@media (prefers-reduced-motion: reduce){
  *, *::before, *::after{ animation-duration:.001ms !important; transition-duration:.001ms !important; }
}
```

Elle couvre d'un coup les quinze `@keyframes` et toutes les transitions, y compris celles ajoutées plus tard. Deux blocs la renforcent par un `animation:none` explicite (1315‑1317, 804‑806) et un troisième traite le cas « écran lent » (335). Côté JavaScript, les trois animations pilotées à la main sont gardées :

- le radar : `radarCanAnimate()` (2382‑2384) teste le réglage avant même de poser `data-radar-key` (2365) ;
- le défilement des chiffres : `compterJusqua()` sort immédiatement (6098) ;
- la pilule glissante et le score de l'accueil : `const fixe = matchMedia('(prefers-reduced-motion: reduce)').matches` (9890), et l'intervalle de 3 s n'est pas armé si `fixe` ;
- le défilement vers l'image générée : `behavior: matchMedia(...).matches ? 'auto' : 'smooth'` (8568).

#### A‑17 — Une seule exception : `scrollTo` ligne 8586 (mineur)

```js
8586:    if(scr){ const top = ... ; scr.scrollTo({top, behavior:'smooth'}); }
```

Dix‑huit lignes après un `scrollIntoView` correctement gardé, ce second défilement force `'smooth'` sans condition. Un utilisateur sensible au mouvement (vertiges, troubles vestibulaires) reçoit malgré tout un défilement animé juste après la génération de son image. S'y ajoute le doublon signalé en C‑7 : deux défilements vers la même cible, dont l'un animé.

**Correctif** : reprendre le ternaire de la ligne 8568, ou supprimer la ligne 8586 qui fait doublon.

## 2.6 Images

Les quatre seules balises `<img>` du fichier sont correctes :

| Ligne | Balise | Verdict |
|---|---|---|
| 2145 | `<img src="…" alt="${escapeHtml(p.name)}" loading="lazy" onerror="handlePhotoError(…)">` | portrait de joueur, `alt` = le nom. **Correct** |
| 2178 | `<img class="club-logo" src="…" alt="" onerror="clubLogoFail(this)">` | logo de club, `alt=""` — décoratif, le nom du club est en texte à côté. **Correct** |
| 9811, 9813 | `<img alt="" src="https://media.api-sports.io/…" onerror="this.remove()">` | portraits de l'accueil, dans un `<button>` qui porte `aria-label="Ouvrir le duel X contre Y"` (9821). `alt=""` est le bon choix. **Correct** |

`legal/credits.html:70` : `<img src="/legendes/photos/…" alt="" loading="lazy">` — photo de légende suivie du nom et du crédit en texte, `alt=""` approprié. **Correct.**

Aucun `alt` manquant, aucun `alt` redondant. Rien à corriger ici.

## 2.7 Pages légales

`legal/conditions.html`, `confidentialite.html`, `credits.html` et `legal.js` sont propres sur les deux axes :

- JavaScript en ES5 (`var`, `function(){}`, pas de flèches), `localStorage` dans un `try/catch` (legal.js:11, 13) — compatible jusqu'aux WebView les plus anciennes ;
- `lang` mis à jour dynamiquement au changement de langue (legal.js:9) ;
- `role="group" aria-label="Langue / Language"` et `aria-pressed` tenu à jour sur les deux boutons (lignes 17‑19 / 29‑31, legal.js:8) ;
- `<nav aria-label>` en pied de page ;
- `font-size:16px` sur `body` et `.recherche{ min-height:44px; font-size:15px }` — zone tactile correcte, mais **15 px déclenche le zoom automatique iOS** (même remarque qu'en A‑10) ;
- `.langues button{ min-height:36px }` — sous 44 px (mineur).
- `[hidden]{ display:none !important }` (ligne 33) : la langue non affichée est bien retirée de l'arbre d'accessibilité.

---

# Doutes — à vérifier sur appareil, non tranché par le code

1. **Groupement de parenthèses en requête média (C‑9)** — Chrome 88 est sûr ; la version de Safari qui accepte `((a) and (b))` imbriqué ne l'est pas. À tester sur un iPhone en iOS 15 avec une largeur CSS > 480 px (réglage « taille d'affichage » agrandi).
2. **Téléchargement en WebView (C‑3)** — l'absence de `navigator.share` dans la WebView est certaine ; le sort exact de `a.download` + `blob:` dépend de ce que Capacitor 7 enregistre comme `DownloadListener`. À tester en build réel sur les deux plateformes : appuyer sur « Télécharger » et vérifier qu'un fichier arrive.
3. **Icône et manifeste (C‑15)** — le refus de WebKit de charger un SVG sans `width`/`height` est un comportement historique que je n'ai pas pu vérifier ici. Test : ouvrir l'application dans Safari iOS, « Sur l'écran d'accueil », et regarder si l'icône Duelio apparaît ou une capture d'écran.
4. **`rel="preload"` sur la feuille de polices (C‑13)** — la version de Safari à partir de laquelle l'astuce `onload="this.rel='stylesheet'"` fonctionne de façon fiable reste à confirmer. Test visuel : les titres sont‑ils en Unbounded ou en police système sur un vieil iPhone ?
5. **Données ICU (C‑14)** — vérifiable seulement sur un appareil à ROM allégée. Test : une statistique au‑dessus de 1 000 doit s'écrire « 1 234,5 » et non « 1,234.5 ».
6. **Double retour haptique** — en natif Android, `haptique()` (6162) appelle le greffon Haptics *et* l'écouteur global de 9797‑9803 appelle `navigator.vibrate(12)` sur le même clic (si la permission `VIBRATE` est au manifeste). Deux vibrations là où une était prévue. Non vérifiable sans appareil.
7. **Échelle de police Android (A‑1)** — je décris le mécanisme `fontScale → textZoom` ; l'ampleur réelle dépend de la version de la WebView et de la configuration Capacitor. Test : régler la taille de police du système au maximum et ouvrir l'onglet « Comparer » avec deux joueurs.
8. **Mode privé iOS et `localStorage`** — les écritures sont toutes dans un `try/catch`, donc aucune casse attendue. Reste à confirmer que les replis se comportent bien à l'usage (l'accueil se réaffiche à chaque lancement, les « consultés récemment » restent vides) plutôt que de boucler.

---

# Ce qu'il faudrait corriger en premier

Déduit des constats ci‑dessus, du plus rentable au moins :

1. **C‑1** — treize `top:0;right:0;bottom:0;left:0` à ajouter avant les `inset:0`. Une passe de dix minutes qui rend l'application utilisable sur iOS 14.0‑14.4.
2. **C‑3** — brancher `@capacitor/share` (déjà installé, jamais appelé) + `@capacitor/filesystem` sur le chemin natif. Sans cela, la fonction mise en avant par l'onglet « Partager » ne produit rien dans le build Play Store.
3. **A‑1** — `height` → `min-height` sur `.stat-row` (1246), `.dr-val` (1267) et `.compare-cols.count-4 .stat-row` (1107), et retirer leur `overflow:hidden`.
4. **A‑3** et **A‑8** — ajouter `.slot-remove` aux lignes 1500 et 1502 ; mettre `min-height:44px` dans la règle 1007. Deux virgules et un nombre.
5. **A‑12** et **A‑11** — `role="alert"` sur `.account-msg` (7211), `role="status"` sur les cinq autres zones d'état, et une région vivante pour le résultat du duel.
6. **A‑2** — éclaircir `--line` (ligne 225) jusqu'à 3:1 sur `--bg`, ou ajouter un jeton `--line-fort` pour les bordures de contrôles.
7. **A‑10** — `font-size:16px` sur `.search-field input` (560) et `.account-form input` (664).
8. **C‑4** — tester `('filter' in tc)` à la ligne 7926 et prévoir un repli, le `try/catch` actuel ne détectant rien.
9. **C‑2** — remplacer les deux `\p{L}` (3812, 4998) par une classe de caractères explicite.
10. **C‑6** — repli `aria-hidden` + boucle de tabulation quand `inert` manque (9659‑9663).
11. **A‑13**, **A‑14**, **A‑15**, **A‑17** — `aria-pressed` sur les boutons Format/Style, désimbrication des boutons de carte, intertitres en `<h2>`/`<h3>`, et le `scrollTo` de 8586 à aligner sur `prefers-reduced-motion`.
12. **A‑4**, **A‑5**, **A‑6**, **A‑7** — quatre valeurs d'opacité/couleur à remonter, et `--lose` à supprimer.
