"""Sync.lua: the "Synchroniser" window, its timer, the safe conditions and ReloadUI.

Spec: docs/01-spec-addon-companion.md, "Addon : synchronisation et commandes".
"""

import pytest

GUID = "Player-4242-0A1B2C3D"
LOGIN_TIME = 1793900000
TICK = 30
LATER = 5 * 60

# Each safe condition, and the state that makes it false.
UNSAFE_STATES = {
    "combat lockdown": {"combatLockdown": True},
    "affecting combat": {"inCombat": True},
    "in instance": {"inInstance": True, "instanceType": "party"},
    "on taxi": {"onTaxi": True},
    "dead or ghost": {"deadOrGhost": True},
    "casting": {"casting": True},
    "channeling": {"channeling": True},
}
SAFE_STATE = {
    "combatLockdown": False,
    "inCombat": False,
    "inInstance": False,
    "instanceType": "none",
    "onTaxi": False,
    "deadOrGhost": False,
    "casting": False,
    "channeling": False,
}


def logged_in(wow, saved=None, **state):
    wow.set_state(**state)
    if saved:
        wow.load_saved_variables(saved)
    wow.load_addon()
    wow.fire("PLAYER_LOGIN")
    return wow


def window(wow):
    return wow.lua.globals().ForeverTrackerSyncFrame


def shown(wow):
    frame = window(wow)
    return frame is not None and bool(frame.IsShown(frame))


def settings_lua(fields):
    """SavedVariables with only a settings table, e.g. settings_lua('interval = 10')."""
    return "ForeverTrackerDB = { schema = 1, settings = { %s }, characters = {} }" % fields


# -- rule 1: last save at login -------------------------------------------------------


def test_last_save_is_login_time(wow):
    logged_in(wow)
    assert wow.ns.lastSaveAt == LOGIN_TIME


def test_window_exists_hidden_at_login(wow):
    logged_in(wow)
    assert window(wow) is not None
    assert not shown(wow)


# -- rule 2: timer and interval -------------------------------------------------------


def test_window_shows_after_default_interval_of_15_min(wow):
    logged_in(wow)
    wow.advance(15 * 60 - TICK)
    assert not shown(wow)
    wow.advance(TICK)
    assert shown(wow)


@pytest.mark.parametrize("minutes", [10, 30])
def test_window_follows_the_interval_setting(wow, minutes):
    logged_in(wow, saved=settings_lua(f"interval = {minutes}"))
    wow.advance(minutes * 60 - TICK)
    assert not shown(wow)
    wow.advance(TICK)
    assert shown(wow)


def test_interval_off_never_shows_the_window(wow):
    logged_in(wow, saved=settings_lua('interval = "off"'))
    wow.advance(4 * 3600)
    assert not shown(wow)


def test_timer_is_checked_every_30_seconds(wow):
    logged_in(wow)
    # Due at +900 exactly, which is a tick; one second earlier is not.
    wow.advance(899)
    assert not shown(wow)
    wow.advance(1)
    assert shown(wow)


def test_nothing_happens_before_login(wow):
    wow.load_addon()
    wow.advance(3600)
    assert not shown(wow)
    assert wow.reload_calls() == []


# -- rule 3: window content -----------------------------------------------------------


def test_window_texts_in_french(wow):
    logged_in(wow)
    frame = window(wow)
    assert frame.text.GetText(frame.text) == "Envoyer ta progression au bot ? (2-3 s de chargement)"
    assert frame.syncButton.GetText(frame.syncButton) == "Synchroniser"
    assert frame.laterButton.GetText(frame.laterButton) == "Plus tard"
    assert frame.dontAskLabel.GetText(frame.dontAskLabel) == "Ne plus demander cette session"
    assert frame.dontAsk.frameType == "CheckButton"


def test_window_texts_in_english_on_enus_client(wow):
    logged_in(wow, locale="enUS")
    frame = window(wow)
    assert frame.syncButton.GetText(frame.syncButton) == "Sync"
    assert frame.laterButton.GetText(frame.laterButton) == "Later"


def test_sync_button_calls_reloadui_from_the_click(wow):
    logged_in(wow)
    wow.advance(15 * 60)
    wow.click(window(wow).syncButton)
    assert wow.reload_calls() == [{"hardware": True}]


def test_sync_button_refreshes_the_snapshot_first(wow):
    logged_in(wow)
    wow.advance(15 * 60)
    wow.set_state(money=999)
    wow.click(window(wow).syncButton)
    snap = wow.db()["characters"][GUID]["snapshot"]
    assert snap["money"] == 999
    assert snap["capturedAt"] == LOGIN_TIME + 15 * 60


