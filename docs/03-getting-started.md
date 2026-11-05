# Démarrage Claude Code

## Mode d'emploi

Cet onglet transforme le dossier en point de départ pour Claude Code : comptes à créer, structure du dépôt, `CLAUDE.md`, contrat en JSON Schema, fixtures, backlog et prompts. Ordre de développement : **serveur d'abord** (testable sans le jeu), puis **addon** (testable en jeu), puis **appli compagnon**.

### Mettre les docs dans le dépôt

Exporter chaque onglet en Markdown dans `docs/` :

| Fichier | Onglet |
| --- | --- |
| `docs/00-research.md` | Recherche |
| `docs/01-spec-addon-companion.md` | Spec addon + appli |
| `docs/02-spec-server.md` | Spec bot + serveur |
| `docs/03-getting-started.md` | Démarrage Claude Code (cet onglet) |

Les specs restent en français ; le code, les commentaires, les commits et les nouveaux docs écrits par l'agent sont en anglais.

### Avec ton pipeline sdd-\*

- Ces specs remplacent la sortie de `sdd-specify` : ne pas relancer d'interview.
- `sdd-constitution` : partir de la section « Règles pour l'agent » du `CLAUDE.md` ci-dessous.
- `sdd-plan` : la section Dépôt et les deux specs fixent déjà l'architecture ; le plan ne fait que la découper par package.
- `sdd-tasks` : partir du backlog de cet onglet (ids `S-xx`, `A-xx`, `C-xx`), une branche et une PR par tâche.
- `sdd-implement` : une tâche à la fois, en TDD, validation après chaque tâche.

Sans le pipeline : utiliser directement les prompts de la section « Prompts de lancement ».

### Règle d'or

Le contrat d'échange (`contract/` + section du même nom dans `docs/02-spec-server.md`) est la seule référence entre l'appli et le serveur. Tout changement modifie le schéma, les fixtures et les deux côtés dans la même PR.

## Comptes et accès à créer à la main

Ces étapes demandent ton identité ou tes secrets : à faire avant de lancer l'agent, qui ne doit jamais les voir en clair dans le chat.

- [ ] **Discord** : sur le Developer Portal, créer l'application « ForeverTracker » → onglet Bot → copier le token dans `.env` (`DISCORD_TOKEN`) et l'Application ID (`DISCORD_CLIENT_ID`). Aucun intent privilégié. Générer le lien d'invitation (scopes `bot` + `applications.commands`, permissions de la spec) et inviter le bot sur un **serveur Discord de test** dédié.
- [ ] **Battle.net** : sur develop.battle.net, créer un client API → noter Client ID et Client Secret (`BNET_CLIENT_ID`, `BNET_CLIENT_SECRET`) → déclarer l'URL de redirection de prod (`https://<domaine>/oauth/bnet/callback`) et celle de dev (voir Environnement local).
- [ ] **Domaine** : un sous-domaine qui pointe sur ton VPS, par exemple `forever.vsgsrv.fr`, ajouté dans Caddy.
- [ ] **GitHub** : dépôt privé `forever-tracker` ; activer GitHub Actions et les Releases (l'appli compagnon et l'addon y seront publiés).
- [ ] **Jeu** : WoW Forever installé, au moins un perso créé, et le partage des données de jeu avec les développeurs activé dans la confidentialité Battle.net (sinon le profil de compte répond 404).
- [ ] **Secrets** : générer `TOKEN_ENC_KEY` (32 octets aléatoires en base64), par exemple en PowerShell : `[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`.
- [ ] **Plus tard** : compte CurseForge pour publier l'addon, certificat de signature de code si Windows SmartScreen bloque l'installeur de l'appli.

## Dépôt

Un monorepo, trois livrables, un dossier `contract/` partagé.

