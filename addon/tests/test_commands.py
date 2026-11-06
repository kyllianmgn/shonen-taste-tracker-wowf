"""Commands.lua (/ftr) and Bindings.xml (key "synchroniser maintenant").

Spec: docs/01-spec-addon-companion.md, "Commandes /ftr" and "Règles" (raccourci).
"""

import xml.etree.ElementTree as ET

import pytest

from harness import BINDINGS_PATH

GUID = "Player-4242-0A1B2C3D"
OTHER = "Player-4242-0FFFFFFF"
LOGIN_TIME = 1793900000
RESET_POPUP = "FOREVERTRACKER_RESET"

SAVED_TWO_CHARACTERS = """
ForeverTrackerDB = { schema = 1, characters = {
  ["%s"] = { key = { guid = "%s" }, snapshot = { level = 23 }, events = {
    { id = "%s-1793890000-1", type = "SESSION_START", at = 1793890000, data = { level = 22 } },
    { id = "%s-1793890500-2", type = "LEVEL_UP", at = 1793890500, data = { level = 23 } },
  } },
  ["%s"] = { key = { guid = "%s" }, snapshot = { level = 5 }, events = {
    { id = "%s-1793880000-1", type = "SESSION_START", at = 1793880000, data = { level = 5 } },
  } },
} }
""" % (GUID, GUID, GUID, GUID, OTHER, OTHER, OTHER)


def logged_in(wow, saved=None, **state):
    wow.set_state(**state)
    if saved:
        wow.load_saved_variables(saved)
    wow.load_addon()
    wow.fire("PLAYER_LOGIN")
    return wow


def typed(wow, line):
    """Type a command and return the chat lines it printed."""
    before = len(wow.chat())
    wow.slash(line)
    return wow.chat()[before:]


def text(lines):
    return "\n".join(lines)


def settings(wow):
    return wow.db()["settings"]


def events(wow, guid=GUID):
    return wow.db()["characters"][guid]["events"] or []


# -- dispatcher -----------------------------------------------------------------------


def test_ftr_is_registered(wow):
    logged_in(wow)
    assert wow.lua.globals().SLASH_FOREVERTRACKER1 == "/ftr"


@pytest.mark.parametrize("line", ["/ftr", "/ftr status", "/FTR STATUS", "/ftr   status  "])
def test_bare_ftr_and_status_print_the_status(wow, line):
    logged_in(wow)
    assert "Dernière sauvegarde" in text(typed(wow, line))


def test_unknown_subcommand_lists_the_commands(wow):
    logged_in(wow)
    out = text(typed(wow, "/ftr nope"))
    assert "Commande inconnue : nope" in out
    for name in ["status", "sync", "interval", "levelprompt", "debug", "reset"]:
        assert f"/ftr {name}" in out


def test_help_lists_the_commands(wow):
    logged_in(wow)
    out = text(typed(wow, "/ftr help"))
    for name in ["status", "sync", "interval", "levelprompt", "debug", "reset"]:
        assert f"/ftr {name}" in out


def test_new_subcommands_plug_into_the_dispatcher(wow):
    logged_in(wow)
    calls = []
    wow.ns.RegisterCommand("hello", lambda args: calls.append(args), "dit bonjour")
    wow.slash("/ftr hello  le monde ")
    assert calls == ["le monde"]
    assert "/ftr hello" in text(typed(wow, "/ftr help"))


def test_messages_fall_back_to_english(wow):
    logged_in(wow, locale="enUS")
    out = text(typed(wow, "/ftr status"))
    assert "Last save" in out


def test_commands_before_login_do_not_break(wow):
    wow.load_addon()
    for line in ["/ftr", "/ftr sync", "/ftr reset", "/ftr interval 10"]:
        wow.slash(line)
    assert wow.reload_calls() == []
    assert wow.popups() == []


# -- status ---------------------------------------------------------------------------


def test_status_shows_character_last_save_interval_and_pending(wow):
    logged_in(wow, saved=SAVED_TWO_CHARACTERS)
    wow.fire("PLAYER_LEVEL_UP", 24)
    wow.advance(7 * 60 + 20)
    out = text(typed(wow, "/ftr status"))
    assert "Perso : Davina Asaria (niveau 24)" in out
    assert "Dernière sauvegarde : il y a 7 min" in out
    assert "Fenêtre Synchroniser : toutes les 15 min" in out
    # SESSION_START + LEVEL_UP of this session; the 2 saved events are already in the file.
    assert "Événements en attente : 2" in out


def test_status_with_interval_off(wow):
    logged_in(wow)
    wow.slash("/ftr interval off")
    assert "Fenêtre Synchroniser : désactivée" in text(typed(wow, "/ftr status"))


def test_pending_counts_every_event_when_the_journal_was_trimmed(wow):
    logged_in(wow, saved=SAVED_TWO_CHARACTERS)
    for _ in range(300):
        wow.fire("PLAYER_DEAD")
    assert "Événements en attente : 300" in text(typed(wow, "/ftr status"))


# -- sync -----------------------------------------------------------------------------


def test_sync_reloads_when_conditions_are_met(wow):
    logged_in(wow)
    wow.slash("/ftr sync")
    assert wow.reload_calls() == [{"hardware": True}]


@pytest.mark.parametrize(
    "state, reason",
    [
        ({"inCombat": True}, "en combat"),
        ({"combatLockdown": True}, "en combat"),
        ({"inInstance": True, "instanceType": "party"}, "en instance"),
        ({"onTaxi": True}, "en vol"),
        ({"deadOrGhost": True}, "mort"),
        ({"casting": True}, "incantation"),
        ({"channeling": True}, "incantation"),
    ],
)
def test_sync_refuses_and_says_why(wow, state, reason):
    logged_in(wow)
    wow.set_state(**state)
    out = text(typed(wow, "/ftr sync"))
    assert wow.reload_calls() == []
    assert "Synchronisation impossible" in out
    assert reason in out


