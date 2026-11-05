"""Test harness: runs the addon inside a Lua runtime (lupa) on top of wow_stubs.lua.

Typical use (see conftest.py for the `wow` fixture):

    game = WowGame()                        # stubs loaded, nothing else
    game.load_saved_variables(SAMPLE_SV)    # optional, like the client reading WTF/
    game.load_addon()                       # TOC files in order, then ADDON_LOADED
    game.fire("PLAYER_LOGIN")
    db = game.db()                          # ForeverTrackerDB as plain Python data
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import lupa

TESTS_DIR = Path(__file__).resolve().parent
ADDON_NAME = "ForeverTracker"
ADDON_DIR = TESTS_DIR.parent / ADDON_NAME
TOC_PATH = ADDON_DIR / f"{ADDON_NAME}.toc"
STUBS_PATH = TESTS_DIR / "wow_stubs.lua"
FIXTURES_DIR = TESTS_DIR.parents[1] / "contract" / "fixtures"
SAVED_VARIABLES_DIR = FIXTURES_DIR / "savedvariables"


# The game runs Lua 5.1; use it when the installed lupa wheel ships it.
try:
    from lupa import lua51 as _lua  # type: ignore[attr-defined]
except ImportError:  # pragma: no cover - older lupa without per-version modules
    _lua = lupa


def _new_runtime():
    return _lua.LuaRuntime(unpack_returned_tuples=True)


def read_toc(path: Path = TOC_PATH) -> tuple[dict[str, str], list[str]]:
    """Return (metadata, files) from a TOC file, files in load order."""
    metadata: dict[str, str] = {}
    files: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("##"):
            key, _, value = line[2:].partition(":")
            metadata[key.strip()] = value.strip()
        elif line.startswith("#"):
            continue
        else:
            files.append(line.replace("\\", "/"))
    return metadata, files


def lua_to_python(value: Any) -> Any:
    """Convert Lua tables recursively: 1..n keys -> list, anything else -> dict."""
    if _lua.lua_type(value) != "table":
        return value
    items = {key: lua_to_python(item) for key, item in value.items()}
    keys = list(items)
    if keys and all(isinstance(k, int) and not isinstance(k, bool) for k in keys):
        if sorted(keys) == list(range(1, len(keys) + 1)):
            return [items[i] for i in range(1, len(keys) + 1)]
    return items


class WowGame:
    """One simulated client session: a fresh Lua state with the WoW stubs loaded."""

    def __init__(self) -> None:
        self.lua = _new_runtime()
        self._run(STUBS_PATH.read_text(encoding="utf-8"), "wow_stubs.lua")
        self.wow = self.lua.globals().WowTest
        self.ns = self.lua.table()  # the addon's private table (`...` second value)
        self.loaded_files: list[str] = []

    # -- loading ----------------------------------------------------------

    def _run(self, source: str, chunk_name: str) -> None:
        compile_chunk = self.lua.eval(
            "function(src, name) local f, err = (loadstring or load)(src, name)"
            " if not f then error(err, 0) end return f end"
        )
        compile_chunk(source, "@" + chunk_name)()

    def load_saved_variables(self, source: str | Path) -> None:
        """Run a SavedVariables file, as the client does before ADDON_LOADED.

        Only for trusted fixtures from this repo: the real client executes this
        file, so the harness does too. Untrusted files go through the literal
        parsers of the server and the companion, never through this.
        """
        if isinstance(source, Path):
            source = source.read_text(encoding="utf-8")
        self._run(source, "SavedVariables/ForeverTracker.lua")

    def load_addon(self, fire_addon_loaded: bool = True) -> None:
        """Load the TOC's Lua files in order, then fire ADDON_LOADED like the client."""
        _, files = read_toc()
        for rel in files:
            if not rel.lower().endswith(".lua"):
                continue  # XML (Bindings.xml) is interpreted by the client, not Lua
            source = (ADDON_DIR / rel).read_text(encoding="utf-8")
            self.wow.runChunk(source, f"{ADDON_NAME}/{rel}", ADDON_NAME, self.ns)
            self.loaded_files.append(rel)
        if fire_addon_loaded:
            self.fire("ADDON_LOADED", ADDON_NAME)

    # -- driving ----------------------------------------------------------

    def fire(self, event: str, *args: Any) -> None:
        self.wow.fire(event, *args)

    def advance(self, seconds: float) -> None:
        self.wow.advance(seconds)

    def set_state(self, **values: Any) -> None:
        state = self.wow.state
        for key, value in values.items():
            state[key] = value

    # -- reading ----------------------------------------------------------

    def global_value(self, name: str) -> Any:
        return lua_to_python(self.lua.globals()[name])

    def db(self) -> Any:
        """ForeverTrackerDB converted to plain Python (dict/list/str/int/bool/None)."""
        return self.global_value("ForeverTrackerDB")

    def reload_calls(self) -> list[dict[str, Any]]:
        return lua_to_python(self.wow.reloadCalls) or []
