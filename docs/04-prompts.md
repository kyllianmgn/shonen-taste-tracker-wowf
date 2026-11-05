# Prompts Claude Code

## Comment les utiliser

Un prompt = une tâche = une session Claude Code neuve, lancée à la racine du dépôt, dans l'ordre du backlog. Chaque prompt suppose que `CLAUDE.md` et `docs/` sont en place (fait par S-01) ; le workflow (plan, OK, branche, TDD, PR) vient du `CLAUDE.md`, donc chaque prompt se termine par la même ligne de rappel.

- Les chemins `docs/01`, `docs/02`, `docs/03` désignent `docs/01-spec-addon-companion.md`, `docs/02-spec-server.md` et `docs/03-getting-started.md`.
- Plusieurs prompts peuvent tourner en même temps : voir la section suivante pour savoir lesquels.
- Si une tâche déborde (PR trop grosse), demander à l'agent de la couper en deux sous-tâches `<ID>a` / `<ID>b` avant de coder.

## Travail en parallèle

Une tâche peut démarrer dès que toutes ses dépendances sont **mergées dans main**. Les tâches d'une même vague peuvent tourner en même temps ; vise 3 à 4 sessions à la fois, idéalement une par package (serveur, addon, appli), car deux packages différents ne se marchent jamais dessus.

### Règles

1. Une tâche = un worktree créé depuis un `main` à jour : `git worktree add ../ft-<ID> -b task/<ID>-<slug> main`.
2. Ne jamais lancer une tâche dont une dépendance n'est pas encore mergée.
3. Fichiers à propriétaire unique : `server/prisma/schema.prisma` (S-02) et `contract/` (S-01). Seules exceptions : S-10 et A-06 ajoutent chacune un nouveau fichier dans contract/fixtures/ sans toucher à l'existant. Toute autre modification de ces fichiers : la tâche s'arrête et demande ; ce changement passe seul, avant les autres.
4. Fichiers partagés à risque de petit conflit : `server/src/app.module.ts`, `package.json` / lockfile, `pubspec.yaml`, `addon/ForeverTracker/ForeverTracker.toc`. Avant la PR : `git fetch; git rebase origin/main`, régénérer le lockfile si besoin, relancer les tests.
5. Une commande Discord = un fichier dans `server/src/discord/commands/` ; le registre des commandes (S-05) les découvre seul, donc deux tâches ajoutent des commandes sans toucher le même fichier.
6. Merger dans l'ordre des vagues ; dans une vague, l'ordre est libre.

### Vagues

| Vague | Tâches lançables en même temps |
| --- | --- |
| V0 | S-01 (seule) |
| V1 | S-02 · A-01 · C-01 |
| V2 | S-03 · S-04 · S-11 · S-16 · A-02 · C-02 · C-03 · C-04 |
| V3 | S-05 · A-03 · A-04 · C-05 |
| V4 | S-06 · S-07 · A-05 · C-06 |
| V5 | S-08 · S-17 · A-06 · C-07 |
| V6 | S-09 · S-12 · S-14 · S-18 · S-19 · A-07 · C-08 |
| V7 | S-10 · S-13 · S-15 · S-20 |
| V8 | S-21 |
| V9 | S-22 |

### Dépendances et périmètre de chaque tâche

| Tâche | Dépend de | Fichiers touchés |
| --- | --- | --- |
| S-01 | — | racine, `contract/`, `docs/`, `tools/link-addon.ps1`, `.github/` |
| S-02 | S-01 | `server/` (squelette), `server/prisma/` |
| S-03 | S-02 | `server/src/common/contract/` |
| S-04 | S-02 | `server/src/common/lua/` |
| S-05 | S-02 | `server/src/discord/` (client, registre, `commands/setup.ts`) |
| S-06 | S-05 | `server/src/core/`, `commands/perso*.ts` |
| S-07 | S-03, S-05 | `server/src/ingest/pairing/`, `server/src/ingest/auth/`, `commands/lier-appli.ts` |
| S-08 | S-06, S-07 | `server/src/ingest/sync/` |
| S-09 | S-08 | `server/src/ingest/heartbeat/`, `server/src/presence/`, `server/src/jobs/presence*` |
| S-10 | S-09 | `tools/fake-client/`, `contract/fixtures/scenarios/` (ajout seul) |
| S-11 | S-02 | `server/src/discord/render/board*` |
| S-12 | S-05, S-08, S-11 | `server/src/discord/board/`, `server/src/jobs/board*` |
| S-13 | S-05, S-09 | `server/src/discord/render/logs*`, `server/src/discord/logs/` |
| S-14 | S-06, S-08 | `commands/profil.ts`, `session.ts`, `classement.ts`, `server/src/discord/render/profile*` |
| S-15 | S-06, S-12 | `commands/confidentialite.ts`, `quitter.ts`, `config.ts`, `admin*.ts` |
| S-16 | S-02 | `server/src/bnet/client/` |
| S-17 | S-05, S-06, S-16 | `server/src/bnet/oauth/`, `commands/lier-battlenet.ts` |
| S-18 | S-11, S-17 | `server/src/bnet/polling/`, `server/src/common/crypto/`, `render/board*` (mention mode de base), server/src/bnet/oauth/ (stockage du jeton), commands/perso\*.ts (bouton Relier) |
| S-19 | S-04, S-05, S-08, A-06 | `commands/sync.ts`, `server/src/ingest/share-code/` |
| S-20 | S-16, S-18 | `server/src/bnet/public/`, `server/src/jobs/bnet-public*` |
| S-21 | toutes les S- | `server/Dockerfile`, `docker-compose.yml`, `docs/deploy.md`, `.github/workflows/server.yml` |
| S-22 | tout | `docs/e2e-checklist.md` |
| A-01 | S-01 | `addon/ForeverTracker/` (TOC, `Core.lua`), `addon/tests/` (harnais, stubs) |
| A-02 | A-01 | `Collect.lua` (appels sûrs) |
| A-03 | A-02 | `Collect.lua` (appels à vérifier, fonctions séparées) |
| A-04 | A-02 | `Journal.lua` |
| A-05 | A-04 | `Sync.lua`, `Commands.lua`, `Bindings.xml` |
| A-06 | A-05 | `Share.lua`, `libs/LibDeflate/`, une ligne dans `Commands.lua`, contract/fixtures/share-code.sample.txt (nouveau fichier) |
| A-07 | A-05, A-06 | `addon/README.md`, `docs/addon-ingame-checklist.md`, tools/package-addon.ps1 |
| C-01 | S-01 | `companion/` (squelette, barre système, réglages) |
| C-02 | C-01 | `companion/lib/lua/` |
| C-03 | C-01 | `companion/lib/wow_files/` |
| C-04 | C-01 | `companion/lib/process/` |
| C-05 | C-01 | `companion/lib/api/`, `companion/lib/ui/first_run/`, stockage sécurisé |
| C-06 | C-02, C-03, C-04, C-05 | `companion/lib/sync/` |
| C-07 | C-06 | `companion/lib/queue/` |
| C-08 | C-07 | packaging, `.github/workflows/companion.yml` |

