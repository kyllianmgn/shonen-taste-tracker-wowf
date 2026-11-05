"""Sanity checks of the harness and the WoW stubs themselves."""

from harness import lua_to_python


def test_lua_to_python_converts_arrays_and_maps(wow):
    value = wow.lua.eval('{ 1, 2, { a = true, b = "x" }, {} }')
    assert lua_to_python(value) == [1, 2, {"a": True, "b": "x"}, {}]


def test_stub_identity(wow):
    g = wow.lua.globals()
    assert g.UnitName("player") == ("Davina", "Asaria")
    assert g.GetUnitName("player") == "Davina Asaria"
    assert g.UnitGUID("player") == "Player-4242-0A1B2C3D"
    assert g.GetCurrentRegion() == 3
    assert g.RegionalUniqueNamesEnabled() is True


def test_state_is_driven_from_python(wow):
    wow.set_state(level=42, inInstance=True, instanceType="party", serverTime=1000)
    g = wow.lua.globals()
    assert g.UnitLevel("player") == 42
    assert g.IsInInstance() == (True, "party")
    assert g.GetServerTime() == 1000


def test_fire_reaches_only_registered_frames(wow):
    wow.lua.execute(
        """
        seen = {}
        local f = CreateFrame("Frame")
        f:RegisterEvent("PLAYER_LEVEL_UP")
        f:SetScript("OnEvent", function(self, event, ...) table.insert(seen, { event, ... }) end)
        """
    )
    wow.fire("PLAYER_LEVEL_UP", 24)
    wow.fire("PLAYER_MONEY")
    assert wow.global_value("seen") == [["PLAYER_LEVEL_UP", 24]]


def test_ticker_runs_when_time_advances(wow):
    wow.set_state(serverTime=1000)
    wow.lua.execute("ticks = 0; C_Timer.NewTicker(30, function() ticks = ticks + 1 end)")
    wow.advance(29)
    assert wow.global_value("ticks") == 0
    wow.advance(61)
    assert wow.global_value("ticks") == 3
    assert wow.lua.globals().GetServerTime() == 1090


def test_ticker_cancel_and_iterations(wow):
    wow.lua.execute(
        """
        a, b = 0, 0
        local t = C_Timer.NewTicker(10, function() a = a + 1 end)
        C_Timer.NewTicker(10, function() b = b + 1 end, 2)
        C_Timer.After(15, function() t:Cancel() end)
        """
    )
    wow.advance(100)
    assert wow.global_value("a") == 1
    assert wow.global_value("b") == 2


def test_reload_ui_spy_tracks_hardware_events(wow):
    wow.lua.execute(
        """
        ReloadUI()
        button = CreateFrame("Button")
        button:SetScript("OnClick", function() ReloadUI() end)
        SLASH_TESTCMD1 = "/testcmd"
        SlashCmdList.TESTCMD = function(msg) lastMsg = msg; ReloadUI() end
        """
    )
    wow.wow.click(wow.lua.globals().button)
    assert wow.wow.slash("/TestCmd  sync ") is True
    assert wow.reload_calls() == [{"hardware": False}, {"hardware": True}, {"hardware": True}]
    assert wow.global_value("lastMsg") == "sync"
    assert wow.wow.hardware is False


def test_request_time_played_fires_time_played_msg(wow):
    wow.set_state(playedTotal=1000, playedLevel=50)
    wow.lua.execute(
        """
        local f = CreateFrame("Frame")
        f:RegisterEvent("TIME_PLAYED_MSG")
        f:SetScript("OnEvent", function(_, _, total, level) played = { total, level } end)
        RequestTimePlayed()
        """
    )
    assert wow.global_value("played") == [1000, 50]
