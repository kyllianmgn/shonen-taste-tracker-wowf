# Bot Discord WoW: Forever — dossier de recherche

Nov 5, 2026 · @Kyllian

## Verdict

Le bot est faisable, mais pas en s'appuyant uniquement sur l'API Blizzard : au 5 novembre, elle ne permet pas de consulter un personnage WoW: Forever publiquement. Il faut un addon maison + une petite appli compagnon chez chaque joueur, comme le font déjà Jeeves, Party Tracker, PatchVault et ForeverDB.

- **API Battle.net (Forever)** : seul le profil de compte fonctionne, avec la connexion OAuth du joueur. Il donne prénom, nom, classe, race, faction et niveau. La recherche publique d'un personnage renvoie encore 404.
- **Jeton OAuth joueur** : valable 24 h, sans jeton de rafraîchissement. Impossible de suivre quelqu'un en continu sans qu'il se reconnecte.
- **Statut « en ligne »** : jamais exposé par l'API Blizzard, quelle que soit la version du jeu.
- **Addon + compagnon** : l'addon lit niveau, XP, or, temps de jeu, zone, équipement, métiers, réputations ; le jeu écrit ces données à chaque déconnexion ou `/reload`. L'appli compagnon les envoie au bot et peut détecter que le jeu tourne, ce qui donne une vraie notion de « connecté ».

Conséquence pour tes salons : le log de connexion et le tableau des niveaux sont réalistes, mais le niveau se met à jour à la déco ou au `/reload`, pas à la seconde du « ding ».

Specs techniques pour le développement : Spec addon + appli et Spec bot + serveur.

Décision : deux modes. **Mode appli** (facultatif) pour l'en ligne en direct et la synchro toutes les 10-15 min ; **mode de base** sans rien installer, via Battle.net (niveau 5 à 15 min après la déconnexion) et `/sync` manuel pour le détail de l'addon.

Pour lancer le développement : Démarrage Claude Code.

## Ce que WoW: Forever change pour un tracker

Un personnage Forever s'identifie par **région + prénom + nom**, pas par royaume + nom. C'est la clé à utiliser partout dans le bot.

- **Sans royaumes visibles** : le joueur choisit un ensemble de règles (Normal, JcJ, JdR, JdR-JcJ ; Hardcore plus tard), pas un serveur. Il n'y a pas de serveur français.
- **Deux noms obligatoires** : prénom et nom, 2 à 12 caractères chacun. La combinaison est unique dans toute la région, tous rulesets confondus.
- **Royaumes cachés** : derrière chaque ruleset, l'API liste de vrais royaumes internes nommés « CAMWOW EU4 Realm 3 PvE » etc. Le ruleset se lit dans leur champ `type` (`NORMAL`, `PVP`, `RP`, `PVP_RP`).
- **Commande d'ajout** : `/add` doit donc demander région (EU par défaut) + prénom + nom, éventuellement le ruleset pour l'affichage. Jamais de royaume.
- **Sortie** : le jeu est sorti le 4 novembre 2026 ; l'outillage tiers (API, armureries) se met en place en ce moment même.

## Sources de données

Trois sources existent ; seule la combinaison addon + compagnon donne « toutes les données » que tu veux aujourd'hui.

### 1. API Battle.net (officielle)

Blizzard n'a ni annoncé ni documenté d'API Forever ; ce qui suit vient de sondages communautaires, vérifiés le 4 novembre à 19 h 15 UTC, juste avant la sortie.

| Namespace | État | Ce qu'on en tire |
| --- | --- | --- |
| `dynamic-forever-eu` | Ouvert | Régions, royaumes internes, ruleset de chaque royaume |
| `static-forever-eu` | Ouvert depuis le 4 nov. | Classes, races (dont les 2 Skyborne), objets, hauts faits, montures, talents, titres, métiers |
| `profile-forever-eu` → `/profile/user/wow` | Ouvert, jeton joueur requis | Liste des persos du compte : prénom, `surname`, classe, race, sexe, faction, niveau, id |
| `profile-forever-eu` → `/profile/wow/character/{prénom}-{nom}` | 404 | Le lien existe mais ne répond pas encore (fiche détaillée, équipement, stats) |
| Guildes, maisons de vente, classements | 404 | Rien |

