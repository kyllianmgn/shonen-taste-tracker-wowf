# Spec technique — addon et appli compagnon

## Périmètre

Côté joueur, deux livrables : l'addon WoW **ForeverTracker** (nom de travail) et l'appli Windows **ForeverTracker Sync**. L'addon enregistre ; l'appli envoie. Le contrat réseau est défini dans l'onglet bot + serveur, section « Contrat d'échange ».

**L'addon fait** : lire l'état des personnages joués, horodater les événements (niveau, mort, donjon, session), les écrire dans ses SavedVariables, proposer une synchronisation toutes les 10-15 min.

**L'addon ne fait pas** : aucun accès réseau (impossible dans WoW), aucune lecture de données de combat (bloquées par les « secrets » sur Forever), aucune automatisation de gameplay.

**L'appli fait** : détecter que WoW Forever tourne, surveiller le fichier SavedVariables, le parser sans l'exécuter, envoyer battements et synchronisations au serveur, garder une file d'envoi hors ligne.

**L'appli ne fait pas** : modifier les fichiers du jeu, lire autre chose que le fichier de l'addon, demander un identifiant Battle.net.

Cibles : client WoW Forever 1.60.x (interface 16001), Windows 10/11 ; macOS en v2.

## Addon : structure et identité

### Fichiers

```
ForeverTracker/
  ForeverTracker.toc
  Core.lua        -- init, enregistrement des événements, accès à la DB
  Collect.lua     -- construction du snapshot
  Journal.lua     -- événements horodatés
  Sync.lua        -- minuteur, fenêtre Synchroniser, ReloadUI
  Commands.lua    -- /ftr
  Bindings.xml    -- touche « Synchroniser maintenant »
  Locales/frFR.lua, Locales/enUS.lua
```

### TOC

```
## Interface: 16001
## Title: ForeverTracker
## Notes: Suit tes personnages pour le bot Discord
## Version: 0.1.0
## SavedVariables: ForeverTrackerDB
Locales/enUS.lua
Locales/frFR.lua
Core.lua
Collect.lua
Journal.lua
Sync.lua
Commands.lua
Bindings.xml
```

- Une seule variable sauvegardée **par compte** (`ForeverTrackerDB`), indexée par GUID de personnage : l'appli n'a qu'un fichier à surveiller, `_forever_/WTF/Account/<COMPTE>/SavedVariables/ForeverTracker.lua`.
- Si un jour l'addon vise plusieurs versions du jeu, renommer en `ForeverTracker_Forever.toc` (suffixe accepté par le client).
- Code lisible, non obfusqué, distribué gratuitement (politique addons Blizzard).

### Identité du personnage

| Donnée | Appel | Remarque |
| --- | --- | --- |
| Prénom, nom | `local first, surname = UnitName("player")` | Sur Forever le 2e retour est le **nom de famille**, pas le royaume |
| Nom complet | `GetUnitName("player")` | « Prénom Nom » en une chaîne |
| Clé stable | `UnitGUID("player")` | Clé de la table `characters` |
| Région | `GetCurrentRegion()` | 1 US, 2 KR, 3 EU, 4 TW, 5 CN → envoyer `"eu"` etc. |
| Royaume interne | `GetRealmName()` | Envoyé brut ; le serveur en déduit le ruleset |
| Noms régionaux actifs | `RegionalUniqueNamesEnabled()` | Doit valoir `true` sur Forever ; sinon journaliser un avertissement |

La clé côté serveur reste **région + prénom + nom** ; le GUID sert de contrôle de cohérence.

## Addon : données et événements

Le client Forever expose l'API Mainline 12.1.5 ; chaque appel marqué « à vérifier » doit être protégé par un test d'existence (`if C_Reputation and C_Reputation.GetFactionDataByIndex then`) et ne jamais faire planter l'addon.

### Snapshot (état courant)

Recalculé à la connexion, à chaque événement listé, et juste avant toute synchronisation.