A-03 et A-04 sont dans la même vague mais touchent des fichiers différents ; A-03 ne crée que de nouvelles fonctions dans `Collect.lua`.

## M0 — Socle

### S-01 — Monorepo, contrat, fixtures

```text
Tâche S-01. Lis CLAUDE.md, docs/03 (sections Dépôt, Contrat partagé, Fixtures et bouchons, Environnement de dev local)
et la section « Contrat d'échange » de docs/02.
- Crée l'arborescence du monorepo exactement comme dans la section Dépôt (dossiers vides avec .gitkeep si besoin).
- Écris contract/schemas/ : sync.request.json est donné en entier ; déduis les autres du tableau « Autres schémas »
  et du contrat d'échange (draft 2020-12, additionalProperties: false partout).
- Écris contract/fixtures/ : tous les fichiers listés dans la section Fixtures, avec les contenus et résultats attendus décrits.
- Ajoute docker-compose.dev.yml (postgres:16, port 5432, volume nommé), .gitignore, README.md court,
  tools/link-addon.ps1 (script donné dans docs/03) et des workflows CI vides par package.
Avant d'écrire, liste les fichiers que tu vas créer et attends mon OK.
Suis le workflow de CLAUDE.md (branche task/S-01-monorepo, PR).
```

### S-02 — Squelette serveur et base

```text
Tâche S-02. Lis docs/02 sections « Périmètre et stack », « Modèle de données », « Configuration et déploiement ».
- Crée le projet NestJS dans server/ (TypeScript strict, ESLint, Jest), avec les modules vides core, ingest, presence,
  discord, bnet, jobs, common.
- Validation de la configuration au démarrage : toutes les variables du tableau + DISCORD_DEV_GUILD_ID (facultative) ;
  arrêt immédiat avec un message clair si une variable obligatoire manque ou est mal formée (TOKEN_ENC_KEY = 32 octets base64).
- Traduis le schéma SQL de docs/02 en prisma/schema.prisma. Ce que Prisma ne sait pas exprimer (index uniques partiels
  main/alt par owner, unicité insensible à la casse des noms) va dans la migration en SQL brut.
- GET /health : 200 si la base répond.
- .env.example avec toutes les variables, sans valeur secrète.
Tests : config invalide → erreur explicite ; /health → 200 sur la base de test ; les contraintes d'unicité refusent les doublons.
Pas de discord.js dans cette tâche.
Suis le workflow de CLAUDE.md.
```

### S-03 — Validation du contrat

```text
Tâche S-03. Lis docs/03 section « Contrat partagé ».
- Module server/src/common/contract : charge tous les fichiers de contract/schemas/ avec ajv (draft 2020-12, ajv-formats),
  expose validate(schemaName, payload) qui renvoie { ok } ou une liste d'erreurs lisibles (chemin + message).
- Les schémas sont lus depuis le dossier contract/ du dépôt, jamais recopiés dans server/.
Tests : toutes les fixtures JSON de contract/fixtures passent leur schéma ; cas invalides construits dans les tests
(region inconnue, level 61, champ inconnu, event.type inconnu, 21 persos) échouent avec un chemin d'erreur précis.
Suis le workflow de CLAUDE.md.
```

### S-04 — Parseur de littéraux Lua (TypeScript)

```text
Tâche S-04. Lis docs/01 section « Addon : format des SavedVariables » et docs/03 « Fixtures et bouchons » + le piège
du parseur dans « Contrat partagé ».
- server/src/common/lua : parseur récursif écrit à la main. Accepte : affectation de tête `Nom = expr`, tables { } avec clés
  ["str"] =, [n] =, ident =, valeurs positionnelles, séparateurs , et ; ; chaînes "…", '…', [[…]] et [==[…]==] avec
  échappements (\n \t \" \' \\ \ddd) ; nombres entiers, décimaux, négatifs, hexadécimaux ; true, false, nil ;
  commentaires -- et --[[ ]].
- Tout le reste (appel de fonction, opérateur, identifiant utilisé comme valeur, ..) = erreur NonLiteralExpression
  avec ligne et colonne. Taille max 512 Ko. Interdit : eval, Function, vm, moteur Lua.
- Normalisation guidée par sync.request.json : tables séquentielles → tableaux, tables vides → [] ou {} selon le schéma.
Tests : les 4 fixtures SavedVariables avec exactement les résultats attendus du tableau de docs/03.
Suis le workflow de CLAUDE.md.
```

