-- Minimal stubs of the WoW API, loaded by the test harness before the addon files.
-- Everything a test needs to drive lives in the global WowTest table:
--   WowTest.state      mutable game state read by the stubs (identity, level, time, ...)
--   WowTest.fire(...)  dispatch an event to every frame registered for it
--   WowTest.advance(s) move server time forward and run due C_Timer callbacks
--   WowTest.click(f)   simulate a mouse click (hardware event) on a frame
--   WowTest.slash(s)   simulate a typed slash command (hardware event)
--   WowTest.reloadCalls list of ReloadUI() calls, each { hardware = bool }

local WowTest = {}
_G.WowTest = WowTest

local function defaultState()
  return {
    -- identity
    firstName = "Davina",
    surname = "Asaria",
    guid = "Player-4242-0A1B2C3D",
    region = 3,
    realmName = "CAMWOW EU5 Realm 1 PvE",
    regionalUniqueNames = true,
    -- character state
    level = 23,
    xp = 4120,
    xpMax = 13600,
    rested = 2100,
    money = 384512,
    zone = "Duskwood",
    subZone = "Darkshire",
    mapId = 1431,
    className = "Prêtre",
    classFile = "PRIEST",
    classId = 5,
    raceName = "Troll",
    raceFile = "Troll",
    raceId = 8,
    sex = 3,
    faction = "Horde",
    factionName = "Horde",
    guild = nil,
    guildRank = nil,
    guildRankIndex = nil,
    inventory = {}, -- [slot] = item link
    inInstance = false,
    instanceType = "none",
    onTaxi = false,
    deadOrGhost = false,
    combatLockdown = false,
    -- time
    serverTime = 1793900000,
    playedTotal = 81234,
    playedLevel = 2310,
  }
end

WowTest.state = defaultState()
WowTest.frames = {}
WowTest.timers = {}
WowTest.reloadCalls = {}
WowTest.playedRequests = 0
WowTest.hardware = false

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

function UnitName(unit)
  if unit ~= "player" then return nil end
  return WowTest.state.firstName, WowTest.state.surname
end

function GetUnitName(unit)
  if unit ~= "player" then return nil end
  local s = WowTest.state
  if s.surname and s.surname ~= "" then
    return s.firstName .. " " .. s.surname
  end
  return s.firstName
end

function UnitGUID(unit)
  if unit ~= "player" then return nil end
  return WowTest.state.guid
end

function GetCurrentRegion() return WowTest.state.region end
function GetRealmName() return WowTest.state.realmName end
function RegionalUniqueNamesEnabled() return WowTest.state.regionalUniqueNames end

-- ---------------------------------------------------------------------------
-- Character state
-- ---------------------------------------------------------------------------

function UnitLevel(unit) if unit == "player" then return WowTest.state.level end return 0 end
function UnitXP(unit) if unit == "player" then return WowTest.state.xp end return 0 end
function UnitXPMax(unit) if unit == "player" then return WowTest.state.xpMax end return 0 end
function GetXPExhaustion() return WowTest.state.rested end
function GetMoney() return WowTest.state.money end
function GetRealZoneText() return WowTest.state.zone end
function GetSubZoneText() return WowTest.state.subZone end

function UnitClass(unit)
  if unit ~= "player" then return nil end
  local s = WowTest.state
  return s.className, s.classFile, s.classId
end

function UnitRace(unit)
  if unit ~= "player" then return nil end
  local s = WowTest.state
  return s.raceName, s.raceFile, s.raceId
end

function UnitSex(unit) if unit == "player" then return WowTest.state.sex end return nil end

function UnitFactionGroup(unit)
  if unit ~= "player" then return nil end
  return WowTest.state.faction, WowTest.state.factionName
end

C_Map = {}
function C_Map.GetBestMapForUnit(unit)
  if unit ~= "player" then return nil end
  return WowTest.state.mapId
end

function GetGuildInfo(unit)
  if unit ~= "player" or not WowTest.state.guild then return nil end
  local s = WowTest.state
  return s.guild, s.guildRank, s.guildRankIndex
end

function GetInventoryItemLink(unit, slot)
  if unit ~= "player" then return nil end
  return WowTest.state.inventory[slot]
end

function IsInInstance()
  return WowTest.state.inInstance, WowTest.state.instanceType
end

function UnitOnTaxi(unit) return unit == "player" and WowTest.state.onTaxi or false end
function UnitIsDeadOrGhost(unit) return unit == "player" and WowTest.state.deadOrGhost or false end
function InCombatLockdown() return WowTest.state.combatLockdown end

-- ---------------------------------------------------------------------------
-- Time and timers
-- ---------------------------------------------------------------------------

function GetServerTime() return WowTest.state.serverTime end
function GetTime() return WowTest.state.serverTime end

local function newTimer(delay, callback, iterations)
  local timer = {
    delay = delay,
    callback = callback,
    remaining = iterations, -- nil = infinite
    due = WowTest.state.serverTime + delay,
    cancelled = false,
  }
  function timer:Cancel() self.cancelled = true end
  function timer:IsCancelled() return self.cancelled end
  table.insert(WowTest.timers, timer)
  return timer
end

C_Timer = {}

function C_Timer.After(delay, callback)
  newTimer(delay, function() callback() end, 1)
end