| Champ | Appel WoW | Mis à jour sur | Statut |
| --- | --- | --- | --- |
| `level` | `UnitLevel("player")` | `PLAYER_LEVEL_UP`, `PLAYER_LOGIN` | Sûr |
| `xp`, `xpMax`, `rested` | `UnitXP`, `UnitXPMax`, `GetXPExhaustion` | `PLAYER_XP_UPDATE` | Sûr |
| `money` (cuivre) | `GetMoney()` | `PLAYER_MONEY` | Sûr |
| `playedTotal`, `playedLevel` (s) | `RequestTimePlayed()` → `TIME_PLAYED_MSG` | Connexion, niveau, avant synchro (max 1 fois / 5 min) | Sûr ; masquer le message de chat est optionnel |
| `zone`, `subZone`, `mapId` | `GetRealZoneText`, `GetSubZoneText`, `C_Map.GetBestMapForUnit("player")` | `ZONE_CHANGED_NEW_AREA` | Sûr |
| `class`, `race`, `sex`, `faction` | `UnitClass`, `UnitRace`, `UnitSex`, `UnitFactionGroup` | `PLAYER_LOGIN` | Sûr (valeurs non localisées : `classFile`, `raceFile`) |
| `guild`, `guildRank` | `GetGuildInfo("player")` | `PLAYER_GUILD_UPDATE` | Sûr |
| `equipment[]` (slot, itemId, lien) | `GetInventoryItemLink("player", 1..19)` | `PLAYER_EQUIPMENT_CHANGED` | Sûr |
| `ilvl` | `GetAverageItemLevel()` | idem | À vérifier |
| `professions[]` (nom, rang, max) | `GetProfessions` + `GetProfessionInfo`, sinon `GetNumSkillLines` + `GetSkillLineInfo` | `SKILL_LINES_CHANGED` | À vérifier |
| `reputations[]` | `C_Reputation.GetNumFactions` + `GetFactionDataByIndex` | `UPDATE_FACTION` | À vérifier |
| `honor` | `UnitHonor("player")` | `HONOR_XP_UPDATE` | À vérifier |
| `deaths` (compteur) | incrémenté par l'addon | `PLAYER_DEAD` | Sûr |
| `capturedAt` | `GetServerTime()` | à chaque calcul | Sûr |

Lecture des appels « à vérifier » (A-03) : chaque API est cherchée au moment de l'appel et appelée sous `pcall` ; si elle manque, lève une erreur ou renvoie une valeur inutilisable, le champ est absent du snapshot.

- `ilvl` : moyenne équipée (2ᵉ retour de `GetAverageItemLevel`), sinon la moyenne globale, arrondie à l'entier inférieur.
- `professions[]` : `GetProfessions` + `GetProfessionInfo` ; si ce chemin échoue ou ne renvoie rien, les lignes de `GetSkillLineInfo` rangées sous les en-têtes `TRADE_SKILLS` et `SECONDARY_SKILLS` (chaînes localisées du client ; armes et langues ignorées). 20 métiers au plus.
- `reputations[]` : les factions visibles dans le panneau Réputation (le contenu d'un en-tête replié n'est pas lu), en-têtes sans réputation ignorés ; `standing` = `reaction`, `value` et `max` relatifs au palier courant. 200 au plus.
- `honor` : entier positif ou nul de `UnitHonor("player")`.
- Avec `/ftr debug on`, la connexion affiche pour chaque API « trouvée », « absente » ou « trouvée, erreur à l'appel », et la source des métiers (`ns.ReportGuardedApis()`), pour la checklist en jeu de A-07.

Talents : hors périmètre v1 (illisibles sur Forever pendant le stress test).

### Journal d'événements

Chaque événement : `{ id, type, at, data }`. `at` = `GetServerTime()`. `id` = `<GUID>-<at>-<compteur>` (compteur incrémenté en mémoire), unique pour la déduplication serveur. Maximum 300 événements par perso, les plus anciens supprimés.

| Type | Déclencheur | `data` |
| --- | --- | --- |
| `SESSION_START` | `PLAYER_LOGIN` | `level`, `zone` |
| `SESSION_END` | `PLAYER_LOGOUT` | `level`, `playedTotal`, `money` |
| `LEVEL_UP` | `PLAYER_LEVEL_UP` | `level`, `playedTotal` (après le `TIME_PLAYED_MSG` suivant), `zone` |
| `DEATH` | `PLAYER_DEAD` | `level`, `zone` |
| `DUNGEON_ENTER` | `PLAYER_ENTERING_WORLD` / `ZONE_CHANGED_NEW_AREA` avec `IsInInstance()` de type `party` ou `raid`, instance différente de la précédente | `instanceName`, `instanceId` (via `GetInstanceInfo()`) |
| `GUILD_CHANGE` | `PLAYER_GUILD_UPDATE` si le nom change | `from`, `to` |
| `PROFESSION_TIER` | rang d'un métier franchit 75, 150, 225 ou 300 | `name`, `rank` |