## M1 — Ingestion et présence

### S-05 — Bot Discord et /setup

```text
Tâche S-05. Lis docs/02 sections « Commandes Discord » et « Salon tableau et salon logs », et docs/00 section
« Contraintes Discord ».
- Module discord : client discord.js v14 (intent Guilds seul), connexion au démarrage du service.
- Déclare TOUTES les commandes et options du tableau de docs/02 (joueur + admin + /sync). Enregistrement sur
  DISCORD_DEV_GUILD_ID si présent, sinon global. Seul /setup est implémenté ; les autres répondent en éphémère
  « Bientôt disponible ».
- /setup (permission Gérer le serveur) : crée #tableau-forever et #logs-forever s'ils ne sont pas fournis, pose exactement
  les permissions décrites, enregistre guild_config, publie un message Components V2 provisoire dans le tableau et garde
  son id dans board_message_ids. Relancer /setup ne duplique rien.
Tests : définitions des commandes (noms, options, choix) ; calcul des permissions ; handler /setup avec de faux objets
guild/channel, y compris le cas où le bot n'a pas « Gérer les salons ».
Suis le workflow de CLAUDE.md.
```

### S-06 — Gestion des persos

```text
Tâche S-06. Lis docs/02 sections « Commandes Discord » et « Modèle de données ».
- Service core : création ou rattachement d'un perso (clé région + prénom + nom, insensible à la casse), rôles main/alt,
  au plus 2 persos suivis par joueur, un seul propriétaire par perso, ligne membership pour le serveur courant.
- Commandes /perso ajouter, principal (échange main/alt), retirer (→ untracked), liste ; réponses éphémères en français ;
  autocomplétion de l'option perso.
- Messages d'erreur clairs : perso possédé par un autre membre, rôle déjà pris (proposer /perso principal), 3e perso.
Tests (base de test) : tous les cas de conflit, l'échange principal/secondaire, la normalisation des noms.
Suis le workflow de CLAUDE.md.
```

### S-07 — Appairage et authentification des appareils

```text
Tâche S-07. Lis docs/02 section « Contrat d'échange » (tableau des endpoints, Appairage, Erreurs).
- /lier appli : code de 8 caractères respectant ^[A-HJ-NP-Z2-9]{8}$, stocké en SHA-256, valable 10 min, usage unique,
  réponse éphémère avec le code et APP_DOWNLOAD_URL.
- POST /v1/devices/pair validé par pair.request.json ; crée device avec le SHA-256 d'un jeton de 32 octets (base64url),
  renvoie le jeton une seule fois.
- Garde Bearer réutilisable : hash du jeton, appareil non révoqué, met à jour last_seen_at.
- DELETE /v1/devices/me → 204, appareil révoqué.
- Limites de débit du tableau (par IP pour pair, par appareil sinon), 429 avec Retry-After ; erreurs au format error.json.
Tests e2e (supertest) : 201, 404 code_unknown, 410 code_expired, 409 code_used, 401 jeton invalide ou révoqué, 429.
Suis le workflow de CLAUDE.md.
```

### S-08 — Ingestion des synchros

```text
Tâche S-08. Lis docs/02 section « Contrat d'échange » en entier (Synchro, Règles de validation) et « Modèle de données ».
- POST /v1/sync : validation ajv (S-03), puis règles métier : snapshot plus ancien ignoré, régression rejetée
  (flag regression), saut suspect stocké avec flag suspect_level_jump, capturedAt/at > maintenant + 5 min refusés.
- Statut par perso : ok, untracked, owned_by_other, rejected ; rattachement automatique si le propriétaire de l'appareil
  suit moins de 2 persos (le premier devient principal).
- Stockage : snapshot (source app) + last_snapshot_id, événements dédupliqués par (character_id, event_id), compteurs
  acceptedEvents / duplicateEvents.
- Émet les événements internes character.updated et event.recorded (EventEmitter Nest).
- Réponse conforme à sync.response.json, avec heartbeatIntervalSec.
Tests e2e avec sync.valid, sync.duplicate, sync.regression, sync.suspect-jump et un perso possédé par un autre membre.
Suis le workflow de CLAUDE.md.
```

### S-09 — Battements, présence et sessions

```text
Tâche S-09. Lis docs/02 section « Présence et sessions ».
- POST /v1/heartbeat (heartbeat.request.json) : met à jour device.game_running et last_seen_at.
- Moteur de présence sous forme de machine d'état testable, avec une horloge injectable : en ligne si un appareil actif a
  battu depuis moins de 2,5 × HEARTBEAT_INTERVAL_SEC ; ouverture, découpage sur SESSION_START d'un autre perso,
  attente de 90 s de la synchro finale, fermeture game_closed ou heartbeat_timeout (job chaque minute).
- Récap à la fermeture (durée, niveaux, or, temps joué, zone de fin, morts) ; session < 2 min sans changement = pas de log.
- Émet session.started et session.ended.
Tests unitaires sur chaque ligne du tableau Transitions ; e2e avec heartbeat.running puis heartbeat.stopped.
Suis le workflow de CLAUDE.md.
```

### S-10 — Faux client