```
forever-tracker/
  CLAUDE.md
  README.md
  docs/                      # les 4 onglets exportés
  contract/
    schemas/                 # JSON Schema (draft 2020-12), source de vérité
      pair.request.json  pair.response.json
      heartbeat.request.json  heartbeat.response.json
      sync.request.json  sync.response.json
      share-code.payload.json  error.json
    fixtures/
      sync.valid.json  sync.duplicate.json  sync.regression.json
      sync.suspect-jump.json  heartbeat.running.json  heartbeat.stopped.json
      scenarios/session-levelup.json
      savedvariables/ForeverTracker.sample.lua
      savedvariables/ForeverTracker.empty.lua
      savedvariables/ForeverTracker.malicious.lua
      savedvariables/ForeverTracker.escapes.lua
      bnet/account-profile.json  bnet/account-profile.404.json
      bnet/realm-6855.json  bnet/token.json
  server/                    # NestJS + discord.js + Prisma
    src/{core,ingest,presence,discord,bnet,jobs,common}/
    prisma/schema.prisma
    test/
    Dockerfile
  addon/
    ForeverTracker/          # le dossier copié dans Interface/AddOns
      libs/LibDeflate/
    tests/                   # pytest + lupa, stubs de l'API WoW
  companion/                 # Flutter Windows
    lib/  test/
  tools/
    fake-client/             # rejoue les fixtures contre le serveur
    link-addon.ps1           # jonction du dossier addon vers le jeu
  docker-compose.yml         # prod : server + db
  docker-compose.dev.yml     # dev : db seule
  .github/workflows/{server,addon,companion}.yml
```

### Choix techniques figés

