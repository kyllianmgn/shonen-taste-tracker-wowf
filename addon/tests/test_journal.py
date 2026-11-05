"""Journal.lua: timestamped events.

Spec: docs/01-spec-addon-companion.md, "Journal d'événements".
"""

import re

import pytest

GUID = "Player-4242-0A1B2C3D"
LOGIN_TIME = 1793900000
MAX_EVENTS = 300
# Neither GetProfessions nor the skill-line fallback returns anything at login.
NO_PROFESSIONS = {"professions": [], "skillLines": []}
ID_PATTERN = re.compile(r"^(Player-\d+-[0-9A-F]+)-(\d+)-(\d+)$")


def logged_in(wow, **state):
    wow.set_state(**state)
    wow.load_addon()
    wow.fire("PLAYER_LOGIN")
    return wow


def events(wow, guid=GUID):
    return wow.db()["characters"][guid]["events"] or []


def of_type(wow, event_type):
    return [e for e in events(wow) if e["type"] == event_type]


def saved_character(snapshot="", events_lua=""):
    return (
        "ForeverTrackerDB = { schema = 1, characters = { [\"%s\"] = {"
        " key = { guid = \"%s\" }, snapshot = { level = 23 %s }, events = { %s } } } }"
        % (GUID, GUID, snapshot, events_lua)
    )


def skill_change(wow, professions):
    """Ranks returned by GetProfessionInfo; Collect.lua copies them into the snapshot first."""
    wow.set_state(professions=[{"name": n, "rank": r, "max": 300} for n, r in professions], skillLines=[])
    wow.fire("SKILL_LINES_CHANGED")


def enter_instance(wow, event="PLAYER_ENTERING_WORLD", **state):
    wow.set_state(inInstance=True, **state)
    wow.fire(event)


def leave_instance(wow):
    wow.set_state(inInstance=False, instanceType="none", instanceName=None, instanceId=None)
    wow.fire("ZONE_CHANGED_NEW_AREA")


# -- event shape and ids ------------------------------------------------------------


def test_event_has_id_type_at_and_data(wow):
    logged_in(wow)
    (event,) = events(wow)
    assert set(event) == {"id", "type", "at", "data"}
    assert event["at"] == LOGIN_TIME


def test_id_is_guid_time_and_counter(wow):
    logged_in(wow)
    assert events(wow)[0]["id"] == f"{GUID}-{LOGIN_TIME}-1"


def test_ids_are_unique_within_the_same_second(wow):
    logged_in(wow)
    for _ in range(5):
        wow.fire("PLAYER_DEAD")
    ids = [e["id"] for e in events(wow)]
    assert len(ids) == 6
    assert len(set(ids)) == len(ids)
    counters = [int(ID_PATTERN.match(i).group(3)) for i in ids]
    assert counters == sorted(counters)
    assert all(ID_PATTERN.match(i).group(2) == str(LOGIN_TIME) for i in ids)


def test_ids_use_the_time_of_each_event(wow):
    logged_in(wow)
    wow.advance(42)
    wow.fire("PLAYER_DEAD")
    death = of_type(wow, "DEATH")[0]
    assert death["at"] == LOGIN_TIME + 42
    assert death["id"] == f"{GUID}-{LOGIN_TIME + 42}-2"


def test_events_are_kept_in_order_after_saved_ones(wow):
    wow.load_saved_variables(saved_character(events_lua=(
        '{ id = "%s-1793899000-1", type = "DEATH", at = 1793899000, data = { level = 22 } }' % GUID
    )))
    logged_in(wow)
    assert [e["type"] for e in events(wow)] == ["DEATH", "SESSION_START"]


def test_nothing_is_recorded_before_login(wow):
    wow.load_addon()
    wow.fire("PLAYER_DEAD")
    wow.fire("PLAYER_LEVEL_UP", 24)
    wow.fire("PLAYER_LOGOUT")
    assert wow.db()["characters"] == {}