function C_Timer.NewTimer(delay, callback)
  local timer
  timer = newTimer(delay, function() callback(timer) end, 1)
  return timer
end

function C_Timer.NewTicker(interval, callback, iterations)
  local ticker
  ticker = newTimer(interval, function() callback(ticker) end, iterations)
  return ticker
end

-- Advance server time by `seconds`, running every timer that comes due, in order.
function WowTest.advance(seconds)
  local target = WowTest.state.serverTime + seconds
  while true do
    local nextTimer
    for _, t in ipairs(WowTest.timers) do
      if not t.cancelled and t.due <= target and (not nextTimer or t.due < nextTimer.due) then
        nextTimer = t
      end
    end
    if not nextTimer then break end
    WowTest.state.serverTime = nextTimer.due
    if nextTimer.remaining then
      nextTimer.remaining = nextTimer.remaining - 1
      if nextTimer.remaining <= 0 then nextTimer.cancelled = true end
    end
    nextTimer.due = nextTimer.due + nextTimer.delay
    nextTimer.callback()
  end
  WowTest.state.serverTime = target
end

-- ---------------------------------------------------------------------------
-- Frames and events
-- ---------------------------------------------------------------------------

local Frame = {}
Frame.__index = Frame

function Frame:RegisterEvent(event) self.events[event] = true end
function Frame:UnregisterEvent(event) self.events[event] = nil end
function Frame:UnregisterAllEvents() self.events = {} end
function Frame:IsEventRegistered(event) return self.events[event] == true end
function Frame:SetScript(name, handler) self.scripts[name] = handler end
function Frame:GetScript(name) return self.scripts[name] end
function Frame:HookScript(name, handler)
  local previous = self.scripts[name]
  self.scripts[name] = function(...)
    if previous then previous(...) end
    handler(...)
  end
end
function Frame:Show()
  if not self.shown then
    self.shown = true
    if self.scripts.OnShow then self.scripts.OnShow(self) end
  end
end
function Frame:Hide()
  if self.shown then
    self.shown = false
    if self.scripts.OnHide then self.scripts.OnHide(self) end
  end
end
function Frame:IsShown() return self.shown end
function Frame:GetName() return self.name end

function CreateFrame(frameType, name, parent, template)
  local frame = setmetatable({
    frameType = frameType,
    name = name,
    parent = parent,
    template = template,
    events = {},
    scripts = {},
    shown = true,
  }, Frame)
  table.insert(WowTest.frames, frame)
  if name then _G[name] = frame end
  return frame
end

-- Dispatch `event` to every frame registered for it, in creation order.
function WowTest.fire(event, ...)
  for _, frame in ipairs(WowTest.frames) do
    local handler = frame.scripts.OnEvent
    if frame.events[event] and handler then
      handler(frame, event, ...)
    end
  end
end

local function asHardwareEvent(fn, ...)
  local previous = WowTest.hardware
  WowTest.hardware = true
  local ok, err = pcall(fn, ...)
  WowTest.hardware = previous
  if not ok then error(err, 0) end
end

-- Simulate a mouse click on a frame (runs OnClick as a hardware event).
function WowTest.click(frame, button)
  local handler = frame.scripts.OnClick
  if handler then asHardwareEvent(handler, frame, button or "LeftButton", false) end
end

-- Simulate the player typing a slash command, e.g. WowTest.slash("/ftr sync").
function WowTest.slash(line)
  local command, rest = line:match("^(/%S+)%s*(.-)%s*$")
  if not command then error("not a slash command: " .. tostring(line)) end
  command = command:lower()
  for key, handler in pairs(SlashCmdList) do
    local i = 1
    while _G["SLASH_" .. key .. i] do
      if _G["SLASH_" .. key .. i]:lower() == command then
        asHardwareEvent(handler, rest, nil)
        return true
      end
      i = i + 1
    end
  end
  return false
end

SlashCmdList = {}

-- ---------------------------------------------------------------------------
-- Protected / spied calls
-- ---------------------------------------------------------------------------

-- Spy: records each call and whether it happened inside a click or typed command.
function ReloadUI()
  table.insert(WowTest.reloadCalls, { hardware = WowTest.hardware })
end

-- Spy: counts calls in WowTest.playedRequests, then fires TIME_PLAYED_MSG
-- synchronously with the values in WowTest.state.
function RequestTimePlayed()
  WowTest.playedRequests = WowTest.playedRequests + 1
  WowTest.fire("TIME_PLAYED_MSG", WowTest.state.playedTotal, WowTest.state.playedLevel)
end

-- ---------------------------------------------------------------------------
-- Misc globals addons commonly touch
-- ---------------------------------------------------------------------------

WowTest.chat = {}
DEFAULT_CHAT_FRAME = {
  AddMessage = function(_, text) table.insert(WowTest.chat, text) end,
}
function print(...)
  local parts = {}
  for i = 1, select("#", ...) do parts[#parts + 1] = tostring((select(i, ...))) end
  table.insert(WowTest.chat, table.concat(parts, " "))
end

function GetLocale() return WowTest.state.locale or "frFR" end

-- Load one addon file the way the client does: chunk called with (addonName, addonTable).
function WowTest.runChunk(source, chunkName, addonName, addonTable)
  local loader = loadstring or load
  local chunk, err = loader(source, "@" .. chunkName)
  if not chunk then error(err, 0) end
  return chunk(addonName, addonTable)
end
