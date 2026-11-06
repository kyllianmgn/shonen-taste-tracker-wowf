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
dart run tool/make_icons.dart        # régénère assets/tray/*.ico et windows/runner/resources/app_icon.ico
```

`flutter build windows` demande Visual Studio (charge C++) et le mode développeur de Windows.

## Structure de `lib/`

| Dossier | Rôle | Tâche |
| --- | --- | --- |
| `settings/` | chemins `%APPDATA%\ForeverTrackerSync`, `settings.json`, « Démarrer avec Windows » (clé Run) | C-01, C-08 |
| `app/` | démarrage : logs tournants | C-01 |
| `ui/tray/` | machine d'état de l'icône, modèle du menu, routage des clics, adaptateur tray_manager | C-01 |
| `lua/` | parseur de littéraux Lua | C-02 |
| `wow_files/` | dossier `_forever_`, fichiers SavedVariables, surveillance | C-03 |
| `process/` | détection du jeu | C-04 |
| `api/` | client HTTP du contrat, erreurs typées, appairage, jeton dans le Gestionnaire d'identifiants | C-05 |
| `ui/first_run/` | fenêtre de premier lancement (dossier du jeu, code, « Démarrer avec Windows ») | C-05 |
| `sync/` | battements, synchros, ensemble des ids déjà envoyés ; relie C-02 à C-05 | C-06 |
| `queue/` | file hors ligne, arrêt des envois sur `401` | C-07 |
| `ui/notifications/` | notification Windows (`local_notifier`) | C-07 |
| `update/` | comparaison de versions, vérification de la dernière release GitHub | C-08 |
| `../installer/` | script Inno Setup | C-08 |

Les modules métier n'importent pas Flutter : seuls `main.dart`, `ui/tray/tray_controller.dart` et
`ui/notifications/windows_notifier.dart` touchent aux plugins (`ui/first_run/` n'utilise que les widgets).

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

## Client API et appairage (`api/`, `ui/first_run/`)

`ApiClient` couvre les quatre routes de docs/02 « Contrat d'échange » : `POST /v1/devices/pair`,
`POST /v1/heartbeat`, `POST /v1/sync`, `DELETE /v1/devices/me`. L'adresse vient de
`--dart-define=API_BASE_URL=…` ; sans elle, aucun appel ne part (`ApiNotConfigured`). Délai de 30 s.

Chaque échec est une `ApiException` typée :

| Cas | Classe | Rejouable (C-07) |
| --- | --- | --- |
| `400 validation_failed` | `ValidationFailed` | non |
| `401 invalid_token` (ou tout 401) | `InvalidToken` | non |
| `404 code_unknown` · `409 code_used` · `410 code_expired` | `CodeUnknown` · `CodeUsed` · `CodeExpired` | non |
| `413 payload_too_large` · `422 unknown_schema` | `PayloadTooLarge` · `SchemaRejected` | non |
| `429 rate_limited` | `RateLimited` (`retryAfter` lu dans `Retry-After`, secondes ou date HTTP) | oui |
| 5xx | `ServerError` | oui |
| réseau, TLS, délai dépassé | `NetworkError` | oui |
| autre statut, ou corps hors contrat | `UnexpectedResponse` | non |

Le jeton d'appareil (`DeviceToken`, dont `toString` masque la valeur) est rangé dans le
Gestionnaire d'identifiants Windows, identifiant générique `ForeverTrackerSync/deviceToken`
(`CredWriteW` / `CredReadW` / `CredDeleteW` via `dart:ffi`, persistance « cet ordinateur »).
Les logs ne contiennent que méthode, chemin et statut : ni corps, ni en-tête, ni message du
serveur, ni code d'appairage.

« Délier » appelle `DELETE /v1/devices/me` puis oublie le jeton, même si le serveur est injoignable.

La fenêtre de premier lancement ne s'ouvre au démarrage que si aucun jeton n'est stocké ; le menu
« Appairer » rouvre la même fenêtre. Elle reprend le dossier de `settings.json` s'il est encore
valide, sinon essaie les emplacements par défaut, sinon demande le dossier (sélecteur natif via
`file_selector`). Le code tapé est mis en majuscules, espaces et tirets retirés, et vérifié
(8 caractères, sans 0/O/1/I) avant tout envoi. Après l'appairage : `gameFolder`,
`startWithWindows` et `firstRunCompleted` sont enregistrés, puis la fenêtre se cache.

Tests : les corps envoyés sont validés contre `contract/schemas` avec `json_schema`
(dépendance de dev) ; `test/api/credential_manager_token_store_test.dart` utilise le vrai
Gestionnaire d'identifiants sous un nom jetable.

## Battements et synchros (`sync/`)

`SyncRuntime` garde une session par dossier `_forever_` (celui de `settings.json`) : le watcher
(C-03), la détection du jeu (C-04) et `SyncEngine`, qui envoie via `ApiClient` (C-05, derrière
l'interface `CompanionApi`). Changer de dossier remplace la session. Après un appairage, tout le
contenu des fichiers est envoyé.

- **Battements** : un tout de suite à chaque `GameStarted` / `GameStopped`, puis toutes les
  `heartbeatIntervalSec` (dernière valeur renvoyée par le serveur, 600 s au départ) tant que le jeu
  tourne. `lastCharacter` = perso du `SESSION_START` le plus récent lu dans les fichiers.
- **Synchros** : sur `FileReady`, le fichier est lu par le parseur de littéraux. Pour chaque perso,
  il part si son `capturedAt` est plus récent que le dernier envoyé ou s'il a des événements dont
  l'`id` n'est pas dans les 1 000 derniers ids envoyés ; seuls ces événements partent (le snapshot
  part toujours avec, le contrat l'exige). Au plus une synchro toutes les 30 s : les changements
  suivants attendent le créneau suivant et sont regroupés. Une synchro = un fichier (un compte).
- **Arrêt du jeu** : si aucun fichier n'est réécrit dans les 60 s qui suivent `GameStopped`, tous
  les fichiers sont relus pour la synchro finale.
- **« Synchroniser maintenant »** relit tous les fichiers et renvoie tout (le serveur
  déduplique), en respectant les 30 s.
- **`schema` inconnu** (autre que 1) : rien n'est envoyé, icône orange « mets à jour l'appli ».
  Un fichier qui n'est pas un littéral pur n'est pas envoyé non plus.
- Tout passe par la file hors ligne (`queue/`, ci-dessous). L'état envoyé est enregistré quand le
  serveur a accepté la synchro **ou** quand la file l'a prise : une synchro en file n'est pas
  replanifiée au changement suivant, seuls les nouveaux événements partent (derrière elle). Une
  synchro refusée pour de bon (400, 413…) n'est pas enregistrée : elle repart au changement suivant.

Le normaliseur lit `assets/contract/sync.request.json`, copie de `contract/schemas/sync.request.json`
embarquée dans l'appli ; `test/sync/contract_asset_test.dart` échoue si les deux diffèrent.

Tests : faux watcher, faux détecteur et faux client API (corps validés contre `contract/schemas`),
horloge manuelle (`test/support/fake_clock.dart`).

## File hors ligne (`queue/`)

`OfflineQueue` est unique pour toute l'appli (elle survit aux changements de dossier du jeu) et se
place entre `SyncEngine` et `ApiClient`.

- **Mise en file** : un battement ou une synchro en échec réseau, 5xx ou 429 est écrit dans
  `%APPDATA%\ForeverTrackerSync\queue\` (un fichier `<numéro>.json` par requête, corps du contrat
  tel quel, jamais le jeton). Icône orange « serveur injoignable ».
- **Rejeu** : 5 s, 30 s, 2 min, puis toutes les 10 min ; un `Retry-After` plus long l'emporte. Les
  délais repartent de zéro après un succès. « Synchroniser maintenant » rejoue la file tout de suite.
- **Ordre** : tant que la file n'est pas vide, les nouvelles requêtes passent derrière, même si le
  réseau est revenu ; la file part de la plus ancienne à la plus récente, avec le `sentAt` d'origine.
- **Expiration** : battements de plus de 30 min et synchros de plus de 7 jours jetés (âge compté
  depuis le premier essai), au démarrage et avant chaque rejeu.
- **Refus définitif** pendant le rejeu (400, 413, 422, réponse hors contrat) : la requête est jetée,
  la suivante part. Un 422 met l'icône orange « mets à jour l'appli ».
- **`401`** : plus aucun envoi (ni direct, ni rejeu), la file reste sur le disque, icône orange
  « jeton révoqué » et **une** notification Windows « Jeton révoqué : réappaire l'appli avec
  /lier appli sur Discord. ». Après un nouvel appairage, la file repart, puis tout est renvoyé.
  Au lancement suivant de l'appli, le jeton révoqué est réessayé une fois : une notification par
  lancement au plus.
- **Délier** vide la file.
- **Redémarrage** : les fichiers de `queue\` sont relus au démarrage et rejoués dans l'ordre ; un
  fichier illisible est supprimé (nom seul dans les logs).
- **Pas de doublon** : une synchro n'est mise en file qu'une fois. Si une réponse se perd alors que
  le serveur a enregistré la synchro, le rejeu renvoie les mêmes ids d'événements et le serveur les
  compte en `duplicateEvents`.

La notification passe par `local_notifier` (toast Windows). Windows n'affiche les toasts d'une
appli de bureau que si elle a un raccourci dans le menu Démarrer : `localNotifier.setup` le crée au
démarrage s'il manque.

Tests : `test/queue/` (horloge manuelle, faux serveur, vrai dossier temporaire pour le
redémarrage) et le groupe « network cut then back » de `test/sync/sync_engine_test.dart`.

## Fichiers locaux

Dans `%APPDATA%\ForeverTrackerSync\` :

- `settings.json` : `gameFolder`, `startWithWindows` (vrai par défaut), `firstRunCompleted`, `version`.
  Aucun secret ; un fichier illisible redonne les valeurs par défaut. Le jeton est dans le
  Gestionnaire d'identifiants Windows (`ForeverTrackerSync/deviceToken`).
- `sync-state.json` : dernier `capturedAt` envoyé (ou mis en file) par perso et 1 000 derniers ids
  d'événements envoyés. Illisible → repart de zéro (le serveur déduplique).
- `queue\0000000001.json`… : requêtes en attente de la file hors ligne (corps du contrat, numéro,
  type, date du premier essai). Supprimées une fois envoyées, refusées ou expirées.
- `forevertracker-sync.log` puis `.1.log` … `.4.log` : 1 Mo par fichier, 5 fichiers au plus.
  Jamais de jeton, de code ni de contenu complet de SavedVariables.

## Icône

| Couleur | Quand |
| --- | --- |
| verte | jeu détecté, aucun problème (dernier envoi OK ou rien envoyé encore) |
| grise | jeu fermé, aucun problème |
| orange | non appairée, jeton révoqué (401, avec notification Windows), `schema` inconnu, ou dernier envoi en échec (requête en file) — même jeu fermé |

La fenêtre n'est jamais affichée au démarrage ; la fermer la cache, « Quitter » arrête l'appli.

Icônes définitives : double chevron « level up », blanc sur la pastille de couleur dans la barre
système (un seul chevron à 16 px), doré sur fond bleu nuit pour l'exe, le menu Démarrer et
l'installeur. `dart run tool/make_icons.dart` les régénère ; `test/app/icons_test.dart` vérifie
les tailles.

## Démarrer avec Windows (`settings/`)

`RegistryStartupLauncher` écrit `"<chemin de l'exe>"` dans la valeur `ForeverTracker Sync` de
`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (`RegSetKeyValueW` via `dart:ffi`, sans
droit admin) ou la supprime. Activé par défaut : la case de la fenêtre de premier lancement est
cochée et appliquée à l'appairage ; le menu la bascule. À chaque démarrage, une fois le premier
lancement terminé, le réglage est réappliqué (chemin réparé après une réinstallation ailleurs).
Un exe lancé depuis `build\windows\` (`flutter run`) n'est jamais inscrit. Une erreur du registre
est journalisée, jamais bloquante. Le joueur peut aussi désactiver l'entrée dans l'onglet
Démarrage du Gestionnaire des tâches. Le désinstalleur supprime la valeur.

## Mises à jour (`update/`)

Au démarrage, `UpdateChecker` lit `GET https://api.github.com/repos/<dépôt>/releases` (anonyme,
sans jeton). Le dépôt vient de `--dart-define=UPDATE_REPO=owner/name` (défaut
`shokkzu/forever-tracker`, la CI passe le dépôt courant ; vide = vérification coupée). Ne comptent
que les tags `companion-v<version>` (SemVer), hors brouillons, pré-versions GitHub et versions
avec suffixe (`-test.1`) ; les releases de l'addon sont ignorées. Si la plus haute dépasse
`appVersion`, **une** notification « Mise à jour disponible » et l'entrée de menu « Télécharger la
version X » ouvrent l'installeur `ForeverTrackerSync-Setup-*.exe` de la release (ou sa page) dans
le navigateur. Seuls les liens `https://github.com/…` sont ouverts. Pas de mise à jour silencieuse
en v1 : rien n'est téléchargé ni installé par l'appli. Échec réseau, limite de débit, réponse
illisible : rien n'est affiché, nouvel essai au prochain démarrage.