# -- cap ----------------------------------------------------------------------------


def test_journal_is_capped_at_300_events_oldest_first_out(wow):
    logged_in(wow)  # SESSION_START = event 1
    for _ in range(310):
        wow.advance(1)
        wow.fire("PLAYER_DEAD")
    journal = events(wow)
    assert len(journal) == MAX_EVENTS
    # 311 recorded: SESSION_START and the first 10 deaths are gone
    assert journal[0]["id"] == f"{GUID}-{LOGIN_TIME + 11}-12"
    assert journal[-1]["id"] == f"{GUID}-{LOGIN_TIME + 310}-311"
    assert all(e["type"] == "DEATH" for e in journal)


def test_cap_also_trims_an_oversized_saved_journal(wow):
    saved = ", ".join(
        '{ id = "%s-%d-%d", type = "DEATH", at = %d, data = { level = 22 } }' % (GUID, 1000 + i, i, 1000 + i)
        for i in range(1, 306)
    )
    wow.load_saved_variables(saved_character(events_lua=saved))
    logged_in(wow)
    journal = events(wow)
    assert len(journal) == MAX_EVENTS
    assert journal[-1]["type"] == "SESSION_START"
    assert journal[0]["at"] == 1000 + 7  # 305 saved + 1 new: the 6 oldest are gone


# -- SESSION_START / SESSION_END ----------------------------------------------------


def test_session_start_on_login(wow):
    logged_in(wow, level=22, zone="Duskwood")
    (event,) = of_type(wow, "SESSION_START")
    assert event["data"] == {"level": 22, "zone": "Duskwood"}


def test_session_end_on_logout(wow):
    logged_in(wow, playedTotal=81234)
    wow.advance(600)
    wow.set_state(money=400000, level=24)
    wow.fire("PLAYER_LOGOUT")
    (event,) = of_type(wow, "SESSION_END")
    assert event["at"] == LOGIN_TIME + 600
    assert event["data"] == {"level": 24, "playedTotal": 81234, "money": 400000}


# -- LEVEL_UP -----------------------------------------------------------------------


def test_level_up_is_recorded_immediately(wow):
    logged_in(wow)  # /played already requested at login: the level-up request is throttled
    wow.advance(60)
    wow.set_state(zone="Westfall")
    wow.fire("PLAYER_LEVEL_UP", 24)
    (event,) = of_type(wow, "LEVEL_UP")
    assert event["at"] == LOGIN_TIME + 60
    assert event["data"] == {"level": 24, "zone": "Westfall"}


def test_level_up_uses_the_event_level_not_unit_level(wow):
    logged_in(wow, level=23)  # UnitLevel can lag behind during PLAYER_LEVEL_UP
    wow.fire("PLAYER_LEVEL_UP", 24)
    assert of_type(wow, "LEVEL_UP")[0]["data"]["level"] == 24


def test_level_up_is_completed_by_the_next_time_played_msg(wow):
    logged_in(wow)
    wow.advance(60)
    wow.fire("PLAYER_LEVEL_UP", 24)
    wow.advance(240)
    wow.fire("TIME_PLAYED_MSG", 81534, 240)
    assert of_type(wow, "LEVEL_UP")[0]["data"] == {
        "level": 24, "zone": "Duskwood", "playedTotal": 81534,
    }


def test_completed_level_up_is_not_overwritten(wow):
    logged_in(wow)
    wow.fire("PLAYER_LEVEL_UP", 24)
    wow.fire("TIME_PLAYED_MSG", 81300, 10)
    wow.fire("TIME_PLAYED_MSG", 99999, 9999)
    assert of_type(wow, "LEVEL_UP")[0]["data"]["playedTotal"] == 81300


