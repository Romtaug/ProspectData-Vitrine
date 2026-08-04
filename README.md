# ProspectData - site vitrine

Site d'une page pour ProspectData : creation de CRM de prospection sur mesure.
Le client decrit sa cible avec ses mots, elle est traduite en codes APE officiels,
et il recoit un CRM deja rempli des entreprises concernees, contacts compris, qui
s'enrichit et se met a jour automatiquement chaque mois.

Paiement unique, sans abonnement, sans limite de volume.
Contact : romtaug+prospectdata@gmail.com

---

## Arborescence complete

```
prospectdata/
|-- index.html               le site ENTIER : CSS, animation, chatbot, FAQ
|                            et logo integres. Autonome : il s'affiche complet
|                            meme si tout le reste manque.
|-- og-image.png             apercu au partage LinkedIn (1200 x 630)
|-- apple-touch-icon.png     icone ecran d'accueil iOS (180 x 180)
|-- favicon.png              icone de secours navigateurs (512 x 512)
|-- robots.txt               referencement Google
|-- sitemap.xml              referencement Google
|-- llms.txt                 indexation par les IA
|-- .nojekyll                dit a GitHub Pages de servir le depot tel quel
|-- streamlit_app.py         option Streamlit : sert index.html en plein ecran
|-- requirements.txt         option Streamlit : la seule dependance
|-- netlify.toml             option Netlify : publie la racine telle quelle
|-- README.md                ce fichier
|
|-- assets/                  les SOURCES du logo, pour editer et reutiliser
|   |-- logo.png             logo complet detoure, fond transparent
|   |-- logo-mark.png        l'entonnoir seul, carre, transparent
|   |-- favicon.png          version 512 x 512
|   |-- apple-touch-icon.png version 180 x 180 sur fond bone
|   |-- og-image.png         image de partage avec la baseline
|
|-- data/
|   |-- faq-prospectdata.json  les 17 questions-reponses du chatbot, editables
|
|-- js/
    |-- chatbot.js             le code source du chatbot, commente
```

## Comment les deux niveaux s'articulent

`index.html` est un fichier autonome : le logo y est integre en data URI, le
chatbot et sa FAQ y sont inclus en dur. Le site fonctionne donc meme si les
dossiers `assets/`, `data/` et `js/` ne sont pas deployes, et meme si un upload
aplatit l'arborescence.

Les dossiers contiennent les memes elements sous forme de fichiers separes. Ils
servent a editer et a reutiliser : prendre `assets/logo.png` pour LinkedIn ou une
facture, modifier `data/faq-prospectdata.json` ou `js/chatbot.js` confortablement.

**Important si tu modifies la FAQ ou le chatbot** : le site lit les versions
integrees dans `index.html`, pas les fichiers des dossiers. Apres une modification
dans `data/` ou `js/`, reporte-la dans `index.html` (chercher `window.PD_FAQ` pour
la FAQ, le bloc `<script>` suivant pour le chatbot). Pour ajouter une simple
question-reponse, le plus rapide est d'editer directement `window.PD_FAQ` dans
`index.html`.

---

## Deploiement

### GitHub Pages (actif)

Le site est servi depuis ce depot : https://romtaug.github.io/prospectdata/

Pour mettre a jour : Add file > Upload files, glisser les fichiers et les dossiers,
commit. Le site se reconstruit en une minute. L'interface web de GitHub accepte le
glisser-deposer de dossiers entiers et conserve leur structure.

### Netlify

1. app.netlify.com > Add new site > Import an existing project > GitHub
2. Choisir ce depot, ne rien changer aux reglages (le `netlify.toml` s'en charge)
3. Deploy site, puis Site configuration > Change site name

Chaque commit sur GitHub redeploie automatiquement. Pour un domaine personnalise
(ex. prospectdata.fr) : Domain management > Add a domain, puis copier les DNS
indiques chez le registrar. HTTPS automatique et gratuit.

### Streamlit

share.streamlit.io > Create app > depot `Romtaug/prospectdata`, branche `main`,
fichier principal `streamlit_app.py` > Deploy.

---

## Les couleurs

| Couleur | Valeur | Usage |
|---|---|---|
| Graphite | `#161A23` | texte, fonds sombres |
| Bordeaux | `#83283A` | boutons, accents, marque |
| Vert | `#29795E` | donnee retrouvee uniquement |
| Bone | `#F6F5F2` | fond clair |
