"""Share.lua: /ftr share, the code pasted into /sync code: on Discord.

Spec: docs/01-spec-addon-companion.md, "Mode de base : /ftr share";
docs/02-spec-server.md, "Commande /sync"; contract/schemas/share-code.payload.json.
"""

import base64
import json
import random
import re
import string

import jsonschema
import pytest

from harness import FIXTURES_DIR
from share_fixture import SHARE_SAMPLE_PATH, decode_share_code, reference_code

GUID = "Player-4242-0A1B2C3D"
OTHER = "Player-4242-0FFFFFFF"
LOGIN_TIME = 1793900000
MAX_LENGTH = 4000
SCHEMA_PATH = FIXTURES_DIR.parent / "schemas" / "share-code.payload.json"
CODE_PATTERN = re.compile(r"^FT1:[A-Za-z0-9_-]+$")


@pytest.fixture(scope="module")
def validator():
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return jsonschema.Draft202012Validator(schema)


def logged_in(wow, saved=None, **state):
    wow.set_state(**state)
    if saved:
        wow.load_saved_variables(saved)
    wow.load_addon()
    wow.fire("PLAYER_LOGIN")
    return wow


def window(wow):
    return wow.ns.shareWindow


def share(wow):
    """Type /ftr share and return the code shown in the window."""
    wow.slash("/ftr share")
    return window(wow).editBox.text


def notice(wow):
    return window(wow).notice.text or ""


def random_text(rng, length):
    return "".join(rng.choice(string.ascii_letters + string.digits) for _ in range(length))


# -- JSON serializer --------------------------------------------------------------------


def encode(wow, value):
    return wow.ns.EncodeJSON(value)


def test_json_objects_have_sorted_keys_and_no_spaces(wow):
    wow.load_addon()
    value = wow.to_lua({"b": 2, "a": "x", "c": {"z": True, "y": False}})
    assert encode(wow, value) == '{"a":"x","b":2,"c":{"y":false,"z":true}}'


def test_json_empty_table_is_an_object_unless_marked_as_array(wow):
    wow.load_addon()
    assert encode(wow, wow.lua.table()) == "{}"
    assert encode(wow, wow.ns.JsonArray(wow.lua.table())) == "[]"
    assert encode(wow, wow.ns.JsonArray(wow.lua.table(3, "a", wow.lua.table()))) == '[3,"a",{}]'


@pytest.mark.parametrize(
    "text",
    [
        'guillemets " et barre \\ oblique',
        "lignes\nretour\rtab\tfin",
        "contrôle \x01\x08\x0c\x1f\x7f",
        "UTF-8 : é à ç € « » 😀",
        "|cff1eff00|Hitem:7720::|h[Coiffe]|h|r",
        "/ slash",
        "",
    ],
)
def test_json_strings_round_trip(wow, text):
    wow.load_addon()
    out = encode(wow, wow.to_lua({"s": text}))
    assert json.loads(out) == {"s": text}
    assert "\n" not in out and "\r" not in out and "\t" not in out


def test_json_numbers(wow):
    wow.load_addon()
    value = wow.to_lua({"int": 1793900000, "big": 2**40, "neg": -5, "float": 22.6, "zero": 0})
    out = encode(wow, value)
    assert '"int":1793900000' in out
    assert '"big":1099511627776' in out
    assert '"float":22.6' in out
    assert json.loads(out) == {"int": 1793900000, "big": 2**40, "neg": -5, "float": 22.6, "zero": 0}


def test_json_integers_written_as_floats_by_lua_stay_integers(wow):
    wow.load_addon()
    out = encode(wow, wow.lua.eval("{ n = 2 ^ 31 + 0.0, m = 10 / 2 }"))
    assert out == '{"m":5,"n":2147483648}'


# -- base64url ------------------------------------------------------------------------


@pytest.mark.parametrize("data", [b"", b"f", b"fo", b"foo", b"foob", b"fooba", b"foobar",
                                  bytes(range(256)), b"\xfb\xff\xfe" * 7])
def test_base64url_matches_python_without_padding(wow, data):
    wow.load_addon()
    expected = base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")
    assert wow.ns.Base64Url(data) == expected


