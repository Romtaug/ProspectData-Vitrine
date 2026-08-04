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

## La carte des prospects

La section « Votre CRM, en vrai » affiche une carte Leaflet (fond OpenStreetMap)
avec des prospects de demonstration autour de Lyon. Chaque point ouvre une
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