# -- interval -------------------------------------------------------------------------


@pytest.mark.parametrize("value, stored", [("10", 10), ("15", 15), ("30", 30), ("off", "off"), ("OFF", "off")])
def test_interval_sets_the_setting(wow, value, stored):
    logged_in(wow)
    out = text(typed(wow, f"/ftr interval {value}"))
    assert settings(wow)["interval"] == stored
    assert "Fenêtre Synchroniser" in out


@pytest.mark.parametrize("value", ["", "7", "abc", "15 30"])
def test_interval_rejects_other_values(wow, value):
    logged_in(wow)
    out = text(typed(wow, f"/ftr interval {value}"))
    assert settings(wow)["interval"] == 15
    assert "/ftr interval 10|15|30|off" in out


def test_interval_applies_to_the_running_timer(wow):
    logged_in(wow)
    wow.slash("/ftr interval 10")
    wow.advance(10 * 60)
    assert wow.lua.globals().ForeverTrackerSyncFrame.IsShown(wow.lua.globals().ForeverTrackerSyncFrame)


# -- levelprompt and debug ------------------------------------------------------------


@pytest.mark.parametrize("command, key", [("levelprompt", "levelPrompt"), ("debug", "debug")])
def test_on_off_settings(wow, command, key):
    logged_in(wow)
    wow.slash(f"/ftr {command} off")
    assert settings(wow)[key] is False
    out = text(typed(wow, f"/ftr {command} on"))
    assert settings(wow)[key] is True
    assert "activé" in out


@pytest.mark.parametrize("command, key", [("levelprompt", "levelPrompt"), ("debug", "debug")])
@pytest.mark.parametrize("value", ["", "oui", "1"])
def test_on_off_settings_reject_other_values(wow, command, key, value):
    logged_in(wow)
    before = settings(wow)[key]
    out = text(typed(wow, f"/ftr {command} {value}"))
    assert settings(wow)[key] == before
    assert f"/ftr {command} on|off" in out


def test_debug_on_enables_debug_messages(wow):
    logged_in(wow)
    wow.slash("/ftr debug on")
    wow.ns.Debug("trace")
    assert any("trace" in line for line in wow.chat())


# -- reset ----------------------------------------------------------------------------


def test_reset_asks_for_confirmation_first(wow):
    logged_in(wow, saved=SAVED_TWO_CHARACTERS)
    wow.slash("/ftr reset")
    assert wow.popups() == [RESET_POPUP]
    assert len(events(wow)) == 3


def test_reset_confirmed_empties_the_current_journal_only(wow):
    logged_in(wow, saved=SAVED_TWO_CHARACTERS)
    wow.slash("/ftr reset")
    wow.wow.acceptPopup(RESET_POPUP)
    assert events(wow) == []
    assert len(events(wow, OTHER)) == 1
    assert "Événements en attente : 0" in text(typed(wow, "/ftr status"))


def test_reset_cancelled_keeps_the_journal(wow):
    logged_in(wow, saved=SAVED_TWO_CHARACTERS)
    wow.slash("/ftr reset")
    wow.wow.cancelPopup(RESET_POPUP)
    assert len(events(wow)) == 3


def test_reset_popup_text_is_localized(wow):
    logged_in(wow)
    dialog = wow.lua.globals().StaticPopupDialogs[RESET_POPUP]
    assert "Davina Asaria" not in dialog.text  # generic text, no format leftovers
    assert "journal" in dialog.text
    assert dialog.button1 == "Vider"
    assert dialog.button2 == "Annuler"


def test_journal_keeps_recording_after_reset(wow):
    logged_in(wow)
    wow.slash("/ftr reset")
    wow.wow.acceptPopup(RESET_POPUP)
    wow.fire("PLAYER_DEAD")
    assert [e["type"] for e in events(wow)] == ["DEATH"]


# -- key binding ----------------------------------------------------------------------


def test_bindings_xml_declares_the_sync_action():
    root = ET.parse(BINDINGS_PATH).getroot()
    assert root.tag == "Bindings"
    bindings = root.findall("Binding")
    assert [b.get("name") for b in bindings] == ["FOREVERTRACKER_SYNC"]
    assert bindings[0].get("header") == "FOREVERTRACKER"
    assert (bindings[0].text or "").strip() == "ForeverTracker_SyncNow()"


def test_binding_labels_in_french(wow):
    logged_in(wow)
    g = wow.lua.globals()
    assert g.BINDING_HEADER_FOREVERTRACKER == "ForeverTracker"
    assert g.BINDING_NAME_FOREVERTRACKER_SYNC == "ForeverTracker : synchroniser maintenant"


def test_binding_labels_in_english(wow):
    logged_in(wow, locale="enUS")
    assert wow.lua.globals().BINDING_NAME_FOREVERTRACKER_SYNC == "ForeverTracker: sync now"


def test_binding_reloads_when_conditions_are_met(wow):
    logged_in(wow)
    wow.press_binding("FOREVERTRACKER_SYNC")
    assert wow.reload_calls() == [{"hardware": True}]


def test_binding_refuses_when_a_condition_is_false(wow):
    logged_in(wow, onTaxi=True)
    before = len(wow.chat())
    wow.press_binding("FOREVERTRACKER_SYNC")
    assert wow.reload_calls() == []
    assert "Synchronisation impossible" in text(wow.chat()[before:])
