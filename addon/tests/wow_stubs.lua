-- Minimal stubs of the WoW API, loaded by the test harness before the addon files.
-- Everything a test needs to drive lives in the global WowTest table:
--   WowTest.state      mutable game state read by the stubs (identity, level, time, ...)
--   WowTest.fire(...)  dispatch an event to every frame registered for it
--   WowTest.advance(s) move server time forward and run due C_Timer callbacks
--   WowTest.click(f)   simulate a mouse click (hardware event) on a frame
--   WowTest.slash(s)   simulate a typed slash command (hardware event)
--   WowTest.reloadCalls list of ReloadUI() calls, each { hardware = bool }
--   WowTest.sounds      ids passed to PlaySound(), in order

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
    instanceName = nil, -- GetInstanceInfo() name, e.g. "Les Mortemines"
    instanceId = nil,   -- GetInstanceInfo() 8th return (instanceID)
    inGuild = nil,      -- IsInGuild(); nil = derived from state.guild
    onTaxi = false,
    deadOrGhost = false,
    combatLockdown = false, -- InCombatLockdown()
    inCombat = false,       -- UnitAffectingCombat("player")
    casting = false,        -- UnitCastingInfo("player") returns a spell
    channeling = false,     -- UnitChannelInfo("player") returns a spell
    -- "à vérifier" APIs (see the section of the same name below)
    avgItemLevel = 22.6,
    avgItemLevelEquipped = 21.4,
    honor = 0,
    -- GetProfessions + GetProfessionInfo; professionIndices overrides the 5
    -- returns of GetProfessions (prof1, prof2, archaeology, fishing, cooking).
    professions = {
      { name = "Herboristerie", rank = 112, max = 150 },
      { name = "Alchimie", rank = 80, max = 150 },
    },
    professionIndices = nil,
    -- GetNumSkillLines + GetSkillLineInfo (classic skill frame)
    skillLines = {
      { name = "Métiers", isHeader = true },
      { name = "Herboristerie", rank = 112, max = 150 },
      { name = "Alchimie", rank = 80, max = 150 },
      { name = "Compétences secondaires", isHeader = true },
      { name = "Pêche", rank = 30, max = 75 },
      { name = "Compétences d'armes", isHeader = true },
      { name = "Masses", rank = 110, max = 115 },
      { name = "Langues", isHeader = true },
      { name = "Langue : orc", rank = 300, max = 300 },
    },
    -- C_Reputation.GetFactionDataByIndex returns these tables as-is
    factions = {
      { factionID = 1118, name = "Classique", isHeader = true, isHeaderWithRep = false },
      { factionID = 76, name = "Orgrimmar", reaction = 5, currentStanding = 4200,
        currentReactionThreshold = 3000, nextReactionThreshold = 9000 },
      { factionID = 530, name = "Trolls Sombrelance", reaction = 4, currentStanding = 300,
        currentReactionThreshold = 0, nextReactionThreshold = 3000 },
    },
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
WowTest.sounds = {}
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

-- name, instanceType, difficultyID, difficultyName, maxPlayers,
-- dynamicDifficulty, isDynamic, instanceID
function GetInstanceInfo()
  local s = WowTest.state
  if not s.inInstance then
    return s.zone, "none", 0, "", 0, 0, false, s.mapId
  end
  return s.instanceName, s.instanceType, 1, "Normal", 5, 0, false, s.instanceId
end

function IsInGuild()
  local s = WowTest.state
  if s.inGuild ~= nil then return s.inGuild end
  return s.guild ~= nil
end

function UnitOnTaxi(unit) return unit == "player" and WowTest.state.onTaxi or false end
function UnitIsDeadOrGhost(unit) return unit == "player" and WowTest.state.deadOrGhost or false end
function InCombatLockdown() return WowTest.state.combatLockdown end
function UnitAffectingCombat(unit) return unit == "player" and WowTest.state.inCombat or false end

