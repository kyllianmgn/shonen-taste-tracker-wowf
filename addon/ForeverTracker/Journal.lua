-- ForeverTracker: journal of timestamped events, stored in characters[guid].events.
-- Spec: docs/01-spec-addon-companion.md, "Journal d'événements".
-- Collect.lua loads first, so on a shared event the snapshot is already refreshed here.

local _, ns = ...

ns.MAX_EVENTS = 300
ns.PROFESSION_TIERS = { 75, 150, 225, 300 }

local DUNGEON_TYPES = { party = true, raid = true }

-- In-memory counter appended to ids: <GUID>-<at>-<counter>.
local counter = 0

-- LEVEL_UP events of this session still waiting for playedTotal.
local pendingLevelUps = {}

-- Values of the last session, read from the SavedVariables at ADDON_LOADED,
-- before Collect overwrites the snapshot: saved[guid] = { guild, ranks }.
local saved = {}

-- Baselines of the current session, set at PLAYER_LOGIN.
local guildKnown, lastGuild
local professionRanks

-- ---------------------------------------------------------------------------
-- Recording
-- ---------------------------------------------------------------------------

local function journal()
  local entry = ns.character
  if not entry then return nil end
  if type(entry.events) ~= "table" then entry.events = {} end
  return entry.events
end

-- Append an event to the current character's journal, dropping the oldest
-- ones beyond MAX_EVENTS. Returns the event, or nil before PLAYER_LOGIN.
function ns.AddEvent(eventType, data)
  local events = journal()
  if not events then return nil end
  local at = GetServerTime()
  counter = counter + 1
  local event = {
    id = ns.guid .. "-" .. at .. "-" .. counter,
    type = eventType,
    at = at,
    data = data or {},
  }
  events[#events + 1] = event
  while #events > ns.MAX_EVENTS do
    table.remove(events, 1)
  end
  return event
end

-- ---------------------------------------------------------------------------
-- Readers
-- ---------------------------------------------------------------------------

local UNKNOWN = {}

-- Current guild name, nil when guildless, UNKNOWN while the client has not
-- loaded the guild info yet (IsInGuild() true but GetGuildInfo() empty).
local function currentGuild()
  local name = GetGuildInfo("player")
  if name then return name end
  if IsInGuild and IsInGuild() then return UNKNOWN end
  return nil
end

-- Iterate the well-formed entries of snapshot.professions.
local function eachProfession(professions, fn)
  if type(professions) ~= "table" then return end
  for _, p in ipairs(professions) do
    if type(p) == "table" and type(p.name) == "string" and type(p.rank) == "number" then
      fn(p.name, p.rank)
    end
  end
end

local function ranksOf(professions)
  local ranks = {}
  eachProfession(professions, function(name, rank) ranks[name] = rank end)
  return ranks
end

-- True if the rank went from below a tier to that tier or above.
local function crossesTier(previous, rank)
  for _, tier in ipairs(ns.PROFESSION_TIERS) do
    if previous < tier and rank >= tier then return true end
  end
  return false
end

local function lastDungeonId()
  local events = journal()
  for i = #events, 1, -1 do
    local e = events[i]
    if type(e) == "table" and e.type == "DUNGEON_ENTER" then
      return type(e.data) == "table" and e.data.instanceId or nil
    end
  end
  return nil
end

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

-- Core's handler has just initialised ns.db.
ns.On("ADDON_LOADED", function()
  if not ns.db then return end
  for guid, entry in pairs(ns.db.characters) do
    local snap = type(entry) == "table" and entry.snapshot
    if type(snap) == "table" then
      saved[guid] = { guild = snap.guild, ranks = ranksOf(snap.professions) }
    end
  end
end)

ns.On("PLAYER_LOGIN", function()
  if not ns.character then return end
  local previous = saved[ns.guid]
  if previous then
    guildKnown, lastGuild = true, previous.guild
    professionRanks = previous.ranks
  else
    local guild = currentGuild()
    guildKnown = guild ~= UNKNOWN
    lastGuild = guildKnown and guild or nil
    professionRanks = ranksOf(ns.character.snapshot and ns.character.snapshot.professions)
  end

  ns.AddEvent("SESSION_START", {
    level = UnitLevel("player"),
    zone = GetRealZoneText(),
  })
end)

ns.On("PLAYER_LOGOUT", function()
  if not ns.character then return end
  local snap = ns.character.snapshot
  ns.AddEvent("SESSION_END", {
    level = UnitLevel("player"),
    playedTotal = type(snap) == "table" and snap.playedTotal or nil,
    money = GetMoney(),
  })
end)

-- UnitLevel("player") can still return the old level while this event runs.
-- playedTotal is filled in by the next TIME_PLAYED_MSG (Collect requests it).
ns.On("PLAYER_LEVEL_UP", function(_, newLevel)
  local event = ns.AddEvent("LEVEL_UP", {
    level = newLevel or UnitLevel("player"),
    zone = GetRealZoneText(),
  })
  if event then pendingLevelUps[#pendingLevelUps + 1] = event end
end)

ns.On("TIME_PLAYED_MSG", function(_, total)
  if #pendingLevelUps == 0 or type(total) ~= "number" then return end
  for _, event in ipairs(pendingLevelUps) do
    event.data.playedTotal = total
  end
  pendingLevelUps = {}
end)

ns.On("PLAYER_DEAD", function()
  ns.AddEvent("DEATH", {
    level = UnitLevel("player"),
    zone = GetRealZoneText(),
  })
end)

-- Party or raid instance different from the last DUNGEON_ENTER of the
-- journal, which survives reloads.
local function checkDungeon()
  if not ns.character or not GetInstanceInfo then return end
  local inInstance, instanceType = IsInInstance()
  if not inInstance or not DUNGEON_TYPES[instanceType] then return end
  local name, _, _, _, _, _, _, instanceId = GetInstanceInfo()
  if instanceId == nil or instanceId == lastDungeonId() then return end
  ns.AddEvent("DUNGEON_ENTER", { instanceName = name, instanceId = instanceId })
end

ns.On("PLAYER_ENTERING_WORLD", checkDungeon)
ns.On("ZONE_CHANGED_NEW_AREA", checkDungeon)

ns.On("PLAYER_GUILD_UPDATE", function()
  if not ns.character then return end
  local guild = currentGuild()
  if guild == UNKNOWN then return end
  if not guildKnown then
    guildKnown, lastGuild = true, guild
    return
  end
  if guild == lastGuild then return end
  ns.AddEvent("GUILD_CHANGE", { from = lastGuild, to = guild })
  lastGuild = guild
end)

-- snapshot.professions is refreshed by Collect.lua on this same event.
-- A profession seen for the first time only sets its baseline.
ns.On("SKILL_LINES_CHANGED", function()
  if not (ns.character and professionRanks) then return end
  local snap = ns.character.snapshot
  eachProfession(type(snap) == "table" and snap.professions, function(name, rank)
    local previous = professionRanks[name]
    if previous and crossesTier(previous, rank) then
      ns.AddEvent("PROFESSION_TIER", { name = name, rank = rank })
    end
    professionRanks[name] = rank
  end)
end)