Points clés :

- Le profil de compte ne contient pas de champ royaume ; il n'apparaît que dans le lien « protected character » (`{realmId}-{characterId}`).
- Un perso n'apparaît dans l'API qu'après une déconnexion. Un compte sans perso Forever renvoie 404, pas une liste vide.
- En retail, la fiche publique n'existe qu'à partir du niveau 10 ; la même règle pourrait expliquer une partie des 404 actuels.
- Le joueur doit avoir activé « Partager mes données de jeu avec les développeurs de la communauté » dans la confidentialité Battle.net, sinon les appels tiers échouent.
- Hôte : `eu.api.blizzard.com`, jeton applicatif via client credentials, plafond indicatif de 100 requêtes/s et 36 000/h.

### 2. Addon maison + appli compagnon (recommandé)

Un addon WoW ne peut pas aller sur Internet ; il écrit dans ses SavedVariables, un fichier Lua que le jeu sauvegarde à la déconnexion, à la sortie ou au `/reload`. Une appli compagnon (Windows) surveille ce fichier et l'envoie au bot.

- C'est le modèle de Party Tracker, PatchVault, Jeeves (appli de bureau) et ForeverDB (Uploader).
- Sur Forever, les fichiers par personnage sont rangés dans `WTF/Account/<id>/<Prénom>-<Nom>/SavedVariables/`.
- Version d'interface du client : 16001 ; le suffixe de TOC `_Forever` est accepté.

### 3. Sites tiers

Armureries (aotc.gg, armorywowforever.com, WoW Forever Friends) : toutes en attente de l'API Blizzard au 5 novembre. ForeverDB a une armurerie alimentée par son propre addon, sans API publique documentée. À surveiller, pas à utiliser comme base.

## Le statut « en ligne »

Seule l'appli compagnon peut dire qu'un joueur est connecté ; l'API Blizzard ne le peut pas, par choix de confidentialité.

- **API Blizzard** : aucun champ « en ligne ». Le champ `last_login_timestamp` de la fiche personnage contient en réalité l'heure de la dernière **déconnexion**, moment où les données sont publiées.
- **Appli compagnon, début de session** : détecter que le processus WoW Forever tourne (installé dans le sous-dossier `_forever_`) → événement « connecté ». Le nom du perso n'est connu qu'au moment où l'addon a écrit une fois, donc l'annonce peut dire « X est en jeu » puis être complétée.
- **Appli compagnon, fin de session** : fermeture du processus ou réécriture des SavedVariables → événement « déconnecté » avec le diff de la session (niveaux gagnés, or, temps joué, zone).
- **Pendant la session** : rien n'est écrit sur disque sans `/reload`. L'addon peut proposer un `/reload` hors combat après chaque niveau, comme le fait Party Tracker, pour publier le « ding » en quasi temps réel.
- **Piste à valider** : lire en direct un fichier de log du jeu pour capter des événements sans `/reload`. Non vérifié pour Forever ; à tester avant d'en dépendre.