# -- the code -------------------------------------------------------------------------


def test_code_decodes_and_matches_the_schema(wow, validator):
    logged_in(wow)
    wow.advance(60)
    wow.fire("PLAYER_DEAD")
    code = share(wow)

    assert CODE_PATTERN.match(code)
    payload = decode_share_code(code)
    validator.validate(payload)
    assert payload["schema"] == 1
    assert payload["addonVersion"] == "1.0.0"
    assert payload["sentAt"] == LOGIN_TIME + 60
    character = payload["character"]
    assert character["key"] == {
        "region": "eu", "firstName": "Davina", "surname": "Asaria",
        "guid": GUID, "realmName": "CAMWOW EU5 Realm 1 PvE",
    }
    assert character["snapshot"]["level"] == 23
    assert character["snapshot"]["capturedAt"] == LOGIN_TIME + 60
    assert [e["type"] for e in character["events"]] == ["SESSION_START", "DEATH"]


def test_empty_lists_are_json_arrays_and_event_data_objects(wow, validator):
    saved = """ForeverTrackerDB = { schema = 1, characters = { ["%s"] = {
      key = { guid = "%s" }, snapshot = { level = 23 }, events = {
        { id = "x-1", type = "SESSION_START", at = 1793899000, data = {} },
      } } } }""" % (GUID, GUID)
    logged_in(wow, saved, professions=[], skillLines=[], factions=[], inventory={})
    payload = decode_share_code(share(wow))
    validator.validate(payload)
    snap = payload["character"]["snapshot"]
    assert snap.get("equipment", []) == []
    assert snap.get("professions", []) == []
    assert snap.get("reputations", []) == []
    assert payload["character"]["events"][0]["data"] == {}


def test_lists_of_the_snapshot_are_kept(wow, validator):
    link = "|cff1eff00|Hitem:7720::::::::23:::::::|h[Coiffe]|h|r"
    logged_in(wow, inventory={1: link})
    snap = decode_share_code(share(wow))["character"]["snapshot"]
    assert snap["equipment"] == [{"slot": 1, "itemId": 7720, "link": link}]
    assert {"name": "Herboristerie", "rank": 112, "max": 150} in snap["professions"]
    assert any(r["factionId"] == 76 for r in snap["reputations"])
    assert notice(wow) == ""


def test_only_schema_fields_are_sent(wow, validator):
    saved = """ForeverTrackerDB = { schema = 1, characters = { ["%s"] = {
      key = { guid = "%s", extra = 1 }, snapshot = { level = 23, extra = "x" }, events = {
        { id = "x-1", type = "SESSION_START", at = 1793899000, data = { level = 22 }, extra = true },
      }, extra = {} } } }""" % (GUID, GUID)
    logged_in(wow, saved)
    validator.validate(decode_share_code(share(wow)))


def test_snapshot_is_refreshed_before_sharing(wow):
    logged_in(wow)
    wow.set_state(money=999999)
    wow.advance(120)
    snap = decode_share_code(share(wow))["character"]["snapshot"]
    assert snap["money"] == 999999
    assert snap["capturedAt"] == LOGIN_TIME + 120


# -- events since the last share --------------------------------------------------------


def test_second_share_only_has_events_since_the_first(wow):
    logged_in(wow)
    wow.advance(10)
    first = decode_share_code(share(wow))["character"]["events"]
    assert [e["type"] for e in first] == ["SESSION_START"]

    wow.advance(300)
    wow.fire("PLAYER_DEAD")
    wow.advance(10)
    second = decode_share_code(share(wow))["character"]["events"]
    assert [e["type"] for e in second] == ["DEATH"]

    wow.advance(300)
    assert decode_share_code(share(wow))["character"]["events"] == []


def test_event_in_the_same_second_as_the_share_is_not_lost(wow):
    logged_in(wow)
    share(wow)
    wow.fire("PLAYER_DEAD")  # same GetServerTime() as the share
    events = decode_share_code(share(wow))["character"]["events"]
    assert "DEATH" in [e["type"] for e in events]


