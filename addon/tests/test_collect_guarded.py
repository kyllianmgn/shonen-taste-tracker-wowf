"""Collect.lua: snapshot fields from the API calls marked "À vérifier".

Spec: docs/01-spec-addon-companion.md, "Addon : données et événements" (ilvl, professions,
reputations, honor). Each API may be missing on the Forever client or raise: the field is then
left out of the snapshot and the addon never raises a Lua error.
"""

import pytest

from harness import lua_to_python

GUID = "Player-4242-0A1B2C3D"
DEBUG_SV = "ForeverTrackerDB = { settings = { debug = true } }"

HERB = {"name": "Herboristerie", "rank": 112, "max": 150}
ALCH = {"name": "Alchimie", "rank": 80, "max": 150}
FISH = {"name": "Pêche", "rank": 30, "max": 75}
ORGRIMMAR = {"factionId": 76, "name": "Orgrimmar", "standing": 5, "value": 1200, "max": 6000}
DARKSPEAR = {"factionId": 530, "name": "Trolls Sombrelance", "standing": 4, "value": 300, "max": 3000}

EXPECTED = {
    "ilvl": 21,
    "honor": 0,
    "professions": [HERB, ALCH],
    "reputations": [ORGRIMMAR, DARKSPEAR],
}

# Every API each field depends on (professions: primary path only, the fallback is tested apart).
APIS = {
    "ilvl": ["GetAverageItemLevel"],
    "honor": ["UnitHonor"],
    "reputations": ["C_Reputation", "C_Reputation.GetNumFactions", "C_Reputation.GetFactionDataByIndex"],
}


def snapshot(wow):
    return wow.db()["characters"][GUID]["snapshot"]


def login(wow, saved_variables=None, **state):
    wow.set_state(**state)
    if saved_variables:
        wow.load_saved_variables(saved_variables)
    wow.load_addon()
    wow.fire("PLAYER_LOGIN")
    return wow


def remove(wow, *paths):
    for path in paths:
        wow.wow.removeApi(path)


def break_(wow, *paths):
    for path in paths:
        wow.wow.breakApi(path)


def chat(wow):
    return lua_to_python(wow.wow.chat) or []


# -- present ----------------------------------------------------------------------


@pytest.mark.parametrize("field", sorted(EXPECTED))
def test_field_is_collected_at_login_when_api_is_present(wow, field):
    login(wow)
    assert snapshot(wow)[field] == EXPECTED[field]


def test_guarded_fields_do_not_replace_safe_ones(wow):
    login(wow)
    snap = snapshot(wow)
    assert snap["level"] == 23
    assert snap["money"] == 384512


# -- missing / raising ---------------------------------------------------------------


@pytest.mark.parametrize(
    "field, api", [(field, api) for field, apis in APIS.items() for api in apis]
)
def test_missing_api_leaves_field_out(wow, field, api):
    remove(wow, api)
    login(wow)
    snap = snapshot(wow)
    assert field not in snap
    assert snap["level"] == 23


@pytest.mark.parametrize(
    "field, api",
    [(field, api) for field, apis in APIS.items() for api in apis if api != "C_Reputation"],
)
def test_raising_api_leaves_field_out(wow, field, api):
    break_(wow, api)
    login(wow)
    snap = snapshot(wow)
    assert field not in snap
    assert snap["level"] == 23


def test_every_api_missing_still_collects_the_rest(wow):
    remove(wow, "GetAverageItemLevel", "UnitHonor", "C_Reputation", "GetProfessions", "GetNumSkillLines")
    login(wow)
    snap = snapshot(wow)
    for guarded in EXPECTED:
        assert guarded not in snap
    assert snap["zone"] == "Duskwood"


def test_api_that_breaks_later_removes_the_field(wow):
    login(wow)
    assert snapshot(wow)["honor"] == 0
    break_(wow, "UnitHonor")
    wow.fire("HONOR_XP_UPDATE", "player")
    assert "honor" not in snapshot(wow)


# -- ilvl ---------------------------------------------------------------------------


def test_ilvl_uses_equipped_average_rounded_down(wow):
    login(wow, avgItemLevel=30.9, avgItemLevelEquipped=27.8)
    assert snapshot(wow)["ilvl"] == 27


def test_ilvl_falls_back_to_overall_average(wow):
    login(wow, avgItemLevel=30.9, avgItemLevelEquipped=None)
    assert snapshot(wow)["ilvl"] == 30