## Installeur et releases

`installer/forevertracker_sync.iss` (Inno Setup 6) : installation par utilisateur dans
`%LOCALAPPDATA%\Programs\ForeverTracker Sync`, sans droit admin, raccourci du menu Démarrer
(le même que celui dont les notifications ont besoin), runtime Visual C++ copié à côté de l'exe.
Une mise à jour ferme l'appli puis la relance. La désinstallation arrête l'appli et supprime la
valeur Run ; `%APPDATA%\ForeverTrackerSync` et le jeton du Gestionnaire d'identifiants restent
(« Délier » avant de désinstaller pour révoquer l'appareil).

L'installeur n'est **pas signé** en v1 : Windows SmartScreen affiche « Windows a protégé votre
ordinateur » ; « Informations complémentaires » puis « Exécuter quand même ». L'avertissement
disparaît quand le fichier gagne en réputation, ou plus tôt avec un certificat de signature.

CI (`.github/workflows/companion.yml`) :

- chaque PR et push sur main : `dart format`, `flutter analyze`, `flutter test` (Linux), puis sur
  Windows les tests (y compris `@TestOn('windows')`), `flutter build windows` et l'installeur,
  gardé 14 jours en artefact ;
- tag `companion-v<version>` : idem, puis release GitHub avec l'installeur. Le tag doit égaler la
  `version` de `pubspec.yaml` ; `companion-v<version>-<suffixe>` donne une pré-version (test), que
  l'appli ne propose jamais. L'adresse du serveur vient de la variable de dépôt `API_BASE_URL`
  (défaut `https://forever.vsgsrv.fr`).

Publier une version : monter `version` dans `pubspec.yaml` et `appVersion` dans
`lib/app/app_info.dart` (un test vérifie qu'ils sont égaux), fusionner dans main, puis
`git tag companion-v1.1.0` et `git push origin companion-v1.1.0`.

Rejouer le job Linux en local : `act pull_request -j check -P ubuntu-latest=catthehacker/ubuntu:act-latest`
(Docker). Les jobs Windows ne tournent que sur GitHub.

macOS : v2 (docs/03, « Décisions ouvertes »).