def test_every_pending_level_up_is_completed(wow):
    logged_in(wow)
    wow.fire("PLAYER_LEVEL_UP", 24)
    wow.fire("PLAYER_LEVEL_UP", 25)
    wow.fire("TIME_PLAYED_MSG", 81300, 10)
    assert [e["data"]["playedTotal"] for e in of_type(wow, "LEVEL_UP")] == [81300, 81300]


def test_time_played_without_pending_level_up_changes_no_event(wow):
    logged_in(wow)
    before = events(wow)
    wow.fire("TIME_PLAYED_MSG", 90000, 100)
    assert events(wow) == before


def test_level_up_gets_played_from_the_throttled_request_once_allowed(wow):
    logged_in(wow)
    wow.advance(300)  # throttle elapsed: the level-up request goes out
    wow.set_state(playedTotal=81534)
    wow.fire("PLAYER_LEVEL_UP", 24)
    wow.advance(300)
    wow.ns.RequestPlayed()  # e.g. right before a sync
    assert of_type(wow, "LEVEL_UP")[0]["data"]["playedTotal"] == 81534


# -- DEATH --------------------------------------------------------------------------


def test_death(wow):
    logged_in(wow, level=23, zone="Duskwood")
    wow.advance(5)
    wow.fire("PLAYER_DEAD")
    (event,) = of_type(wow, "DEATH")
    assert event["at"] == LOGIN_TIME + 5
    assert event["data"] == {"level": 23, "zone": "Duskwood"}


# -- DUNGEON_ENTER ------------------------------------------------------------------


@pytest.mark.parametrize("instance_type", ["party", "raid"])
@pytest.mark.parametrize("event", ["PLAYER_ENTERING_WORLD", "ZONE_CHANGED_NEW_AREA"])
def test_dungeon_enter_for_party_and_raid(wow, instance_type, event):
    logged_in(wow)
    enter_instance(wow, event, instanceType=instance_type, instanceName="Les Mortemines", instanceId=36)
    (entered,) = of_type(wow, "DUNGEON_ENTER")
    assert entered["data"] == {"instanceName": "Les Mortemines", "instanceId": 36}


@pytest.mark.parametrize("instance_type", ["pvp", "arena", "scenario", "none"])
def test_no_dungeon_enter_for_other_instance_types(wow, instance_type):
    logged_in(wow)
    enter_instance(wow, instanceType=instance_type, instanceName="Goulet des Chanteguerres", instanceId=489)
    assert of_type(wow, "DUNGEON_ENTER") == []


def test_no_dungeon_enter_outside_instances(wow):
    logged_in(wow)
    wow.fire("PLAYER_ENTERING_WORLD")
    wow.fire("ZONE_CHANGED_NEW_AREA")
    assert of_type(wow, "DUNGEON_ENTER") == []


def test_dungeon_enter_is_not_duplicated_inside_the_instance(wow):
    logged_in(wow)
    enter_instance(wow, instanceType="party", instanceName="Les Mortemines", instanceId=36)
    wow.fire("ZONE_CHANGED_NEW_AREA")
    wow.fire("PLAYER_ENTERING_WORLD")
    assert len(of_type(wow, "DUNGEON_ENTER")) == 1


def test_dungeon_enter_is_not_duplicated_for_the_same_instance_twice_in_a_row(wow):
    logged_in(wow)
    enter_instance(wow, instanceType="party", instanceName="Les Mortemines", instanceId=36)
    leave_instance(wow)
    enter_instance(wow, instanceType="party", instanceName="Les Mortemines", instanceId=36)
    assert len(of_type(wow, "DUNGEON_ENTER")) == 1


def test_dungeon_enter_for_a_different_instance(wow):
    logged_in(wow)
    enter_instance(wow, instanceType="party", instanceName="Les Mortemines", instanceId=36)
    leave_instance(wow)
    enter_instance(wow, instanceType="party", instanceName="Donjon d'Ombrecroc", instanceId=33)
    leave_instance(wow)
    enter_instance(wow, instanceType="party", instanceName="Les Mortemines", instanceId=36)
    assert [e["data"]["instanceId"] for e in of_type(wow, "DUNGEON_ENTER")] == [36, 33, 36]