def test_sync_button_refuses_when_conditions_turn_false(wow):
    logged_in(wow)
    wow.advance(15 * 60)
    wow.set_state(casting=True)
    wow.click(window(wow).syncButton)
    assert wow.reload_calls() == []
    assert any("Synchronisation impossible" in line for line in wow.chat())


def test_later_hides_and_postpones_by_5_min(wow):
    logged_in(wow)
    wow.advance(15 * 60)
    wow.click(window(wow).laterButton)
    assert not shown(wow)
    wow.advance(LATER - TICK)
    assert not shown(wow)
    wow.advance(TICK)
    assert shown(wow)
    assert wow.reload_calls() == []


def test_later_twice_postpones_again(wow):
    logged_in(wow)
    wow.advance(15 * 60)
    wow.click(window(wow).laterButton)
    wow.advance(LATER)
    wow.click(window(wow).laterButton)
    wow.advance(LATER - TICK)
    assert not shown(wow)
    wow.advance(TICK)
    assert shown(wow)


def test_dont_ask_again_this_session(wow):
    logged_in(wow)
    wow.advance(15 * 60)
    frame = window(wow)
    wow.click(frame.dontAsk)
    wow.click(frame.laterButton)
    assert not shown(wow)
    wow.advance(4 * 3600)
    assert not shown(wow)
    wow.fire("PLAYER_LEVEL_UP", 24)
    wow.advance(TICK)
    assert not shown(wow)


def test_dont_ask_unchecked_again_keeps_asking(wow):
    logged_in(wow)
    wow.advance(15 * 60)
    frame = window(wow)
    wow.click(frame.dontAsk)
    wow.click(frame.dontAsk)
    wow.click(frame.laterButton)
    wow.advance(LATER)
    assert shown(wow)


def test_dont_ask_is_not_saved(wow):
    # Only this session (until the next reload): nothing goes to the SavedVariables.
    logged_in(wow)
    wow.advance(15 * 60)
    wow.click(window(wow).dontAsk)
    wow.click(window(wow).laterButton)
    assert wow.db()["settings"] == {"interval": 15, "levelPrompt": True, "debug": False}


def test_the_window_is_shown_once_not_reopened_each_tick(wow):
    logged_in(wow)
    calls = []
    frame = window(wow)
    frame.HookScript(frame, "OnShow", lambda *_: calls.append(1))
    wow.advance(15 * 60 + 10 * TICK)
    assert shown(wow)
    assert len(calls) == 1


def test_showing_the_window_asks_for_played_time(wow):
    logged_in(wow)
    before = wow.wow.playedRequests
    wow.advance(15 * 60)
    assert shown(wow)
    assert wow.wow.playedRequests == before + 1


def test_escape_can_close_the_window(wow):
    logged_in(wow)
    special = wow.lua.globals().UISpecialFrames
    assert "ForeverTrackerSyncFrame" in list(special.values())


# -- safe conditions ------------------------------------------------------------------


@pytest.mark.parametrize("unsafe", UNSAFE_STATES.values(), ids=UNSAFE_STATES.keys())
def test_window_never_shows_when_a_condition_is_false(wow, unsafe):
    logged_in(wow)
    wow.set_state(**unsafe)
    wow.advance(4 * 3600)
    assert not shown(wow)
    wow.fire("PLAYER_LEVEL_UP", 24)
    wow.advance(TICK)
    assert not shown(wow)
    assert wow.reload_calls() == []


@pytest.mark.parametrize("unsafe", UNSAFE_STATES.values(), ids=UNSAFE_STATES.keys())
def test_window_shows_at_next_tick_once_conditions_are_back(wow, unsafe):
    logged_in(wow)
    wow.set_state(**unsafe)
    wow.advance(20 * 60)
    wow.set_state(**SAFE_STATE)
    wow.advance(TICK)
    assert shown(wow)


@pytest.mark.parametrize("api", ["UnitCastingInfo", "UnitChannelInfo"])
def test_missing_cast_api_does_not_break_the_check(wow, api):
    wow.wow.removeApi(api)
    logged_in(wow)
    wow.advance(15 * 60)
    assert shown(wow)


# -- rule 4: after a level up ---------------------------------------------------------


def test_level_up_shows_the_window_right_away(wow):
    logged_in(wow)
    wow.advance(60)
    wow.fire("PLAYER_LEVEL_UP", 24)
    assert shown(wow)