Détails d'implémentation (A-04) :

- Les champs absents restent absents de `data` (ex. `GUILD_CHANGE` sans `from` à l'entrée dans une première guilde, sans `to` au départ).
- `SESSION_START` / `SESSION_END` suivent `PLAYER_LOGIN` / `PLAYER_LOGOUT`, donc chaque `/reload` (synchronisation comprise) produit aussi une paire ; `SESSION_END.playedTotal` est la dernière valeur connue du snapshot.
- `LEVEL_UP` en attente de `playedTotal` est gardé en mémoire : si l'interface est rechargée avant le `TIME_PLAYED_MSG` suivant, l'événement part sans `playedTotal`.
- « Instance précédente » de `DUNGEON_ENTER` = le dernier `DUNGEON_ENTER` du journal du perso, ce qui tient aussi après un `/reload`.
- `GUILD_CHANGE` et `PROFESSION_TIER` comparent à la guilde et aux rangs du snapshot sauvegardé (session précédente), sinon à ceux lus à la connexion. Tant que `IsInGuild()` est vrai mais que `GetGuildInfo()` ne renvoie rien (infos de guilde pas encore chargées), aucun changement n'est enregistré. Un métier vu pour la première fois sert de référence sans événement.
- Un saut qui franchit plusieurs seuils d'un coup donne un seul `PROFESSION_TIER` avec le rang atteint.

## Addon : synchronisation et commandes

Le jeu n'écrit les SavedVariables qu'à la déconnexion, à la sortie ou au rechargement de l'interface, et `ReloadUI()` n'est accepté qu'en réponse à un clic ou une touche. L'addon **propose** donc la synchronisation ; il ne l'impose jamais.

### Règles

1. À chaque `PLAYER_LOGIN`, `lastSaveAt = GetServerTime()` (une connexion ou un rechargement vient d'écrire le fichier).
2. Un `C_Timer.NewTicker(30, …)` vérifie : `GetServerTime() - lastSaveAt >= interval` (défaut 15 min ; choix 10, 15, 30, off).
3. Si c'est le cas et que les conditions sûres sont réunies, afficher la fenêtre **Synchroniser** : texte « Envoyer ta progression au bot ? (2-3 s de chargement) », boutons **Synchroniser** (appelle `ReloadUI()`) et **Plus tard** (repousse de 5 min), case « Ne plus demander cette session ».
4. Après un `LEVEL_UP`, proposer la même fenêtre dès que les conditions sont réunies (option activée par défaut).
5. Masquer la fenêtre dès `PLAYER_REGEN_DISABLED` (entrée en combat).
6. Jamais d'appel à `ReloadUI()` hors clic, touche ou commande tapée.

Conditions sûres (toutes vraies) : `not InCombatLockdown()`, `not UnitAffectingCombat("player")`, `not IsInInstance()`, `not UnitOnTaxi("player")`, `not UnitIsDeadOrGhost("player")`, pas de sort en cours d'incantation.

Raccourci : `Bindings.xml` déclare une action « ForeverTracker : synchroniser maintenant » que le joueur assigne à une touche ; elle appelle `ReloadUI()` si les conditions sont réunies.

Détails d'implémentation (A-05) :

- Le seul `ReloadUI()` de l'addon est dans `ns.SyncNow()` (`Sync.lua`), appelé par le bouton **Synchroniser**, la touche (`FOREVERTRACKER_SYNC`, fonction globale `ForeverTracker_SyncNow`) et `/ftr sync`. Il revérifie les conditions, recalcule le snapshot, puis recharge ; sinon il écrit la raison dans le chat (« Synchronisation impossible : tu es en combat. »).
- `UnitCastingInfo` / `UnitChannelInfo` (sort en cours) et les autres appels des conditions sont cherchés au moment de l'appel : une API absente compte comme une condition remplie.
- Le minuteur démarre au `PLAYER_LOGIN` et relit `settings.interval` à chaque passage : un `/ftr interval` s'applique sans recharger.
- Toute fermeture hors combat (**Plus tard** ou la croix du cadre) repousse de 5 min et annule la fenêtre de niveau en attente ; un `LEVEL_UP` pendant ces 5 min attend leur fin. Si la case est cochée à ce moment, plus aucune fenêtre (intervalle ni niveau) jusqu'au prochain rechargement : le choix n'est pas sauvegardé.
- `PLAYER_REGEN_DISABLED` masque la fenêtre sans la repousser : elle revient au premier passage du minuteur (ou à `PLAYER_REGEN_ENABLED`) où les conditions sont réunies.
- À l'affichage, la fenêtre demande `/played` (`ns.RequestPlayed()`, limité à 1 fois / 5 min) pour que `playedTotal` soit à jour au moment du clic.
- La fenêtre n'a pas de nom global (Échap ne la ferme pas) : les seules globales de l'addon sont `ForeverTrackerDB`, `SLASH_FTR1`, `BINDING_HEADER_FOREVERTRACKER`, `BINDING_NAME_FOREVERTRACKER_SYNC` et `ForeverTracker_SyncNow`. Modèles de cadres utilisés, à contrôler en jeu (A-07) : `BasicFrameTemplateWithInset`, `UIPanelButtonTemplate`, `UICheckButtonTemplate`.

### Commandes `/ftr`

| Commande | Effet |
| --- | --- |
| `/ftr` ou `/ftr status` | Perso, dernière sauvegarde, intervalle, événements en attente |
| `/ftr sync` | Synchronise tout de suite (`ReloadUI()`) si les conditions sont réunies |
| `/ftr interval 10\|15\|30\|off` | Fréquence de la fenêtre Synchroniser |
| `/ftr levelprompt on\|off` | Fenêtre après chaque niveau |
| `/ftr debug on\|off` | Messages de diagnostic dans le chat |
| `/ftr reset` | Vide le journal du perso courant, après confirmation |

Les réglages vivent dans `ForeverTrackerDB.settings` (communs à tous les persos du compte).

Détails d'implémentation (A-05) :

- Sous-commande insensible à la casse ; `/ftr help` liste les commandes, une sous-commande inconnue affiche « Commande inconnue » puis la liste. Une valeur hors liste (`/ftr interval 7`) ne change rien et rappelle l'utilisation.
- Ajouter une sous-commande : `ns.RegisterCommand(nom, handler, aide, arguments)` ; `handler` reçoit le reste de la ligne, sans espaces autour (A-06 y ajoute `share`).
- « Événements en attente » = événements du perso enregistrés depuis la dernière écriture du fichier, c'est-à-dire après le dernier événement lu dans les SavedVariables au chargement (tous si celui-ci a été retiré par le plafond de 300).
- « Dernière sauvegarde » = minutes écoulées depuis le `PLAYER_LOGIN` (règle 1).
- `/ftr reset` ouvre une `StaticPopup` (**Vider** / **Annuler**) ; seul **Vider** remplace `events` du perso courant par une table vide, les autres persos ne changent pas.

### Mode de base : `/ftr share`

Pour les joueurs sans appli. `/ftr share` ouvre une fenêtre avec une zone de texte sélectionnée, prête à copier, contenant le code du perso courant à coller dans `/sync code:` sur Discord.

- Contenu : `key`, `snapshot` et les événements du perso depuis le dernier partage (champ `lastSharedAt` dans les SavedVariables).
- Encodage : JSON (sérialiseur maison simple) → deflate brut avec LibDeflate (`CompressDeflate`) → base64url (encodeur Lua maison) → préfixe `FT1:`.
- Taille visée : moins de 4 000 caractères ; au-delà, retirer `equipment` puis `reputations` et le signaler dans la fenêtre.
- Alternative sans copier-coller : joindre le fichier `ForeverTracker.lua` à `/sync fichier:`.

## Addon : format des SavedVariables

C'est le contrat entre l'addon et l'appli. Tout changement incompatible incrémente `schema` ; l'appli refuse un `schema` qu'elle ne connaît pas et le signale.

```lua
ForeverTrackerDB = {
  ["schema"] = 1,
  ["addonVersion"] = "0.1.0",
  ["settings"] = { ["interval"] = 15, ["levelPrompt"] = true, ["debug"] = false },
  ["characters"] = {
    ["Player-4242-0A1B2C3D"] = {
      ["key"] = { ["region"] = "eu", ["firstName"] = "Davina", ["surname"] = "Asaria",
                  ["guid"] = "Player-4242-0A1B2C3D", ["realmName"] = "CAMWOW EU5 Realm 1 PvE" },
      ["snapshot"] = {
        ["capturedAt"] = 1793900000, ["level"] = 23, ["xp"] = 4120, ["xpMax"] = 13600, ["rested"] = 2100,
        ["money"] = 384512, ["playedTotal"] = 81234, ["playedLevel"] = 2310,
        ["zone"] = "Duskwood", ["subZone"] = "Darkshire", ["mapId"] = 1431,
        ["classFile"] = "PRIEST", ["raceFile"] = "Troll", ["sex"] = 3, ["faction"] = "Horde",
        ["guild"] = "Les Veilleurs", ["guildRank"] = "Membre", ["ilvl"] = 21, ["deaths"] = 4, ["honor"] = 0,
        ["equipment"] = { { ["slot"] = 1, ["itemId"] = 7720, ["link"] = "|cff1eff00|Hitem:7720::...|h[...]|h|r" } },
        ["professions"] = { { ["name"] = "Herboristerie", ["rank"] = 112, ["max"] = 150 } },
        ["reputations"] = { { ["factionId"] = 76, ["name"] = "Orgrimmar", ["standing"] = 5, ["value"] = 1200, ["max"] = 6000 } }
      },
      ["events"] = {
        { ["id"] = "Player-4242-0A1B2C3D-1793899000-1", ["type"] = "SESSION_START", ["at"] = 1793899000,
          ["data"] = { ["level"] = 22, ["zone"] = "Duskwood" } },
        { ["id"] = "Player-4242-0A1B2C3D-1793899800-2", ["type"] = "LEVEL_UP", ["at"] = 1793899800,
          ["data"] = { ["level"] = 23, ["playedTotal"] = 80900, ["zone"] = "Duskwood" } }
      }
    }
  }
}
```

Valeurs d'exemple, pas des données réelles. Règles :

- Les clés de premier niveau de `characters` sont des GUID ; `key` reprend l'identité complète.
- `money` en cuivre, durées en secondes, horodatages en secondes Unix serveur.
- Le fichier peut être rechargé vide par le client (bug de chargement vu en bêta) : l'addon recrée alors la structure sans erreur, et le serveur reste la source de l'historique.
- Pas de fonction, de référence circulaire ni de clé non-chaîne/non-entier : le parseur de l'appli n'a pas à gérer plus que des tables, chaînes, nombres et booléens.

## Appli compagnon (ForeverTracker Sync)

Une appli de barre système Windows, sans fenêtre principale, qui transforme le fichier de l'addon en appels HTTPS. Stack suggérée : Flutter desktop ou Tauri.

Expérience joueur : une seule fenêtre au premier lancement (dossier du jeu détecté, code d'appairage, « Démarrer avec Windows »), puis l'appli tourne en silence dans la barre système. Le joueur ne la rouvre que pour voir le statut ou en cas d'erreur. L'appli est facultative : sans elle, le joueur est en mode de base (onglet bot + serveur).

### Premier lancement

1. Trouver le dossier du jeu : essayer `C:\Program Files (x86)\World of Warcraft\_forever_` puis `C:\Program Files\World of Warcraft\_forever_` ; sinon demander au joueur de choisir son dossier World of Warcraft. Valider la présence de `_forever_\WTF`.
2. Appairage : le joueur tape le code obtenu avec `/lier appli` → `POST /v1/devices/pair` → stocker le `deviceToken` dans le Gestionnaire d'identifiants Windows, jamais en clair.
3. Lister les fichiers `_forever_\WTF\Account\*\SavedVariables\ForeverTracker.lua` (plusieurs comptes possibles).
4. Proposer « Démarrer avec Windows » (activé par défaut).

### Détection du jeu

- Toutes les 5 s, chercher un processus dont l'exécutable est dans le dossier `_forever_` (nom attendu `Wow.exe` ou `Wow-arm64.exe`, à vérifier sur une install réelle).
- Passage arrêté → lancé : battement immédiat `gameRunning: true`. Passage lancé → arrêté : battement immédiat `gameRunning: false`, puis attendre jusqu'à 60 s la réécriture du fichier pour envoyer la synchro finale.

### Lecture du fichier

- Surveiller les dossiers SavedVariables (watcher système + repli par lecture de la date de modification toutes les 10 s).
- Sur changement : attendre que taille et date soient stables pendant 2 s (le jeu écrit en plusieurs fois), puis lire.
- **Ne jamais exécuter le Lua.** Parser la table avec un petit parseur de littéraux (tables, chaînes avec échappements, nombres, booléens, `nil`) : `luaparse` en JS, ou un parseur récursif d'une centaine de lignes en Dart/Rust.
- Pour chaque perso : envoyer le snapshot si `capturedAt` > dernier envoyé, et les événements dont l'`id` n'est pas dans l'ensemble des ids déjà envoyés (1 000 derniers gardés localement ; le serveur déduplique de toute façon).
- `schema` inconnu : ne rien envoyer, icône orange, message « mets à jour l'appli ».

### Envois

- **Battement** : toutes les `heartbeatIntervalSec` (600 s par défaut, valeur renvoyée par le serveur) tant que le jeu tourne, plus aux changements d'état. Contient le dernier perso vu (le plus récent `SESSION_START`).
- **Synchro** : à chaque changement utile du fichier, au plus une toutes les 30 s.
- Format exact : onglet bot + serveur, « Contrat d'échange ».

### File hors ligne

- Toute requête échouée (réseau, 5xx, 429) est écrite dans `%APPDATA%\ForeverTrackerSync\queue\` puis rejouée avec un délai croissant : 5 s, 30 s, 2 min, puis toutes les 10 min.
- Les battements de plus de 30 min sont jetés ; les synchros sont gardées jusqu'à 7 jours.
- `401` : jeton révoqué → arrêter les envois, notifier « réappaire l'appli avec /lier appli ».

### Interface

- Icône : verte (jeu détecté, dernier envoi OK), grise (jeu fermé), orange (erreur).
- Menu : statut (perso, dernière synchro, serveur), Synchroniser maintenant (relit et renvoie), Appairer / Délier, Démarrer avec Windows, Ouvrir les logs, Quitter.
- Notifications Windows uniquement pour les erreurs bloquantes.
- Mise à jour automatique au démarrage (releases GitHub signées).
- Logs locaux tournants, sans jeton ni contenu de fichier complet.

## Critères d'acceptation côté joueur

À vérifier en jeu sur le client live, pas seulement avec des stubs.

- [ ] L'addon se charge sans « obsolète » ni erreur Lua sur Forever 1.60.x.
- [ ] `/ftr status` affiche le bon prénom, nom, région et niveau.
- [ ] Après une déconnexion, `ForeverTracker.lua` contient le snapshot et les événements `SESSION_START` et `SESSION_END` de la session.
- [ ] Un passage de niveau produit un `LEVEL_UP` avec le bon niveau, puis la fenêtre Synchroniser hors combat.
- [ ] La fenêtre n'apparaît jamais en combat, en instance, en vol ou mort, et disparaît si un combat commence.
- [ ] Aucun `ReloadUI()` sans clic, touche ou commande.
- [ ] Un fichier rechargé vide ne provoque aucune erreur.
- [ ] Chaque appel marqué « à vérifier » a été testé ; le résultat est noté dans le README.
- [ ] L'appli détecte le lancement et l'arrêt du jeu en moins de 10 s.
- [ ] Une synchro arrive au serveur moins de 10 s après un `/reload`.
- [ ] Avec le réseau coupé, les synchros sont mises en file puis envoyées au retour du réseau, sans doublon côté serveur.
- [ ] Le jeton n'apparaît ni dans les logs ni dans un fichier en clair.
- [ ] Le Lua du fichier n'est jamais exécuté (test avec un fichier piégé contenant un appel de fonction).