| Domaine | Choix | Pourquoi |
| --- | --- | --- |
| Serveur | Node LTS, TypeScript strict, NestJS, discord.js v14 | Ta stack ; un seul process pour API, bot et jobs |
| Base | PostgreSQL 16 + Prisma, migrations versionnées | Schéma de la spec traduit dans `schema.prisma` |
| Validation | `ajv` sur les fichiers de `contract/schemas/` | Le serveur valide avec les mêmes schémas que les tests de l'appli |
| Tests serveur | Jest (unitaires) + Supertest + base Postgres de test (e2e) | Défaut NestJS |
| Discord testable | Rendu du tableau et des logs en fonctions pures, testées sans Discord | La partie risquée se teste sans réseau |
| Battle.net | Client HTTP isolé dans `bnet/`, bouchonné avec `nock` | API non documentée, peut changer |
| Addon | Lua 5.1 (WoW), LibDeflate embarqué | Seule lib externe nécessaire (pour `/ftr share`) |
| Tests addon | Python + `lupa` (vrai Lua 5.1) avec des stubs de l'API WoW | Tester sans lancer le jeu |
| Appli | Flutter desktop Windows | Ta stack ; à confirmer (Décisions ouvertes) |
| Parseur Lua | Écrit à la main (Dart dans l'appli, TypeScript dans le serveur pour `/sync fichier`), mêmes fixtures | Jamais d'exécution de Lua |
| CI | GitHub Actions : lint + tests par package, release de l'addon (zip) et de l'appli (installeur) sur tag |  |

## CLAUDE.md

À copier tel quel à la racine du dépôt. Il sert aussi de base à `sdd-constitution`.

```markdown
# ForeverTracker — agent guide

Discord bot + WoW: Forever addon + Windows companion app that track players' characters
(level, presence, sessions) and render a live board and a log channel in Discord.

## Sources of truth (read before coding)
- docs/00-research.md — context and constraints (French)
- docs/01-spec-addon-companion.md — addon + companion spec (French)
- docs/02-spec-server.md — bot + server spec, data model, exchange contract (French)
- docs/03-getting-started.md — repo layout, backlog with task ids, fixtures (French)
- contract/schemas/*.json — machine-readable contract; wins over prose if they differ
If the spec is ambiguous or contradicts the code, STOP and ask. Do not guess.

## Workflow
- One task id (S-xx server, A-xx addon, C-xx companion) = one branch `task/<id>-<slug>` = one PR.
- Never commit to main. Conventional Commits (feat:, fix:, test:, chore:, docs:).
- TDD: write the failing test first, make it pass, refactor. All tests green before asking for review.
- Ask before any decision not covered by docs: new dependency, DB schema change, contract change,
  new Discord permission, new file in the player's WoW folder.
- Contract change = schemas + fixtures + server + companion in the same PR; bump `schema` if breaking.
- Code, comments, commits, PR text in English. User-facing strings in French
  (addon also ships enUS).

## Hard rules
- Never execute Lua coming from SavedVariables files or /sync attachments: literal parser only.
- Secrets come from environment variables only. Never log tokens, codes or full SavedVariables.
- Device tokens, pairing codes and OAuth states are stored as SHA-256 hashes.
  Battle.net user tokens are stored only in base mode, AES-256-GCM encrypted, deleted at expiry.
- Addon: no network; ReloadUI() only from a click, a key binding or a typed slash command;
  every API marked "à vérifier" in the spec is guarded by an existence check; Interface 16001.
- Discord: board and log rendering are pure functions with unit tests; board edits debounced
  (>= 15 s per guild); personal commands answer ephemerally.
- Battle.net: all calls go through server/src/bnet; tests use nock, never the real API.

## Commands (Windows, PowerShell)
- DB for dev: `docker compose -f docker-compose.dev.yml up -d`
- Server: `cd server; npm ci; npm run lint; npm test; npm run test:e2e; npx prisma migrate dev`
- Addon tests: `python -m pytest addon/tests`
- Link addon into the game: `./tools/link-addon.ps1`
- Companion: `cd companion; flutter test; flutter build windows`
- Replay a payload: `node tools/fake-client --fixture contract/fixtures/sync.valid.json`

## Definition of done
- Tests green, lint clean, the task's acceptance criteria ticked in the PR description,
  docs updated when behavior changes, no TODO left without a linked task id.
```

## Contrat partagé (JSON Schema)

Version machine du « Contrat d'échange » de la spec serveur, à poser dans `contract/schemas/`. Le serveur valide chaque requête avec `ajv` ; l'appli valide ce qu'elle envoie dans ses tests avec les mêmes fichiers.

### `sync.request.json`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "contract/sync.request.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["sentAt", "schema", "addonVersion", "characters"],
  "properties": {
    "sentAt": { "type": "integer", "minimum": 0 },
    "schema": { "const": 1 },
    "addonVersion": { "type": "string", "maxLength": 20 },
    "characters": { "type": "array", "minItems": 1, "maxItems": 20, "items": { "$ref": "#/$defs/character" } }
  },
  "$defs": {
    "key": {
      "type": "object", "additionalProperties": false,
      "required": ["region", "firstName", "surname"],
      "properties": {
        "region": { "enum": ["eu", "us", "kr", "tw"] },
        "firstName": { "type": "string", "minLength": 2, "maxLength": 12 },
        "surname": { "type": "string", "minLength": 2, "maxLength": 12 },
        "guid": { "type": "string", "maxLength": 64 },
        "realmName": { "type": "string", "maxLength": 64 }
      }
    },
    "character": {
      "type": "object", "additionalProperties": false,
      "required": ["key", "snapshot", "events"],
      "properties": {
        "key": { "$ref": "#/$defs/key" },
        "snapshot": { "$ref": "#/$defs/snapshot" },
        "events": { "type": "array", "maxItems": 500, "items": { "$ref": "#/$defs/event" } }
      }
    },
    "snapshot": {
      "type": "object", "additionalProperties": false,
      "required": ["capturedAt", "level"],
      "properties": {
        "capturedAt": { "type": "integer", "minimum": 0 },
        "level": { "type": "integer", "minimum": 1, "maximum": 60 },
        "xp": { "type": "integer", "minimum": 0 },
        "xpMax": { "type": "integer", "minimum": 0 },
        "rested": { "type": "integer", "minimum": 0 },
        "money": { "type": "integer", "minimum": 0 },
        "playedTotal": { "type": "integer", "minimum": 0 },
        "playedLevel": { "type": "integer", "minimum": 0 },
        "zone": { "type": "string", "maxLength": 64 },
        "subZone": { "type": "string", "maxLength": 64 },
        "mapId": { "type": "integer" },
        "classFile": { "type": "string", "maxLength": 32 },
        "raceFile": { "type": "string", "maxLength": 32 },
        "sex": { "type": "integer", "minimum": 1, "maximum": 3 },
        "faction": { "enum": ["Alliance", "Horde", "Neutral"] },
        "guild": { "type": "string", "maxLength": 64 },
        "guildRank": { "type": "string", "maxLength": 64 },
        "ilvl": { "type": "number", "minimum": 0 },
        "deaths": { "type": "integer", "minimum": 0 },
        "honor": { "type": "integer", "minimum": 0 },
        "equipment": { "type": "array", "maxItems": 19, "items": {
          "type": "object", "required": ["slot", "itemId"], "additionalProperties": false,
          "properties": { "slot": { "type": "integer", "minimum": 1, "maximum": 19 },
                          "itemId": { "type": "integer" }, "link": { "type": "string", "maxLength": 512 } } } },
        "professions": { "type": "array", "maxItems": 20, "items": {
          "type": "object", "required": ["name", "rank"], "additionalProperties": false,
          "properties": { "name": { "type": "string", "maxLength": 64 },
                          "rank": { "type": "integer" }, "max": { "type": "integer" } } } },
        "reputations": { "type": "array", "maxItems": 200, "items": {
          "type": "object", "required": ["factionId", "standing"], "additionalProperties": false,
          "properties": { "factionId": { "type": "integer" }, "name": { "type": "string", "maxLength": 64 },
                          "standing": { "type": "integer" }, "value": { "type": "integer" }, "max": { "type": "integer" } } } }
      }
    },
    "event": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "type", "at", "data"],
      "properties": {
        "id": { "type": "string", "maxLength": 128 },
        "type": { "enum": ["SESSION_START", "SESSION_END", "LEVEL_UP", "DEATH", "DUNGEON_ENTER", "GUILD_CHANGE", "PROFESSION_TIER"] },
        "at": { "type": "integer", "minimum": 0 },
        "data": { "type": "object" }
      }
    }
  }
}
```

### Autres schémas (même style)

| Fichier | Champs |
| --- | --- |
| `pair.request.json` | `code` (motif `^[A-HJ-NP-Z2-9]{8}$`), `deviceName` (≤ 64), `appVersion` (≤ 20), `os` (`windows`, `macos`) |
| `pair.response.json` | `deviceId` (uuid), `deviceToken` (43 caractères base64url), `heartbeatIntervalSec` (entier) |
| `heartbeat.request.json` | `sentAt`, `gameRunning` (booléen), `appVersion`, `lastCharacter` facultatif (= `key` sans `guid` ni `realmName`) |
| `heartbeat.response.json` | `heartbeatIntervalSec`, `serverTime` |
| `sync.response.json` | `heartbeatIntervalSec`, `results[]` : `key`, `status` (`ok`, `untracked`, `owned_by_other`, `rejected`), `acceptedEvents`, `duplicateEvents`, `flags[]` |
| `share-code.payload.json` | Ce que contient un code `FT1:` décodé : `sentAt`, `schema`, `addonVersion` et **un seul** `character` (même `$defs`) |
| `error.json` | `error.code`, `error.message` |

Piège du parseur Lua : une table Lua vide `{}` peut être un tableau ou un objet. Le parseur produit d'abord une structure neutre, puis une étape de normalisation guidée par le schéma convertit les tables vides en `[]` pour `equipment`, `professions`, `reputations` et `events`, et en `{}` pour `data`.

## Fixtures et bouchons

Tout se teste sans le jeu ni Blizzard grâce à ces fichiers ; ils vivent dans `contract/fixtures/` et sont partagés par les trois packages.

### SavedVariables

| Fichier | Contenu | Résultat attendu |
| --- | --- | --- |
| `ForeverTracker.sample.lua` | L'exemple de la spec addon, plus un 2e perso avec `equipment = {}` | Parse OK, 2 persos, `equipment` normalisé en `[]` |
| `ForeverTracker.empty.lua` | `ForeverTrackerDB = nil` | Aucun envoi, aucune erreur |
| `ForeverTracker.malicious.lua` | Un appel de fonction (`os.execute("calc")`), une concaténation `..` et une variable globale à la place de valeurs | Rejet net (« expression non littérale »), rien d'exécuté |
| `ForeverTracker.escapes.lua` | Chaînes avec `\"`, `\n`, `\124` (le \` | `des liens d'objets), chaînes longues`\[\[…\]\]` , commentaires  `--\` |

