# Spec technique — bot Discord et serveur

## Périmètre et stack

Un seul service Node, **ForeverTracker Server**, contient l'API HTTP, le bot Discord et les tâches planifiées ; il partage une base PostgreSQL. Il reçoit les données de l'appli compagnon (onglet addon + appli) et les rend dans Discord.

### Stack

- Node LTS, TypeScript strict.
- NestJS : API d'ingestion, callback OAuth Battle.net, `GET /health`.
- discord.js v14 dans un module Nest, slash commands, Components V2 pour le tableau.
- PostgreSQL 16, ORM au choix (Prisma ou TypeORM), migrations versionnées.
- Docker Compose (service + base) derrière Caddy pour le HTTPS.
- Tests : unitaires sur les règles (présence, validation, rendu du tableau), e2e sur l'API avec une base de test.

### Modules

| Module | Rôle |
| --- | --- |
| `core` | Serveurs Discord, joueurs, personnages, appartenance |
| `ingest` | Appairage, battements, synchros, validation, déduplication |
| `presence` | Sessions, passage en ligne / hors ligne, expiration des battements |
| `discord` | Commandes, rendu du tableau, publication des logs, file d'envoi |
| `bnet` | OAuth joueur, client API Blizzard Forever |
| `jobs` | Tâches planifiées (expiration, débounce du tableau, nettoyage) |

Les modules communiquent par événements internes (`character.updated`, `session.started`, `session.ended`, `event.recorded`, `character.tracked`) : `ingest`, `presence` et `core` les émettent, `discord` les consomme.

## Contrat d'échange

Quatre endpoints JSON sous `https://<domaine>/v1`, authentifiés par jeton d'appareil (`Authorization: Bearer <deviceToken>`) sauf l'appairage. C'est la référence unique pour l'appli et le serveur.

| Méthode | Chemin | Auth | Limite par appareil |
| --- | --- | --- | --- |
| POST | `/v1/devices/pair` | Aucune | 5 / min par IP |
| POST | `/v1/heartbeat` | Bearer | 2 / min |
| POST | `/v1/sync` | Bearer | 2 / min, 512 Ko max |
| DELETE | `/v1/devices/me` | Bearer | — |

### Appairage

Le code vient de `/lier appli` : 8 caractères sans ambiguïté (pas de 0/O, 1/I), valable 10 min, usage unique, rattaché au membre Discord.

```json
POST /v1/devices/pair
{ "code": "K7P29QXM", "deviceName": "PC-salon", "appVersion": "0.1.0", "os": "windows" }

201
{ "deviceId": "6f1c…", "deviceToken": "<43 caractères base64url>", "heartbeatIntervalSec": 600 }
```

Erreurs : `404 code_unknown`, `410 code_expired`, `409 code_used`. Le serveur ne stocke que le SHA-256 du jeton.

Comportement (S-07) :

