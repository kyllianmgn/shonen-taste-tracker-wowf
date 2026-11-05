# Addon tests

The addon runs inside a real Lua 5.1 interpreter (via [lupa](https://pypi.org/project/lupa/)) on top of
`wow_stubs.lua`, a minimal fake of the WoW API. No game client needed.

## Setup (once)

Python 3.10+ required. From the repo root, in PowerShell:

```powershell
python -m venv addon/tests/.venv
addon/tests/.venv/Scripts/Activate.ps1
python -m pip install -r addon/tests/requirements.txt
```

## Run

```powershell
python -m pytest addon/tests          # whole suite
python -m pytest addon/tests -k login # filter by name
```

## Layout

| File | Role |
| --- | --- |
| `wow_stubs.lua` | WoW API stubs; all test controls live in the `WowTest` global |
| `harness.py` | `WowGame`: fresh Lua state, loads stubs, SavedVariables, then the TOC files in order |
| `conftest.py` | `wow` fixture: a new `WowGame` per test |
| `test_*.py` | Tests |

## Writing a test

```python
from harness import SAVED_VARIABLES_DIR

def test_example(wow):
    wow.set_state(level=24, guid="Player-4242-0A1B2C3D")         # drive the stubs
    wow.load_saved_variables(SAVED_VARIABLES_DIR / "ForeverTracker.sample.lua")  # optional
    wow.load_addon()               # runs the TOC's .lua files, then fires ADDON_LOADED
    wow.fire("PLAYER_LOGIN")       # any event, with arguments: wow.fire("PLAYER_LEVEL_UP", 24)
    wow.advance(30)                # moves GetServerTime() and runs due C_Timer callbacks
    assert wow.db()["characters"]["Player-4242-0A1B2C3D"]["key"]["guid"] == "Player-4242-0A1B2C3D"
```

- `wow.db()` returns `ForeverTrackerDB` as plain Python: Lua arrays become lists, other tables dicts
  (an empty table is `{}`).
- `wow.ns` is the addon's private table (the second value of `...` in each file).
- `wow.wow.click(frame)` and `wow.wow.slash("/ftr sync")` simulate a click and a typed command;
  `wow.reload_calls()` lists `ReloadUI()` calls with `hardware = True` only when they came from one of them.
- `wow.set_state(...)` converts Python dicts and lists into Lua tables, e.g.
  `wow.set_state(inventory={1: "|cff...|Hitem:7720:...|h[...]|h|r"})`.
- `RequestTimePlayed()` fires `TIME_PLAYED_MSG` right away with `state.playedTotal` / `state.playedLevel`
  and counts its calls in `wow.wow.playedRequests`.
- `print()` and `DEFAULT_CHAT_FRAME:AddMessage()` are captured in `WowTest.chat`
  (`lua_to_python(wow.wow.chat)`); `state.locale` sets `GetLocale()` (default `frFR`).
- The "à vérifier" APIs (`GetAverageItemLevel`, `GetProfessions`, `GetSkillLineInfo`, `C_Reputation.*`,
  `UnitHonor`, ...) are stubbed from `state` (`avgItemLevel`, `professions`, `skillLines`, `factions`,
  `honor`). `wow.wow.removeApi("C_Reputation.GetNumFactions")` makes one disappear (a bare name such as
  `"C_Reputation"` removes the whole namespace) and `wow.wow.breakApi(path)` makes it raise.
- `Bindings.xml` and other XML files are skipped: the loader runs only `.lua` files.
- `load_saved_variables` executes the file like the game client does. Use it only with fixtures from
  this repo: the server and the companion parse SavedVariables as literals and never execute them.
