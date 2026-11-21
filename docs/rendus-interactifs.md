
# Rendus interactifs du chat Tauri

Chaque réponse peut contenir plusieurs blocs de code `frst-ui`. Le même parseur s’applique à tous les modèles et aux réponses stockées dans l’historique. Les instructions de format sont ajoutées au prompt de chat selon la demande. La conformité effective du JSON dépend du modèle.

```frst-ui
{"version":1,"kind":"simulator","title":"Puissance","fields":[{"id":"intensite","label":"Intensité","type":"range","min":0,"max":100,"value":35}],"results":[{"label":"Puissance","unit":"W","formula":{"op":"mul","args":[{"field":"intensite"},2]}}]}
```

| Type | Contenu et comportement |
| --- | --- |
| `chart` | `chart` prend `line`, `bar`, `pie` ou `scatter`. Les `series` contiennent un `name` et des `points` avec `label` et `y`. Le nuage de points et la courbe avec `axis: "numeric"` attendent aussi `x`. |
| `table` | `columns` contient les en-têtes et `rows` les lignes. Le filtre et le tri sont locaux. |
| `checklist`, `accordion`, `popover` | `items` contient des libellés ou des objets `{title,content}` selon le type. |
| `cards`, `carousel`, `timeline`, `animation` | `items` contient des objets `{title,text,label,url,image}`. Le titre est requis. L’image directe provient de Wikimedia Commons. |
| `diagram` | Les éléments de `items` sont reliés par `edges`, une liste de paires d’indices. La navigation suit les liaisons déclarées. |
| `map` | `places` contient `{title,lat,lon,text}`. `route: true` relie les étapes à vol d’oiseau. La carte permet le pincement, le déplacement au doigt et la sélection d’un repère. Le fond hors ligne provient de [Natural Earth 1:110m v5.1.2](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_110m_land.geojson), dans le [domaine public](https://www.naturalearthdata.com/about/terms-of-use/). |
| `form` et `simulator` | `fields` contient des champs `text`, `textarea`, `number`, `range`, `date`, `checkbox`, `select` ou `radio`. `results` contient des expressions arithmétiques bornées. Les saisies restent locales au composant. |
| `editor` | `text` est modifiable localement. Le lecteur peut enregistrer une copie Markdown. |

Les blocs `quiz` et `cards` du mode Étudiant conservent leur format existant. Les rendus reposent sur des données validées et des composants préinstallés. Les actions possibles sont la navigation locale, la validation d’un formulaire local, l’enregistrement d’une copie et l’ouverture explicite d’une source HTTPS. Les images externes intégrées sont limitées aux hôtes d’images Wikimedia déjà autorisés.

Les aperçus de fichiers utilisent les lecteurs et convertisseurs embarqués. Les PDF restent paginés. Les Word générés affichent leur structure Markdown et les Word importés un aperçu filtré des titres, paragraphes, caractères gras, italiques et soulignés. Les classeurs Excel et le CSV proposent une grille triable dans les limites de l’aperçu. Les blocs HTML générés affichent leur aperçu directement dans la réponse, avec le code replié et un bouton pour ouvrir le fichier en grand. Le document est filtré et isolé, sans scripts, navigation ou requêtes réseau. Les SVG sont filtrés avant un affichage en image.

La galerie de recherche utilise Wikimedia Commons. Les fiches météo, sports, lieux, produits ou réservations peuvent structurer des données issues de la recherche web lorsque le modèle dispose des sources. Les services temps réel, les itinéraires routiers, les transactions de réservation et l’édition collaborative nécessitent des intégrations backend dédiées. La validation tactile et WebView reste à effectuer sur appareils iOS et Android.
