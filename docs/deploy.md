# Déploiement du serveur sur le VPS

ForeverTracker Server tourne sur le VPS avec Docker Compose, derrière le Caddy déjà en place. Le stack (`docker-compose.yml` à la racine du dépôt) contient trois services :

| Service | Image | Rôle |
| --- | --- | --- |
| `server` | `ghcr.io/<owner>/forever-tracker-server:<version>` | API, bot Discord et tâches planifiées. Port 3000 joignable seulement depuis le réseau de Caddy. Applique les migrations (`prisma migrate deploy`) avant chaque démarrage. |
| `db` | `postgres:16` | Base, volume nommé `forever-tracker_pgdata`, aucun port publié. |
| `backup` | `postgres:16` | Un `pg_dump` par jour dans `./backups`, conservé 14 jours (`tools/pg-backup.sh`). |

L'image est construite par la CI (`.github/workflows/server.yml`) et poussée sur GHCR à chaque tag `server-v<version>` ; la version du tag doit être celle de `server/package.json`.

## Prérequis

- Docker Engine et le plugin Compose v2 sur le VPS.
- Caddy qui tourne en conteneur, branché sur un réseau Docker partagé (`caddy` dans ce document).
- Le sous-domaine (par exemple `forever.vsgsrv.fr`) qui pointe sur le VPS.
- Les comptes et secrets de docs/03 « Comptes et accès à créer à la main » : token et Application ID Discord, client Battle.net avec l'URL de redirection de prod déclarée.

## 1. Préparer le dossier

```sh
sudo mkdir -p /opt/forever-tracker && sudo chown "$USER" /opt/forever-tracker
cd /opt/forever-tracker
# Seuls docker-compose.yml, .env.example et tools/pg-backup.sh servent sur le VPS ;
# un clone du dépôt est le plus simple pour les mises à jour.
git clone <url du dépôt> .
```

Si le réseau partagé avec Caddy n'existe pas encore :

```sh
docker network create caddy
# puis brancher le conteneur Caddy dessus (dans son propre compose : networks: [caddy], external: true)
```

S'il porte un autre nom, le renseigner dans `CADDY_NETWORK`.

## 2. Variables

```sh
cp .env.example .env
chmod 600 .env
openssl rand -hex 24      # → POSTGRES_PASSWORD (hexadécimal : il est inséré tel quel dans DATABASE_URL)
openssl rand -base64 32   # → TOKEN_ENC_KEY
```

Remplir `.env` :

