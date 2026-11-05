"""Collect.lua: character identity (key) and snapshot from the "Sûr" API calls.

Spec: docs/01-spec-addon-companion.md, "Identité du personnage" and "Snapshot (état courant)".
"""

import pytest

from harness import lua_to_python

GUID = "Player-4242-0A1B2C3D"
LOGIN_TIME = 1793900000
THROTTLE = 300  # RequestTimePlayed at most once every 5 minutes
LINK_HEAD = "|cff1eff00|Hitem:7720::::::::23:::::|h[Masque de Davina]|h|r"
LINK_FEET = "|cffffffff|Hitem:2580::::::::23:::::|h[Bottes]|h|r"


def character(wow, guid=GUID):
    return wow.db()["characters"][guid]


def snapshot(wow, guid=GUID):
    return character(wow, guid)["snapshot"]


def logged_in(wow, **state):
    wow.set_state(**state)
    wow.load_addon()
    wow.fire("PLAYER_LOGIN")
    return wow


def played_requests(wow):
    return wow.wow.playedRequests


def chat(wow):
    return lua_to_python(wow.wow.chat) or []


# -- key ------------------------------------------------------------------------


def test_key_holds_full_identity(wow):
    logged_in(wow)
    assert character(wow)["key"] == {
        "region": "eu",
        "firstName": "Davina",
        "surname": "Asaria",
        "guid": GUID,
        "realmName": "CAMWOW EU5 Realm 1 PvE",
    }


@pytest.mark.parametrize(
    "region_id, code",
    [(1, "us"), (2, "kr"), (3, "eu"), (4, "tw"), (5, "cn")],
)
def test_region_id_is_mapped_to_code(wow, region_id, code):
    logged_in(wow, region=region_id)
    assert character(wow)["key"]["region"] == code


def test_unknown_region_is_left_out(wow):
    logged_in(wow, region=99)
    key = character(wow)["key"]
    assert "region" not in key
    assert key["firstName"] == "Davina"


def test_surname_is_second_return_of_unit_name(wow):
    logged_in(wow, firstName="Bob", surname="Martel")
    key = character(wow)["key"]
    assert (key["firstName"], key["surname"]) == ("Bob", "Martel")


def test_key_is_refreshed_on_login(wow):
    wow.load_saved_variables(
        'ForeverTrackerDB = { schema = 1, characters = { ["Player-4242-0A1B2C3D"] ='
        ' { key = { guid = "Player-4242-0A1B2C3D", firstName = "Old" }, snapshot = {}, events = {} } } }'
    )
    logged_in(wow)
    assert character(wow)["key"]["firstName"] == "Davina"


# -- snapshot at login ------------------------------------------------------------


def test_login_snapshot_has_every_safe_field(wow):
    logged_in(wow, guild="Les Veilleurs", guildRank="Membre", guildRankIndex=3,
               inventory={1: LINK_HEAD, 8: LINK_FEET})
    assert snapshot(wow) == {
        "capturedAt": LOGIN_TIME,
        "level": 23,
        "xp": 4120,
        "xpMax": 13600,
        "rested": 2100,
        "money": 384512,
        "playedTotal": 81234,
        "playedLevel": 2310,
        "zone": "Duskwood",
        "subZone": "Darkshire",
        "mapId": 1431,
        "classFile": "PRIEST",
        "raceFile": "Troll",
        "sex": 3,
        "faction": "Horde",
        "guild": "Les Veilleurs",
        "guildRank": "Membre",
        "deaths": 0,
        "equipment": [
            {"slot": 1, "itemId": 7720, "link": LINK_HEAD},
            {"slot": 8, "itemId": 2580, "link": LINK_FEET},
        ],
    }


def test_snapshot_uses_non_localized_class_and_race(wow):
    logged_in(wow, className="Guerrier", classFile="WARRIOR", raceName="Elfe de la nuit",
              raceFile="NightElf", faction="Alliance", factionName="Alliance", sex=2)
    snap = snapshot(wow)
    assert (snap["classFile"], snap["raceFile"], snap["faction"], snap["sex"]) == (
        "WARRIOR", "NightElf", "Alliance", 2)


def test_no_guild_leaves_guild_fields_out(wow):
    logged_in(wow)
    snap = snapshot(wow)
    assert "guild" not in snap and "guildRank" not in snap


def test_no_rested_xp_is_zero(wow):
    logged_in(wow, rested=None)
    assert snapshot(wow)["rested"] == 0


def test_empty_equipment_is_an_empty_list(wow):
    logged_in(wow)
    assert snapshot(wow)["equipment"] == {}  # empty Lua table