```text
Tâche S-10. Lis docs/03 section « Fixtures et bouchons » (Faux client) et « Boucle de test manuelle ».
- tools/fake-client en Node (JavaScript ESM sans étape de build, point d'entrée tools/fake-client/index.js), commandes : pair <code>, heartbeat --running|--stopped,
  sync --fixture <fichier>, scenario <fichier>.
- Configuration : API_BASE_URL (défaut http://localhost:3000) ; jeton stocké dans tools/fake-client/.token (gitignoré).
- Les horodatages des fixtures (sentAt, capturedAt, at) sont réécrits relativement à maintenant via un champ offsetSec.
- Format de scénario : liste d'étapes { action, fixture?, gameRunning?, waitSec? } ; écris
  contract/fixtures/scenarios/session-levelup.json (lancement, synchro, niveau, arrêt).
Test : le scénario tourne contre le serveur de test e2e et crée bien une session fermée avec 1 niveau gagné.
Suis le workflow de CLAUDE.md.
```

## M2 — Rendu Discord

### S-11 — Rendu du tableau (fonction pure)

```text
Tâche S-11. Lis docs/02 section « Salon tableau et salon logs » (partie Tableau) et docs/00 « Contraintes Discord ».
- server/src/discord/render/board.ts : fonction pure renderBoard(input) → liste de payloads de message Components V2
  (Container + TextDisplay, flag IS_COMPONENTS_V2). input = config du serveur, joueurs avec persos main/alt, dernier
  snapshot, état de présence, préférences de confidentialité, maintenant.
- Règles : en ligne d'abord puis board_sort ; barre de 10 segments = niveau / 60 ; % d'XP du niveau ; 60 sans barre ;
  « non synchronisé » ; masquages hide_zone / hide_presence ; pied « Mis à jour <t:…:R> ».
- Découpage : chaque message ≤ 3 800 caractères de texte et ≤ 40 composants, sans couper un joueur en deux.
- Aucune dépendance au client Discord ni à la base : types d'entrée définis dans le module.
Tests : rendus de référence (snapshot tests) pour 0, 1, 12 et 45 joueurs, en ligne / hors ligne, 60, non synchronisé,
chaque masquage, et vérification des limites de caractères et de composants.
Suis le workflow de CLAUDE.md.
```

### S-12 — Publication du tableau

```text
Tâche S-12. Lis docs/02 section « Salon tableau et salon logs » (Debounce, Reprise).
- Abonné à character.updated, session.started, session.ended : marque le serveur Discord « à redessiner ».
- Job toutes les 5 s : pour chaque serveur marqué dont la dernière édition date d'au moins BOARD_MIN_EDIT_INTERVAL_SEC,
  construit les données, appelle renderBoard (S-11), compare le hash du rendu au précédent, puis édite les messages
  existants, crée les messages manquants, supprime les messages en trop, et met à jour board_message_ids dans l'ordre.
- Reprise : 10008 → republier ; 10003 ou 50013 → désactiver le tableau et prévenir dans le salon logs.
- Au démarrage du service : redessiner tous les tableaux.
Tests avec un faux client REST Discord : rafale de 50 changements → au plus une édition par 15 s ; rendu identique → aucun
appel ; passage de 1 à 2 messages et retour ; chaque code d'erreur.
Suis le workflow de CLAUDE.md.
```

### S-13 — Salon logs

```text
Tâche S-13. Lis docs/02 section « Salon tableau et salon logs » (partie Logs) et « Présence et sessions » (Récap).
- server/src/discord/render/logs.ts : une fonction pure par type de message du tableau Logs (début de session, fin de
  session avec récap, niveau, 60, perso suivi, mort, guilde) ; or formaté en po / pa / pc depuis le cuivre ; durées en
  « 2 h 14 ».
- Publication : abonné à event.recorded, session.started, session.ended ; file par salon (1 message / 1,5 s),
  regroupement des événements d'un même joueur à moins de 10 s d'écart, published_at pour ne jamais republier.
- Filtres : level_announce_step (le 60 est toujours annoncé), log_deaths, hide_presence, flags, événements reçus plus de
  24 h après leur at.
Tests : rendus de référence par type ; regroupement ; chaque filtre ; aucune double publication après redémarrage.
Suis le workflow de CLAUDE.md.
```

### S-14 — /profil, /session, /classement

```text
Tâche S-14. Lis docs/02 section « Commandes Discord » (lignes /profil, /session, /classement).
- Un fichier par commande dans server/src/discord/commands/ ; rendu en fonctions pures dans render/profile.ts.
- /profil : niveau et barre d'XP, temps joué, or, zone, guilde, ilvl, métiers, réputations au niveau Honoré ou plus,
  10 derniers niveaux avec date. Sans perso indiqué : le principal du membre.
- /session : dernière session terminée ou session en cours.
- /classement : top 15 des membres du serveur sur les persos principaux ; critères niveau, temps joué, rythme
  (niveaux / heure jouée, persos avec au moins 1 h de jeu), or, morts.
- Les données masquées par /confidentialite n'apparaissent nulle part ; un joueur qui masque l'or est absent du classement
  par or.
Tests : rendus de référence et cas de masquage.
Suis le workflow de CLAUDE.md.
```

### S-15 — Confidentialité, départ, configuration, admin

```text
Tâche S-15. Lis docs/02 section « Commandes Discord » (lignes /confidentialite, /quitter et tableau Admin) et
« Modèle de données » (règles de /quitter).
- /confidentialite : met à jour player.hide_money / hide_zone / hide_presence et déclenche un redessin du tableau.
- /quitter : message éphémère avec bouton de confirmation (expire en 60 s) ; suppression selon docs/02, appareils révoqués.
- /config (Gérer le serveur) : annonce_niveau, morts, tri ; redessin du tableau.
- /admin perso, /admin rafraichir (supprime et republie le tableau), /admin suspects (7 derniers jours).
Tests : permissions refusées pour un non-admin ; après /quitter un envoi de l'appareil reçoit 401 ; chaque option de /config
change bien le rendu.
Suis le workflow de CLAUDE.md.
```

