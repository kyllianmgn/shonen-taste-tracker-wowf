# Checklist de validation en jeu (A-07)

À dérouler sur le client live WoW: Forever 1.60.x, pas avec les stubs. Sources : docs/01, sections « Addon : données et événements » et « Critères d'acceptation côté joueur ».

Chaque ligne a un identifiant (`2.3`) : pour rendre les résultats, recopie l'identifiant, **OK** / **KO** et ce que le chat a affiché (une capture d'écran convient aussi). Les résultats des appels « à vérifier » (section 2) vont ensuite dans le tableau de [addon/README.md](../addon/README.md#résultats-des-appels-à-vérifier).

## 0. Préparation

- [ ] **0.1** Installe l'addon depuis le zip de release : `./tools/package-addon.ps1`, puis décompresse `release/ForeverTracker-<version>.zip` dans `World of Warcraft\_forever_\Interface\AddOns\` (ou `./tools/link-addon.ps1` pour pointer vers le dépôt). Tu dois obtenir `...\AddOns\ForeverTracker\ForeverTracker.toc`.
- [ ] **0.2** Affiche les erreurs Lua : `/console scriptErrors 1` (une seule fois, réglage conservé).
- [ ] **0.3** Active les diagnostics de l'addon : `/ftr debug on`, puis `/reload`.
- [ ] **0.4** Crée une macro « FT » avec le texte ci-dessous et lance-la après chaque `/reload` ou connexion. Elle crée une variable `FT` dans ta session (pas dans l'addon) qui pointe vers l'entrée du perso courant, pour raccourcir les `/dump` :
  ```
  /run FT=ForeverTrackerDB.characters[UnitGUID("player")] print("FT prêt", FT and FT.key.firstName)
  ```
  Attendu : `FT prêt <ton prénom>`. La table `ns` de l'addon est privée : `/dump ns...` ne marche pas, passe toujours par `ForeverTrackerDB`, `FT` ou les API du jeu.
- [ ] **0.5** Repère le fichier `World of Warcraft\_forever_\WTF\Account\<COMPTE>\SavedVariables\ForeverTracker.lua`. Ouvre-le seulement avec un éditeur de texte (Bloc-notes), jeu fermé ou perso déconnecté.
- [ ] **0.6** Pour les tests de la section 3 : un perso à quelques centaines de points d'XP d'un niveau, une pierre de foyer, un maître de vol à portée et un donjon accessible.

## 1. Chargement et identité

- [ ] **1.1** Critère : *l'addon se charge sans « obsolète » ni erreur Lua.*
  - Action : écran de sélection des persos → bouton AddOns ; puis entre en jeu.
  - Attendu : ForeverTracker coché, sans mention « Obsolète » ; aucune fenêtre d'erreur Lua à l'entrée en jeu ni après `/reload`.
  - Commandes : `/dump select(4, GetBuildInfo())` → `16001` ; `/dump C_AddOns.GetAddOnMetadata("ForeverTracker", "Version")` → `"0.1.0"` ; `/dump C_AddOns.IsAddOnLoaded("ForeverTracker")` → `true`.
  - Résultat :
- [ ] **1.2** Critère : *`/ftr status` affiche le bon prénom, nom, région et niveau.*
  - Commande : `/ftr status`
  - Attendu : 4 lignes : `Perso : <Prénom> <Nom> (niveau <N>)`, `Dernière sauvegarde : il y a <m> min`, `Fenêtre Synchroniser : toutes les 15 min`, `Événements en attente : <n>`.
  - Écart connu : la région n'est pas affichée par `/ftr status` (seulement enregistrée dans `key.region`). Vérifie-la avec 1.4 et dis si elle doit apparaître dans `/ftr status` (changement de code dans une tâche suivante).
  - Résultat :
- [ ] **1.3** Identité brute (remarques de la spec « Identité du personnage »).
  - Commandes : `/dump UnitName("player")` → 2 valeurs : prénom, puis **nom de famille** (pas le royaume) ; `/dump GetUnitName("player")` → `"Prénom Nom"` ; `/dump UnitGUID("player")` → `"Player-…"` ; `/dump GetCurrentRegion()` → `3` (EU) ; `/dump GetRealmName()` → nom interne du royaume ; `/dump RegionalUniqueNamesEnabled()` → `true`.
  - Attendu : comme ci-dessus. Si `RegionalUniqueNamesEnabled()` vaut `false`, le chat a dû afficher à la connexion (debug on) « les noms uniques régionaux sont désactivés… ».
  - Résultat :
- [ ] **1.4** Clé enregistrée par l'addon.
  - Commande (macro FT lancée) : `/dump FT.key`
  - Attendu : `region = "eu"`, `firstName` et `surname` identiques à 1.3, `guid` = `UnitGUID("player")`, `realmName` = `GetRealmName()`.
  - Résultat :
- [ ] **1.5** Snapshot « sûr ».
  - Commande : `/dump FT.snapshot`
  - Attendu : `level`, `xp`, `xpMax`, `rested`, `money` (en cuivre, = `GetMoney()`), `playedTotal` / `playedLevel` (= `/played`), `zone`, `subZone`, `mapId` (nombre), `classFile` / `raceFile` non localisés (`"PRIEST"`, `"Troll"`…), `sex`, `faction`, `guild` / `guildRank` si tu es en guilde, `equipment` (une entrée par objet porté, avec `slot`, `itemId`, `link`), `deaths`, `capturedAt` (≈ `/dump GetServerTime()`).
  - Résultat :

## 2. Appels « à vérifier »

Avec `/ftr debug on`, chaque connexion ou `/reload` affiche « API à vérifier sur ce client : » puis une ligne par API : `API <nom> : trouvée` / `absente` / `trouvée, erreur à l'appel`, et `métiers lus via <API>`. Recopie ce rapport tel quel (2.1), puis contrôle les valeurs une par une.

- [ ] **2.1** Rapport de connexion.
  - Commandes : `/ftr debug on`, `/reload`
  - Attendu : 8 lignes `API … :` (`GetAverageItemLevel`, `GetProfessions`, `GetProfessionInfo`, `GetNumSkillLines`, `GetSkillLineInfo`, `C_Reputation.GetNumFactions`, `C_Reputation.GetFactionDataByIndex`, `UnitHonor`) et une ligne `métiers lus via …` ou `métiers : aucune API utilisable`. Aucune erreur Lua quelle que soit la réponse.
  - Résultat :
- [ ] **2.2** `ilvl` — `GetAverageItemLevel()`
  - Commandes : `/dump GetAverageItemLevel()` puis `/dump FT.snapshot.ilvl`
  - Attendu : 2 nombres (moyenne globale, moyenne équipée) ; `ilvl` = 2ᵉ valeur arrondie à l'entier inférieur, égal au niveau d'objet de la feuille de perso. Change une pièce d'équipement : `ilvl` suit.
  - Résultat :
- [ ] **2.3** `professions` — chemin Mainline `GetProfessions` + `GetProfessionInfo`
  - Commandes : `/dump GetProfessions()` puis `/dump GetProfessionInfo((GetProfessions()))`
  - Attendu : `GetProfessions()` renvoie jusqu'à 5 index (métier 1, métier 2, archéologie, pêche, cuisine ; `nil` si absent). `GetProfessionInfo` renvoie le nom (1ʳᵉ valeur), l'icône, le rang (3ᵉ) et le max (4ᵉ).
  - Résultat :
- [ ] **2.4** `professions` — chemin Classic `GetNumSkillLines` + `GetSkillLineInfo`
  - Commandes : `/dump GetNumSkillLines()`, `/dump GetSkillLineInfo(1)`, `/dump TRADE_SKILLS, SECONDARY_SKILLS`
  - Attendu : un nombre de lignes > 0 ; `GetSkillLineInfo(i)` renvoie nom, en-tête (booléen), déplié, rang (4ᵉ valeur), …, max (7ᵉ valeur) ; les deux constantes valent les titres d'en-têtes de la fenêtre Compétences (« Métiers », « Compétences secondaires » en frFR). Si ces API sont absentes, note-le simplement.
  - Résultat :
- [ ] **2.5** `professions` — valeur enregistrée
  - Commande : `/dump FT.snapshot.professions`
  - Attendu : une entrée `{ name, rank, max }` par métier principal et secondaire (pas d'armes ni de langues), rangs identiques à la fenêtre Métiers. Monte un métier d'un point : `rank` suit (événement `SKILL_LINES_CHANGED`). La source utilisée est celle de la ligne `métiers lus via …` de 2.1.
  - Résultat :
- [ ] **2.6** `reputations` — `C_Reputation.GetNumFactions` + `C_Reputation.GetFactionDataByIndex`
  - Commandes : `/dump C_Reputation.GetNumFactions()`, `/dump C_Reputation.GetFactionDataByIndex(2)`
  - Attendu : un nombre ; une table avec au moins `factionID`, `name`, `reaction`, `currentStanding`, `currentReactionThreshold`, `nextReactionThreshold`, `isHeader`, `isHeaderWithRep`. Note les champs absents ou nommés autrement.
  - Résultat :
- [ ] **2.7** `reputations` — valeur enregistrée
  - Commandes : `/dump #FT.snapshot.reputations`, `/dump FT.snapshot.reputations[1]`
  - Attendu : une entrée par faction visible dans le panneau Réputation (en-têtes sans réputation exclus, contenu d'un en-tête replié non lu) ; `standing` = palier (5 = Amical), `value` / `max` = progression dans le palier comme dans le panneau (ex. 1200 / 6000). Gagne de la réputation : la valeur suit après `UPDATE_FACTION`.
  - Résultat :
- [ ] **2.8** `honor` — `UnitHonor("player")`
  - Commandes : `/dump UnitHonor("player")`, `/dump FT.snapshot.honor`
  - Attendu : un entier ≥ 0, identique dans les deux ; si l'API est absente, `honor` n'est pas dans le snapshot (`nil`) et rien ne plante.
  - Résultat :
- [ ] **2.9** Modèles de cadres utilisés par les fenêtres.
  - Commandes : `/dump C_XMLUtil.GetTemplateInfo("BasicFrameTemplateWithInset")`, puis la même chose avec `"UIPanelButtonTemplate"`, `"UICheckButtonTemplate"` et `"UIPanelScrollFrameTemplate"`
  - Attendu : une table (type, largeur, hauteur) pour chacun, pas `nil`. Contrôle visuel en 3.3 (fenêtre Synchroniser : cadre avec titre et croix, 2 boutons, case à cocher) et 4.6 (fenêtre `/ftr share` : zone de texte avec barre de défilement).
  - Résultat :
- [ ] **2.10** API des conditions sûres (une API absente compte comme une condition remplie).
  - Commandes : `/dump InCombatLockdown(), UnitAffectingCombat("player"), IsInInstance(), UnitOnTaxi("player"), UnitIsDeadOrGhost("player"), UnitCastingInfo("player"), UnitChannelInfo("player")`
  - Attendu : hors combat, dehors, à pied, vivant, sans incantation : `false false false false false nil nil` (pas d'erreur « attempt to call a nil value »).
  - Résultat :
- [ ] **2.11** Temps joué : `RequestTimePlayed()` / `TIME_PLAYED_MSG`.
  - Commandes : `/played`, puis `/dump FT.snapshot.playedTotal, FT.snapshot.playedLevel`
  - Attendu : les deux valeurs (en secondes) correspondent au message de `/played`.
  - Résultat :

## 3. Journal et fenêtre Synchroniser

- [ ] **3.1** Critère : *après une déconnexion, `ForeverTracker.lua` contient le snapshot et les événements `SESSION_START` et `SESSION_END` de la session.*
  - Action : connecte-toi, joue 2-3 min, déconnecte-toi (`/camp`), puis ouvre le fichier (0.5).
  - Attendu : `["schema"] = 1`, `["addonVersion"] = "0.1.0"`, `characters["Player-…"]` avec `key`, `snapshot` rempli (comme 1.5) et, en fin de `events`, un `SESSION_START` (`level`, `zone`) puis un `SESSION_END` (`level`, `playedTotal`, `money`), avec des `id` de la forme `<GUID>-<at>-<n>`.
  - En jeu, après reconnexion : `/dump FT.events[#FT.events]` → le `SESSION_START` qui vient d'être créé.
  - Résultat :
- [ ] **3.2** Critère : *un passage de niveau produit un `LEVEL_UP` avec le bon niveau.*
  - Action : prends un niveau hors combat (rends une quête).
  - Commande : `/dump FT.events[#FT.events]` (si un autre événement s'est ajouté entre-temps, `/dump FT.events[#FT.events - 1]`)
  - Attendu : `type = "LEVEL_UP"`, `data.level` = nouveau niveau, `data.zone`, et `data.playedTotal` rempli une fois le message de temps joué apparu dans le chat. `/dump FT.snapshot.level` = nouveau niveau.
  - Résultat :
- [ ] **3.3** Critère : *… puis la fenêtre Synchroniser hors combat.*
  - Attendu : dans les 30 s suivant le niveau, la fenêtre « Envoyer ta progression au bot ? (2-3 s de chargement) » avec **Synchroniser**, **Plus tard** et la case « Ne plus demander cette session ». Si le niveau tombe en combat : pas de fenêtre avant la fin du combat, puis elle apparaît.
  - Variante : `/ftr levelprompt off`, prends un niveau → pas de fenêtre ; `/ftr levelprompt on` pour revenir.
  - Résultat :
- [ ] **3.4** Boutons de la fenêtre.
  - Action : **Plus tard** → la fenêtre se ferme, pas de rechargement, elle ne revient pas avant 5 min. La croix fait pareil. Avec la case cochée puis **Plus tard** → plus aucune fenêtre jusqu'au prochain `/reload`. **Synchroniser** → l'interface se recharge (2-3 s).
  - Résultat :
- [ ] **3.5** Critère : *la fenêtre n'apparaît jamais en combat, en instance, en vol ou mort.* Test rapide par `/ftr sync` (mêmes conditions que la fenêtre) :
  - En combat (tape la commande pendant un combat) → `Synchronisation impossible : tu es en combat.`
  - Dans un donjon → `… : tu es en instance.`
  - Sur un trajet de maître de vol → `… : tu es en vol.`
  - Mort, puis fantôme → `… : ton perso est mort.`
  - Incantation : macro `/cast Pierre de foyer` + `/ftr sync` sur deux lignes → `… : une incantation est en cours.`
  - Dans aucun de ces cas l'interface ne se recharge.
  - Résultat :
- [ ] **3.6** Même critère, avec la fenêtre du minuteur. `/ftr interval 10`, `/reload`, puis attends environ 9 min et place-toi dans l'un des états ci-dessus (vol, mort, instance) au moment où les 10 min tombent.
  - Attendu : pas de fenêtre tant que l'état dure ; elle apparaît dans les 30 s après en être sorti (atterrissage, résurrection, sortie du donjon). Remets `/ftr interval 15` à la fin.
  - Résultat :
- [ ] **3.7** Critère : *la fenêtre disparaît si un combat commence.*
  - Action : fenêtre affichée (3.3 ou 3.6), attaque un monstre sans cliquer.
  - Attendu : la fenêtre disparaît à l'entrée en combat et revient à la fin du combat (sans attendre 5 min).
  - Résultat :
- [ ] **3.8** Critère : *aucun `ReloadUI()` sans clic, touche ou commande.*
  - Action : pendant toute la session de test (au moins 1 h : niveau, combats, changements de zone, donjon, vol), note chaque `/reload`, clic sur **Synchroniser**, appui sur la touche ou `/ftr sync` que tu fais.
  - Commande en fin de session : `/run local n=0 for _,e in ipairs(FT.events) do if e.type=="SESSION_START" and e.at>=GetServerTime()-3600 then n=n+1 end end print(n)`
  - Attendu : l'interface ne s'est jamais rechargée d'elle-même ; le nombre affiché = 1 (connexion) + le nombre de rechargements que tu as déclenchés dans l'heure.
  - Résultat :
- [ ] **3.9** Raccourci clavier.
  - Action : Échap → Options → Raccourcis → section AddOns → « ForeverTracker : synchroniser maintenant », assigne une touche, appuie dessus hors combat, puis en combat.
  - Attendu : hors combat l'interface se recharge ; en combat `Synchronisation impossible : tu es en combat.` et pas de rechargement.
  - Résultat :
- [ ] **3.10** Critère : *un fichier rechargé vide ne provoque aucune erreur.*
  - Action : jeu fermé, copie `ForeverTracker.lua` en `ForeverTracker.lua.bak`, vide le fichier (0 octet), lance le jeu et connecte-toi. Recommence avec un fichier qui ne contient que `ForeverTrackerDB = {}`. Remets la sauvegarde à la fin, jeu fermé.
  - Commandes : `/ftr status`, `/dump ForeverTrackerDB.schema`, `/dump ForeverTrackerDB.settings`
  - Attendu : aucune erreur Lua ; `/ftr status` affiche le perso ; `schema` = `1` ; réglages par défaut (`interval = 15`, `levelPrompt = true`, `debug = false`). À la déconnexion suivante le fichier contient à nouveau une structure complète.
  - Résultat :

## 4. Commandes `/ftr`

- [ ] **4.1** `/ftr help` → « Commandes : » puis une ligne par commande (`status`, `sync`, `interval`, `levelprompt`, `debug`, `reset`, `share`, `help`). `/ftr truc` → « Commande inconnue : truc » puis la liste. `/FTR STATUS` marche comme `/ftr status`. Résultat :
- [ ] **4.2** `/ftr interval 30` → « Fenêtre Synchroniser : toutes les 30 min » ; `/ftr interval off` → « … : désactivée » ; `/ftr interval 7` → « Utilisation : /ftr interval 10|15|30|off » et rien ne change (`/ftr status`). Remets `15`. Résultat :
- [ ] **4.3** `/ftr levelprompt off` / `on` et `/ftr debug off` / `on` → messages « … : désactivée / activée » ; `/ftr debug truc` → « Utilisation : … ». Après `/reload`, `/dump ForeverTrackerDB.settings` garde les valeurs choisies. Résultat :
- [ ] **4.4** `/ftr status` → « Événements en attente » augmente après un événement (mort, niveau) et revient à 1 après un `/reload` (le `SESSION_START` du rechargement, pas encore écrit dans le fichier). Résultat :
- [ ] **4.5** `/ftr reset` → fenêtre de confirmation **Vider** / **Annuler**. **Annuler** : `/dump #FT.events` inchangé. **Vider** : « Journal vidé. » et `/dump #FT.events` → `0` ; les autres persos du compte gardent leur journal. Résultat :
- [ ] **4.6** `/ftr share` → fenêtre avec une zone de texte défilante, code `FT1:…` déjà sélectionné. Ctrl+C copie le code ; une frappe ne le modifie pas ; un clic le resélectionne ; Échap ferme la fenêtre. Colle le code dans `/sync code:` sur Discord → accepté. Résultat :

## 5. Événements du journal (complément)

Pas des critères d'acceptation, mais à contrôler pendant la même session. Pour chacun : `/dump FT.events[#FT.events]` juste après.

- [ ] **5.1** Mort → `DEATH` avec `level` et `zone` ; `/dump FT.snapshot.deaths` augmente de 1. Résultat :
- [ ] **5.2** Entrée dans un donjon → `DUNGEON_ENTER` avec `instanceName` et `instanceId` ; ressortir puis rentrer dans le même donjon (ou `/reload` dedans) ne crée pas de second événement. Résultat :
- [ ] **5.3** Entrée dans une guilde, départ ou changement → `GUILD_CHANGE` avec `from` / `to` (champ absent pour « pas de guilde »). Résultat :
- [ ] **5.4** Métier qui passe 75, 150, 225 ou 300 → `PROFESSION_TIER` avec `name` et `rank`. Résultat :

## 6. Appli compagnon (si installée)

- [ ] **6.1** Nom du processus du jeu (« à vérifier » de la spec). Jeu lancé, dans PowerShell : `Get-Process | Where-Object { $_.Path -like "*_forever_*" } | Select-Object Name, Path`. Attendu : `Wow` (ou `Wow-arm64`) avec un chemin dans `_forever_`. Résultat :
- [ ] **6.2** Critère : *l'appli détecte le lancement et l'arrêt du jeu en moins de 10 s.* Chronomètre entre le lancement / la fermeture du jeu et le changement de couleur de l'icône (grise → verte, verte → grise). Résultat :
- [ ] **6.3** Critère : *une synchro arrive au serveur moins de 10 s après un `/reload`.* Prends de l'XP, `/reload`, chronomètre jusqu'à la mise à jour du statut de l'appli (dernière synchro) et du tableau Discord (au plus 15 s de délai d'édition en plus côté bot). Résultat :
- [ ] **6.4** Critère : *réseau coupé → synchros en file, envoyées au retour, sans doublon.* Coupe le réseau Windows (le jeu sera déconnecté : fais `/reload` juste avant, ou ferme le jeu), vérifie la présence de fichiers dans `%APPDATA%\ForeverTrackerSync\queue\`, rétablis le réseau. Attendu : la file se vide (au plus 10 min), le salon de logs Discord n'affiche chaque événement qu'une fois. Résultat :
- [ ] **6.5** Critère : *le jeton n'apparaît ni dans les logs ni dans un fichier en clair.* `Get-ChildItem "$env:APPDATA\ForeverTrackerSync" -Recurse -File | Select-String -Pattern "deviceToken|Bearer"`. Attendu : aucune ligne contenant une valeur de jeton. Le jeton est dans le Gestionnaire d'identifiants Windows (Identifiants Windows → identifiants génériques → `ForeverTrackerSync/deviceToken`). Résultat :
- [ ] **6.6** Critère : *le Lua du fichier n'est jamais exécuté.* Jeu fermé, garde une copie du fichier, puis ajoute dans `ForeverTrackerDB` la ligne `["piege"] = print("PIEGE"),`. Attendu : l'appli refuse le fichier (icône orange, erreur de lecture dans ses logs) sans rien exécuter ; joint à `/sync fichier:` sur Discord, il est refusé aussi. Remets la copie avant de relancer le jeu. Résultat :