def test_dungeon_enter_is_not_duplicated_after_a_reload(wow):
    wow.load_saved_variables(saved_character(events_lua=(
        '{ id = "%s-1793899000-1", type = "DUNGEON_ENTER", at = 1793899000,'
        ' data = { instanceName = "Les Mortemines", instanceId = 36 } }' % GUID
    )))
    logged_in(wow, inInstance=True, instanceType="party", instanceName="Les Mortemines", instanceId=36)
    wow.fire("PLAYER_ENTERING_WORLD")
    assert len(of_type(wow, "DUNGEON_ENTER")) == 1


# -- GUILD_CHANGE -------------------------------------------------------------------


def test_guild_change_when_joining(wow):
    logged_in(wow)
    wow.set_state(guild="Les Veilleurs", guildRank="Recrue")
    wow.fire("PLAYER_GUILD_UPDATE")
    (event,) = of_type(wow, "GUILD_CHANGE")
    assert event["data"] == {"to": "Les Veilleurs"}


def test_guild_change_when_leaving(wow):
    logged_in(wow, guild="Les Veilleurs", guildRank="Membre")
    wow.set_state(guild=None, guildRank=None)
    wow.fire("PLAYER_GUILD_UPDATE")
    (event,) = of_type(wow, "GUILD_CHANGE")
    assert event["data"] == {"from": "Les Veilleurs"}


def test_guild_change_between_guilds(wow):
    logged_in(wow, guild="Les Veilleurs", guildRank="Membre")
    wow.set_state(guild="La Horde Noire")
    wow.fire("PLAYER_GUILD_UPDATE")
    assert of_type(wow, "GUILD_CHANGE")[0]["data"] == {"from": "Les Veilleurs", "to": "La Horde Noire"}


def test_no_guild_change_when_name_is_the_same(wow):
    logged_in(wow, guild="Les Veilleurs", guildRank="Membre")
    wow.set_state(guildRank="Officier")
    wow.fire("PLAYER_GUILD_UPDATE")
    wow.fire("PLAYER_GUILD_UPDATE")
    assert of_type(wow, "GUILD_CHANGE") == []


def test_no_guild_change_while_guild_info_is_not_loaded(wow):
    # Early in a session GetGuildInfo can return nil although IsInGuild() is true.
    wow.load_saved_variables(saved_character(snapshot=', guild = "Les Veilleurs"'))
    logged_in(wow, guild=None, inGuild=True)
    wow.fire("PLAYER_GUILD_UPDATE")
    wow.set_state(guild="Les Veilleurs", inGuild=None)
    wow.fire("PLAYER_GUILD_UPDATE")
    assert of_type(wow, "GUILD_CHANGE") == []


def test_guild_change_against_the_guild_of_the_last_session(wow):
    wow.load_saved_variables(saved_character(snapshot=', guild = "Les Veilleurs"'))
    logged_in(wow, guild="La Horde Noire")
    wow.fire("PLAYER_GUILD_UPDATE")
    assert of_type(wow, "GUILD_CHANGE")[0]["data"] == {"from": "Les Veilleurs", "to": "La Horde Noire"}


def test_guild_change_is_recorded_once(wow):
    logged_in(wow)
    wow.set_state(guild="Les Veilleurs")
    wow.fire("PLAYER_GUILD_UPDATE")
    wow.fire("PLAYER_GUILD_UPDATE")
    assert len(of_type(wow, "GUILD_CHANGE")) == 1


# -- PROFESSION_TIER ----------------------------------------------------------------


@pytest.mark.parametrize("tier", [75, 150, 225, 300])
def test_profession_tier_when_rank_reaches_a_threshold(wow, tier):
    logged_in(wow, **NO_PROFESSIONS)
    skill_change(wow, [("Herboristerie", tier - 1)])
    skill_change(wow, [("Herboristerie", tier)])
    (event,) = of_type(wow, "PROFESSION_TIER")
    assert event["data"] == {"name": "Herboristerie", "rank": tier}