## M3 — Battle.net et mode de base

### S-16 — Client Battle.net

```text
Tâche S-16. Lis docs/02 sections « Liaison Battle.net » et « Mode de base », docs/00 section « Sources de données »
et les fixtures contract/fixtures/bnet/.
L'API Forever n'est pas documentée par Blizzard : n'utilise QUE les routes, namespaces et champs cités dans ces docs.
- server/src/bnet/client : jeton applicatif (client credentials sur https://oauth.battle.net/token), mis en cache et
  renouvelé avant expiration ; hôtes régionaux {eu,us,kr,tw}.api.blizzard.com ; namespaces dynamic-forever-{r},
  static-forever-{r}, profile-forever-{r}.
- Méthodes : getRealm(region, id) → ruleset (type.type), avec cache de l'index des royaumes 24 h ;
  getAccountProfile(region, userToken) ; getPublicCharacter(region, first, surname, ifModifiedSince) → 200 | 304 | 404.
- File de requêtes : max 100/s et 36 000/h ; 429 → attente puis nouvel essai ; erreurs typées.
Tests nock uniquement (aucun appel réel) : profil de compte, 404, royaume 6855 → NORMAL, 304, 429, expiration du jeton.
Suis le workflow de CLAUDE.md.
```

### S-17 — /lier battlenet (OAuth)

```text
Tâche S-17. Lis docs/02 section « Liaison Battle.net » en entier (Flux, Erreurs).
- commands/lier-battlenet.ts : option region (EU par défaut) ; crée oauth_state (SHA-256, 10 min, usage unique, jeton
  d'interaction stocké) ; répond en éphémère avec le lien d'autorisation (scope wow.profile).
- GET /oauth/bnet/callback : vérifie le state, échange le code, appelle getAccountProfile (S-16), applique l'étape 5
  (vérification, transfert signalé aux admins, untracked), édite la réponse éphémère d'origine avec la liste des persos et
  deux menus déroulants principal / secondaire ; page HTML minimale « Liaison réussie, retourne sur Discord ».
- Interaction expirée → message privé au membre. Chaque cas du tableau Erreurs a son message.
- Le jeton joueur est jeté à la fin du callback ; laisse un point d'extension clair pour S-18 (mode de base).
Tests e2e avec nock : succès, 404, state expiré, state réutilisé, perso déjà possédé par un autre membre non vérifié.
Suis le workflow de CLAUDE.md.
```

### S-18 — Mode de base (relevés Battle.net)

```text
Tâche S-18. Lis docs/02 section « Mode de base » (Sources et rythme, Événements déduits, Affichage).
- server/src/common/crypto : AES-256-GCM avec TOKEN_ENC_KEY (nonce aléatoire par chiffrement).
- Mode d'un joueur : mode appli s'il a au moins un appareil non révoqué vu dans les 7 derniers jours, sinon mode de base.
- En mode de base, le callback de S-17 stocke le jeton chiffré dans bnet_token au lieu de le jeter.
- Job toutes les 10 min : pour chaque bnet_token valide, getAccountProfile, snapshot source bnet_account si le niveau a
  changé, LEVEL_UP déduits (event_id bnet-<character_id>-<niveau>), suppression des jetons expirés.
- renderBoard (S-11) : mention « mode de base » et « vu il y a X » pour ces joueurs ; /perso liste propose un bouton
  « Relier Battle.net » quand le jeton a expiré.
Tests : chiffrement aller-retour ; un passage 21 → 23 crée 2 LEVEL_UP sans doublon avec un /sync au même niveau ;
jeton expiré supprimé ; rendu « mode de base ».
Suis le workflow de CLAUDE.md.
```

### S-19 — /sync (envoi manuel)

```text
Tâche S-19. Lis docs/02 section « Mode de base » (Commande /sync) et docs/01 section « Mode de base : /ftr share ».
- server/src/ingest/share-code : décode FT1: (base64url → inflateRaw → JSON), valide avec share-code.payload.json.
- commands/sync.ts : option code ou fichier (pièce jointe ≤ 512 Ko, téléchargée puis passée au parseur Lua de S-04) ;
  réutilise le service de S-08 (snapshot source manual) ; au plus une fois toutes les 2 min par membre ; seuls les persos
  du membre sont acceptés ; réponse éphémère avec le résumé (persos mis à jour, événements acceptés, doublons).
- Le format de référence est contract/fixtures/share-code.sample.txt, produit par l'addon en A-06 (dépendance) :
  ton décodeur doit le lire sans modification.
Tests : share-code.sample.txt, code corrompu, code d'un autre membre, fichier SavedVariables valide, fichier piégé,
limite de débit.
Suis le workflow de CLAUDE.md.
```

### S-20 — Fiche publique

```text
Tâche S-20. Lis docs/02 sections « Liaison Battle.net » (Fiche publique) et « Mode de base » (Sources et rythme).
- Job quotidien : teste getPublicCharacter sur un perso vérifié de niveau 10+ ; journalise le résultat ; si 200 et
  BNET_PUBLIC_PROFILE=true, active les relevés publics.
- Relevés adaptatifs : 10 min si le perso a changé dans les 24 h, 1 h sinon, 6 h si inactif depuis plus de 7 jours ;
  If-Modified-Since avec le Last-Modified stocké ; 304 = rien.
- Snapshot source bnet_public (niveau, équipement) ; last_login_timestamp sert à « vu il y a X » et à la fin de session
  déduite ; LEVEL_UP déduits comme en S-18.
- Les persos ayant un appareil actif ne sont pas relevés (l'appli est plus précise).
Tests nock : 404 (fonction désactivée), 200 puis 304, calcul des intervalles, fin de session déduite.
Suis le workflow de CLAUDE.md.
```