def test_ilvl_non_number_is_left_out(wow):
    login(wow, avgItemLevel=None, avgItemLevelEquipped=None)
    assert "ilvl" not in snapshot(wow)


def test_ilvl_updates_on_equipment_change(wow):
    login(wow)
    wow.set_state(avgItemLevelEquipped=24.2, serverTime=1793900060)
    wow.fire("PLAYER_EQUIPMENT_CHANGED", 1, False)
    snap = snapshot(wow)
    assert snap["ilvl"] == 24
    assert snap["capturedAt"] == 1793900060


# -- honor --------------------------------------------------------------------------


def test_honor_value(wow):
    login(wow, honor=1234)
    assert snapshot(wow)["honor"] == 1234


@pytest.mark.parametrize("value", [None, -5, "abc"])
def test_honor_invalid_value_is_left_out(wow, value):
    login(wow, honor=value)
    assert "honor" not in snapshot(wow)


def test_honor_updates_on_honor_xp_update(wow):
    login(wow)
    wow.set_state(honor=42)
    wow.fire("HONOR_XP_UPDATE", "player")
    assert snapshot(wow)["honor"] == 42


# -- professions --------------------------------------------------------------------


def test_professions_skip_empty_profession_slots(wow):
    # prof1, prof2 empty, archaeology empty, fishing = index 2, cooking empty
    login(wow, professionIndices={1: 1, 4: 2})
    assert snapshot(wow)["professions"] == [HERB, ALCH]


@pytest.mark.parametrize("api", ["GetProfessions", "GetProfessionInfo"])
def test_professions_fall_back_to_skill_lines_when_api_missing(wow, api):
    remove(wow, api)
    login(wow)
    assert snapshot(wow)["professions"] == [HERB, ALCH, FISH]


@pytest.mark.parametrize("api", ["GetProfessions", "GetProfessionInfo"])
def test_professions_fall_back_to_skill_lines_when_api_raises(wow, api):
    break_(wow, api)
    login(wow)
    assert snapshot(wow)["professions"] == [HERB, ALCH, FISH]


def test_professions_fall_back_when_get_professions_returns_nothing(wow):
    login(wow, professions=[])
    assert snapshot(wow)["professions"] == [HERB, ALCH, FISH]


def test_no_profession_at_all_is_an_empty_list(wow):
    login(wow, professions=[], skillLines=[{"name": "Métiers", "isHeader": True}])
    assert snapshot(wow)["professions"] == {}  # empty Lua table


def test_skill_lines_ignore_weapon_skills_and_languages(wow):
    remove(wow, "GetProfessions")
    login(wow)
    names = [p["name"] for p in snapshot(wow)["professions"]]
    assert "Masses" not in names
    assert "Langue : orc" not in names


def test_skill_lines_without_header_names_are_left_out(wow):
    remove(wow, "GetProfessions", "TRADE_SKILLS", "SECONDARY_SKILLS")
    login(wow)
    assert "professions" not in snapshot(wow)


@pytest.mark.parametrize(
    "missing",
    [
        ("GetProfessions", "GetNumSkillLines"),
        ("GetProfessions", "GetSkillLineInfo"),
        ("GetProfessionInfo", "GetNumSkillLines"),
    ],
)
def test_professions_left_out_when_both_paths_are_missing(wow, missing):
    remove(wow, *missing)
    login(wow)
    assert "professions" not in snapshot(wow)


@pytest.mark.parametrize(
    "broken",
    [
        ("GetProfessions", "GetNumSkillLines"),
        ("GetProfessions", "GetSkillLineInfo"),
        ("GetProfessionInfo", "GetSkillLineInfo"),
    ],
)
def test_professions_left_out_when_both_paths_raise(wow, broken):
    break_(wow, *broken)
    login(wow)
    assert "professions" not in snapshot(wow)


def test_professions_update_on_skill_lines_changed(wow):
    login(wow)
    wow.set_state(professions=[{"name": "Herboristerie", "rank": 113, "max": 150}])
    wow.fire("SKILL_LINES_CHANGED")
    assert snapshot(wow)["professions"] == [{"name": "Herboristerie", "rank": 113, "max": 150}]


def test_professions_are_capped_at_20(wow):
    remove(wow, "GetProfessions")
    lines = [{"name": "Métiers", "isHeader": True}]
    lines += [{"name": f"Métier {i}", "rank": i, "max": 300} for i in range(1, 26)]
    login(wow, skillLines=lines)
    assert len(snapshot(wow)["professions"]) == 20