@pytest.mark.parametrize("rank", [74, 76, 149, 151, 299, 301, 375])
def test_no_profession_tier_without_crossing(wow, rank):
    logged_in(wow, **NO_PROFESSIONS)
    skill_change(wow, [("Herboristerie", rank - 1)])
    skill_change(wow, [("Herboristerie", rank)])
    assert of_type(wow, "PROFESSION_TIER") == []


def test_profession_tier_crossed_by_a_jump_is_one_event_with_the_new_rank(wow):
    logged_in(wow, **NO_PROFESSIONS)
    skill_change(wow, [("Herboristerie", 140)])
    skill_change(wow, [("Herboristerie", 230)])
    (event,) = of_type(wow, "PROFESSION_TIER")
    assert event["data"] == {"name": "Herboristerie", "rank": 230}


def test_profession_tier_per_profession(wow):
    logged_in(wow, **NO_PROFESSIONS)
    skill_change(wow, [("Herboristerie", 74), ("Alchimie", 149)])
    skill_change(wow, [("Herboristerie", 75), ("Alchimie", 149)])
    skill_change(wow, [("Herboristerie", 75), ("Alchimie", 150)])
    assert [e["data"] for e in of_type(wow, "PROFESSION_TIER")] == [
        {"name": "Herboristerie", "rank": 75},
        {"name": "Alchimie", "rank": 150},
    ]


def test_no_profession_tier_when_rank_does_not_change(wow):
    logged_in(wow, **NO_PROFESSIONS)
    skill_change(wow, [("Herboristerie", 74)])
    skill_change(wow, [("Herboristerie", 75)])
    skill_change(wow, [("Herboristerie", 75)])
    assert len(of_type(wow, "PROFESSION_TIER")) == 1


def test_no_profession_tier_when_rank_goes_down_then_back(wow):
    logged_in(wow, **NO_PROFESSIONS)
    skill_change(wow, [("Herboristerie", 80)])
    skill_change(wow, [("Herboristerie", 1)])  # unlearnt and learnt again
    skill_change(wow, [("Herboristerie", 74)])
    assert of_type(wow, "PROFESSION_TIER") == []


def test_first_reading_of_a_profession_is_only_a_baseline(wow):
    # Profession data can load after login: a rank seen for the first time is not a crossing.
    logged_in(wow, **NO_PROFESSIONS)
    skill_change(wow, [("Herboristerie", 112)])
    skill_change(wow, [("Herboristerie", 112), ("Minage", 160)])
    assert of_type(wow, "PROFESSION_TIER") == []


def test_profession_tier_against_the_ranks_read_at_login(wow):
    logged_in(wow, professions=[{"name": "Herboristerie", "rank": 149, "max": 150}])
    skill_change(wow, [("Herboristerie", 150)])
    assert of_type(wow, "PROFESSION_TIER")[0]["data"] == {"name": "Herboristerie", "rank": 150}


def test_profession_tier_against_the_ranks_of_the_last_session(wow):
    wow.load_saved_variables(saved_character(
        snapshot=', professions = { { name = "Herboristerie", rank = 74, max = 150 } }'
    ))
    logged_in(wow, **NO_PROFESSIONS)
    skill_change(wow, [("Herboristerie", 75)])
    assert of_type(wow, "PROFESSION_TIER")[0]["data"] == {"name": "Herboristerie", "rank": 75}


def test_skill_change_without_profession_api_is_ignored(wow):
    logged_in(wow, **NO_PROFESSIONS)
    for api in ("GetProfessions", "GetNumSkillLines"):
        wow.wow.removeApi(api)
    wow.fire("SKILL_LINES_CHANGED")
    assert of_type(wow, "PROFESSION_TIER") == []