## M4 — Addon

Rappel commun à toutes les tâches A- (déjà dans `CLAUDE.md`, à garder en tête) : Lua 5.1, aucun accès réseau, aucune globale hors `ForeverTrackerDB`, `SLASH_FTR1` et le binding, `ReloadUI()` uniquement sur clic, touche ou commande tapée.

### A-01 — Squelette et harnais de tests

```text
Tâche A-01. Lis docs/01 sections « Addon : structure et identité » et « Addon : format des SavedVariables », et docs/03
« Fixtures et bouchons » (Stubs de l'API WoW).
- addon/ForeverTracker/ : TOC exactement comme dans docs/01 (Interface 16001), Core.lua avec une table d'addon locale,
  une frame d'événements, l'initialisation de ForeverTrackerDB (schema 1, addonVersion, settings par défaut, characters)
  sans écraser une table existante, et la recréation propre si la table chargée est nil ou vide.
  Les autres fichiers du TOC existent vides.
- addon/tests/ : pytest + lupa ; wow_stubs.lua avec tous les stubs listés dans docs/03 ; un loader qui charge les stubs
  puis les fichiers dans l'ordre du TOC ; helper fire(event, ...) ; helper pour lire ForeverTrackerDB depuis Python.
- addon/tests/README.md : comment lancer les tests.
Tests : PLAYER_LOGIN crée l'entrée du perso indexée par GUID ; DB nil → structure recréée ; DB existante conservée.
Suis le workflow de CLAUDE.md.
```

### A-02 — Identité et snapshot (appels sûrs)

```text
Tâche A-02. Lis docs/01 sections « Addon : structure et identité » (tableau Identité) et « Addon : données et événements »
(tableau Snapshot, lignes marquées Sûr).
- Collect.lua : key (région via GetCurrentRegion → eu/us/kr/tw/cn, prénom et nom via UnitName("player"), GUID,
  GetRealmName) ; snapshot avec les champs Sûrs ; capturedAt = GetServerTime().
- Mise à jour sur les événements indiqués ; RequestTimePlayed au plus une fois toutes les 5 min, valeurs lues dans
  TIME_PLAYED_MSG.
- Si RegionalUniqueNamesEnabled() renvoie false : avertissement en mode debug, mais l'addon continue.
Tests : chaque champ, chaque événement déclencheur, l'étranglement de RequestTimePlayed, la région 3 → "eu".
Suis le workflow de CLAUDE.md.
```

### A-03 — Appels « à vérifier »

```text
Tâche A-03. Lis docs/01 section « Addon : données et événements » (lignes marquées À vérifier).
- Dans Collect.lua, nouvelles fonctions uniquement (ne réécris pas celles de A-02) : ilvl, professions (GetProfessions +
  GetProfessionInfo, sinon GetNumSkillLines + GetSkillLineInfo), reputations (C_Reputation), honor.
- Chaque appel est protégé par un test d'existence ; si l'API manque ou échoue (pcall), le champ est absent du snapshot,
  jamais d'erreur Lua.
- Mode debug : affiche quelles API ont été trouvées (sert à la checklist en jeu de A-07).
Tests : chaque champ avec le stub présent, absent, et qui lève une erreur.
Suis le workflow de CLAUDE.md.
```

### A-04 — Journal d'événements

```text
Tâche A-04. Lis docs/01 section « Addon : données et événements » (Journal d'événements).
- Journal.lua : tous les types du tableau, avec leurs déclencheurs et leurs data ; id = <GUID>-<at>-<compteur> ;
  plafond de 300 événements par perso (les plus anciens supprimés).
- LEVEL_UP : enregistré tout de suite, puis complété avec playedTotal au TIME_PLAYED_MSG suivant.
- DUNGEON_ENTER : seulement pour les instances party / raid, et pas deux fois de suite pour la même instance.
- PROFESSION_TIER : seuils 75, 150, 225, 300.
Tests : chaque type, unicité des ids, plafond, LEVEL_UP complété, DUNGEON_ENTER non dupliqué.
Suis le workflow de CLAUDE.md.
```

### A-05 — Fenêtre Synchroniser et commandes

```text
Tâche A-05. Lis docs/01 section « Addon : synchronisation et commandes » en entier.
- Sync.lua : règles 1 à 6, conditions sûres, fenêtre « Synchroniser » (boutons Synchroniser / Plus tard, case « Ne plus
  demander cette session »), report de 5 min, masquage sur PLAYER_REGEN_DISABLED, fenêtre après un LEVEL_UP.
- Bindings.xml : action « ForeverTracker : synchroniser maintenant ».
- Commands.lua : /ftr avec un dispatcher de sous-commandes (status, sync, interval, levelprompt, debug, reset) facile à
  étendre ; textes en français avec Locales/enUS.lua en secours.
Tests : la fenêtre n'apparaît jamais si une condition est fausse ; ReloadUI n'est appelé que par le clic simulé, le binding
ou /ftr sync ; chaque sous-commande ; report de 5 min.
Suis le workflow de CLAUDE.md.
```

### A-06 — /ftr share