### Payloads

| Fichier | Scénario |
| --- | --- |
| `sync.valid.json` | 1 perso, snapshot complet, `SESSION_START` + `LEVEL_UP` |
| `sync.duplicate.json` | Identique à `sync.valid.json` : 0 événement accepté, 2 doublons |
| `sync.regression.json` | Même perso, niveau inférieur : `rejected`, flag `regression` |
| `sync.suspect-jump.json` | +8 niveaux en 10 min : flag `suspect_level_jump`, rien publié |
| `heartbeat.running.json` / `heartbeat.stopped.json` | Ouverture / fermeture de session |

### Battle.net (pour `nock`)

```json
// bnet/account-profile.json — GET /profile/user/wow?namespace=profile-forever-eu
{ "wow_accounts": [ { "id": 1234567, "characters": [ {
    "character": { "href": "https://eu.api.blizzard.com/profile/wow/character/davina-asaria?namespace=profile-forever-eu" },
    "protected_character": { "href": "https://eu.api.blizzard.com/profile/user/wow/protected-character/6855-716333?namespace=profile-forever-eu" },
    "name": "Davina", "surname": "Asaria", "id": 716333,
    "playable_class": { "name": "Priest", "id": 5 }, "playable_race": { "name": "Troll", "id": 8 },
    "gender": { "type": "FEMALE", "name": "Female" }, "faction": { "type": "HORDE", "name": "Horde" },
    "level": 23 } ] } ] }

// bnet/realm-6855.json — GET /data/wow/realm/6855?namespace=dynamic-forever-eu
{ "id": 6855, "name": "CAMWOW EU5 Realm 1 PvE", "slug": "camwow-eu5-realm-1-pve",
  "region": { "name": "CAMWOW Europe", "id": 93 }, "locale": "enGB", "timezone": "Europe/Paris",
  "type": { "type": "NORMAL", "name": "Normal" } }

// bnet/token.json — POST https://oauth.battle.net/token
{ "access_token": "test-user-token", "token_type": "bearer", "expires_in": 86400, "scope": "wow.profile" }
```