| Variable | Valeur en prod |
| --- | --- |
| `SERVER_IMAGE` | `ghcr.io/<owner>/forever-tracker-server:<version>` (version figée, pas `latest`) |
| `CADDY_NETWORK` | `caddy` |
| `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD` | `ft`, `ft`, le mot de passe généré. `DATABASE_URL` est construite par le compose. |
| `BACKUP_PATH`, `BACKUP_HOUR`, `BACKUP_RETENTION_DAYS` | `./backups`, `3` (heure UTC), `14` |
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` | Developer Portal. `DISCORD_DEV_GUILD_ID` reste **vide** en prod (commandes globales). |
| `PUBLIC_BASE_URL` | `https://<domaine>` |
| `BNET_CLIENT_ID`, `BNET_CLIENT_SECRET` | develop.battle.net |
| `BNET_REDIRECT_URI` | `https://<domaine>/oauth/bnet/callback`, identique à celle déclarée chez Blizzard |
| `TOKEN_ENC_KEY` | la clé générée. **La garder ailleurs aussi** : sans elle, les jetons du mode de base d'une sauvegarde sont illisibles. |
| `APP_DOWNLOAD_URL` | page des releases de l'appli compagnon |
| autres | valeurs par défaut de `.env.example` (détail : docs/02 « Variables d'environnement ») |

Le serveur refuse de démarrer si une variable obligatoire manque ou est mal formée, et liste les variables en cause dans ses logs (jamais leurs valeurs).

## 3. Caddy

Ajouter au Caddyfile, puis recharger Caddy (`docker exec <conteneur caddy> caddy reload --config /etc/caddy/Caddyfile`) :

```caddyfile
<domaine> {
	reverse_proxy server:3000
}
```

`server` est le nom du service dans le réseau `caddy`. Si un autre stack de ce réseau a aussi un service `server`, remplacer par le nom du conteneur, `forever-tracker-server-1`.

## 4. Premier démarrage

Si le paquet GHCR est privé, se connecter une fois avec un token GitHub (scope `read:packages`) :

```sh
echo "<token>" | docker login ghcr.io -u <utilisateur github> --password-stdin
```

Puis :

```sh
docker compose pull
docker compose up -d
docker compose logs -f server     # « Applying migration … » puis le démarrage du bot
docker compose ps                 # server doit passer à « healthy » (jusqu'à 90 s)
curl -s https://<domaine>/health  # {"status":"ok","database":"up","discord":"up"}
```

Dans Discord : inviter le bot avec le lien de docs/02 « Discord Developer Portal », puis lancer `/setup` sur le serveur. Les commandes globales peuvent mettre quelques minutes à apparaître la première fois.

## 5. Mise à jour

1. Pousser le tag depuis le poste de dev, après avoir monté `version` dans `server/package.json` :
   ```sh
   git tag server-v0.2.0 && git push origin server-v0.2.0
   ```
   La CI lance les tests puis pousse `ghcr.io/<owner>/forever-tracker-server:0.2.0` (et `latest` hors pré-version).
2. Sur le VPS :
   ```sh
   cd /opt/forever-tracker
   git pull                                   # docker-compose.yml et tools/ éventuellement modifiés
   sed -i 's|^SERVER_IMAGE=.*|SERVER_IMAGE=ghcr.io/<owner>/forever-tracker-server:0.2.0|' .env
   docker compose exec backup pg-backup.sh once   # sauvegarde avant migration
   docker compose pull server
   docker compose up -d
   docker compose logs -f server
   ```
   Les migrations en attente s'appliquent avant le démarrage ; si l'une échoue, le serveur ne démarre pas et le conteneur redémarre en boucle : voir les logs, puis revenir à l'ancienne version (remettre l'ancien `SERVER_IMAGE`, `docker compose up -d`) et restaurer la sauvegarde si la migration a laissé la base à moitié modifiée.

## 6. Sauvegardes

- Un fichier `backups/ft-<horodatage UTC>.dump` par jour à `BACKUP_HOUR` (UTC), format `pg_dump -Fc`. Au démarrage du service, une sauvegarde est faite tout de suite s'il n'y en a aucune de moins de 24 h.
- Les fichiers de plus de `BACKUP_RETENTION_DAYS` jours sont supprimés après chaque sauvegarde réussie ; les autres fichiers du dossier ne sont jamais touchés.
- Sauvegarde à la demande : `docker compose exec backup pg-backup.sh once`.
- Suivi : `docker compose logs backup` (une ligne par sauvegarde, `ERROR` en cas d'échec).
- Les sauvegardes restent sur le VPS : les copier régulièrement ailleurs (rsync, stockage objet), avec `.env` (pour `TOKEN_ENC_KEY`).

## 7. Restaurer une sauvegarde

```sh
cd /opt/forever-tracker
docker compose stop server                     # plus d'écriture pendant la restauration
ls -lt backups/                                # choisir le fichier
docker compose exec -T db sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < backups/ft-20261107T030000Z.dump
docker compose start server
curl -s https://<domaine>/health
```

`--clean --if-exists` supprime puis recrée chaque objet de la sauvegarde : la base revient exactement à l'état du dump. Au redémarrage, le serveur applique les migrations plus récentes que la sauvegarde, puis redessine les tableaux.

Sur un VPS neuf : suivre les étapes 1 à 4 avec le même `.env` (même `TOKEN_ENC_KEY`), arrêter `server`, restaurer comme ci-dessus, relancer.

## Test local du stack de prod

Sur le poste de dev, avec Docker Desktop :

```sh
docker network create caddy                    # une fois
cp .env.example .env                           # SERVER_IMAGE vide → image construite localement
# remplir .env avec le bot et le serveur Discord de test ; PUBLIC_BASE_URL=http://localhost:3000
docker compose up -d --build
docker compose ps                              # server « healthy »
docker compose exec server node -e "fetch('http://127.0.0.1:3000/health').then(async r => console.log(r.status, await r.text()))"
docker compose down                            # -v pour effacer aussi la base de test
```

Le port 3000 n'est pas publié sur l'hôte : `/health` se teste depuis le conteneur (ou depuis un conteneur du réseau `caddy`).