def test_last_shared_at_is_saved_per_character_outside_the_character_entry(wow):
    saved = """ForeverTrackerDB = { schema = 1, lastSharedAt = { ["%s"] = 1700000000 },
      characters = {} }""" % OTHER
    logged_in(wow, saved)
    wow.advance(42)
    share(wow)
    db = wow.db()
    assert db["lastSharedAt"] == {GUID: LOGIN_TIME + 42, OTHER: 1700000000}
    # characters[guid] is validated with additionalProperties: false by the companion.
    assert set(db["characters"][GUID]) == {"key", "snapshot", "events"}


def test_last_shared_at_from_the_file_filters_old_events(wow):
    saved = """ForeverTrackerDB = { schema = 1, lastSharedAt = { ["%s"] = 1793890000 },
      characters = { ["%s"] = { key = { guid = "%s" }, snapshot = { level = 23 }, events = {
        { id = "a", type = "DEATH", at = 1793880000, data = {} },
        { id = "b", type = "DEATH", at = 1793890000, data = {} },
        { id = "c", type = "DEATH", at = 1793895000, data = {} },
      } } } }""" % (GUID, GUID, GUID)
    logged_in(wow, saved)
    ids = [e["id"] for e in decode_share_code(share(wow))["character"]["events"]]
    assert ids[:2] == ["b", "c"]
    assert "a" not in ids


def test_corrupt_last_shared_at_is_replaced(wow):
    logged_in(wow, 'ForeverTrackerDB = { schema = 1, lastSharedAt = "oops", characters = {} }')
    share(wow)
    assert wow.db()["lastSharedAt"] == {GUID: LOGIN_TIME}


# -- size limit -----------------------------------------------------------------------


def big_equipment(rng):
    return {
        slot: "|cff1eff00|Hitem:%d::::::::23:::::::|h[%s]|h|r" % (1000 + slot, random_text(rng, 400))
        for slot in range(1, 20)
    }


def big_factions(rng):
    return [
        {"factionID": 100 + i, "name": random_text(rng, 60), "reaction": 4, "currentStanding": 10,
         "currentReactionThreshold": 0, "nextReactionThreshold": 3000}
        for i in range(200)
    ]


def test_long_code_drops_equipment_first(wow, validator):
    rng = random.Random(1)
    logged_in(wow, inventory=big_equipment(rng))
    code = share(wow)
    assert len(code) <= MAX_LENGTH
    snap = decode_share_code(code)["character"]["snapshot"]
    validator.validate(decode_share_code(code))
    assert "equipment" not in snap
    assert len(snap["reputations"]) == 2
    assert "équipement" in notice(wow)
    assert "réputations" not in notice(wow)


def test_long_code_then_drops_reputations(wow, validator):
    rng = random.Random(2)
    logged_in(wow, inventory=big_equipment(rng), factions=big_factions(rng))
    code = share(wow)
    assert len(code) <= MAX_LENGTH
    payload = decode_share_code(code)
    validator.validate(payload)
    assert "equipment" not in payload["character"]["snapshot"]
    assert "reputations" not in payload["character"]["snapshot"]
    assert "équipement" in notice(wow) and "réputations" in notice(wow)


def test_equipment_goes_first_even_when_reputations_are_the_long_part(wow):
    rng = random.Random(3)
    link = "|cff1eff00|Hitem:7720::::::::23:::::::|h[Coiffe]|h|r"
    logged_in(wow, inventory={1: link}, factions=big_factions(rng))
    snap = decode_share_code(share(wow))["character"]["snapshot"]
    # the order is fixed by the spec
    assert "equipment" not in snap
    assert "reputations" not in snap


def test_without_equipment_only_reputations_are_dropped(wow):
    rng = random.Random(7)
    logged_in(wow, factions=big_factions(rng))
    entry = wow.lua.eval(
        "function(src) return { key = src.key,"
        " snapshot = { level = 23, reputations = src.snapshot.reputations }, events = {} } end"
    )(wow.ns.character)
    code, dropped = wow.ns.BuildShareCode(entry, None, LOGIN_TIME)
    assert list(dropped.values()) == ["reputations"]
    assert len(code) <= MAX_LENGTH