Formes reprises des relevés communautaires du 4 novembre ; `account-profile.404.json` simule un compte sans perso Forever ou avec le partage désactivé.

### Stubs de l'API WoW (tests addon)

`addon/tests/wow_stubs.lua`, chargé par `lupa` avant l'addon :

- Identité : `UnitName("player")` → `"Davina", "Asaria"`, `UnitGUID`, `GetCurrentRegion()` → 3, `GetRealmName`, `RegionalUniqueNamesEnabled()` → `true`.
- État : `UnitLevel`, `UnitXP`, `UnitXPMax`, `GetXPExhaustion`, `GetMoney`, `GetRealZoneText`, `GetSubZoneText`, `GetGuildInfo`, `GetInventoryItemLink`, `IsInInstance`, `UnitOnTaxi`, `UnitIsDeadOrGhost`, `InCombatLockdown`, tous pilotables depuis le test.
- Temps : `GetServerTime()` contrôlable ; `C_Timer.NewTicker` qui avance à la demande.
- Frames : `CreateFrame` minimal (`RegisterEvent`, `SetScript`, `Show`, `Hide`) et une fonction `fire(event, ...)` pour simuler les événements.
- `ReloadUI` espion : les tests vérifient qu'il n'est appelé que via un clic simulé ou `/ftr sync`.
- `RequestTimePlayed` qui déclenche `TIME_PLAYED_MSG` avec des valeurs fixées.

### Faux client

`tools/fake-client` (Node, sans dépendance au jeu) : `pair <code>`, `heartbeat --running|--stopped`, `sync --fixture <fichier>`, et `scenario <fichier>` qui rejoue une suite d'appels avec des délais (par exemple : lancement du jeu, synchro, niveau, arrêt). C'est l'outil des tests e2e et du test manuel sur le serveur Discord de test.

## Environnement de dev local (Windows, PowerShell)