```text
Tâche A-06. Lis docs/01 section « Mode de base : /ftr share », docs/02 section « Mode de base » (Commande /sync) et le
schéma contract/schemas/share-code.payload.json.
- Share.lua : sérialiseur JSON maison (échappements corrects, tableaux vs objets selon le schéma), LibDeflate embarqué dans
  libs/ avec sa licence (CompressDeflate), encodeur base64url maison, préfixe FT1: ; contenu = perso courant + événements
  depuis lastSharedAt ; au-delà de 4 000 caractères, retirer equipment puis reputations et le signaler.
- Fenêtre avec zone de texte sélectionnée prête à copier ; met à jour lastSharedAt.
- Ajoute uniquement la sous-commande share au dispatcher de Commands.lua.
- Génère avec les stubs un code de référence et écris-le dans contract/fixtures/share-code.sample.txt (nouveau fichier) :
  c'est le format que le serveur (S-19) devra décoder.
Tests : décoder en Python (base64url → zlib.decompress(…, -15) → json) le code généré et le valider contre
share-code.payload.json ; cas de troncature.
Suis le workflow de CLAUDE.md.
```

### A-07 — Validation en jeu

```text
Tâche A-07. Lis docs/01 sections « Addon : données et événements » et « Critères d'acceptation côté joueur ».
- Rédige docs/addon-ingame-checklist.md : pour chaque critère d'acceptation et chaque appel « à vérifier », l'action à faire
  en jeu, la commande /dump ou /ftr à taper et le résultat attendu, avec une case à cocher.
- Ajoute un script tools/package-addon.ps1 qui produit ForeverTracker-<version>.zip prêt à installer.
- Complète addon/README.md (installation, commandes, confidentialité).
Ne modifie pas le code Lua : je ferai les tests en jeu et je te donnerai les résultats dans une tâche suivante.
Suis le workflow de CLAUDE.md.
```

## M5 — Appli compagnon

Rappel commun aux tâches C- : Flutter Windows ; toute nouvelle dépendance (package pub) est proposée avec une alternative et attend ton accord ; les modules métier n'importent pas Flutter, pour rester testables en Dart pur.

### C-01 — Squelette et barre système

```text
Tâche C-01. Lis docs/01 section « Appli compagnon (ForeverTracker Sync) » (Expérience joueur, Interface).
- Projet Flutter desktop Windows dans companion/ ; structure lib/{lua,wow_files,process,api,sync,queue,ui,settings}/.
- Icône de barre système à 3 états (vert, gris, orange) et menu : Statut, Synchroniser maintenant, Appairer / Délier,
  Démarrer avec Windows, Ouvrir les logs, Quitter ; actions branchées sur des interfaces vides à implémenter plus tard.
- Pas de fenêtre principale visible au démarrage (sauf premier lancement, fait en C-05).
- Réglages JSON dans %APPDATA%\ForeverTrackerSync\settings.json ; logs tournants dans le même dossier.
Avant d'ajouter des packages (barre système, démarrage avec Windows, logs), propose-moi la liste avec une alternative chacun.
Tests : lecture/écriture des réglages ; machine d'état de l'icône.
Suis le workflow de CLAUDE.md.
```

### C-02 — Parseur de littéraux Lua (Dart)

```text
Tâche C-02. Lis docs/01 section « Addon : format des SavedVariables », docs/03 « Fixtures et bouchons » et le piège du
parseur dans docs/03 « Contrat partagé ». Regarde server/src/common/lua (S-04) comme référence de comportement si elle
est déjà mergée.
- companion/lib/lua : même grammaire et mêmes erreurs que S-04 (NonLiteralExpression avec ligne et colonne), écrit à la
  main en Dart pur, sans exécuter de Lua ; normalisation guidée par sync.request.json.
Tests : les 4 fixtures SavedVariables de contract/fixtures, lues directement depuis le dossier contract/ du dépôt, avec
exactement les résultats attendus de docs/03.
Suis le workflow de CLAUDE.md.
```

### C-03 — Dossier du jeu et surveillance des fichiers

```text
Tâche C-03. Lis docs/01 section « Appli compagnon » (Premier lancement étape 1 et 3, Lecture du fichier).
- companion/lib/wow_files : recherche du dossier _forever_ (chemins par défaut puis choix manuel, validation de
  _forever_\WTF), découverte de tous les WTF\Account\*\SavedVariables\ForeverTracker.lua.
- Surveillance : watcher système + repli par lecture de la date de modification toutes les 10 s ; un changement n'est émis
  qu'après 2 s de taille et date stables ; flux d'événements FileReady(path).
Tests avec des dossiers temporaires : découverte multi-comptes, écriture en plusieurs fois, fichier supprimé puis recréé.
Suis le workflow de CLAUDE.md.
```

### C-04 — Détection du jeu

```text
Tâche C-04. Lis docs/01 section « Appli compagnon » (Détection du jeu).
- companion/lib/process : toutes les 5 s, liste des processus et de leur exécutable ; jeu lancé si un exécutable se trouve
  sous le dossier _forever_ (Wow.exe ou Wow-arm64.exe à confirmer, comparaison insensible à la casse) ; flux d'états
  GameStarted / GameStopped sans répétition.
- Accès aux processus derrière une interface, avec une implémentation Windows et une fausse pour les tests.
Propose-moi l'approche Windows (API Win32 via FFI ou commande système) avant de coder.
Tests : transitions avec la fausse implémentation ; chemin hors _forever_ ignoré.
Suis le workflow de CLAUDE.md.
```

### C-05 — Client API, premier lancement, appairage