-- name, displayName, texture, startTimeMs, endTimeMs, ... (nil when not casting)
function UnitCastingInfo(unit)
  if unit ~= "player" or not WowTest.state.casting then return nil end
  return "Soins", "Soins", 135915, 0, 2500
end

function UnitChannelInfo(unit)
  if unit ~= "player" or not WowTest.state.channeling then return nil end
  return "Fouet mental", "Fouet mental", 136208, 0, 3000
end

-- ---------------------------------------------------------------------------
-- "À vérifier" APIs: present by default; tests remove or break them with
-- WowTest.removeApi / WowTest.breakApi to check the addon's guards.
-- ---------------------------------------------------------------------------

function GetAverageItemLevel()
  return WowTest.state.avgItemLevel, WowTest.state.avgItemLevelEquipped
end

function UnitHonor(unit)
  if unit ~= "player" then return 0 end
  return WowTest.state.honor
end

function GetProfessions()
  local s = WowTest.state
  if s.professionIndices then
    local p = s.professionIndices
    return p[1], p[2], p[3], p[4], p[5]
  end
  local n = #s.professions
  return n >= 1 and 1 or nil, n >= 2 and 2 or nil, n >= 3 and 3 or nil,
    n >= 4 and 4 or nil, n >= 5 and 5 or nil
end

function GetProfessionInfo(index)
  local p = WowTest.state.professions[index]
  if not p then return nil end
  -- name, icon, skillLevel, maxSkillLevel, numAbilities, spelloffset, skillLine, skillModifier
  return p.name, 136246, p.rank, p.max, 2, 0, 182, 0
end

TRADE_SKILLS = "Métiers"
SECONDARY_SKILLS = "Compétences secondaires"

function GetNumSkillLines() return #WowTest.state.skillLines end

function GetSkillLineInfo(index)
  local line = WowTest.state.skillLines[index]
  if not line then return nil end
  -- skillName, isHeader, isExpanded, skillRank, numTempPoints, skillModifier, skillMaxRank
  if line.isHeader then
    return line.name, true, true, 0, 0, 0, 0
  end
  return line.name, false, false, line.rank, 0, 0, line.max
end

C_Reputation = {}
function C_Reputation.GetNumFactions() return #WowTest.state.factions end
function C_Reputation.GetFactionDataByIndex(index) return WowTest.state.factions[index] end

-- Resolve "C_Reputation.GetNumFactions" to (parent table, field name).
local function apiSlot(path)
  local namespace, field = path:match("^([%w_]+)%.([%w_]+)$")
  if namespace then return _G[namespace], field end
  return _G, path
end

-- Make an API disappear, as on a client that does not have it.
-- A bare namespace ("C_Reputation") removes the whole table.
function WowTest.removeApi(path)
  local parent, name = apiSlot(path)
  if parent then parent[name] = nil end
end

-- Make an API raise a Lua error when called.
function WowTest.breakApi(path)
  local parent, name = apiSlot(path)
  parent[name] = function() error("stub: " .. path .. " is broken") end
end

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
function Frame:IsVisible() return self.shown and (not self.parent or self.parent:IsVisible()) end
function Frame:GetName() return self.name end
function Frame:GetParent() return self.parent end

-- Layout and look: recorded when useful to a test, otherwise no-ops.
function Frame:SetText(text) self.text = text end
function Frame:GetText() return self.text end
function Frame:SetChecked(checked) self.checked = checked and true or false end
function Frame:GetChecked() return self.checked == true end
function Frame:SetSize(w, h) self.width, self.height = w, h end
function Frame:SetWidth(w) self.width = w end
function Frame:SetHeight(h) self.height = h end
function Frame:SetPoint(...)
  self.points = self.points or {}
  table.insert(self.points, { ... })
end
function Frame:ClearAllPoints() self.points = nil end
function Frame:SetAllPoints(...) end
function Frame:SetFrameStrata(strata) self.strata = strata end
function Frame:SetMovable(movable) self.movable = movable end
function Frame:SetClampedToScreen() end
function Frame:SetToplevel() end
function Frame:EnableMouse() end
function Frame:RegisterForDrag() end
function Frame:StartMoving() end
function Frame:StopMovingOrSizing() end
function Frame:SetJustifyH() end
function Frame:SetWordWrap() end
function Frame:SetColorTexture() end
function Frame:SetTextColor() end
function Frame:SetFontObject() end
function Frame:SetScrollChild(child) self.scrollChild = child end