Sans appli compagnon (joueur qui refuse d'installer), le bot ne peut afficher qu'un « vu pour la dernière fois », et seulement quand la fiche publique fonctionnera.

## Données récupérables par source

L'addon couvre presque tout ; l'API compte sert surtout à prouver qu'un perso appartient bien au joueur Discord.

| Donnée | API compte (OAuth joueur) | Fiche publique API | Addon + compagnon |
| --- | --- | --- | --- |
| Prénom, nom, classe, race, faction | Oui | Oui quand elle ouvrira | Oui |
| Niveau | Oui, à la déco | Oui quand elle ouvrira | Oui, à la déco ou au `/reload` |
| XP vers le niveau suivant | Non | Non (pas en retail) | Oui |
| Date de chaque niveau | Non | Non | Oui (l'addon les horodate) |
| Temps de jeu total et au niveau | Non | Non | Oui |
| Or | Non | Non | Oui |
| Zone actuelle | Non | Non | Oui |
| Équipement | Non | Probable, comme en retail | Oui |
| Talents | Non | Incertain | Non lisible pendant le stress test (Party Tracker) |
| Métiers et niveaux de compétence | Non | Absent sur Classic Era, incertain | Oui |
| Réputations | Non | Probable | Oui |
| Rang JcJ, honneur | Non | Incertain | Oui |
| Donjons visités | Non | Non | Oui |
| Morts | Non | Non | Oui (Party Tracker les publie) |
| Guilde | Non | 404 aujourd'hui | Oui |
| Statut en ligne | Non | Non | Oui, via le processus du jeu |

Les restrictions « secrets » de Forever (les mêmes que Midnight) masquent surtout des valeurs de combat en instance ; elles ne bloquent pas niveau, or, zone ou temps de jeu, que PatchVault lit déjà sur Forever.

## Bots et outils de référence

Aucun outil existant ne fait exactement ton bot ; Zoe donne le modèle Discord, Party Tracker et PatchVault donnent le modèle de collecte.

| Outil | Jeu | Source des données | Ce qu'on reprend |
| --- | --- | --- | --- |
| [Zoe](https://top.gg/bot/550737379460382752) | LoL / TFT | API Riot | Salon « info » géré par le bot avec un panneau unique, plusieurs comptes par joueur (`/add account`), équipes, classements, récap après chaque partie, `/setup` guidé |
| [Party Tracker](https://partytracker.app/) | Forever | Addon + appli Windows/Mac, envoi à la déco ou `/wpt sync` | Course au 60, dates de chaque niveau, temps joué, flux de « dings » et morts, webhook Discord par niveau ou tous les 10 niveaux |
| [PatchVault](https://www.curseforge.com/wow/addons/patchvault) | Retail + Forever | Addon + appli Windows à chaque sauvegarde du jeu | Liste exhaustive de ce qu'un addon lit sur Forever : niveau, XP, or, temps joué, zone, stats, équipement, réputations, compétences, rang JcJ |
| [Jeeves](https://www.jeeves.bot/docs/configuration/forever) | Retail, Classic, Forever | Appli de bureau ; sur Forever rapporte niveau, classe, race, faction, région à la déco | Liaison Battle.net, choix du perso principal, rôles Discord par niveau |
| [ForeverDB](https://foreverdb.net/discord) | Forever | Addon + Uploader, persos privés par défaut | `/character`, liaison Discord par code, confidentialité opt-in |
| [GuildOS](https://www.curseforge.com/wow/addons/guild-os) | Forever + Retail | Addon + compagnon Windows | `/register` qui lie Discord et perso et attribue des rôles |

À retenir : tous les outils Forever sérieux passent par un addon et un envoi à la déconnexion. L'API Blizzard n'est utilisée que là où elle répond.

## Conception fonctionnelle

Le bot suit des joueurs Discord, chacun avec deux persos au plus (principal + secondaire), et s'appuie sur deux salons : un tableau verrouillé et un fil de logs.

### Commandes joueur

| Commande | Rôle |
| --- | --- |
| `/lier appli` | Donne un code d'appairage à saisir dans l'appli compagnon |
| `/lier battlenet` | Connexion OAuth Battle.net : prouve que les persos sont bien au joueur et importe la liste |
| `/perso ajouter prénom nom [région] [rôle]` | Ajoute un perso, principal ou secondaire ; refusé s'il appartient déjà à quelqu'un |
| `/perso principal` | Inverse principal et secondaire |
| `/perso retirer` | Retire un perso du suivi |
| `/profil [@membre]` | Fiche complète : niveau, XP, temps joué, or, zone, équipement, métiers, réputations, historique des niveaux |
| `/session [@membre]` | Récap de la dernière session : durée, niveaux, or, zones |
| `/classement [critère]` | Niveau, temps joué, rythme (niveaux/heure), or, morts |
| `/confidentialite` | Masquer or, zone ou statut en ligne |
| `/quitter` | Supprime toutes les données du joueur |

### Commandes admin (permission Gérer le serveur)

| Commande | Rôle |
| --- | --- |
| `/setup` | Crée ou choisit les deux salons, pose les permissions, publie le message du tableau |
| `/config` | Événements logués, palier d'annonce de niveau (chaque niveau ou tous les 10), tri du tableau, fuseau |
| `/admin perso @membre prénom nom` | Ajoute un perso pour quelqu'un |
| `/admin rafraichir` | Reconstruit le tableau |

### Salon tableau (verrouillé)

- Personne n'écrit sauf le bot ; un seul message, édité à chaque changement.
- Une ligne par joueur : pastille en ligne/hors ligne, perso principal (classe, niveau, barre vers 60, zone), perso secondaire en dessous, dernière session.
- Tri par niveau du principal, puis temps joué ; pied de message avec l'heure de mise à jour.
- Si l'id du message est perdu ou le message supprimé, le bot le republie et mémorise le nouvel id.

### Salon logs

- Connexion : « Prénom Nom est en jeu » (via l'appli).
- Déconnexion : récap de session (durée, +N niveaux, or gagné, zone de fin).
- Niveau atteint, palier configurable ; message spécial au 60.
- Nouveau perso lié, mort (optionnel), changement de guilde.

### Règles de suivi

- Inscription volontaire : on ne suit que les joueurs qui font `/lier` ; données affichées seulement sur ton serveur.
- Un perso n'appartient qu'à un seul membre Discord ; la liaison Battle.net ou l'appli tranche les conflits.

## Architecture technique

Quatre pièces : un addon, une appli compagnon, un service hébergé (API d'ingestion + bot + worker Battle.net) et une base de données. L'appli est le seul chemin pour l'en ligne et le détail ; Battle.net sert à vérifier la propriété et de repli.

&#91;embedded content: architecture · PC du joueur, hébergement, Discord\]

L'appli pousse un état à chaque sauvegarde du jeu ; le bot ne lit que la base et regroupe ses éditions pour respecter les limites Discord.

### Flux d'une session

1. Le joueur lance le jeu : l'appli voit le processus et envoie « session ouverte » → log de connexion, pastille verte.
2. Il monte de niveau : l'addon horodate l'événement et propose un `/reload` hors combat → l'appli envoie → log du niveau, tableau mis à jour.
3. Il se déconnecte : le jeu écrit les SavedVariables, l'appli envoie l'état final puis « session fermée » → récap dans les logs, pastille grise.

### Envoi toutes les 10 à 15 minutes

Un envoi régulier est possible, mais des données fraîches à chaque envoi demandent un `/reload` automatique : le jeu n'écrit rien sur disque autrement.

- **Battement « en ligne »** : l'appli envoie toutes les 10-15 min « jeu ouvert, perso X » tant que le processus tourne. Aucun coût pour le joueur. Sans battement depuis 25 min, le bot passe le joueur hors ligne (utile si le PC plante).
- **Données fraîches** : l'addon propose un `/reload` hors combat toutes les 10-15 min, via une petite fenêtre « Synchroniser » ou une touche dédiée : ReloadUI() exige un clic ou une touche du joueur, donc aucun rechargement ne peut être 100 % automatique. L'appli envoie l'état quelques secondes après. Coût : un écran de chargement de quelques secondes ; à proposer en option dans l'addon (jamais en combat, en instance, en vol ou en file).
- **Sans `/reload` automatique** : l'appli renvoie le dernier état connu avec le battement ; niveau, or et zone ne bougent qu'aux sauvegardes du jeu.
- **API Battle.net** : l'interroger toutes les 10-15 min n'apporte rien, le profil ne change qu'à la déconnexion et le jeton joueur expire au bout de 24 h.

Côté bot, ce rythme est confortable : une édition du tableau par cycle reste loin de la limite de 5 éditions par 5 secondes.

### Modèle de données

| Table | Contenu clé |
| --- | --- |
| serveurs | id du serveur Discord, salon tableau, id(s) du message tableau, salon logs, config |
| joueurs | id Discord, préférences de confidentialité, date d'inscription |
| personnages | région, prénom, nom, ruleset, classe, race, faction, joueur, rôle principal/secondaire, id Blizzard si lié |
| appareils | joueur, empreinte du jeton d'appairage, dernière activité |
| snapshots | perso, horodatage, niveau, XP, or, temps joué, zone, détail JSON (équipement, métiers, réputations) |
| sessions | perso, début, fin, niveaux gagnés, or gagné, durée |
| evenements | type (connexion, niveau, mort, 60), perso, horodatage, données, publié ou non |

### Stack suggérée

- **Bot + API d'ingestion + callback OAuth** : TypeScript, discord.js, NestJS dans un même service ; PostgreSQL ; Docker derrière Caddy pour le HTTPS exigé par l'URL de redirection Battle.net.
- **Addon** : Lua, TOC `_Forever`, SavedVariables par personnage.
- **Appli compagnon** : Flutter desktop ou Tauri ; besoins = icône dans la barre système, surveillance de fichiers, détection de processus, démarrage avec Windows, mise à jour automatique.
- **Sécurité des envois** : jeton d'appareil propre à chaque joueur, jamais de mot de passe Battle.net.

## Contraintes Discord

Un message unique tient environ 35 à 40 joueurs ; au-delà, il faut paginer.

- **Verrouillage du salon tableau** : refuser à @everyone Envoyer des messages, Créer des fils et Ajouter des réactions ; autoriser au bot Voir le salon, Envoyer des messages, Intégrer des liens et Lire l'historique.
- **Format du tableau** : Components V2 (conteneurs, sections, texte) rend un tableau plus propre qu'un embed. Limites : 40 composants par message, 4 000 caractères de texte au total, et plus d'embed ni de contenu classique une fois le drapeau posé.
- **Capacité** : à \~100 caractères par joueur (principal + secondaire), 4 000 caractères ≈ 35-40 joueurs. Au-delà : deux messages, ou des boutons « page suivante » qui répondent en éphémère (les boutons fonctionnent même dans un salon verrouillé).
- **Rate limits** : 5 éditions de message par 5 secondes par salon, 50 requêtes/s au total pour le bot. Regrouper les changements et éditer au plus toutes les 10 à 15 secondes (debounce).
- **Logs** : 5 messages par 5 secondes par salon ; un pic de connexions doit passer par une file d'attente.
- **Commandes** : slash commands uniquement, aucun intent privilégié nécessaire (pas de lecture des messages). Une interaction doit répondre en 3 secondes, donc `defer` avant tout appel à l'API Blizzard.

## Risques et points ouverts

Le plus gros risque est l'adoption : chaque joueur doit installer un addon et une appli.

| Risque | Impact | Parade |
| --- | --- | --- |
| API Forever non documentée | Endpoints qui changent ou disparaissent ; le namespace statique versionné bouge à chaque patch | Utiliser les noms simples (`static-forever-eu`) et isoler l'API derrière un module ; ne jamais en dépendre pour le cœur du bot |
| Bug SavedVariables de la bêta | Le jeu écrivait les fichiers mais ne les rechargeait pas au démarrage ; donné pour corrigé, mais ForeverSVFix le disait encore actif | Le serveur garde tout l'historique ; l'addon n'envoie que l'état courant et les événements de la session, donc une remise à zéro locale ne perd rien |
| Joueurs sans appli | Pas d'en ligne, pas d'or, pas de zone | Repli sur l'API : niveau via OAuth (jeton 24 h), puis fiche publique quand elle ouvrira ; afficher « non synchronisé » |
| Triche | Les SavedVariables sont des fichiers locaux modifiables | Contrôles de vraisemblance (pas +10 niveaux en 5 min) et recoupement avec le niveau de l'API quand il existe |
| Windows seulement | Joueurs Mac exclus au départ | Prévoir l'appli multiplateforme dès le choix de la techno |
| Règles Blizzard sur les addons | Addon gratuit, code lisible, pas de pub en jeu | Addon open source, distribué gratuitement |
| Données personnelles | Temps de jeu et présence sont des données sur des personnes, et tu es en France | Inscription volontaire, `/quitter` qui efface tout, or et zone masquables |

Points à vérifier en jeu dès que possible : ce que l'addon lit vraiment (talents, métiers) sur le client live, l'apparition des persos niveau 10+ dans la fiche publique, et le nom exact du processus Forever.

## Plan de mise en place

Commencer par le bot et le tableau avec saisie manuelle, puis brancher l'addon : chaque phase est utilisable seule.

1. **Prérequis** : application Discord (token, slash commands), application sur develop.battle.net (client id/secret, URL de redirection OAuth sur ton domaine), base de données, hébergement du bot et de l'API d'ingestion.
2. **Bot squelette** : `/setup`, `/perso ajouter`, modèle de données, message unique du tableau avec debounce, salon logs. Niveaux saisis à la main pour tester l'affichage.
3. **Addon** : TOC `_Forever` en interface 16001 ; à chaque connexion, niveau, `/reload` et déco, il enregistre l'état du perso et les événements (niveau, mort, zone) dans ses SavedVariables. Proposition de `/reload` hors combat après un niveau.
4. **Appli compagnon** : appairage par code (`/lier appli`), surveillance du dossier WTF, détection du processus du jeu, envoi signé vers l'API d'ingestion, file locale si hors ligne.
5. **Liaison Battle.net** : `/lier battlenet` pour vérifier la propriété des persos et importer prénom/nom/niveau, repli pour ceux qui n'ont pas l'appli.
6. **Enrichissements** : `/profil` complet, `/session`, classements, rôles Discord par tranche de niveau, récap hebdo.
7. **Fiche publique** : dès que `/profile/wow/character/{prénom}-{nom}` répond, s'en servir pour équipement et « vu pour la dernière fois » sans appli.

## Sources

**API Blizzard et Forever**

- [WoW: Forever API notes (sondage communautaire, 4 nov. 19 h 15 UTC)](https://mhuijskens.com/WoWForever/Api/)
- [Forum Blizzard API : World of Warcraft: Forever API Namespace?](https://us.forums.blizzard.com/en/blizzard/t/world-of-warcraft-forever-api-namespace/59774)
- [GitHub wow-forever-mission-control #84 (état au 5 nov.)](https://github.com/BradGroux/wow-forever-mission-control/issues/84)
- [Forum Blizzard : OAuth API Refresh token?](https://us.forums.blizzard.com/en/blizzard/t/oauth-api-refresh-token/559)
- [Forum Blizzard : statut en ligne des membres de guilde](https://us.forums.blizzard.com/en/blizzard/t/is-it-possible-to-get-guild-members-online-status/11739)
- [Forum Blizzard : last\_login\_timestamp = dernière déconnexion](https://us.forums.blizzard.com/en/blizzard/t/wow-last-login-timestamp-and-api-performance/9028)
- [Support Blizzard : partager ses données avec les développeurs](https://us.support.blizzard.com/en/article/375447)
- [Documentation Profile APIs](https://community.developer.battle.net/documentation/world-of-warcraft/profile-apis)

**Le jeu**

- [Blizzard : Create a Name of Your Own in WoW: Forever](https://news.blizzard.com/en-us/article/24304161/wow)
- [Method : noms et rulesets](https://www.method.gg/wow-forever/choosing-your-character-name-and-ruleset-in-wow-forever)
- [Playnews : pas de serveur français](https://www.playnews.gg/guides/serveur-francais-wow-forever-y-en-a-t-il-un-et-ou-trouver-des-joueurs-francophones)

**Addons**

- [Warcraft Wiki : Patch 1.60.1 API changes](https://warcraft.wiki.gg/wiki/Patch_1.60.1/API_changes/notes)
- [ForeverSVFix](https://github.com/nobewayo/ForeverSVFix)
- [wowlab : SavedVariables sur Forever](https://github.com/sandgraal/wowlab/wiki/SavedVariables-and-Merging)
- [Politique Blizzard sur les addons (via Wowhead)](https://www.wowhead.com/news=320230/mythic-dungeon-tools-paywalled-dungeon-data-available-to-subscribers-only)

**Outils de référence**

- [Zoe](https://top.gg/bot/550737379460382752) · [Party Tracker](https://partytracker.app/) · [PatchVault](https://www.curseforge.com/wow/addons/patchvault) · [Jeeves Forever](https://www.jeeves.bot/docs/configuration/forever) · [ForeverDB armurerie](https://foreverdb.net/armory) · [ForeverDB bot](https://foreverdb.net/discord) · [GuildOS](https://www.curseforge.com/wow/addons/guild-os) · [aotc.gg Forever](https://www.aotc.gg/forever)

**Discord**

- [Components V2 (discord.py masterclass)](https://fallendeity.github.io/discord.py-masterclass/components-v2)
- [Rate limits Discord](https://space-node.net/blog/discord-api-rate-limits-explained-2026)