```text
Tâche C-05. Lis docs/02 section « Contrat d'échange » et docs/01 « Appli compagnon » (Premier lancement).
- companion/lib/api : client HTTP pour pair, heartbeat, sync et DELETE devices/me ; API_BASE_URL via --dart-define ;
  erreurs typées selon error.json (401, 410, 409, 404, 429 avec Retry-After).
- companion/lib/ui/first_run : fenêtre unique (dossier du jeu détecté ou à choisir, saisie du code, case « Démarrer avec
  Windows ») ; s'affiche seulement si l'appli n'est pas appairée.
- Jeton stocké dans le stockage sécurisé Windows, jamais dans settings.json ni dans les logs.
Tests : les corps de requête produits sont valides contre contract/schemas (propose-moi le package de validation JSON
Schema) ; gestion de chaque erreur ; le jeton n'apparaît pas dans les logs.
Suis le workflow de CLAUDE.md.
```

### C-06 — Battements et synchros

```text
Tâche C-06. Lis docs/01 section « Appli compagnon » (Envois, Lecture du fichier) et docs/02 « Contrat d'échange ».
- companion/lib/sync : orchestre C-02 à C-05. Battement immédiat aux changements d'état du jeu, puis toutes les
  heartbeatIntervalSec reçues du serveur tant que le jeu tourne ; lastCharacter = perso du SESSION_START le plus récent.
- Sur FileReady : parse, puis pour chaque perso snapshot si capturedAt > dernier envoyé et événements dont l'id n'est pas
  dans l'ensemble des 1 000 derniers ids envoyés ; au plus une synchro toutes les 30 s ; schema inconnu → rien envoyé,
  icône orange.
- Après GameStopped : attendre jusqu'à 60 s la réécriture du fichier avant la synchro finale.
- « Synchroniser maintenant » relit et renvoie.
Tests avec de faux C-03/C-04/C-05 : scénario complet lancement → niveau → arrêt ; aucun doublon d'événement ; respect des 30 s.
Suis le workflow de CLAUDE.md.
```

### C-07 — File hors ligne

```text
Tâche C-07. Lis docs/01 section « Appli compagnon » (File hors ligne).
- companion/lib/queue : toute requête en échec (réseau, 5xx, 429) écrite en JSON dans %APPDATA%\ForeverTrackerSync\queue\,
  rejouée avec délais 5 s, 30 s, 2 min puis toutes les 10 min ; battements de plus de 30 min jetés ; synchros gardées
  7 jours ; ordre d'envoi conservé.
- 401 : arrêt des envois, icône orange, notification Windows « réappaire l'appli avec /lier appli ».
Tests : coupure puis retour du réseau (pas de doublon côté contrat), expiration des battements, 401, redémarrage de l'appli
avec une file non vide.
Suis le workflow de CLAUDE.md.
```

### C-08 — Démarrage, installeur, mises à jour

```text
Tâche C-08. Lis docs/01 section « Appli compagnon » (Interface) et docs/03 « Décisions ouvertes » (support macOS = v2).
- Démarrage avec Windows (activé par défaut au premier lancement) ; icônes définitives.
- Installeur Windows : propose-moi MSIX ou Inno Setup avec leurs contraintes (signature, SmartScreen) avant de choisir.
- .github/workflows/companion.yml : build et tests sur chaque PR ; sur tag companion-v*, build de l'installeur et release
  GitHub.
- Au démarrage, vérification de la dernière release GitHub ; si plus récente, notification avec lien de téléchargement
  (pas de mise à jour silencieuse en v1).
Tests : comparaison de versions ; workflow validé avec act ou un tag de test.
Suis le workflow de CLAUDE.md.
```

## M6 — Mise en production

### S-21 — Déploiement

```text
Tâche S-21. Lis docs/02 section « Configuration et déploiement » et docs/03 « Comptes et accès ».
- server/Dockerfile multi-étapes (build puis image d'exécution minimale, utilisateur non root, HEALTHCHECK sur /health).
- docker-compose.yml de prod : services server et db (postgres:16, volume nommé), réseau externe partagé avec Caddy, aucun
  port de la base exposé ; migrations lancées au démarrage (prisma migrate deploy).
- Sauvegarde quotidienne pg_dump avec rotation sur 14 jours : propose-moi conteneur dédié ou tâche cron de l'hôte.
- .github/workflows/server.yml : lint + tests + build sur chaque PR ; sur tag server-v*, image poussée sur GHCR.
- docs/deploy.md : étapes sur le VPS (variables, bloc Caddy « <domaine> { reverse_proxy server:3000 } », premier démarrage,
  mise à jour, restauration d'une sauvegarde).
Test : docker compose up en local avec un .env de test → /health répond 200 et le bot se connecte au serveur Discord de test.
Suis le workflow de CLAUDE.md.
```

### S-22 — Test de bout en bout réel

```text
Tâche S-22. Lis les critères d'acceptation de docs/01, docs/02 (y compris ceux du Mode de base) et docs/addon-ingame-checklist.md.
- Rédige docs/e2e-checklist.md : scénario 1 (moi, avec jeu + addon + appli + bot en prod sur le serveur de test :
  connexion, niveau, fenêtre Synchroniser, déconnexion, coupure réseau) ; scénario 2 (un 2e joueur sans appli :
  /lier battlenet, relevé après déconnexion, /sync code) ; pour chaque étape, ce qui doit apparaître dans Discord et la
  requête SQL qui vérifie l'état en base (sessions, événements, snapshots, flags).
- Ajoute tools/diagnostics.ps1 qui affiche l'état d'un joueur (persos, dernière session, 20 derniers événements) via
  docker compose exec db psql.
Ne lance pas le jeu : je ferai les scénarios et je te donnerai les écarts à corriger, une tâche par écart.
Suis le workflow de CLAUDE.md.
```