def test_equipment_link_without_item_id_is_skipped(wow):
    logged_in(wow, inventory={1: "garbage", 8: LINK_FEET})
    assert snapshot(wow)["equipment"] == [{"slot": 8, "itemId": 2580, "link": LINK_FEET}]


def test_unknown_map_leaves_map_id_out(wow):
    logged_in(wow, mapId=None)
    assert "mapId" not in snapshot(wow)


def test_login_keeps_saved_death_counter(wow):
    wow.load_saved_variables(
        'ForeverTrackerDB = { schema = 1, characters = { ["Player-4242-0A1B2C3D"] ='
        ' { key = {}, snapshot = { deaths = 4, level = 22 }, events = {} } } }'
    )
    logged_in(wow)
    snap = snapshot(wow)
    assert snap["deaths"] == 4
    assert snap["level"] == 23


def test_nothing_is_collected_before_login(wow):
    wow.load_addon()
    for event in ("PLAYER_XP_UPDATE", "PLAYER_MONEY", "ZONE_CHANGED_NEW_AREA",
                  "PLAYER_GUILD_UPDATE", "PLAYER_EQUIPMENT_CHANGED", "PLAYER_DEAD"):
        wow.fire(event)
    wow.fire("PLAYER_LEVEL_UP", 24)
    wow.fire("TIME_PLAYED_MSG", 1, 1)
    assert wow.db()["characters"] == {}


def test_login_without_guid_does_not_crash(wow):
    wow.load_addon()
    wow.set_state(guid=None)
    wow.fire("PLAYER_LOGIN")
    wow.fire("PLAYER_MONEY")
    assert wow.db()["characters"] == {}


# -- updates on events -------------------------------------------------------------


def test_level_up_uses_event_level(wow):
    # UnitLevel can still return the old level while PLAYER_LEVEL_UP runs.
    logged_in(wow)
    wow.advance(60)
    wow.fire("PLAYER_LEVEL_UP", 24)
    snap = snapshot(wow)
    assert snap["level"] == 24
    assert snap["capturedAt"] == LOGIN_TIME + 60


def test_level_up_without_argument_reads_unit_level(wow):
    logged_in(wow)
    wow.set_state(level=25)
    wow.fire("PLAYER_LEVEL_UP")
    assert snapshot(wow)["level"] == 25


def test_xp_update(wow):
    logged_in(wow)
    wow.set_state(xp=5000, xpMax=14000, rested=0)
    wow.advance(10)
    wow.fire("PLAYER_XP_UPDATE", "player")
    snap = snapshot(wow)
    assert (snap["xp"], snap["xpMax"], snap["rested"]) == (5000, 14000, 0)
    assert snap["capturedAt"] == LOGIN_TIME + 10


def test_money_update(wow):
    logged_in(wow)
    wow.set_state(money=1)
    wow.advance(5)
    wow.fire("PLAYER_MONEY")
    snap = snapshot(wow)
    assert snap["money"] == 1
    assert snap["capturedAt"] == LOGIN_TIME + 5


def test_zone_update(wow):
    logged_in(wow)
    wow.set_state(zone="Elwynn Forest", subZone="Goldshire", mapId=1429)
    wow.advance(5)
    wow.fire("ZONE_CHANGED_NEW_AREA")
    snap = snapshot(wow)
    assert (snap["zone"], snap["subZone"], snap["mapId"]) == ("Elwynn Forest", "Goldshire", 1429)
    assert snap["capturedAt"] == LOGIN_TIME + 5


def test_guild_update_join_and_leave(wow):
    logged_in(wow)
    wow.set_state(guild="Les Veilleurs", guildRank="Recrue", guildRankIndex=4)
    wow.fire("PLAYER_GUILD_UPDATE", "player")
    snap = snapshot(wow)
    assert (snap["guild"], snap["guildRank"]) == ("Les Veilleurs", "Recrue")
    wow.set_state(guild=None, guildRank=None, guildRankIndex=None)
    wow.advance(5)
    wow.fire("PLAYER_GUILD_UPDATE", "player")
    snap = snapshot(wow)
    assert "guild" not in snap and "guildRank" not in snap
    assert snap["capturedAt"] == LOGIN_TIME + 5


def test_equipment_update(wow):
    logged_in(wow, inventory={1: LINK_HEAD})
    wow.set_state(inventory={8: LINK_FEET})
    wow.advance(5)
    wow.fire("PLAYER_EQUIPMENT_CHANGED", 1, True)
    snap = snapshot(wow)
    assert snap["equipment"] == [{"slot": 8, "itemId": 2580, "link": LINK_FEET}]
    assert snap["capturedAt"] == LOGIN_TIME + 5


def test_death_increments_counter(wow):
    logged_in(wow)
    wow.fire("PLAYER_DEAD")
    wow.advance(5)
    wow.fire("PLAYER_DEAD")
    snap = snapshot(wow)
    assert snap["deaths"] == 2
    assert snap["capturedAt"] == LOGIN_TIME + 5