### À installer

- Node LTS, Git, `gh`.
- Docker Desktop (Postgres de dev).
- Python 3 puis `pip install pytest lupa` (tests addon).
- Flutter SDK avec le support Windows desktop (Visual Studio, charge « Développement Desktop en C++ »).

### Serveur

```powershell
docker compose -f docker-compose.dev.yml up -d   # postgres:16 sur localhost:5432
cd server
Copy-Item .env.example .env                      # remplir les secrets
npm ci
npx prisma migrate dev
npm run start:dev                                # API sur http://localhost:3000
```

- En dev, ajouter `DISCORD_DEV_GUILD_ID` : les commandes sont alors enregistrées sur le serveur de test seulement, et prises en compte immédiatement.
- `.env.example` liste toutes les variables de la spec serveur, sans valeur secrète.
- Callback Battle.net en dev : déclarer `http://localhost:3000/oauth/bnet/callback` sur develop.battle.net. Si le portail le refuse, passer par un tunnel HTTPS (par exemple un sous-domaine de dev sur ton VPS).

### Addon

`tools/link-addon.ps1` crée une jonction pour éditer l'addon dans le dépôt et le tester directement en jeu :

```powershell
param([string]$WowRoot = "C:\Program Files (x86)\World of Warcraft")
$target = Join-Path $PSScriptRoot "..\addon\ForeverTracker" | Resolve-Path
$link   = Join-Path $WowRoot "_forever_\Interface\AddOns\ForeverTracker"
if (Test-Path $link) { Remove-Item $link -Force }
New-Item -ItemType Junction -Path $link -Target $target | Out-Null
Write-Host "Linked $link -> $target"
```

En jeu : `/console scriptErrors 1` pour voir les erreurs Lua, puis `/reload` après chaque modification.

### Appli

```powershell
cd companion
flutter test
flutter run -d windows --dart-define=API_BASE_URL=http://localhost:3000
```

### Boucle de test manuelle

1. Base + serveur démarrés, bot présent sur le serveur Discord de test, `/setup` fait.
2. `/lier appli` → `node tools/fake-client pair <code>`.
3. `node tools/fake-client scenario contract/fixtures/scenarios/session-levelup.json`.
4. Vérifier le tableau et les logs dans Discord.

## Backlog

37 tâches en 7 jalons, chacune = une branche + une PR. Les critères d'acceptation des specs servent de tests de fin de jalon. Ordre conseillé : M0 → M3 en série ; M4 (addon) et M5 (appli) peuvent avancer en parallèle dès que M1 est fini, dans des worktrees séparés.

### M0 — Socle

- [ ] **S-01** Monorepo : `CLAUDE.md`, `docs/`, `contract/schemas` + `contract/fixtures`, `docker-compose.dev.yml`, workflows CI vides.
- [ ] **S-02** Squelette NestJS, config validée au démarrage (variables obligatoires), `GET /health`, `schema.prisma` complet + première migration.
- [ ] **S-03** Validation du contrat : chargement des schémas avec `ajv`, tests sur toutes les fixtures JSON.
- [ ] **S-04** Parseur de littéraux Lua en TypeScript + normalisation guidée par le schéma ; tests sur les 4 fixtures SavedVariables.

### M1 — Ingestion et présence

- [ ] **S-05** Démarrage du bot, enregistrement des commandes (serveur de test en dev), `/setup` avec création des salons et permissions.
- [ ] **S-06** `/perso ajouter`, `principal`, `retirer`, `liste` ; règles d'appartenance (2 persos suivis, un seul propriétaire).
- [ ] **S-07** Appairage : `/lier appli`, `POST /v1/devices/pair`, garde d'authentification Bearer, `DELETE /v1/devices/me`, limites de débit.
- [ ] **S-08** `POST /v1/sync` : validation, rattachement auto, snapshots, déduplication des événements, flags `regression` et `suspect_level_jump`.
- [ ] **S-09** `POST /v1/heartbeat` + moteur de présence : ouverture, découpage par perso, fermeture (`game_closed`, `heartbeat_timeout`), récap.
- [ ] **S-10** `tools/fake-client` (pair, heartbeat, sync, scenario) + scénario `session-levelup.json`.

