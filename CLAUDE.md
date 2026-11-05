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
- One task id (S-xx server, A-xx addon, C-xx companion) = one branch `task/<id>-<slug>`.
- No pull requests: do not run `gh pr create` or write a PR description, even if a task prompt
  or docs/03-04 asks for one. Work ends with the commits on the task branch; ask before merging
  into main.
- Never commit to main. Conventional Commits (feat:, fix:, test:, chore:, docs:).
- TDD: write the failing test first, make it pass, refactor. All tests green before asking for review.
- Ask before any decision not covered by docs: new dependency, DB schema change, contract change,
  new Discord permission, new file in the player's WoW folder.
- Contract change = schemas + fixtures + server + companion in the same branch; bump `schema` if breaking.
- Code, comments, commits in English. User-facing strings in French
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
- Tests green, lint clean, the task's acceptance criteria checked off in the final message,
  docs updated when behavior changes, no TODO left without a linked task id.
