from harness import SAVED_VARIABLES_DIR

GUID = "Player-4242-0A1B2C3D"
DEFAULT_SETTINGS = {"interval": 15, "levelPrompt": True, "debug": False}


def assert_fresh_structure(db):
    assert db == {
        "schema": 1,
        "addonVersion": "0.1.0",
        "settings": DEFAULT_SETTINGS,
        "characters": {},
    }


# -- creation -----------------------------------------------------------------


def test_first_run_without_saved_variables_creates_structure(wow):
    wow.load_addon()
    assert_fresh_structure(wow.db())


def test_nil_db_is_recreated(wow):
    wow.load_saved_variables(SAVED_VARIABLES_DIR / "ForeverTracker.empty.lua")
    assert wow.db() is None
    wow.load_addon()
    assert_fresh_structure(wow.db())


def test_empty_db_is_recreated(wow):
    wow.load_saved_variables("ForeverTrackerDB = {}")
    wow.load_addon()
    assert_fresh_structure(wow.db())


def test_non_table_db_is_recreated(wow):
    wow.load_saved_variables('ForeverTrackerDB = "corrupted"')
    wow.load_addon()
    assert_fresh_structure(wow.db())


def test_db_is_not_touched_before_addon_loaded(wow):
    wow.load_addon(fire_addon_loaded=False)
    assert wow.db() is None


def test_addon_loaded_for_another_addon_is_ignored(wow):
    wow.load_addon(fire_addon_loaded=False)
    wow.fire("ADDON_LOADED", "SomeOtherAddon")
    assert wow.db() is None


# -- preservation -------------------------------------------------------------


def test_existing_db_is_kept(wow):
    wow.load_saved_variables(SAVED_VARIABLES_DIR / "ForeverTracker.sample.lua")
    before = wow.db()
    wow.load_addon()
    assert wow.db() == before


def test_existing_db_table_is_the_same_object(wow):
    wow.load_saved_variables(SAVED_VARIABLES_DIR / "ForeverTracker.sample.lua")
    wow.lua.execute("originalDB = ForeverTrackerDB")
    wow.load_addon()
    assert wow.lua.eval("ForeverTrackerDB == originalDB") is True


def test_custom_settings_are_kept_and_missing_ones_filled(wow):
    wow.load_saved_variables(
        'ForeverTrackerDB = { schema = 1, addonVersion = "0.1.0",'
        " settings = { interval = 30, debug = true }, characters = {} }"
    )
    wow.load_addon()
    assert wow.db()["settings"] == {"interval": 30, "levelPrompt": True, "debug": True}


def test_off_interval_and_disabled_prompt_are_kept(wow):
    wow.load_saved_variables(
        'ForeverTrackerDB = { schema = 1, settings = { interval = "off", levelPrompt = false } }'
    )
    wow.load_addon()
    db = wow.db()
    assert db["settings"] == {"interval": "off", "levelPrompt": False, "debug": False}
    assert db["characters"] == {}
    assert db["addonVersion"] == "0.1.0"


def test_partial_db_gets_missing_top_level_fields(wow):
    wow.load_saved_variables(
        'ForeverTrackerDB = { characters = { ["Player-1-1"] = { events = { { id = "x" } } } } }'
    )
    wow.load_addon()
    db = wow.db()
    assert db["schema"] == 1
    assert db["addonVersion"] == "0.1.0"
    assert db["settings"] == DEFAULT_SETTINGS
    assert db["characters"] == {"Player-1-1": {"events": [{"id": "x"}]}}


# -- PLAYER_LOGIN -------------------------------------------------------------


def test_player_login_creates_character_entry_indexed_by_guid(wow):
    wow.load_addon()
    wow.fire("PLAYER_LOGIN")
    characters = wow.db()["characters"]
    assert list(characters) == [GUID]
    entry = characters[GUID]
    assert entry["key"]["guid"] == GUID  # the rest of key and snapshot: test_collect.py
    # the journal holds only the login's SESSION_START: test_journal.py
    assert [e["type"] for e in entry["events"]] == ["SESSION_START"]


