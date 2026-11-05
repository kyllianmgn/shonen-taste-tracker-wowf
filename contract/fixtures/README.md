# Contract fixtures

Shared by `server/`, `addon/tests/` and `companion/test/`. Expected results come from
`docs/03-getting-started.md` (« Fixtures et bouchons ») and the validation rules of
`docs/02-spec-server.md` (« Contrat d'échange »). Values are examples, not real data.

All JSON payloads validate against `contract/schemas/`; the expected *server* outcome below is
what the ingestion logic must produce.

## Payloads

Character: `eu` / Davina / Asaria, GUID `Player-4242-0A1B2C3D`. Base time `T0 = 1793900000`.

| File | Schema | Precondition | Expected result |
| --- | --- | --- | --- |
| `sync.valid.json` | `sync.request` | Character unknown, device owner tracks 0 characters | `status: ok`, `acceptedEvents: 2` (`SESSION_START`, `LEVEL_UP`), `duplicateEvents: 0`, `flags: []`; character auto-attached as main |
| `sync.duplicate.json` | `sync.request` | `sync.valid.json` already applied | Byte-identical to `sync.valid.json`: `status: ok`, `acceptedEvents: 0`, `duplicateEvents: 2`; same `capturedAt`, so no new snapshot |
| `sync.regression.json` | `sync.request` | `sync.valid.json` applied (level 23) | Snapshot at `T0 + 600` with level 22: `status: rejected`, `flags: ["regression"]` |
| `sync.suspect-jump.json` | `sync.request` | `sync.valid.json` applied (level 23 at `T0`) | Snapshot at `T0 + 600` with level 31 (+8 in 10 min): stored with `flags: ["suspect_level_jump"]`, 8 `LEVEL_UP` events accepted but never published in Discord |
| `heartbeat.running.json` | `heartbeat.request` | No open session | `gameRunning: true` at `T0 - 1000`: player goes online, session opens |
| `heartbeat.stopped.json` | `heartbeat.request` | Session open | `gameRunning: false` at `T0 + 700`: session closes with `end_reason = game_closed` |

`scenarios/` is filled by S-10 (`session-levelup.json`).

## SavedVariables

Literal parser only: these files are never executed.

| File | Content | Expected result |
| --- | --- | --- |
| `ForeverTracker.sample.lua` | Spec example (Davina, level 23) + 2nd character Morwen with `equipment`, `professions`, `reputations` and `events` all `{}` | Parses; 2 characters; after schema-guided normalization the empty tables become `[]` |
| `ForeverTracker.empty.lua` | `ForeverTrackerDB = nil` | No error, nothing sent |
| `ForeverTracker.malicious.lua` | `os.execute("calc")`, `"Asa" .. "ria"`, `SOME_GLOBAL` in value positions | Clean rejection (« expression non littérale »), nothing executed |
| `ForeverTracker.escapes.lua` | Escapes, long strings, comments, trailing commas, single quotes | Parses; values below |

Decoded values expected from `ForeverTracker.escapes.lua`:

| Path | Value |
| --- | --- |
| `snapshot.guild` | `Les "Veilleurs"` |
| `snapshot.guildRank` | `L'Officier` |
| `snapshot.zone` | `Bois de la Pénombre` (`\195\169` = UTF-8 `é`) |
| `snapshot.subZone` | `Line one` + LF + `Line two` + TAB + `Tabbed\Backslash` |
| `snapshot.ilvl` | `21.5` |
| `snapshot.equipment[0].link` | `\|cff1eff00\|Hitem:7720::::::::23:::::::::\|h[Whitemane's Chapeau]\|h\|r` (`\124` = `\|`) |
| `snapshot.equipment[1].link` | `\|cffffffff\|Hitem:6060::::::::23:::::::::\|h[Flax Vest]\|h\|r` |
| `snapshot.professions`, `snapshot.reputations` | `[]` |
| `events[0].data` | `{}` (empty table normalized to an object) |
| `events[1].data.from` | `Ancienne -- pas un commentaire` |
| `events[1].data.to` | `Les "Veilleurs" ]] encore` |

Comments (`--`, `--[[ ]]`, `--[==[ ]==]`) are skipped, including a `]]` inside a level-2 comment.

## Battle.net (`nock`)

| File | Request |
| --- | --- |
| `bnet/account-profile.json` | `GET /profile/user/wow?namespace=profile-forever-eu` |
| `bnet/account-profile.404.json` | Same request: account with no Forever character, or data sharing disabled |
| `bnet/realm-6855.json` | `GET /data/wow/realm/6855?namespace=dynamic-forever-eu` |
| `bnet/token.json` | `POST https://oauth.battle.net/token` |