### M2 — Rendu Discord

- [ ] **S-11** Rendu du tableau en fonction pure (tri, barres, confidentialité, découpage ≤ 3 800 caractères) + tests.
- [ ] **S-12** Publication du tableau : debounce 15 s, hash de contenu, multi-messages, reprise sur `10008` / `10003` / `50013`.
- [ ] **S-13** Logs : rendu pur + file par salon (1,5 s, regroupement 10 s), `published_at`, règle des 24 h, palier d'annonce.
- [ ] **S-14** `/profil`, `/session`, `/classement`.
- [ ] **S-15** `/confidentialite`, `/quitter`, `/config`, `/admin perso`, `/admin rafraichir`, `/admin suspects`.

### M3 — Battle.net et mode de base

- [ ] **S-16** Client Battle.net isolé : jeton applicatif, cache de l'index des royaumes (24 h), file et 429 ; tests `nock`.
- [ ] **S-17** `/lier battlenet` : `oauth_state`, callback, échange du code, profil de compte, rattachement et vérification, édition de la réponse éphémère avec menus principal / secondaire.
- [ ] **S-18** Mode de base : stockage chiffré du jeton (`bnet_token`), relevé toutes les 10 min pendant 24 h, événements déduits, affichage « mode de base ».
- [ ] **S-19** `/sync code:` (FT1, inflate, schéma `share-code.payload`) et `/sync fichier:` (parseur Lua).
- [ ] **S-20** Sonde quotidienne de la fiche publique et relevés adaptatifs derrière `BNET_PUBLIC_PROFILE`, avec `If-Modified-Since`.

### M4 — Addon

- [ ] **A-01** TOC, `Core.lua`, initialisation de `ForeverTrackerDB`, harnais `pytest` + `lupa` + `wow_stubs.lua`.
- [ ] **A-02** Identité (prénom, nom, GUID, région) et snapshot sur les appels « sûrs ».
- [ ] **A-03** Appels « à vérifier » (métiers, réputations, ilvl, honneur) protégés par des tests d'existence.
- [ ] **A-04** Journal d'événements : ids, plafond de 300, `SESSION_START` / `END`, `LEVEL_UP`, `DEATH`, `DUNGEON_ENTER`, `GUILD_CHANGE`, `PROFESSION_TIER`.
- [ ] **A-05** Fenêtre Synchroniser (minuteur, conditions, report, masquage en combat), raccourci clavier, commandes `/ftr`.
- [ ] **A-06** `/ftr share` (sérialiseur JSON, LibDeflate, base64url, `FT1:`) ; un test génère un code que les tests serveur de S-19 décodent.
- [ ] **A-07** Validation en jeu sur le client live (checklist de la spec), résultats des appels « à vérifier » dans le README, zip de release.

### M5 — Appli compagnon

- [ ] **C-01** Projet Flutter Windows, icône de barre système, stockage des réglages.
- [ ] **C-02** Parseur de littéraux Lua en Dart + normalisation ; mêmes fixtures que S-04.
- [ ] **C-03** Détection du dossier `_forever_`, découverte des fichiers SavedVariables, watcher avec attente de stabilité.
- [ ] **C-04** Détection du processus du jeu (état lancé / arrêté toutes les 5 s).
- [ ] **C-05** Client API, fenêtre de premier lancement, appairage, jeton dans le stockage sécurisé Windows.
- [ ] **C-06** Battements, envoi des synchros, ensemble des ids déjà envoyés.
- [ ] **C-07** File hors ligne avec délais croissants, gestion du `401`.
- [ ] **C-08** Démarrage avec Windows, installeur, release GitHub, vérification de mise à jour.

### M6 — Mise en production

- [ ] **S-21** `Dockerfile`, `docker-compose.yml` de prod, entrée Caddy, sauvegarde `pg_dump` quotidienne, doc de déploiement.
- [ ] **S-22** Test de bout en bout réel : jeu + addon + appli + bot sur le serveur de test, puis mode de base avec un 2e joueur sans appli.