- `/lier appli` ne stocke que le SHA-256 du code. Il crée aussi au besoin les lignes `player`, `guild_config` (valeurs par défaut, une ligne existante n'est pas modifiée) et `membership` du serveur où la commande est lancée.
- Un code déjà utilisé donne `409 code_used`, même s'il a aussi expiré. Le code est consommé et l'appareil créé dans une même transaction : deux envois simultanés du même code ne créent qu'un appareil.
- Le corps est validé par `pair.request.json` (`400 validation_failed`, JSON mal formé compris). La limite de 5 / min par IP s'applique avant la validation : les essais invalides comptent aussi.
- Garde Bearer (`DeviceAuthGuard`, réutilisable sur toute route `/v1`) : jeton absent, mal formé, inconnu, appareil révoqué ou joueur supprimé → `401 invalid_token`. Chaque appel accepté met à jour `last_seen_at`.
- `DELETE /v1/devices/me` → `204` ; il révoque l'appareil appelant uniquement.
- Les limites de débit sont tenues en mémoire (un seul processus), par route : fenêtre glissante d'une minute, remise à zéro au redémarrage. `Retry-After` donne en secondes le délai avant la prochaine place libre. L'IP du client est lue dans `X-Forwarded-For` en faisant confiance à un seul proxy (Caddy).

### Battement

```json
POST /v1/heartbeat
{ "sentAt": 1793900000, "gameRunning": true, "appVersion": "0.1.0",
  "lastCharacter": { "region": "eu", "firstName": "Davina", "surname": "Asaria" } }

200
{ "heartbeatIntervalSec": 600, "serverTime": 1793900002 }
```

`lastCharacter` est facultatif (inconnu tant que l'addon n'a rien écrit).

### Synchro

```json
POST /v1/sync
{ "sentAt": 1793900000, "schema": 1, "addonVersion": "0.1.0",
  "characters": [
    { "key": { "region": "eu", "firstName": "Davina", "surname": "Asaria",
                "guid": "Player-4242-0A1B2C3D", "realmName": "CAMWOW EU5 Realm 1 PvE" },
      "snapshot": { "capturedAt": 1793900000, "level": 23, "xp": 4120, "xpMax": 13600, "money": 384512,
                    "playedTotal": 81234, "zone": "Duskwood", "classFile": "PRIEST", "…": "mêmes champs que les SavedVariables" },
      "events": [ { "id": "Player-4242-0A1B2C3D-1793899800-2", "type": "LEVEL_UP", "at": 1793899800,
                    "data": { "level": 23, "zone": "Duskwood" } } ] } ] }

200
{ "heartbeatIntervalSec": 600,
  "results": [ { "key": { "region": "eu", "firstName": "Davina", "surname": "Asaria" },
                 "status": "ok", "acceptedEvents": 1, "duplicateEvents": 0, "flags": [] } ] }
```

`status` par perso : `ok` · `untracked` (perso du joueur mais au-delà de ses deux persos suivis : stocké, pas affiché) · `owned_by_other` (déjà rattaché à un autre membre : rien stocké) · `rejected` (validation échouée, détail dans `flags`).

Comportement (S-08) :

- Ordre des contrôles : jeton et limite de débit, taille (512 Kio, `413 payload_too_large`), `schema` numérique différent de 1 → `422 unknown_schema`, puis `sync.request.json` → `400 validation_failed`. Chaque perso est ensuite traité seul, dans sa propre transaction : un perso refusé n'empêche pas les autres.
- Flags de refus (`rejected` ; rien n'est stocké pour ce perso : ni rattachement, ni snapshot, ni événement) : `future_timestamp` (`capturedAt` ou un `at` à plus de 5 min dans le futur), `level_above_cap` (niveau au-delà de `LEVEL_CAP`), `regression`.
- Snapshot pas plus récent que le dernier stocké (`capturedAt` inférieur **ou égal**) : ignoré, pas de nouveau snapshot ; ses événements nouveaux sont quand même enregistrés (file hors ligne vidée en retard).
- Rattachement : un perso inconnu ou sans propriétaire prend le premier rôle libre du propriétaire de l'appareil (principal, puis secondaire), sinon `untracked`. Un perso du joueur garde son rôle ; un perso `untracked` répond `untracked` mais tout est stocké. La recherche ignore la casse ; la `key` de la réponse reprend celle envoyée.
- Un snapshot stocké met à jour `guid`, `realm_name`, `class_file`, `race_file` et `faction` du perso. Les champs sans colonne (équipement, métiers, réputations, `rested`, `playedLevel`…) vont dans `detail`.
- `suspect_level_jump` est posé sur le snapshot **et** sur les événements de la même synchro : enregistrés, jamais publiés.
- Un événement déjà connu, ou répété dans le même envoi, compte dans `duplicateEvents`.
- Après chaque transaction validée : `character.updated` si un snapshot a été stocké, `event.recorded` pour chaque événement nouveau (dans l'ordre de l'addon). Les deux portent `characterId`, `ownerId`, `role`, `source` et `flags` ; les doublons n'émettent rien. Bus : `@nestjs/event-emitter` (noms dans `SYNC_EVENTS`, `server/src/ingest/sync/sync.events.ts`).
- `SyncService.ingest` prend une `source` : `app` pour `POST /v1/sync`, `manual` pour `/sync` (S-19).

### Règles de validation

- `region` ∈ `eu`, `us`, `kr`, `tw` ; prénom et nom 2-12 caractères ; `level` entre 1 et `LEVEL_CAP` (60).
- `capturedAt` et `at` pas plus de 5 min dans le futur.
- Snapshot plus ancien que le dernier stocké : ignoré sans erreur. Niveau ou `playedTotal` en baisse : rejeté, flag `regression`.
- Plus de 5 niveaux gagnés entre deux snapshots espacés de moins de 15 min : stocké avec le flag `suspect_level_jump`, événements non publiés dans Discord.
- Événements dédupliqués par `(character_id, event_id)` ; doublons comptés, jamais une erreur.
- Perso inconnu du serveur et non rattaché : rattaché automatiquement au propriétaire de l'appareil s'il suit moins de deux persos (le premier devient principal), sinon `untracked`.

### Erreurs

Format commun : `{ "error": { "code": "…", "message": "…" } }`. `400 validation_failed`, `401 invalid_token`, `413 payload_too_large`, `422 unknown_schema`, `429 rate_limited` avec en-tête `Retry-After`.

## Modèle de données

Un joueur Discord possède ses persos une fois pour toutes ; chaque serveur Discord choisit qui il affiche via `membership`. Schéma de référence (PostgreSQL, à traduire dans l'ORM choisi) :

```sql
CREATE TABLE guild_config (
  guild_id            TEXT PRIMARY KEY,          -- id du serveur Discord
  board_channel_id    TEXT,
  board_message_ids   TEXT[] NOT NULL DEFAULT '{}', -- 1 ou plusieurs messages si pagination
  logs_channel_id     TEXT,
  level_announce_step INT  NOT NULL DEFAULT 1,     -- 1 = chaque niveau, 10 = tous les 10
  log_deaths          BOOLEAN NOT NULL DEFAULT false,
  board_sort          TEXT NOT NULL DEFAULT 'level', -- level | played | name
  timezone            TEXT NOT NULL DEFAULT 'Europe/Paris',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE player (
  discord_user_id TEXT PRIMARY KEY,
  hide_money      BOOLEAN NOT NULL DEFAULT false,
  hide_zone       BOOLEAN NOT NULL DEFAULT false,
  hide_presence   BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE membership (                       -- joueur affiché sur tel serveur
  guild_id        TEXT REFERENCES guild_config ON DELETE CASCADE,
  discord_user_id TEXT REFERENCES player ON DELETE CASCADE,
  PRIMARY KEY (guild_id, discord_user_id)
);

CREATE TABLE character (
  id              BIGSERIAL PRIMARY KEY,
  region          TEXT NOT NULL,
  first_name      TEXT NOT NULL,
  surname         TEXT NOT NULL,
  guid            TEXT,
  realm_name      TEXT,
  ruleset         TEXT,                          -- NORMAL | PVP | RP | PVP_RP
  class_file      TEXT, race_file TEXT, faction TEXT,
  owner_id        TEXT REFERENCES player ON DELETE SET NULL,
  role            TEXT CHECK (role IN ('main','alt','untracked')),
  bnet_verified   BOOLEAN NOT NULL DEFAULT false,
  last_snapshot_id BIGINT
  -- unicité : CREATE UNIQUE INDEX ON character (region, lower(first_name), lower(surname));
);
-- au plus un 'main' et un 'alt' par owner_id (index partiels uniques)

CREATE TABLE device (
  id            UUID PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES player ON DELETE CASCADE,
  token_sha256  TEXT NOT NULL UNIQUE,
  name TEXT, app_version TEXT, os TEXT,
  last_seen_at  TIMESTAMPTZ,
  game_running  BOOLEAN NOT NULL DEFAULT false,
  revoked_at    TIMESTAMPTZ
);

CREATE TABLE pairing_code (
  code_sha256 TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES player ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE TABLE snapshot (
  id           BIGSERIAL PRIMARY KEY,
  character_id BIGINT NOT NULL REFERENCES character ON DELETE CASCADE,
  captured_at  TIMESTAMPTZ NOT NULL,
  level INT NOT NULL, xp INT, xp_max INT, money BIGINT, played_total INT,
  zone TEXT, sub_zone TEXT,
  detail       JSONB NOT NULL,                   -- équipement, métiers, réputations, etc.
  source       TEXT NOT NULL DEFAULT 'app',      -- app | manual | bnet_account | bnet_public
  flags        TEXT[] NOT NULL DEFAULT '{}',
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE game_session (
  id           BIGSERIAL PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES player ON DELETE CASCADE,
  character_id BIGINT REFERENCES character,      -- connu après la 1re synchro
  started_at   TIMESTAMPTZ NOT NULL,
  ended_at     TIMESTAMPTZ,
  end_reason   TEXT,                             -- game_closed | heartbeat_timeout | character_changed
  level_start INT, level_end INT, money_start BIGINT, money_end BIGINT,
  played_start INT, played_end INT
);

CREATE TABLE game_event (
  id           BIGSERIAL PRIMARY KEY,
  character_id BIGINT NOT NULL REFERENCES character ON DELETE CASCADE,
  event_id     TEXT NOT NULL,                    -- id fourni par l'addon
  type         TEXT NOT NULL,
  at           TIMESTAMPTZ NOT NULL,
  data         JSONB NOT NULL,
  flags        TEXT[] NOT NULL DEFAULT '{}',
  published_at TIMESTAMPTZ,                      -- null = pas encore posté dans les logs
  UNIQUE (character_id, event_id)
);

CREATE TABLE bnet_token (                       -- mode de base uniquement
  owner_id        TEXT PRIMARY KEY REFERENCES player ON DELETE CASCADE,
  region          TEXT NOT NULL,
  token_encrypted BYTEA NOT NULL,                 -- AES-256-GCM, clé TOKEN_ENC_KEY
  expires_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE oauth_state (                      -- flux /lier battlenet
  state_sha256      TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL REFERENCES player ON DELETE CASCADE,
  guild_id          TEXT,
  region            TEXT NOT NULL,
  interaction_token TEXT NOT NULL,              -- pour éditer la réponse éphémère (15 min)
  expires_at        TIMESTAMPTZ NOT NULL,
  used_at           TIMESTAMPTZ
);
```

- `/quitter` supprime la ligne `player` : persos détachés (`owner_id` à null, rôle `untracked`), appareils, sessions et appartenances effacés ; snapshots et événements effacés avec les persos orphelins par une tâche de nettoyage.
- Rétention : snapshots à 1 par heure au-delà de 30 jours, événements conservés.

## Présence et sessions

Un joueur est **en ligne** si au moins un de ses appareils non révoqués a `game_running = true` et un battement reçu depuis moins de 2,5 × l'intervalle (25 min avec l'intervalle par défaut de 10 min).

### Transitions

| Situation | Action |
| --- | --- |
| Battement `gameRunning: true` alors que le joueur est hors ligne | Ouvrir une `game_session` (perso = `lastCharacter` s'il est connu), émettre `session.started` |
| Synchro pendant une session ouverte | Renseigner le perso s'il manquait ; valeurs de départ depuis le dernier snapshot d'avant la session (à défaut le premier snapshot de la session), niveau depuis le `SESSION_START` de l'addon ; mettre à jour les valeurs de fin |
| `SESSION_START` d'un autre perso pendant la session | Fermer la session courante (`character_changed`), en ouvrir une nouvelle pour ce perso |
| Battement `gameRunning: false` et aucun autre appareil actif | Attendre 90 s une éventuelle synchro finale, puis fermer (`game_closed`) et émettre `session.ended` |
| Plus de battement depuis le délai d'expiration | Tâche chaque minute : fermer (`heartbeat_timeout`) et émettre `session.ended` |

### Récap de session

Calculé à la fermeture : durée, niveaux gagnés (`level_end - level_start`), or gagné ou perdu, temps de jeu ajouté (`played_end - played_start`), zone de fin, nombre de morts (événements `DEATH` de la période).

- Session de moins de 2 min sans aucun changement : fermée sans log (simple lancement / fermeture du jeu).
- `hide_presence` : la session est enregistrée mais ni la pastille ni les logs de connexion ne sont affichés pour ce joueur.

### Comportement (S-09)

- `POST /v1/heartbeat` : garde Bearer, 2 / min par appareil, corps validé par `heartbeat.request.json` (`400 validation_failed`). Met à jour `game_running`, `app_version` et `last_seen_at` de l'appareil, puis répond `{ heartbeatIntervalSec, serverTime }`. Toutes les heures de présence sont celles de **réception** côté serveur, jamais `sentAt`. `last_seen_at` est aussi rafraîchi par toute autre requête de l'appareil (garde Bearer).
- Machine d'état pure (`server/src/presence/presence-machine.ts`), une ligne du tableau Transitions par branche ; `PresenceService` l'alimente avec les battements, les événements internes de la synchro (`character.updated`, `event.recorded` de type `SESSION_START`, source `app` seulement : un `/sync` manuel ne touche pas aux sessions) et les ticks. Un joueur a au plus une session ouverte ; ses entrées sont traitées une à une, sous le même verrou de ligne `player` que la synchro.
- Un battement `gameRunning: true` alors qu'une session est encore ouverte mais que le joueur est hors ligne (jeu relancé pendant l'attente de 90 s, ou battements expirés pas encore traités par la tâche) ferme d'abord l'ancienne session (`game_closed` ou `heartbeat_timeout`), puis en ouvre une nouvelle. Un battement ne change jamais le perso d'une session ; il le renseigne seulement s'il manquait.
- Snapshots et `SESSION_START` d'avant la session (plus de 5 min avant `started_at`, marge d'horloge client) sont ignorés, comme les snapshots d'un autre perso (la synchro envoie tous les persos du compte). Découpage : la session courante se ferme à l'heure du `SESSION_START` de l'autre perso, la nouvelle s'ouvre à cette même heure.
- Niveau de départ : le plus bas des `SESSION_START` du perso dans la session (un `/reload` en produit un nouveau), sinon celui du snapshot de départ.
- Fermeture `game_closed` : `ended_at` = heure du battement d'arrêt ; la fermeture a lieu 90 s plus tard (minuterie en mémoire, et la tâche chaque minute en secours après un redémarrage, l'heure d'arrêt étant alors relue dans le `last_seen_at` de l'appareil arrêté). `heartbeat_timeout` : `ended_at` = dernier contact de l'appareil.
- `end_reason` ∈ `game_closed` · `heartbeat_timeout` · `character_changed`.
- Événements (`PRESENCE_EVENTS`, `server/src/presence/presence.events.ts`), émis après validation de la transaction : `session.started` (`sessionId`, `ownerId`, `characterId` éventuellement null, `startedAt`) et `session.ended` (mêmes champs + `endedAt`, `reason`, `recap`, `quiet`). `recap` : `durationSec`, `levelStart`, `levelEnd`, `levelsGained`, `moneyDelta` (cuivre, négatif si perte), `playedAddedSec`, `endZone`, `endSubZone`, `deaths` ; une valeur dont un bout manque vaut null. La zone de fin vient du dernier snapshot de la session ; le rendu choisit zone ou sous-zone (« fin à Darkshire » est une sous-zone).
- `quiet` (pas de log) : moins de 2 min **et** ni niveau gagné, ni or gagné ou perdu, ni mort. Le temps de jeu ajouté seul ne compte pas comme un changement.

