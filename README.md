# ForeverTracker

Track WoW: Forever characters (level, presence, sessions) and render a live board and a log
channel in Discord.

| Package | Stack | Role |
| --- | --- | --- |
| `server/` | Node LTS, NestJS, discord.js v14, Prisma, PostgreSQL 16 | HTTP API, Discord bot, scheduled jobs |
| `addon/` | Lua 5.1 (WoW: Forever, Interface 16001) | Collects character state into SavedVariables |
| `companion/` | Flutter (Windows desktop) | Reads SavedVariables and sends them to the server |
| `contract/` | JSON Schema (draft 2020-12) + fixtures | Single source of truth between companion and server |
| `tools/` | Node / PowerShell | Fake client, addon linking |

## Quick start (Windows, PowerShell)

```powershell
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL 16 on localhost:5432
./tools/link-addon.ps1                           # link the addon into the game folder
```

Per-package commands are listed in [CLAUDE.md](CLAUDE.md).

## Documentation

Specs live in [`docs/`](docs/) (French):

- [00-research.md](docs/00-research.md): context and constraints
- [01-spec-addon-companion.md](docs/01-spec-addon-companion.md): addon and companion app
- [02-spec-server.md](docs/02-spec-server.md): bot, server, data model, exchange contract
- [03-getting-started.md](docs/03-getting-started.md): repo layout, backlog, fixtures, dev environment
- [04-prompts.md](docs/04-prompts.md): per-task prompts and parallel work plan