def test_get_character_creates_an_empty_entry(wow):
    wow.load_addon()
    get_character = wow.lua.eval("function(ns, guid) return ns.GetCharacter(guid) end")
    get_character(wow.ns, "Player-1-2")
    assert wow.db()["characters"] == {
        "Player-1-2": {"key": {"guid": "Player-1-2"}, "snapshot": {}, "events": {}}
    }


def test_player_login_uses_the_current_guid(wow):
    wow.set_state(guid="Player-4242-FFFFFFFF")
    wow.load_addon()
    wow.fire("PLAYER_LOGIN")
    assert list(wow.db()["characters"]) == ["Player-4242-FFFFFFFF"]


def test_player_login_after_nil_db_creates_entry(wow):
    wow.load_saved_variables(SAVED_VARIABLES_DIR / "ForeverTracker.empty.lua")
    wow.load_addon()
    wow.fire("PLAYER_LOGIN")
    assert list(wow.db()["characters"]) == [GUID]


def test_player_login_keeps_existing_character_entry(wow):
    wow.load_saved_variables(SAVED_VARIABLES_DIR / "ForeverTracker.sample.lua")
    before = wow.db()["characters"][GUID]
    wow.lua.execute("originalEntry = ForeverTrackerDB.characters['Player-4242-0A1B2C3D']")
    wow.load_addon()
    wow.fire("PLAYER_LOGIN")
    # Login refreshes key and snapshot (Collect.lua) but keeps the same entry,
    # its journal (Journal.lua appends SESSION_START) and the saved death counter.
    assert wow.lua.eval("ForeverTrackerDB.characters['Player-4242-0A1B2C3D'] == originalEntry")
    after = wow.db()["characters"][GUID]
    assert after["events"][:-1] == before["events"]
    assert after["events"][-1]["type"] == "SESSION_START"
    assert after["snapshot"]["deaths"] == before["snapshot"]["deaths"]


def test_player_login_adds_new_character_next_to_existing_ones(wow):
    wow.load_saved_variables(SAVED_VARIABLES_DIR / "ForeverTracker.sample.lua")
    before = wow.db()["characters"]
    wow.set_state(guid="Player-4242-0C3D4E5F")
    wow.load_addon()
    wow.fire("PLAYER_LOGIN")
    characters = wow.db()["characters"]
    assert set(characters) == set(before) | {"Player-4242-0C3D4E5F"}
    for guid, entry in before.items():
        assert characters[guid] == entry


def test_player_login_without_guid_does_not_crash(wow):
    wow.load_addon()
    wow.set_state(guid=None)
    wow.fire("PLAYER_LOGIN")
    assert wow.db()["characters"] == {}


def test_addon_table_exposes_current_character(wow):
    wow.load_addon()
    wow.fire("PLAYER_LOGIN")
    assert wow.ns.guid == GUID
    same_db = wow.lua.eval("function(ns) return ns.db == ForeverTrackerDB end")
    assert same_db(wow.ns) is True


def test_addon_creates_no_global_besides_the_ones_the_client_requires(wow):
    list_globals = wow.lua.eval(
        "function() local t = {} for k in pairs(_G) do t[#t + 1] = k end return t end"
    )
    before = set(list_globals().values())
    wow.load_addon()
    wow.fire("PLAYER_LOGIN")
    assert set(list_globals().values()) - before == {
        "ForeverTrackerDB",                  # SavedVariables
        "SLASH_FTR1",                        # /ftr
        "BINDING_HEADER_FOREVERTRACKER",     # key binding labels
        "BINDING_NAME_FOREVERTRACKER_SYNC",
        "ForeverTracker_SyncNow",            # Bindings.xml runs in the global scope
    }