## Commandes Discord

Slash commands uniquement, enregistrées globalement ; intents `Guilds` seulement. Toute commande qui appelle la base ou une API répond d'abord par `deferReply`. Un joueur apparaît sur le tableau d'un serveur dès qu'il y utilise `/perso ajouter` ou `/lier` (ligne `membership`).

### Joueur

| Commande | Options | Réponse | Comportement |
| --- | --- | --- | --- |
| `/lier appli` | — | Éphémère | Génère le code d'appairage (8 caractères, 10 min) et le lien de téléchargement de l'appli |
| `/lier battlenet` | — | Éphémère | Lien OAuth à usage unique (section Liaison Battle.net) |
| `/perso ajouter` | `prenom`, `nom`, `region` (EU par défaut, US, KR, TW), `role` (principal, secondaire) | Éphémère | Crée ou rattache le perso ; refus si un autre membre le possède ou si le rôle est déjà pris (proposer `/perso principal`) |
| `/perso principal` | `perso` (autocomplétion) | Éphémère | Ce perso devient principal, l'ancien principal devient secondaire |
| `/perso retirer` | `perso` | Éphémère | Passe le perso en `untracked` |
| `/perso liste` | — | Éphémère | Persos du joueur, rôle, dernière synchro, vérifié Battle.net ou non |
| `/profil` | `membre` (facultatif), `perso` (facultatif) | Publique | Fiche : niveau et barre d'XP, temps joué, or, zone, guilde, équipement (ilvl), métiers, réputations clés, 10 derniers niveaux avec dates |
| `/session` | `membre` (facultatif) | Publique | Récap de la dernière session terminée, ou session en cours |
| `/classement` | `critere` : niveau, temps joué, rythme (niveaux par heure jouée), or, morts | Publique | Top 15 des membres du serveur, persos principaux |
| `/confidentialite` | `or`, `zone`, `presence` (booléens) | Éphémère | Masque ces infos partout |
| `/quitter` | — | Éphémère avec bouton de confirmation | Supprime le joueur et révoque ses appareils |
| `/sync` | code (texte de /ftr share) ou fichier (ForeverTracker.lua) | Éphémère | Envoi manuel du mode de base (section Mode de base) |

Les valeurs masquées par `/confidentialite` ne sortent ni dans `/profil`, ni dans `/classement`, ni dans le tableau, ni dans les logs.

Comportement de `/perso` (S-06, règles dans `core/characters/character.service.ts`) :