def test_event_updates_only_its_own_fields(wow):
    logged_in(wow)
    before = snapshot(wow)
    wow.set_state(level=40, xp=1, money=2, zone="Elsewhere")
    wow.advance(5)
    wow.fire("PLAYER_MONEY")
    after = snapshot(wow)
    assert after["money"] == 2
    assert (after["level"], after["xp"], after["zone"]) == (before["level"], before["xp"], before["zone"])


def test_full_collect_refreshes_everything(wow):
    # Called by Sync.lua right before a synchronisation.
    logged_in(wow)
    wow.set_state(level=30, money=7, zone="Tanaris")
    wow.advance(400)
    collect = wow.lua.eval("function(ns) return ns.CollectSnapshot() end")
    collect(wow.ns)
    snap = snapshot(wow)
    assert (snap["level"], snap["money"], snap["zone"]) == (30, 7, "Tanaris")
    assert snap["capturedAt"] == LOGIN_TIME + 400
    assert played_requests(wow) == 2  # login + before sync


# -- time played -------------------------------------------------------------------


def test_time_played_msg_sets_played_fields(wow):
    logged_in(wow)
    wow.advance(5)
    wow.fire("TIME_PLAYED_MSG", 90000, 100)
    snap = snapshot(wow)
    assert (snap["playedTotal"], snap["playedLevel"]) == (90000, 100)
    assert snap["capturedAt"] == LOGIN_TIME + 5


def test_login_requests_time_played_once(wow):
    logged_in(wow)
    assert played_requests(wow) == 1


def test_level_up_requests_time_played(wow):
    logged_in(wow)
    wow.advance(THROTTLE)
    wow.set_state(playedTotal=90000, playedLevel=0)
    wow.fire("PLAYER_LEVEL_UP", 24)
    assert played_requests(wow) == 2
    snap = snapshot(wow)
    assert (snap["playedTotal"], snap["playedLevel"]) == (90000, 0)


def test_time_played_request_is_throttled_to_once_per_5_minutes(wow):
    logged_in(wow)
    wow.advance(THROTTLE - 1)
    wow.fire("PLAYER_LEVEL_UP", 24)
    assert played_requests(wow) == 1
    wow.advance(1)
    wow.fire("PLAYER_LEVEL_UP", 25)
    assert played_requests(wow) == 2
    wow.advance(10)
    wow.fire("PLAYER_LEVEL_UP", 26)
    assert played_requests(wow) == 2


def test_request_time_played_returns_whether_it_asked(wow):
    logged_in(wow)
    request = wow.lua.eval("function(ns) return ns.RequestPlayed() end")
    assert request(wow.ns) is False
    wow.advance(THROTTLE)
    assert request(wow.ns) is True
    assert played_requests(wow) == 2


def test_missing_request_time_played_does_not_crash(wow):
    wow.lua.execute("RequestTimePlayed = nil")
    logged_in(wow)
    assert snapshot(wow)["level"] == 23


# -- regional unique names ---------------------------------------------------------


def test_regional_names_disabled_warns_in_debug_mode(wow):
    wow.load_saved_variables('ForeverTrackerDB = { schema = 1, settings = { debug = true } }')
    logged_in(wow, regionalUniqueNames=False)
    messages = chat(wow)
    assert len(messages) == 1
    assert "ForeverTracker" in messages[0]
    assert "noms uniques régionaux" in messages[0]
    assert snapshot(wow)["level"] == 23  # the addon carries on
    assert character(wow)["key"]["firstName"] == "Davina"


def test_regional_names_warning_in_english(wow):
    wow.load_saved_variables('ForeverTrackerDB = { schema = 1, settings = { debug = true } }')
    logged_in(wow, regionalUniqueNames=False, locale="enUS")
    assert "regional unique names" in chat(wow)[0]


def test_regional_names_disabled_is_silent_without_debug(wow):
    logged_in(wow, regionalUniqueNames=False)
    assert chat(wow) == []
    assert snapshot(wow)["level"] == 23


def test_regional_names_enabled_is_silent_in_debug_mode(wow):
    wow.load_saved_variables('ForeverTrackerDB = { schema = 1, settings = { debug = true } }')
    logged_in(wow)
    assert chat(wow) == []


def test_missing_regional_names_api_does_not_crash(wow):
    wow.load_saved_variables('ForeverTrackerDB = { schema = 1, settings = { debug = true } }')
    wow.lua.execute("RegionalUniqueNamesEnabled = nil")
    logged_in(wow)
    assert chat(wow) == []
    assert character(wow)["key"]["region"] == "eu"