## Prompts de lancement

À coller dans Claude Code, à la racine du dépôt. Un prompt par tâche ; relancer une session propre entre deux tâches.

### Première session (S-01)

```text
Lis CLAUDE.md, puis docs/03-getting-started.md (sections Dépôt, Contrat partagé, Fixtures et bouchons)
et la section « Contrat d'échange » de docs/02-spec-server.md.
Réalise uniquement la tâche S-01 du backlog :
- crée l'arborescence du monorepo décrite dans la section Dépôt ;
- écris les JSON Schemas de contract/schemas/ (sync.request.json est donné en entier, déduis les autres
  du tableau « Autres schémas » et du contrat d'échange) ;
- écris les fixtures de contract/fixtures/ listées dans la section Fixtures ;
- ajoute docker-compose.dev.yml (postgres:16) et des workflows CI qui ne font encore rien.
Avant d'écrire un fichier, liste ce que tu vas créer et attends mon OK.
Branche task/S-01-monorepo, commits Conventional, puis PR avec gh pr create.
```

### Modèle pour chaque tâche suivante

```text
Tâche <ID> du backlog de docs/03-getting-started.md.
1. Lis CLAUDE.md et les sections de spec qui concernent cette tâche.
2. Résume en 5 lignes ce que tu vas faire, les fichiers touchés et les tests prévus. Attends mon OK.
3. Branche task/<ID>-<slug>. TDD : écris d'abord les tests (ils doivent échouer), puis le code.
4. Lance les tests et le lint du package concerné ; tout doit être vert.
5. PR avec gh pr create : résumé, critères d'acceptation cochés, ce que je dois vérifier à la main.
Si la spec est floue ou contredit le code, arrête-toi et pose la question. Pas de nouvelle dépendance sans mon accord.
```

### Ajouts selon le package

- **Addon (A-xx)** : « Lua 5.1 uniquement, aucun accès réseau, aucune globale hors `ForeverTrackerDB`, `SLASH_FTR1` et le binding. Chaque appel marqué "à vérifier" dans docs/01 est protégé par un test d'existence. Les tests passent par `addon/tests` avec lupa et les stubs ; ajoute un stub plutôt que de supposer le comportement du jeu. »
- **Appli (C-xx)** : « Flutter Windows. Propose-moi la liste des packages (barre système, démarrage avec Windows, stockage sécurisé, accès aux processus) avec une alternative chacun, avant de les ajouter. Le parseur Lua est écrit à la main et passe les mêmes fixtures que le serveur. »
- **Battle.net (S-16 à S-20)** : « L'API Forever n'est pas documentée : n'utilise que les routes et champs listés dans docs/02 et les fixtures bnet ; aucun appel réel dans les tests. »
- **A-07 (validation en jeu)** : « Rédige la checklist de test manuel en jeu à partir des critères d'acceptation de docs/01, avec pour chaque appel "à vérifier" une commande `/dump` à taper et le résultat attendu. Je ferai les tests et je te donnerai les résultats. »

## Décisions ouvertes

Les specs avancent avec une valeur par défaut pour chaque point ; il suffit de la changer ici avant la tâche indiquée.

| Décision | Défaut dans les specs | À trancher avant |
| --- | --- | --- |
| Nom du projet, de l'addon et de la commande | ForeverTracker, `/ftr` | S-01 |
| Domaine de l'API | `forever.vsgsrv.fr` sur ton VPS | S-17 (redirection OAuth) |
| Techno de l'appli | Flutter Windows (alternatives : Tauri, .NET) | C-01 |
| Langue du bot | Français uniquement | S-05 |
| Intervalle des battements / de la fenêtre Synchroniser | 10 min / 15 min | S-09, A-05 |
| Logs des morts activés par défaut | Non (`log_deaths = false`) | S-13 |
| Régions acceptées | EU par défaut, US, KR, TW possibles | S-06 |
| Distribution de l'addon | Releases GitHub, CurseForge plus tard | A-07 |
| Support macOS de l'appli | v2 | C-08 |
| Comportement au 3e perso d'un joueur | Stocké en `untracked`, non affiché | S-08 |