- Noms : 2 à 12 lettres chacun (limite aussi posée sur les options Discord). Un perso créé par la commande est stocké en NFC, sans espaces autour, première lettre en majuscule et le reste en minuscules ; un perso déjà connu garde ses noms stockés. La recherche ignore la casse (`lower()` comme l'index unique).
- `/perso ajouter` sans `role` donne le premier rôle libre : principal, sinon secondaire. Refus, sans rien créer : perso possédé par un autre membre (même `untracked`), rôle demandé déjà pris (on nomme le perso qui l'occupe et on propose de l'ajouter dans l'autre rôle puis `/perso principal`), ou 2 persos déjà suivis. Un perso sans propriétaire est rattaché ; un perso `untracked` du joueur est repris ; un perso déjà suivi par le joueur répond « déjà ton perso … » sans changer son rôle.
- La ligne `membership` du serveur courant (et `guild_config` avec ses valeurs par défaut si `/setup` n'a jamais tourné) n'est créée que si `/perso ajouter` réussit ou si le perso était déjà suivi.
- `/perso principal` sur un secondaire échange les deux rôles ; sur un perso `untracked`, l'ancien principal passe secondaire si la place est libre, sinon refus (« retire ton secondaire »). `/perso retirer` garde le propriétaire et libère le rôle.
- Autocomplétion de `perso` : les persos du joueur (tous sauf le principal pour `principal`, les suivis pour `retirer`), valeur = id du perso. Un texte tapé à la main est aussi accepté s'il désigne un seul perso (« Prénom Nom » ou « Prénom Nom (EU) »).
- `/perso liste` : principal, secondaire puis non suivis ; dernière synchro = réception du dernier snapshot, en heure relative Discord.

Comportement de `/profil`, `/session` et `/classement` (S-14, rendu pur dans `discord/render/profile.ts`, lectures dans `discord/profile/profile-query.service.ts`) :

- Réponses publiques ; les mentions ne notifient personne. Un membre sans ligne `membership` sur ce serveur n'est pas affiché (« aucun perso suivi sur ce serveur »).
- `/profil` : seuls les persos suivis (principal, secondaire) ; sans `perso`, le principal, ou un message demandant l'option s'il n'y en a pas. Autocomplétion de `perso` : les persos suivis du `membre` choisi (l'auteur par défaut). Barre d'XP de 10 segments sur l'XP du niveau (rien au 60) ; or en po / pa / pc ; zone « sous-zone, zone » ; réputations `standing` ≥ 6 (Honoré, Révéré, Exalté), 10 au plus ; 10 derniers `LEVEL_UP` non flagués avec leur date ; heure de la dernière synchro.
- `/session` : la session ouverte, sinon la dernière session terminée qui aurait un récap (on saute celles de moins de 2 min sans changement de niveau ni d'or). Morts = événements `DEATH` non flagués de la période ; zone = dernier snapshot de la période.
- `/classement` : principal de chaque membre du serveur, dernier snapshot. Niveau (égalité départagée par l'XP), temps joué, rythme = (niveau − 1) / heures jouées pour les persos d'au moins 1 h de jeu, or, morts = compteur `deaths` de l'addon. Un perso sans la valeur du critère n'est pas classé.
- Confidentialité : `hide_money` retire l'or de `/profil` et `/session` et le joueur du classement par or (il reste dans les autres) ; `hide_zone` retire la zone ; `hide_presence` retire l'heure de synchro, les heures de session et la session en cours.

### Admin (permission Gérer le serveur)

| Commande | Options | Comportement |
| --- | --- | --- |
| `/setup` | `tableau` (salon, facultatif), `logs` (salon, facultatif) | Crée `#tableau-forever` et `#logs-forever` s'ils ne sont pas fournis, pose les permissions, publie le tableau |
| `/config` | `annonce_niveau` (1, 5, 10), `morts` (oui/non), `tri` (niveau, temps, nom) | Met à jour `guild_config` et reconstruit le tableau |
| `/admin perso` | `membre`, `prenom`, `nom`, `region`, `role` | Comme `/perso ajouter` pour un autre membre |
| `/admin rafraichir` | — | Supprime et republie le tableau |
| `/admin suspects` | — | Liste les snapshots et événements flagués des 7 derniers jours |

Comportement de `/confidentialite`, `/quitter`, `/config` et `/admin` (S-15, services `core/players/player-account.service.ts`, `discord/admin/`, rendus purs dans `discord/privacy/privacy-replies.ts` et `discord/admin/admin-replies.ts`) :

- `/confidentialite` et `/config` sans option affichent les réglages actuels sans rien changer ; avec des options, seules celles données changent (ligne `player` ou `guild_config` créée avec ses valeurs par défaut si besoin), puis les tableaux concernés sont marqués à redessiner.
- `/quitter` répond tout de suite (sans base) avec deux boutons, « Oui, tout supprimer » et « Annuler ». Le bouton de confirmation vaut 60 s, comptées depuis la création du message éphémère (rien n'est gardé en mémoire) ; après, il répond « confirmation expirée » et retire les boutons. La suppression suit la règle du « Modèle de données », sous le verrou de ligne `player` ; un appareil supprimé reçoit `401 invalid_token` à son envoi suivant. Les tableaux des serveurs où le joueur apparaissait sont redessinés.
- Nettoyage : `OrphanCleanupJob` (`server/src/jobs/`), toutes les heures, supprime les persos sans propriétaire avec leurs snapshots et événements.
- Commandes admin : `default_member_permissions` = Gérer le serveur, et la permission est revérifiée à l'exécution (un admin du serveur peut ouvrir la commande à d'autres) ; refus éphémère sinon.
- `/admin perso` : mêmes règles que `/perso ajouter` pour le membre choisi (appartenance créée sur ce serveur) ; refus pour un bot. Les mentions de la réponse ne notifient personne.
- `/admin rafraichir` : au prochain passage autorisé du debounce (15 s depuis la dernière édition), les messages du tableau sont supprimés puis le tableau est republié dans de nouveaux messages, même si le rendu n'a pas changé. Sans tableau configuré : renvoi vers `/setup`.
- `/admin suspects` : snapshots flagués (par `received_at`) et événements flagués (par `at`) des 7 derniers jours, des persos des membres de ce serveur, du plus récent au plus ancien, tronqués à 2 000 caractères avec « … et N de plus ».

Permissions posées par `/setup` sur le salon tableau : refus à @everyone d'Envoyer des messages, Envoyer dans les fils, Créer des fils publics et privés, Ajouter des réactions ; autorisation au bot de Voir le salon, Envoyer des messages, Intégrer des liens, Lire l'historique. Le bot a besoin de Gérer les salons sur le serveur pour poser ces permissions.

Comportement de `/setup` (S-05) :

- Les permissions sont posées à la création de `#tableau-forever`. Discord n'autorise un bot à y mettre que des permissions qu'il possède lui-même sur le serveur : il lui faut donc aussi celles de la liste ci-dessus (en général héritées d'@everyone). S'il en manque, `/setup` les nomme et ne crée rien.
- Un salon existant (option `tableau`, ou salon déjà configuré) n'est jamais modifié : changer ses permissions demanderait Gérer les rôles, que le bot ne demande pas. `/setup` vérifie les refus faits à @everyone et liste en éphémère ce que l'admin doit corriger à la main ; il refuse le salon si le bot ne peut pas y publier.
- `#logs-forever` est créé sans permission particulière ; `/setup` prévient si le bot ne peut pas y écrire.
- Relancer `/setup` réutilise les salons (ids de `guild_config`, puis noms), édite le message du tableau en place, ou le republie s'il a disparu. Si le tableau change de salon, l'ancien message est supprimé.

## Salon tableau et salon logs

### Tableau

Un message Components V2 (un `Container` avec des `TextDisplay`), édité en place ; plusieurs messages si le texte dépasse le budget.

```
WoW: Forever — 12 joueurs suivis · 3 en ligne

🟢 @Kyllian
   Davina Asaria · Prêtre 23 · ▰▰▰▰▱▱▱▱▱▱ 38 % · Darkshire
   ↳ Brom Ferrepied · Guerrier 11 · ▰▰▱▱▱▱▱▱▱▱ 72 %
⚫ @Lina · vu il y a 3 h
   Ilsa Ventbrume · Mage 19 · ▰▰▰▱▱▱▱▱▱▱ 10 %
   ↳ non synchronisé

Mis à jour <t:1793900000:R>
```

Règles de rendu :

- Joueurs en ligne d'abord, puis tri `board_sort` (niveau du principal, temps joué ou nom).
- Barre de 10 segments = niveau / 60 ; pourcentage = XP dans le niveau actuel. Au niveau 60, afficher « 60 » sans barre.
- Zone omise si `hide_zone` ; pastille et « vu il y a » omis si `hide_presence`.
- Perso sans aucun snapshot : « non synchronisé ».
- Horodatage Discord relatif (`<t:…:R>`), mis à jour côté client, donc pas d'édition juste pour l'heure.

Budget : 4 000 caractères de texte et 40 composants par message. Découper par blocs de joueurs ≤ 3 800 caractères ; créer ou supprimer des messages supplémentaires et garder leurs ids dans `board_message_ids`, dans l'ordre.

Debounce : tout `character.updated`, `session.started` ou `session.ended` marque le serveur « à redessiner » ; une tâche toutes les 5 s redessine les serveurs marqués dont la dernière édition date d'au moins 15 s. Ne rien envoyer si le rendu est identique au précédent (hash du contenu).

Reprise : erreur Discord `10008` (message inconnu) → republier et mémoriser le nouvel id ; `10003` (salon inconnu) ou `50013` (permissions manquantes) → désactiver le tableau et prévenir dans le salon logs. Au démarrage du service, redessiner tous les tableaux.

Comportement (S-12) :

- `BoardPublisher` (`server/src/discord/board/`) garde en mémoire, par serveur : marqué ou non, heure du dernier appel à Discord, hash du dernier rendu envoyé et ids visés. Après un redémarrage, tout est perdu et chaque tableau est redessiné une fois (tâche `BoardRedrawJob`, `server/src/jobs/`, toutes les 5 s).
- Hash : rendu recalculé avec une heure fixe, pour que « Mis à jour <t:…:R> » seul ne déclenche jamais d'édition. Un rendu identique ne compte pas comme une édition (le délai de `BOARD_MIN_EDIT_INTERVAL_SEC` ne repart pas).
- Marquage : `character.updated` (sauf persos `untracked`), `session.started` et `session.ended` marquent les serveurs ayant un tableau où le joueur (`ownerId` de l'événement) a une appartenance (noms `SYNC_EVENTS` et `PRESENCE_EVENTS`). `/setup` réussi oublie le hash du serveur, pour remplacer le tableau provisoire au prochain passage.
- Messages : les messages existants sont édités dans l'ordre, ceux en trop supprimés (depuis la fin), les manquants créés ; `board_message_ids` est réécrit seulement s'il change, même après un échec en cours de route. Un `10008` sur le message n°i supprime les messages suivants et republie à partir de i, pour garder l'ordre ; un `10008` à la suppression est ignoré.
- Désactiver le tableau = `board_channel_id` à null et `board_message_ids` vidé (le reste de `guild_config` est gardé) ; plus aucun envoi jusqu'au prochain `/setup`. Message dans le salon logs (sans mention), s'il existe.
- Autre erreur (réseau, 5xx…) : le serveur reste marqué et l'essai suivant attend le délai minimum. Les `429` sont gérés par la file REST de discord.js.
- Présence sur le tableau : mode du joueur selon `playerMode` (S-18). Mode appli : en ligne selon `isOnline` du moteur de présence (S-09), sur les appareils non révoqués ; « vu » = dernier battement de tous ses appareils. Mode de base : jamais en ligne ; « vu » = donnée la plus récente entre le dernier battement et le `received_at` du dernier snapshot du principal ou du secondaire (`last_login_timestamp` n'est stocké nulle part pour l'instant).

### Logs

| Événement | Message | Condition |
| --- | --- | --- |
| Début de session | 🟢 @membre est en jeu — Davina Asaria (niv. 23) | Pas `hide_presence` |
| Fin de session | ⚫ Davina Asaria : 2 h 14 de jeu · niv. 21 → 23 · +38 po · fin à Darkshire · 1 mort | Session ≥ 2 min ou avec un changement |
| Niveau | ⬆️ Davina Asaria passe niveau 24 (81 h de jeu) | `niveau % level_announce_step == 0` |
| Niveau 60 | 🏆 Davina Asaria atteint le niveau 60 en 9 j 4 h de jeu | Toujours |
| Perso suivi | ➕ @membre suit Davina Asaria (principal) | Toujours |
| Mort | 💀 Davina Asaria est morte à Duskwood (niv. 23) | `log_deaths` |
| Guilde | Davina Asaria rejoint \<Les Veilleurs> | Toujours |

- File d'envoi par salon : au plus un message toutes les 1,5 s ; les événements d'un même joueur arrivés à moins de 10 s d'écart sont regroupés en un seul message.
- `published_at` empêche toute double publication.
- Événements reçus plus de 24 h après leur `at` (file hors ligne vidée tard) ou flagués : enregistrés, jamais publiés.
- Or affiché en po / pa / pc à partir du cuivre.

Comportement (S-13, rendu pur dans `discord/render/logs.ts`, règles dans `discord/logs/log-rules.ts`, publication dans `discord/logs/`) :

- Abonnements : `event.recorded`, `session.started`, `session.ended` et `character.tracked`. Ce dernier est émis par `core/characters` après validation quand un perso devient principal ou secondaire alors qu'il était nouveau, sans propriétaire ou `untracked` (`/perso ajouter`, `/admin perso`, `/perso principal` ou menus de rôle sur un perso non suivi) ; un simple échange principal / secondaire n'émet rien.
- Salons visés : le salon logs de chaque serveur où le joueur a une appartenance (`logs_channel_id` renseigné). Mentions affichées sans notifier personne.
- Une ligne par événement ; les lignes d'un même joueur dans un salon attendent 10 s sans nouvelle ligne, puis partent en un message, triées par heure de l'événement (un message plein, 2 000 caractères, part sans attendre et un autre commence). Une tâche (`jobs/logs-send.job.ts`, toutes les 500 ms) envoie au plus un message par salon toutes les 1,5 s ; à l'arrêt propre du serveur, tout ce qui attend part tout de suite.
- Événements de jeu : `LEVEL_UP`, `DEATH` et `GUILD_CHANGE` seulement. Ni flagués, ni d'un perso `untracked`, ni reçus plus de 24 h après leur `at` (heure de réception = traitement de `event.recorded`). `LEVEL_UP` : annoncé si `niveau % level_announce_step == 0`, et le 60 toujours, sous la seule forme 🏆 ; temps de jeu tiré de `data.playedTotal`, omis s'il manque. `DEATH` : seulement dans les serveurs où `log_deaths` est actif ; « morte » si le dernier snapshot a `sex = 3`. `GUILD_CHANGE` : seulement avec un `to` (rejoindre ou changer de guilde) ; un départ sans nouvelle guilde ne publie rien.
- `published_at` est posé dans la base avant la mise en file, et seulement si au moins un serveur publie la ligne (une mort jamais publiée garde `published_at` nul). Un `LEVEL_UP` dont un autre `LEVEL_UP` du même perso et du même niveau est déjà publié (addon et Battle.net) n'est pas publié ni marqué. Ce qui attend en file au moment d'un plantage est perdu, jamais publié deux fois.
- Sessions : début masqué par `hide_presence` ; fin non publiée si `quiet`. `hide_presence` retire la durée de la fin de session, `hide_money` l'or, `hide_zone` la zone (fin de session et morts). Zone de fin : sous-zone, sinon zone. Valeurs inconnues, or inchangé et zéro mort omis. Un perso inconnu ou `untracked` n'est jamais nommé : la ligne nomme le membre.
- Erreur Discord `10003`, `50001` ou `50013` : la file du salon est vidée ; autre erreur : nouvel essai 1,5 s plus tard, message abandonné au 3e échec.
- Mode de base : la fin de session déduite de `last_login_timestamp` n'existe pas encore (rien ne stocke cette valeur, voir S-18), donc pas de fin de session courte pour l'instant.

## Liaison Battle.net

La liaison sert à prouver la propriété des persos et à importer prénom, nom, classe, race, faction et niveau ; le jeton joueur n'est conservé qu'en mode de base, 24 h au plus. L'API Forever n'est pas documentée par Blizzard : tout appel passe par un client isolé dans le module `bnet`.

### Flux

1. `/lier battlenet [region]` : le serveur crée un `state` aléatoire (32 octets, 10 min, usage unique) lié au membre et au **jeton d'interaction** Discord, puis répond en éphémère avec le lien : `https://oauth.battle.net/authorize?client_id=…&redirect_uri=<PUBLIC_BASE_URL>/oauth/bnet/callback&response_type=code&scope=wow.profile&state=<state>`
2. `GET /oauth/bnet/callback?code&state` : vérifier le `state`, puis `POST https://oauth.battle.net/token` (auth Basic client id/secret, `grant_type=authorization_code`, `code`, `redirect_uri`). Jeton valable 24 h, sans jeton de rafraîchissement.
3. `GET https://eu.api.blizzard.com/profile/user/wow?namespace=profile-forever-eu&locale=fr_FR` avec le jeton joueur (hôte et namespace selon la région).
4. Lire `wow_accounts[].characters[]` : `name`, `surname`, `playable_class`, `playable_race`, `faction`, `level`, `id`. Le royaume interne n'est que dans le lien `protected_character` (`…/{realmId}-{characterId}`) ; le ruleset vient de `GET /data/wow/realm/{realmId}?namespace=dynamic-forever-eu`, champ `type.type` (index des royaumes mis en cache 24 h, jeton applicatif).
5. Pour chaque perso : déjà au membre → `bnet_verified = true` ; à un autre membre non vérifié → transféré à ce membre et signalé aux admins ; inconnu → créé en `untracked`.
6. Éditer la réponse éphémère d'origine (le jeton d'interaction vaut 15 min) avec la liste des persos et deux menus déroulants « principal » / « secondaire ». La page web du callback affiche seulement « Liaison réussie, retourne sur Discord ».
7. Mode appli : jeter le jeton joueur. Mode de base : le garder chiffré jusqu'à son expiration (24 h) pour les relevés, puis le supprimer.

### Erreurs

| Cas | Réponse |
| --- | --- |
| `state` inconnu, expiré ou réutilisé | Page d'erreur, inviter à relancer `/lier battlenet` |
| Profil de compte en 404 | « Aucun perso Forever trouvé. Connecte-toi une fois en jeu puis déconnecte-toi, et vérifie que le partage des données de jeu avec les développeurs est activé dans la confidentialité Battle.net. » |
| 401 / 403 sur l'API | Relancer le flux une fois ; sinon message d'erreur générique et log serveur |
| Interaction expirée (> 15 min) | Envoyer le résultat en message privé au membre |

### Comportement (S-17)

Code dans `bnet/oauth/` (callback, `state`, étape 5 dans `CharacterService.linkFromBnet`) et `discord/commands/lier-battlenet.ts`.

- `/lier battlenet` : option `region` (EU, US, KR, TW ; `BNET_DEFAULT_REGION` sans l'option). Comme `/lier appli`, crée la ligne `membership` du serveur. Réponse éphémère avec un bouton lien « Se connecter à Battle.net ». Le lien utilise `BNET_REDIRECT_URI`, qui doit valoir `<PUBLIC_BASE_URL>/oauth/bnet/callback`.
- Le `state` est marqué utilisé dès l'arrivée sur le callback (`UPDATE` conditionnel) : il ne sert qu'une fois, même si la suite échoue. Page d'erreur en 400 avec un texte propre à chaque cas : inconnu, expiré, déjà utilisé.
- Étape 5 : les persos rattachés, créés ou transférés passent en `untracked` et `bnet_verified = true` ; un perso déjà au membre garde son rôle. Un perso possédé par un autre membre **vérifié** n'est pas touché ; la réponse lui dit de contacter un admin. Sont importés : faction, `class_file` et `race_file` (ids classiques seulement, les races Skyborne restent vides), nom du royaume et ruleset ; une valeur absente n'efface jamais une donnée connue. Le niveau n'est qu'affiché : aucun snapshot n'est créé (S-18 crée les snapshots `bnet_account`).
- Transfert « signalé aux admins » : une ligne dans `#logs-forever` de chaque serveur où l'ancien ou le nouveau propriétaire est affiché, sans notification (`allowed_mentions` vide).
- 401 / 403 : un seul nouvel essai avec le même jeton, puis le message générique. Code refusé, Battle.net en panne ou base indisponible : même message générique, page en 502, détail dans le journal du serveur (jamais le code, le `state` ni un jeton).
- Refus de l'autorisation sur Battle.net (`error=access_denied`) : page et message « Liaison annulée ».
- Réponse éphémère : modifiée par le webhook de l'interaction (liste des persos avec niveau, rôle et ce qui leur est arrivé, puis les menus « Perso principal » et « Perso secondaire », 25 persos au plus). Si la modification échoue (jeton d'interaction expiré), le même contenu part en message privé.
- Menus : « principal » fait comme `/perso principal` ; « secondaire » fait de ce perso le secondaire, l'ancien secondaire passe en `untracked`, et le principal est refusé.
- Jeton joueur : `BNET_USER_TOKEN_SINK` le reçoit à la fin d'une liaison réussie : gardé chiffré en mode de base, jeté en mode appli (voir « Comportement (S-18) »).

### Fiche publique (plus tard)

Un job quotidien teste `GET /profile/wow/character/{prénom}-{nom}?namespace=profile-forever-eu` (prénom-nom en minuscules) sur un perso vérifié de niveau 10+. Dès qu'il répond 200, activer le drapeau `BNET_PUBLIC_PROFILE` : les persos sans appli sont rafraîchis toutes les 6 h depuis la fiche publique (niveau, équipement, `last_login_timestamp` affiché comme « vu pour la dernière fois »).

Limites API : 100 requêtes/s et 36 000/h ; le client met en file et respecte les 429.

## Mode de base (sans appli)

Un joueur sans appli reste suivi : le bot relève Battle.net automatiquement, et le joueur peut envoyer le détail de l'addon à la main avec `/sync`. Le mode est déduit par joueur : au moins un appareil actif = mode appli, sinon mode de base.

### Sources et rythme des relevés

| Source | Déclencheur | Fréquence | Données |
| --- | --- | --- | --- |
| Profil de compte (OAuth) | Job | Toutes les 10 min tant que le jeton du joueur est valide (24 h) | Niveau, classe, race, faction |
| Fiche publique (`BNET_PUBLIC_PROFILE`) | Job adaptatif | 10 min si le perso a changé dans les 24 h, 1 h sinon, 6 h si inactif depuis plus de 7 jours | Niveau, équipement, `last_login_timestamp` |
| `/sync` | Le joueur | À la demande, au plus une fois toutes les 2 min | Snapshot complet et événements de l'addon |

- Fiche publique : envoyer `If-Modified-Since` avec le `Last-Modified` reçu ; un `304` ne coûte rien et ne crée rien.
- Jeton OAuth du mode de base : stocké chiffré (AES-GCM, clé `TOKEN_ENC_KEY` en variable d'environnement) dans une table `bnet_token(owner_id, token_encrypted, expires_at)`, supprimé à l'expiration. Après expiration, `/perso liste` affiche un bouton « Relier Battle.net ».
- Chaque snapshot porte sa source : colonne `snapshot.source` ∈ `app`, `manual`, `bnet_account`, `bnet_public`.

### Événements déduits

Battle.net ne fournit pas d'événements : le serveur compare deux relevés successifs.

- Niveau en hausse → un `LEVEL_UP` par niveau gagné, `event_id` = `bnet-<character_id>-<niveau>` (la déduplication évite tout doublon avec un `/sync` ultérieur portant le même niveau, puisque le log est publié une seule fois par niveau via `published_at`).
- `last_login_timestamp` qui avance → fin de session déduite, horodatée avec cette valeur.

### Commande `/sync`

`/sync code:<texte>` ou `/sync fichier:<ForeverTracker.lua>`, réponse éphémère.

- `code` : chaîne produite par `/ftr share` dans l'addon, format `FT1:` + base64url d'un JSON compressé en deflate brut. Décodage : `zlib.inflateRawSync`, puis mêmes validations que `POST /v1/sync`.
- `fichier` : pièce jointe de 512 Ko maximum, parsée avec le même parseur de littéraux Lua que l'appli (jamais exécutée).
- Seuls les persos du membre sont acceptés ; mêmes statuts et flags que le contrat d'échange.

Comportement (S-19, `server/src/ingest/share-code/`, `discord/commands/sync.ts`) :

- Il faut exactement une des deux options ; sinon un rappel d'utilisation, qui ne compte pas comme un essai.
- Limite : un essai par membre toutes les 2 min (fenêtre glissante en mémoire, comme les limites `/v1`). Elle est vérifiée avant tout téléchargement ou décodage : un code illisible ou un fichier refusé compte aussi.
- `code` : espaces et retours à la ligne autour ignorés ; `FT1:` puis uniquement l'alphabet base64url, sinon « pas un code ForeverTracker ». Inflate plafonné à 512 Kio (au-delà : « trop gros »). Deflate ou JSON illisible : « code illisible ». Puis `schema` numérique différent de 1 → « version inconnue », et `share-code.payload.json` (le premier champ fautif est nommé). Le perso est envoyé à `SyncService.ingest` comme une synchro d'un seul perso, `sentAt` du code.
- `fichier` : refusé au-delà de 512 Kio d'après la taille annoncée par Discord, puis pendant la lecture. Seules les URL `https://cdn.discordapp.com` et `media.discordapp.net` sont téléchargées (sans suivre de redirection, 10 s maximum). Expression non littérale → « fichier refusé », autre erreur de syntaxe → « fichier illisible », `ForeverTrackerDB` nil ou sans perso → « aucun perso ». Tous les persos du fichier sont envoyés (`sentAt` = heure du serveur) et validés par `sync.request.json`.
- Un envoi valide crée au besoin les lignes `player`, `guild_config` (valeurs par défaut) et `membership` du serveur courant, comme `/lier`, puis appelle `SyncService.ingest` avec la source `manual`. Rien n'est créé pour un envoi refusé.
- Réponse : une ligne de résumé (persos mis à jour = `ok` ou `untracked`, événements acceptés, doublons), puis une ligne par perso : `ok`, `untracked` (non suivi), `owned_by_other` (rien enregistré), `rejected` avec ses flags en clair, et `suspect_level_jump` signalé comme enregistré mais pas annoncé.

### Affichage en mode de base

- Pas de pastille verte : le tableau affiche « vu il y a X » (dernier `last_login_timestamp` ou dernière donnée reçue) et une mention discrète « mode de base ».
- Logs : pas de log de connexion ; niveaux et 60 publiés comme en mode appli ; fin de session publiée sous forme courte, « Davina Asaria : niv. 21 → 23 », sans durée.
- Délai réaliste : 5 à 15 min après la déconnexion du joueur.

### Comportement (S-18)

Code dans `bnet/polling/` (job et relevés), `bnet/oauth/base-mode-token-sink.ts`, `common/crypto/token-cipher.ts`, `core/players/` (mode du joueur) et `render/board.ts`.

- Mode d'un joueur : mode appli s'il a au moins un appareil non révoqué dont `last_seen_at` date de 7 jours au plus ; sinon mode de base (aucun appareil, tous révoqués, jamais vus ou vus il y a plus de 7 jours).
- Fin du callback `/lier battlenet` : en mode de base, le jeton est chiffré (AES-256-GCM, nonce aléatoire de 12 octets par chiffrement, stocké `nonce | tag | chiffré`) dans `bnet_token` avec sa région et son expiration ; une nouvelle liaison remplace l'ancien jeton. En mode appli, le jeton est jeté.
- Job toutes les 10 min (jamais deux passages en même temps) : supprime d'abord les jetons expirés, puis lit le profil de compte pour chaque jeton valide. 401 / 403 : un nouvel essai, puis le jeton est supprimé. Autre erreur : jeton gardé, nouvel essai au passage suivant. Jeton indéchiffrable : supprimé.
- Seuls les persos déjà au propriétaire du jeton sont relevés (les autres ne sont créés ou rattachés que par `/lier battlenet`). Le niveau lu est comparé au dernier snapshot du perso, quelle que soit sa source : égal ou inférieur, rien n'est créé ; premier relevé sans snapshot, un snapshot de référence sans événement ; en hausse, un snapshot `bnet_account` (heure du relevé, `detail` vide, flag `suspect_level_jump` comme pour une synchro) et un `LEVEL_UP` par niveau gagné, `event_id` = `bnet-<character.id>-<niveau>`, `data` = `{ "level": n }`. Classe, race et faction sont mises à jour, une valeur absente n'efface rien.
- Un niveau pour lequel un `LEVEL_UP` existe déjà (envoyé par l'addon via `/sync`) n'est pas déduit une seconde fois. Dans l'autre ordre (relevé puis `/sync` portant ses propres `LEVEL_UP`), l'événement de l'addon est enregistré aussi : la publication une seule fois par niveau revient aux logs (S-13).
- Après chaque relevé : `character.updated` et `event.recorded` avec `source = bnet_account`, comme une synchro.
- Tableau : un joueur en mode de base n'a pas de pastille et ne compte jamais « en ligne » ; sa ligne affiche `@membre · vu <t:…:R> · *mode de base*` (« vu » omis sans donnée reçue ou avec `hide_presence`).
- `/perso liste` : pour un joueur en mode de base qui a des persos vérifiés Battle.net et plus de jeton valide, une ligne « liaison expirée » et un bouton « Relier Battle.net » (`perso:relink-bnet`) qui relance `/lier battlenet` dans la région du principal vérifié (sinon du premier perso vérifié), lié à l'interaction du bouton.

### Critères d'acceptation du mode de base

- [ ] Un joueur sans appareil mais lié à Battle.net voit son niveau mis à jour dans les 15 min suivant sa déconnexion.
- [ ] Le jeton OAuth est chiffré en base et supprimé à son expiration.
- [ ] Un `/sync` puis un relevé Battle.net au même niveau ne publient qu'un seul log de niveau.
- [ ] Un code `/sync` corrompu ou d'un autre membre est refusé proprement.

## Configuration et déploiement

### Variables d'environnement

| Variable | Exemple | Rôle |
| --- | --- | --- |
| `DISCORD_TOKEN` | — | Token du bot |
| `DISCORD_CLIENT_ID` | — | Id de l'application, pour enregistrer les commandes |
| `DATABASE_URL` | `postgres://ft:…@db:5432/ft` | Connexion PostgreSQL |
| `PUBLIC_BASE_URL` | `https://ft.mondomaine.fr` | Base de l'API et du callback OAuth |
| `BNET_CLIENT_ID`, `BNET_CLIENT_SECRET` | — | Application créée sur develop.battle.net |
| `BNET_REDIRECT_URI` | `https://ft.mondomaine.fr/oauth/bnet/callback` | Doit être déclarée à l'identique chez Blizzard |
| `BNET_DEFAULT_REGION` | `eu` | Région par défaut |
| `BNET_PUBLIC_PROFILE` | `false` | Active la lecture des fiches publiques |
| `HEARTBEAT_INTERVAL_SEC` | `600` | Renvoyé à l'appli |
| `LEVEL_CAP` | `60` | Niveau maximum |
| `BOARD_MIN_EDIT_INTERVAL_SEC` | `15` | Debounce du tableau |
| `APP_DOWNLOAD_URL` | lien des releases | Donné par `/lier appli` |
| `LOG_LEVEL` | `info` | Verbosité |
| `TOKEN_ENC_KEY` | 32 octets en base64 | Chiffrement des jetons Battle.net du mode de base |

### Docker

- `docker-compose.yml` : services `server` (image Node, port 3000 non exposé) et `db` (postgres:16, volume nommé), dans le réseau de Caddy.
- Caddy : `ft.mondomaine.fr { reverse_proxy server:3000 }`.
- Migrations lancées au démarrage du conteneur ; `GET /health` vérifie la base et la connexion Discord : `{"status":"ok","database":"up","discord":"up"}`, ou 503 avec `"status":"error"` dès qu'un des deux est `down`.
- Sauvegarde quotidienne de la base (`pg_dump`).

### Comportement (S-21)

- `server/Dockerfile` multi-étapes, contexte de build = racine du dépôt (le serveur lit `contract/schemas` à l'exécution) : étape `build` (`npm ci`, `prisma generate`, `nest build`, puis `npm prune --omit=dev`), image d'exécution `node:24-bookworm-slim` sous l'utilisateur `node`, `HEALTHCHECK` sur `GET /health`. Le CLI `prisma` est une dépendance de production pour lancer `prisma migrate deploy` avant `node dist/main.js` ; une migration en échec empêche le démarrage.
- `docker-compose.yml` : `server`, `db` (volume nommé `pgdata`, aucun port publié) et `backup` ; `server` est aussi branché sur le réseau externe de Caddy (`CADDY_NETWORK`, `caddy` par défaut). Toutes les valeurs viennent du `.env` voisin (`.env.example` à la racine) ; `DATABASE_URL` est construite à partir de `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`.
- Sauvegarde : conteneur `backup` (`postgres:16`, `tools/pg-backup.sh`), un `pg_dump -Fc` par jour à `BACKUP_HOUR` UTC dans `BACKUP_PATH`, fichiers de plus de `BACKUP_RETENTION_DAYS` (14) jours supprimés après chaque sauvegarde réussie ; sauvegarde immédiate au démarrage s'il n'y en a aucune de moins de 24 h.
- CI `server.yml` : lint, tests, build et construction de l'image sur chaque PR ; un tag `server-v<version>` (égal à la version de `server/package.json`) pousse `ghcr.io/<owner>/forever-tracker-server:<version>` (et `latest` hors pré-version).
- Procédure complète (VPS, Caddy, mise à jour, restauration) : `docs/deploy.md`.

### Discord Developer Portal

- Scopes d'invitation : `bot`, `applications.commands`.
- Permissions : Voir les salons, Envoyer des messages, Intégrer des liens, Lire l'historique, Gérer les salons.
- Aucun intent privilégié.

## Critères d'acceptation côté serveur

Testables sans le jeu, avec un faux client qui rejoue les payloads du contrat d'échange.

- [ ] `/setup` crée les deux salons, pose les permissions et publie le tableau ; un membre sans droits ne peut pas écrire dans le tableau.
- [ ] `/perso ajouter` refuse un perso déjà possédé par un autre membre et un troisième perso suivi.
- [ ] Appairage : un code expiré ou réutilisé est refusé ; le jeton n'est stocké qu'en SHA-256.
- [ ] Une même synchro envoyée deux fois n'ajoute aucun événement ni aucun log.
- [ ] Un snapshot avec un niveau en baisse est rejeté ; un saut de plus de 5 niveaux en moins de 15 min est flagué et non publié.
- [ ] Battement `gameRunning: true` → pastille verte et log « en jeu » ; arrêt des battements → session fermée après le délai et récap publié.
- [ ] Une rafale de 50 synchros en 10 s ne produit pas plus d'une édition du tableau toutes les 15 s, et aucune erreur 429 non gérée.
- [ ] Au-delà de 40 joueurs, le tableau se répartit sur plusieurs messages sans dépasser 4 000 caractères chacun.
- [ ] Message du tableau supprimé à la main → republié au prochain rendu.
- [ ] `/confidentialite or:true` masque l'or partout : tableau, `/profil`, `/classement`, logs.
- [ ] `/quitter` efface le joueur, révoque ses appareils ; ses envois suivants reçoivent `401`.
- [ ] Flux Battle.net : un profil de compte en 404 donne le message d'aide ; un succès marque les persos vérifiés et le jeton n'est stocké que chiffré, 24 h au plus, en mode de base.
- [ ] Redémarrage du service : tableaux redessinés, sessions ouvertes conservées.