# -- reputations --------------------------------------------------------------------


def test_reputation_header_with_rep_is_kept(wow):
    factions = [
        {"factionID": 1118, "name": "Classique", "isHeader": True, "isHeaderWithRep": False},
        {"factionID": 1052, "name": "Expédition de la Horde", "isHeader": True, "isHeaderWithRep": True,
         "reaction": 6, "currentStanding": 9500, "currentReactionThreshold": 9000,
         "nextReactionThreshold": 21000},
    ]
    login(wow, factions=factions)
    assert snapshot(wow)["reputations"] == [
        {"factionId": 1052, "name": "Expédition de la Horde", "standing": 6, "value": 500, "max": 12000}
    ]


def test_reputation_entries_without_id_or_standing_are_skipped(wow):
    factions = [
        "not a table",
        {"name": "Sans id", "reaction": 4},
        {"factionID": 0, "name": "Id nul", "reaction": 4},
        {"factionID": 99, "name": "Sans rang"},
        {"factionID": 76, "name": "Orgrimmar", "reaction": 5},
    ]
    login(wow, factions=factions)
    assert snapshot(wow)["reputations"] == [{"factionId": 76, "name": "Orgrimmar", "standing": 5}]


def test_no_faction_is_an_empty_list(wow):
    login(wow, factions=[])
    assert snapshot(wow)["reputations"] == {}  # empty Lua table


def test_reputations_are_capped_at_200(wow):
    factions = [{"factionID": i, "name": f"F{i}", "reaction": 4} for i in range(1, 251)]
    login(wow, factions=factions)
    assert len(snapshot(wow)["reputations"]) == 200


def test_reputations_update_on_update_faction(wow):
    login(wow)
    wow.set_state(factions=[{"factionID": 76, "name": "Orgrimmar", "reaction": 6}])
    wow.fire("UPDATE_FACTION")
    assert snapshot(wow)["reputations"] == [{"factionId": 76, "name": "Orgrimmar", "standing": 6}]


def test_full_collect_refreshes_guarded_fields(wow):
    login(wow)
    wow.set_state(honor=7, avgItemLevelEquipped=30.0)
    wow.ns.CollectSnapshot()
    snap = snapshot(wow)
    assert (snap["honor"], snap["ilvl"]) == (7, 30)


# -- debug report -------------------------------------------------------------------

ALL_APIS = [
    "GetAverageItemLevel",
    "GetProfessions",
    "GetProfessionInfo",
    "GetNumSkillLines",
    "GetSkillLineInfo",
    "C_Reputation.GetNumFactions",
    "C_Reputation.GetFactionDataByIndex",
    "UnitHonor",
]


def api_line(wow, api):
    lines = [line for line in chat(wow) if f" {api} : " in line or f" {api}: " in line]
    assert len(lines) == 1, chat(wow)
    return lines[0]


def test_debug_mode_reports_every_found_api_at_login(wow):
    login(wow, DEBUG_SV)
    for api in ALL_APIS:
        assert api_line(wow, api).endswith(": trouvée")


def test_debug_mode_reports_missing_api(wow):
    remove(wow, "C_Reputation")
    login(wow, DEBUG_SV)
    assert api_line(wow, "C_Reputation.GetNumFactions").endswith(": absente")
    assert api_line(wow, "UnitHonor").endswith(": trouvée")


def test_debug_mode_reports_raising_api(wow):
    break_(wow, "UnitHonor")
    login(wow, DEBUG_SV)
    assert ": trouvée, erreur à l'appel" in api_line(wow, "UnitHonor")


def test_debug_mode_reports_profession_source(wow):
    remove(wow, "GetProfessions")
    login(wow, DEBUG_SV)
    assert any(line.endswith("métiers lus via GetSkillLineInfo") for line in chat(wow)), chat(wow)


def test_debug_report_in_english(wow):
    remove(wow, "GetAverageItemLevel")
    login(wow, DEBUG_SV, locale="enUS")
    assert api_line(wow, "GetAverageItemLevel").endswith(": missing")
    assert api_line(wow, "UnitHonor").endswith(": found")


def test_no_report_without_debug(wow):
    login(wow)
    assert chat(wow) == []


def test_report_can_be_requested_again(wow):
    login(wow, DEBUG_SV)
    wow.wow.chat = wow.lua.table()
    wow.ns.ReportGuardedApis()
    for api in ALL_APIS:
        assert api_line(wow, api).endswith(": trouvée")
