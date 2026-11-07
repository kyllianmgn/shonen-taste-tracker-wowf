# ForeverTracker (addon)

Addon WoW: Forever qui suit tes personnages pour le bot Discord : niveau, temps joué, sessions, morts, donjons. Il enregistre tout dans un fichier de ton dossier WoW ; l'appli **ForeverTracker Sync** (ou la commande `/sync` sur Discord) l'envoie au bot.

Client visé : WoW: Forever 1.60.x (interface 16001). Langues : français, anglais.

## Installation

1. Télécharge `ForeverTracker-<version>.zip` depuis les releases GitHub du projet.
2. Jeu fermé, décompresse-le dans `World of Warcraft\_forever_\Interface\AddOns\`. Tu dois obtenir :
   ```
   World of Warcraft\_forever_\Interface\AddOns\ForeverTracker\ForeverTracker.toc
   ```
   (et pas `...\AddOns\ForeverTracker-1.0.0\ForeverTracker\...` : si ton outil de décompression crée un dossier en plus, déplace `ForeverTracker` d'un niveau).
3. Lance le jeu ; à l'écran de sélection des persos, bouton **AddOns** : vérifie que ForeverTracker est coché.
4. En jeu, tape `/ftr` : l'addon affiche ton perso et son niveau.

Mise à jour : remplace le dossier `ForeverTracker` par celui du nouveau zip. Ton historique n'est pas dans ce dossier, il n'est pas perdu.

Ensuite, pour que le bot reçoive ta progression :
- **avec l'appli** (recommandé) : installe ForeverTracker Sync et appaire-la avec `/lier appli` sur Discord ; elle envoie tout seule chaque sauvegarde du jeu ;
- **sans l'appli** : `/ftr share` en jeu, puis colle le code dans `/sync code:` sur Discord (ou joins le fichier `ForeverTracker.lua` à `/sync fichier:`).

## Synchronisation

Le jeu n'écrit le fichier de l'addon qu'à la déconnexion, à la sortie ou au rechargement de l'interface. Toutes les 15 min (réglable), et après chaque niveau, l'addon propose donc une fenêtre **Synchroniser** : un clic recharge l'interface (2-3 s) et écrit le fichier.

- La fenêtre n'apparaît jamais en combat, en instance, en vol, mort ou pendant une incantation, et disparaît si un combat commence.
- **Plus tard** la repousse de 5 min ; la case « Ne plus demander cette session » la coupe jusqu'au prochain rechargement.
- L'addon ne recharge jamais l'interface tout seul : seulement sur un clic, une touche ou une commande tapée.
- Raccourci : Échap → Options → Raccourcis → AddOns → « ForeverTracker : synchroniser maintenant ».

## Commandes

| Commande | Effet |
| --- | --- |
| `/ftr` ou `/ftr status` | Perso, dernière sauvegarde, intervalle, événements en attente |
| `/ftr sync` | Synchronise tout de suite (recharge l'interface) si c'est possible |
| `/ftr interval 10\|15\|30\|off` | Fréquence de la fenêtre Synchroniser (défaut 15 min) |
| `/ftr levelprompt on\|off` | Fenêtre Synchroniser après chaque niveau (défaut on) |
| `/ftr share` | Code à coller dans `/sync code:` sur Discord, pour jouer sans l'appli |
| `/ftr debug on\|off` | Messages de diagnostic dans le chat |
| `/ftr reset` | Vide le journal d'événements du perso courant, après confirmation |
| `/ftr help` | Liste des commandes |

Les réglages sont communs à tous les persos du compte.

## Confidentialité

**Ce que l'addon enregistre**, pour chaque perso joué, dans `World of Warcraft\_forever_\WTF\Account\<COMPTE>\SavedVariables\ForeverTracker.lua` :
- identité : prénom, nom, région, royaume, identifiant (GUID) ;
- état : niveau, XP, or, temps joué, zone, classe, race, sexe, faction, guilde et rang, équipement porté et niveau d'objet, métiers, réputations, honneur, nombre de morts ;
- journal (300 derniers événements) : début et fin de session, niveaux, morts, entrées en donjon, changements de guilde, paliers de métier ;
- tes réglages `/ftr`.

**Ce qu'il ne fait pas** : aucun accès réseau (impossible dans WoW), aucune lecture du chat, des amis, des données de combat ni de ton compte Battle.net, aucune action de jeu automatique. Le code est lisible, non obfusqué.

**Qui reçoit ces données** : personne tant que tu ne les envoies pas. L'appli ForeverTracker Sync lit uniquement ce fichier et l'envoie au serveur du bot ; `/ftr share` produit un code qui contient ton identité, l'état ci-dessus et les événements depuis ton dernier partage. Sur Discord, `/confidentialite` masque ton or, ta zone ou ta présence, et `/quitter` supprime tes données côté bot.

**Effacer** : `/ftr reset` vide le journal du perso courant ; supprimer le fichier `ForeverTracker.lua` (jeu fermé) efface tout côté addon.

## Résultats des appels « à vérifier »

Appels de l'API que la spec ne garantit pas sur le client Forever (docs/01, « Snapshot »). L'addon les cherche au moment de l'appel et les appelle sous `pcall` : un appel absent ou en erreur retire seulement le champ du snapshot. Procédure de test : [docs/addon-ingame-checklist.md](../docs/addon-ingame-checklist.md), section 2.

| Appel | Champ | Résultat sur 1.60.x | Checklist |
| --- | --- | --- | --- |
| `GetAverageItemLevel` | `ilvl` | non testé | 2.2 |
| `GetProfessions` + `GetProfessionInfo` | `professions` | non testé | 2.3, 2.5 |
| `GetNumSkillLines` + `GetSkillLineInfo` (repli) | `professions` | non testé | 2.4, 2.5 |
| `C_Reputation.GetNumFactions` + `GetFactionDataByIndex` | `reputations` | non testé | 2.6, 2.7 |
| `UnitHonor` | `honor` | non testé | 2.8 |
| Modèles `BasicFrameTemplateWithInset`, `UIPanelButtonTemplate`, `UICheckButtonTemplate`, `UIPanelScrollFrameTemplate` | fenêtres | non testé | 2.9 |

## Développement

```powershell
./tools/link-addon.ps1             # lie addon/ForeverTracker dans le dossier du jeu (jonction)
python -m pytest addon/tests       # tests hors jeu (Lua 5.1 + stubs), voir addon/tests/README.md
./tools/package-addon.ps1          # release/ForeverTracker-<version>.zip
```

`package-addon.ps1` lit la version dans `ForeverTracker.toc` (`## Version:`), refuse de construire si `ns.VERSION` dans `Core.lua` diffère, et met le seul dossier `ForeverTracker/` dans le zip (sans `__pycache__` ni fichiers cachés). Options : `-OutDir <dossier>` (défaut `release/`, ignoré par git), `-AddonDir <dossier>`.

Spec : [docs/01-spec-addon-companion.md](../docs/01-spec-addon-companion.md). Bibliothèque embarquée : LibDeflate 1.0.2 (licence zlib, `libs/LibDeflate/`).
