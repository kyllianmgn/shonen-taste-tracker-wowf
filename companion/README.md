# ForeverTracker Sync (appli compagnon)

Appli de barre système Windows qui lit le fichier SavedVariables de l'addon et l'envoie au serveur.
Spec : `docs/01-spec-addon-companion.md`, section « Appli compagnon ».

## Commandes

```powershell
cd companion
flutter test
flutter analyze
dart format --set-exit-if-changed lib test tool
flutter run -d windows --dart-define=API_BASE_URL=http://localhost:3000
dart run tool/make_tray_icons.dart   # régénère assets/tray/*.ico
```

`flutter build windows` demande Visual Studio (charge C++) et le mode développeur de Windows.

## Structure de `lib/`

| Dossier | Rôle | Tâche |
| --- | --- | --- |
| `settings/` | chemins `%APPDATA%\ForeverTrackerSync`, `settings.json`, interface « Démarrer avec Windows » | C-01 (lanceur réel : C-08) |
| `app/` | démarrage : logs tournants | C-01 |
| `ui/tray/` | machine d'état de l'icône, modèle du menu, routage des clics, adaptateur tray_manager | C-01 |
| `lua/` | parseur de littéraux Lua | C-02 |
| `wow_files/` | dossier `_forever_`, fichiers SavedVariables, surveillance | C-03 |
| `process/` | détection du jeu | C-04 |
| `api/` | client HTTP, appairage (interface vide pour l'instant) | C-05 |
| `sync/` | battements et synchros (interface vide pour l'instant) | C-06 |
| `queue/` | file hors ligne | C-07 |

Les modules métier n'importent pas Flutter : seuls `main.dart` et `ui/tray/tray_controller.dart`
touchent aux plugins.

## Lecture des SavedVariables (`lua/`)

`parseSavedVariablesBytes(octets, schéma sync.request)` lit `ForeverTracker.lua` sans jamais
l'exécuter : parseur de littéraux écrit à la main, portage exact de `server/src/common/lua` (S-04),
mêmes erreurs (`NonLiteralExpression`, `SyntaxError`, `SourceTooLarge` au-delà de 512 Ko,
`NestingTooDeep` au-delà de 100 niveaux) avec ligne et colonne. Les tables vides deviennent `[]`
ou `{}` selon `contract/schemas/sync.request.json`. `ForeverTrackerDB = nil` renvoie `null` :
rien à envoyer. Les tests lisent directement `contract/fixtures/savedvariables/`.

## Détection du jeu (`process/`)

`GameDetector` interroge `ProcessLister` toutes les 5 s et émet `GameStarted` / `GameStopped`
seulement quand l'état change. Le jeu est « lancé » si `Wow.exe` ou `Wow-arm64.exe` tourne sous le
dossier `_forever_` (casse et sens des barres ignorés ; `_retail_`, `_forever_old` ou un chemin avec
`..` ne comptent pas). Au démarrage, jeu déjà lancé → `GameStarted` ; jeu arrêté → rien. Une liste
de processus en échec garde le dernier état. Tout autre `.exe` vu sous `_forever_` est journalisé
une fois (nom seul) pour confirmer le vrai nom de l'exécutable sur une install réelle.

`Win32ProcessLister` passe par `dart:ffi` (package `ffi`) : `K32EnumProcesses`, puis
`OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `QueryFullProcessImageNameW` ; aucun droit
admin, aucune console lancée, les processus protégés sont ignorés.

## Fichiers du jeu (`wow_files/`)

L'appli lit les fichiers du joueur et n'y écrit jamais.

- **Dossier du jeu** (`ForeverFolderLocator`) : essaie
  `C:\Program Files (x86)\World of Warcraft\_forever_` puis `C:\Program Files\World of Warcraft\_forever_`.
  Sinon le joueur choisit son dossier World of Warcraft (le dossier `_forever_` lui-même est accepté
  aussi). Le dossier n'est valide que s'il contient `_forever_\WTF`. `gameFolder` garde le chemin
  du dossier `_forever_`.
- **Découverte** (`discoverSavedVariables`) : tous les
  `_forever_\WTF\Account\*\SavedVariables\ForeverTracker.lua`, un par compte. Les noms sont comparés
  sans tenir compte de la casse ; les `.bak` et les dossiers par perso sont ignorés.
- **Surveillance** (`SavedVariablesWatcher`) : watcher système récursif sur `_forever_\WTF`, plus une
  relecture toutes les 10 s (liste des comptes, taille et date de modification) qui sert de repli
  et relance le watcher s'il est tombé. Un changement n'est émis (`FileReady(path)`) qu'après 2 s
  sans changement de taille ni de date. Au démarrage, chaque fichier présent est émis une fois ;
  ensuite, seulement s'il change ou s'il est supprimé puis recréé. Un fichier supprimé avant
  d'être stable n'est pas émis.

## Fichiers locaux

Dans `%APPDATA%\ForeverTrackerSync\` :

- `settings.json` : `gameFolder`, `startWithWindows` (vrai par défaut), `firstRunCompleted`, `version`.
  Aucun secret ; un fichier illisible redonne les valeurs par défaut.
- `forevertracker-sync.log` puis `.1.log` … `.4.log` : 1 Mo par fichier, 5 fichiers au plus.
  Jamais de jeton, de code ni de contenu complet de SavedVariables.

## Icône

| Couleur | Quand |
| --- | --- |
| verte | jeu détecté, aucun problème (dernier envoi OK ou rien envoyé encore) |
| grise | jeu fermé, aucun problème |
| orange | non appairée, jeton révoqué (401), `schema` inconnu, ou dernier envoi en échec — même jeu fermé |

La fenêtre n'est jamais affichée au démarrage ; la fermer la cache, « Quitter » arrête l'appli.