def test_level_up_in_combat_waits_for_the_conditions(wow):
    logged_in(wow)
    wow.set_state(inCombat=True)
    wow.fire("PLAYER_LEVEL_UP", 24)
    assert not shown(wow)
    wow.advance(TICK)
    assert not shown(wow)
    wow.set_state(inCombat=False)
    wow.advance(TICK)
    assert shown(wow)


def test_level_up_prompt_is_off_when_disabled(wow):
    logged_in(wow, saved=settings_lua("levelPrompt = false"))
    wow.advance(60)
    wow.fire("PLAYER_LEVEL_UP", 24)
    wow.advance(TICK)
    assert not shown(wow)


def test_later_on_level_up_prompt_does_not_bring_it_back(wow):
    logged_in(wow)
    wow.advance(60)
    wow.fire("PLAYER_LEVEL_UP", 24)
    wow.click(window(wow).laterButton)
    # 5 min later the interval (15 min) is not due yet: nothing to ask.
    wow.advance(LATER)
    assert not shown(wow)
    wow.advance(15 * 60 - 60 - LATER)
    assert shown(wow)


def test_level_up_during_later_waits_for_the_5_min(wow):
    logged_in(wow)
    wow.advance(60)
    wow.fire("PLAYER_LEVEL_UP", 24)
    wow.click(window(wow).laterButton)
    wow.advance(60)
    wow.fire("PLAYER_LEVEL_UP", 25)
    assert not shown(wow)
    wow.advance(LATER - 60)
    assert shown(wow)


# -- rule 5: hidden when entering combat ----------------------------------------------


def test_entering_combat_hides_the_window(wow):
    logged_in(wow)
    wow.advance(15 * 60)
    assert shown(wow)
    wow.set_state(inCombat=True, combatLockdown=True)
    wow.fire("PLAYER_REGEN_DISABLED")
    assert not shown(wow)


def test_window_comes_back_after_combat(wow):
    logged_in(wow)
    wow.advance(15 * 60)
    wow.set_state(inCombat=True, combatLockdown=True)
    wow.fire("PLAYER_REGEN_DISABLED")
    wow.advance(TICK)
    assert not shown(wow)
    wow.set_state(inCombat=False, combatLockdown=False)
    wow.fire("PLAYER_REGEN_ENABLED")
    wow.advance(TICK)
    assert shown(wow)


def test_level_up_prompt_hidden_by_combat_comes_back(wow):
    logged_in(wow)
    wow.fire("PLAYER_LEVEL_UP", 24)
    wow.set_state(inCombat=True)
    wow.fire("PLAYER_REGEN_DISABLED")
    assert not shown(wow)
    wow.set_state(inCombat=False)
    wow.advance(TICK)
    assert shown(wow)


# -- rule 6: ReloadUI only from a click, a key or a typed command ---------------------


def test_reloadui_is_never_called_by_events_or_timers(wow):
    logged_in(wow)
    for event, args in [
        ("PLAYER_LEVEL_UP", (24,)),
        ("PLAYER_XP_UPDATE", ()),
        ("PLAYER_MONEY", ()),
        ("ZONE_CHANGED_NEW_AREA", ()),
        ("PLAYER_REGEN_DISABLED", ()),
        ("PLAYER_REGEN_ENABLED", ()),
        ("PLAYER_DEAD", ()),
        ("TIME_PLAYED_MSG", (90000, 100)),
        ("PLAYER_ENTERING_WORLD", ()),
    ]:
        wow.fire(event, *args)
        wow.advance(17 * 60)
    wow.advance(6 * 3600)
    assert wow.reload_calls() == []


def test_every_reloadui_comes_from_a_hardware_event(wow):
    logged_in(wow)
    wow.advance(15 * 60)
    wow.click(window(wow).syncButton)
    wow.slash("/ftr sync")
    wow.press_binding("FOREVERTRACKER_SYNC")
    assert wow.reload_calls() == [{"hardware": True}] * 3


def test_reloadui_appears_in_a_single_place_of_the_addon():
    # ReloadUI() lives in ns.SyncNow only; its callers are checked above.
    from harness import ADDON_DIR

    hits = []
    for path in ADDON_DIR.rglob("*.lua"):
        if "libs" in path.parts:
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            code = line.split("--", 1)[0]
            if "ReloadUI" in code:
                hits.append((path.name, number))
    assert len(hits) == 1 and hits[0][0] == "Sync.lua", hits