-- EditBox: focus and selection are recorded for the tests.
function Frame:SetMultiLine(multiLine) self.multiLine = multiLine end
function Frame:SetAutoFocus(autoFocus) self.autoFocus = autoFocus end
function Frame:SetMaxLetters(maxLetters) self.maxLetters = maxLetters end
function Frame:SetCursorPosition(position) self.cursor = position end
function Frame:SetFocus() self.focused = true end
function Frame:ClearFocus() self.focused = false end
function Frame:HasFocus() return self.focused == true end
-- Without arguments the whole text is selected, like the client.
function Frame:HighlightText(first, last)
  self.highlighted = { first = first or 0, last = last or -1 }
end

-- Font strings and textures: regions that never receive events.
local function newRegion(regionType, parent)
  return setmetatable({
    frameType = regionType,
    parent = parent,
    events = {},
    scripts = {},
    shown = true,
  }, Frame)
end
function Frame:CreateFontString() return newRegion("FontString", self) end
function Frame:CreateTexture() return newRegion("Texture", self) end

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

SOUNDKIT = { IG_QUEST_LIST_OPEN = 567 }
function PlaySound(id) table.insert(WowTest.sounds, id) end

UIParent = CreateFrame("Frame", "UIParent")
UISpecialFrames = {}

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
-- A CheckButton toggles its checked state before OnClick, like the client.
function WowTest.click(frame, button)
  if frame.frameType == "CheckButton" then frame.checked = not frame.checked end
  local handler = frame.scripts.OnClick
  if handler then asHardwareEvent(handler, frame, button or "LeftButton", false) end
end

-- Simulate the player typing in an EditBox: replaces its text, then runs
-- OnTextChanged with userInput = true, like the client.
function WowTest.typeText(editBox, text)
  editBox.text = text
  local handler = editBox.scripts.OnTextChanged
  if handler then asHardwareEvent(handler, editBox, true) end
end

-- Simulate the Escape key in a focused EditBox.
function WowTest.pressEscape(editBox)
  local handler = editBox.scripts.OnEscapePressed
  if handler then asHardwareEvent(handler, editBox) end
end

-- Simulate a key bound in Bindings.xml: runs the <Binding> body (Lua source)
-- as a hardware event, with keystate "down" like the client.
function WowTest.pressBinding(body)
  local loader = loadstring or load
  local chunk, err = loader("local keystate = 'down'\n" .. body, "@Bindings.xml")
  if not chunk then error(err, 0) end
  asHardwareEvent(chunk)
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
-- Static popups (confirmation dialogs)
-- ---------------------------------------------------------------------------

StaticPopupDialogs = {}
WowTest.popups = {} -- names of the popups currently shown

function StaticPopup_Show(name)
  if not StaticPopupDialogs[name] then return nil end
  StaticPopup_Hide(name)
  table.insert(WowTest.popups, name)
  return { which = name }
end

function StaticPopup_Hide(name)
  for i = #WowTest.popups, 1, -1 do
    if WowTest.popups[i] == name then table.remove(WowTest.popups, i) end
  end
end

local function answerPopup(name, callback)
  local shown = false
  for _, n in ipairs(WowTest.popups) do
    if n == name then shown = true end
  end
  if not shown then error("popup not shown: " .. tostring(name)) end
  StaticPopup_Hide(name)
  local dialog = StaticPopupDialogs[name]
  if dialog[callback] then asHardwareEvent(dialog[callback], { which = name }) end
end

-- Simulate a click on the first (accept) or second (cancel) button of a popup.
function WowTest.acceptPopup(name) answerPopup(name, "OnAccept") end
function WowTest.cancelPopup(name) answerPopup(name, "OnCancel") end

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
