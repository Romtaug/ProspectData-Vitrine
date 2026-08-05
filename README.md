# ProspectData - site vitrine

Site d'une page pour ProspectData : creation de CRM de prospection sur mesure.
Le client decrit sa cible avec ses mots, elle est traduite en codes APE officiels,
et il recoit un CRM rempli des entreprises concernees, telephones et emails
verifies compris, qui s'enrichit et se met a jour tout seul chaque mois.

Paiement unique, sans abonnement, sans limite de volume.
Contact : romtaug+prospectdata@gmail.com

En ligne : https://prospectdata.netlify.app/

## Arborescence

```
index.html                    le site : structure, styles, animations, carte
widget.js                     le chatbot (bulle en bas a droite)
data/faq-prospectdata.json    la base de connaissances du chatbot
netlify/functions/chat.js     backend du chatbot : appelle Gemini, cle cote serveur
netlify/functions/_faq-loader.js
netlify/functions/_retrieval.js
assets/                       logo complet, entonnoir seul, favicon, icones
favicon.png                   icone d'onglet
apple-touch-icon.png          icone ecran d'accueil iOS
og-image.png                  apercu au partage LinkedIn (1200 x 630)
netlify.toml                  publie la racine, declare les fonctions
robots.txt / sitemap.xml / llms.txt
```

## Deploiement

Le depot est branche sur Netlify : chaque commit sur `main` redeploie le site
automatiquement. Aucune etape de build.

Pour mettre a jour : Add file > Upload files sur GitHub, glisser les fichiers ou
dossiers modifies, commit. Une minute plus tard c'est en ligne.

## Le chatbot

La bulle en bas a droite est `widget.js`. Elle interroge la fonction serveur
`netlify/functions/chat.js`, qui charge la FAQ (`data/faq-prospectdata.json`),
selectionne les entrees pertinentes et demande la reponse a Gemini. La cle ne
quitte jamais le serveur.

Configuration requise, une seule variable dans Netlify :
Site configuration > Environment variables > `GEMINI_API_KEY`
(cle gratuite sur https://aistudio.google.com/app/apikey)

Optionnel, pour changer les textes sans toucher au code : `BOT_SITE_NAME`,
`BOT_ASSISTANT_NAME`, `CONTACT_EMAIL`.

Pour enrichir les reponses : editer `data/faq-prospectdata.json` (chaque entree a
un `theme`, une `question`, une `answer`) et commit. Rien d'autre a faire.

## Ajouter un secteur : une seule zone a editer

En haut du `<script>` de `index.html` se trouve le bloc `PD_SECTORS`. Chaque
secteur y tient en une dizaine de lignes et alimente **tout** le site a la fois :
l'animation du hero, l'onglet, le titre du CRM, les compteurs, la carte et les
fiches. Pour ajouter un secteur, copiez un bloc existant et changez les valeurs.
Rien d'autre a toucher, aucune limite de nombre.

```js
{ id:"pharmacies", tab:"Pharmacies",
  phrase:"les pharmacies du Rhone",              // ce que tape le hero
  apes:["47.73Z","dep. 69"],                     // les puces vertes
  n:1240, nA:310,                                // volume, dont tier A
  titre:"Pharmacies - Rhone", maj:"mise a jour du 1er aout",
  kpis:[["a contacter",180],["contactes",44],["RDV",7],["signes",2]],
  prospects:[
    {n:"Pharmacie du Centre", v:"Lyon 2e", t:"04 78 xx xx xx",
     e:"contact@pharmacieducentre.fr", x:"a",   // x = tier a, b ou c
     lat:45.7578, lng:4.8320,
     st:"new", sl:"a contacter", as:"-", neuf:true}
  ]}
```

Champs d'un prospect : `n` nom, `v` ville, `t` telephone, `e` email, `x` tier
(`a`, `b` ou `c`), `lat`/`lng` coordonnees, `st` statut (`new`, `tel`, `rel`,
`rdv`), `sl` libelle du statut, `as` commercial assigne, `neuf: true` pour le
badge « nouveau ». Le hero utilise les 3 premiers prospects, la carte et les
fiches utilisent tous.

**Lien direct vers un secteur**, pratique pour une campagne ciblee : ajoutez
`?secteur=ID` a l'URL. Exemple : `https://prospectdata.netlify.app/?secteur=restaurants`
ouvre la page avec l'onglet Restaurants deja actif. L'URL se met aussi a jour
toute seule quand le visiteur change d'onglet, donc un prospect peut partager la
vue de son propre secteur.

Six secteurs sont livres : garages, boulangeries, bureaux d'etudes, restaurants,
agences immobilieres, electriciens. Volontairement tres differents, pour montrer
que le produit ne depend pas du metier.

## La carte des prospects

La section « Votre CRM, en vrai » affiche une carte Leaflet (fond OpenStreetMap)
avec les prospects du secteur selectionne. Chaque point ouvre une
popup avec telephone et email, et fait defiler la fiche correspondante a droite.
Les fiches ont le telephone et l'email cliquables. Les donnees sont dans le bloc
`PROSPECTS` en bas de `index.html` : entreprises fictives, coordonnees reelles.

## Les couleurs

| Couleur | Valeur | Usage |
|---|---|---|
| Graphite | `#161A23` | texte, fonds sombres |
| Bordeaux | `#83283A` | boutons, accents, marque |
| Vert | `#29795E` / `#35A17C` | emails trouves, validation |
| Bone | `#FAF9F5` / `#F1EFE7` | fonds clairs |

Polices : Bricolage Grotesque (titres), Inter (texte), JetBrains Mono (donnees).