def test_code_still_too_long_is_shown_with_a_hint(wow, validator):
    rng = random.Random(4)
    events = ",\n".join(
        '{ id = "e-%d", type = "DEATH", at = %d, data = { zone = "%s" } }'
        % (i, 1793800000 + i, random_text(rng, 60))
        for i in range(300)
    )
    saved = """ForeverTrackerDB = { schema = 1, characters = { ["%s"] = {
      key = { guid = "%s" }, snapshot = { level = 23 }, events = { %s } } } }""" % (GUID, GUID, events)
    logged_in(wow, saved)
    code = share(wow)
    assert len(code) > MAX_LENGTH
    validator.validate(decode_share_code(code))
    assert "/sync fichier" in notice(wow)


def test_build_share_code_reports_what_was_dropped(wow):
    rng = random.Random(5)
    logged_in(wow, inventory=big_equipment(rng))
    code, dropped = wow.ns.BuildShareCode(wow.ns.character, None, LOGIN_TIME)
    assert len(code) <= MAX_LENGTH
    assert list(dropped.values()) == ["equipment"]
    # the saved snapshot keeps its equipment: only the code is trimmed
    assert len(wow.db()["characters"][GUID]["snapshot"]["equipment"]) == 19


# -- window and command -----------------------------------------------------------------


def test_window_shows_the_code_selected_and_focused(wow):
    logged_in(wow)
    code = share(wow)
    win = window(wow)
    assert win.IsShown(win)
    box = win.editBox
    assert box.text == code
    assert box.focused is True
    assert box.highlighted is not None
    assert box.highlighted.first == 0 and box.highlighted.last == -1


def test_window_explains_where_to_paste(wow):
    logged_in(wow)
    share(wow)
    assert "/sync code:" in window(wow).help.text


def test_typing_in_the_box_restores_the_code(wow):
    logged_in(wow)
    code = share(wow)
    box = window(wow).editBox
    wow.wow.typeText(box, "abc")
    assert box.text == code
    assert box.highlighted.first == 0


def test_escape_closes_the_window(wow):
    logged_in(wow)
    share(wow)
    wow.wow.pressEscape(window(wow).editBox)
    assert not window(wow).IsShown(window(wow))


def test_window_is_not_a_global(wow):
    logged_in(wow)
    share(wow)
    assert wow.lua.globals().ForeverTrackerShareFrame is None


def test_share_before_login_says_no_character(wow):
    wow.load_addon()
    wow.slash("/ftr share")
    assert any("Aucun perso" in line for line in wow.chat())
    assert not window(wow).IsShown(window(wow))


def test_share_is_listed_in_help(wow):
    logged_in(wow)
    wow.slash("/ftr help")
    assert any("/ftr share" in line for line in wow.chat())


def test_share_does_not_reload_the_ui(wow):
    logged_in(wow)
    share(wow)
    assert wow.reload_calls() == []


def test_english_client(wow):
    logged_in(wow, locale="enUS")
    share(wow)
    assert "/sync code:" in window(wow).help.text
    assert window(wow).help.text.startswith("Copy")


# -- reference fixture for the server (S-19) ---------------------------------------------


def test_reference_fixture_is_up_to_date(validator):
    expected = reference_code()
    assert SHARE_SAMPLE_PATH.read_bytes().decode("ascii") == expected, (
        "run: python addon/tests/share_fixture.py"
    )


def test_reference_fixture_decodes_and_matches_the_schema(validator):
    code = SHARE_SAMPLE_PATH.read_text(encoding="ascii")
    assert CODE_PATTERN.match(code)
    payload = decode_share_code(code)
    validator.validate(payload)
    character = payload["character"]
    assert character["key"]["guid"] == GUID
    assert character["snapshot"]["level"] == 24
    assert character["snapshot"]["guild"] == "Les Éveillés"
    assert character["snapshot"]["subZone"] == "L'Éperon \"sud\""
    assert [e["type"] for e in character["events"]] == ["SESSION_START", "DEATH", "LEVEL_UP"]
    assert len(character["snapshot"]["equipment"]) == 2
