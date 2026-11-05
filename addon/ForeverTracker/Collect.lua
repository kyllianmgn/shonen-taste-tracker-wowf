-- ForeverTracker: character identity (key) and snapshot.
-- Spec: docs/01-spec-addon-companion.md, "Identité du personnage" and "Snapshot (état courant)".
-- This file covers the calls marked "Sûr"; the "À vérifier" ones live in separate functions (A-03).

local _, ns = ...

-- GetCurrentRegion() id -> region code sent to the server.
ns.REGIONS = { [1] = "us", [2] = "kr", [3] = "eu", [4] = "tw", [5] = "cn" }

-- RequestTimePlayed() is sent at most once per PLAYED_THROTTLE seconds.
ns.PLAYED_THROTTLE = 300

local EQUIPMENT_SLOTS = 19

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

function ns.CollectKey(entry)
  local key = entry.key
  if type(key) ~= "table" then
    key = {}
    entry.key = key
  end
  local firstName, surname = UnitName("player")
  key.region = ns.REGIONS[GetCurrentRegion()]
  key.firstName = firstName
  key.surname = surname
  key.guid = UnitGUID("player")
  key.realmName = GetRealmName()
  return key
end

-- Forever must run with regional unique names; if not, the server key
-- (region + first name + surname) may be ambiguous. Warn, but carry on.
local function checkRegionalNames()
  if not RegionalUniqueNamesEnabled then return end
  if RegionalUniqueNamesEnabled() == false then
    ns.Debug(ns.L.WARN_REGIONAL_NAMES)
  end
end

-- ---------------------------------------------------------------------------
-- Snapshot field groups, one per triggering event
-- ---------------------------------------------------------------------------

local collect = {}

function collect.level(snap, level)
  snap.level = level or UnitLevel("player")
end

function collect.xp(snap)
  snap.xp = UnitXP("player")
  snap.xpMax = UnitXPMax("player")
  snap.rested = GetXPExhaustion() or 0
end

function collect.money(snap)
  snap.money = GetMoney()
end

function collect.zone(snap)
  snap.zone = GetRealZoneText()
  snap.subZone = GetSubZoneText()
  snap.mapId = C_Map and C_Map.GetBestMapForUnit and C_Map.GetBestMapForUnit("player") or nil
end

function collect.character(snap)
  local _, classFile = UnitClass("player")
  local _, raceFile = UnitRace("player")
  snap.classFile = classFile
  snap.raceFile = raceFile
  snap.sex = UnitSex("player")
  snap.faction = UnitFactionGroup("player")
end

function collect.guild(snap)
  local guild, rank = GetGuildInfo("player")
  snap.guild = guild
  snap.guildRank = guild and rank or nil
end

function collect.equipment(snap)
  local items = {}
  for slot = 1, EQUIPMENT_SLOTS do
    local link = GetInventoryItemLink("player", slot)
    local itemId = type(link) == "string" and tonumber(link:match("|Hitem:(%d+)")) or nil
    if itemId then
      items[#items + 1] = { slot = slot, itemId = itemId, link = link }
    end
  end
  snap.equipment = items
end

-- Snapshot of the current character, or nil before PLAYER_LOGIN.
local function currentSnapshot()
  local entry = ns.character
  if not entry then return nil end
  if type(entry.snapshot) ~= "table" then entry.snapshot = {} end
  return entry.snapshot
end

-- Refresh one field group and stamp capturedAt.
local function update(group, ...)
  local snap = currentSnapshot()
  if not snap then return end
  collect[group](snap, ...)
  snap.capturedAt = GetServerTime()
end

-- ---------------------------------------------------------------------------
-- Time played
-- ---------------------------------------------------------------------------

local lastPlayedRequest

-- Ask the client for /played, throttled. Returns true if the request was sent.
-- The values arrive asynchronously in TIME_PLAYED_MSG.
function ns.RequestPlayed()
  if not RequestTimePlayed then return false end
  local now = GetTime()
  if lastPlayedRequest and now - lastPlayedRequest < ns.PLAYED_THROTTLE then
    return false
  end
  lastPlayedRequest = now
  RequestTimePlayed()
  return true
end

-- ---------------------------------------------------------------------------
-- Full collection: at login and right before a synchronisation
-- ---------------------------------------------------------------------------

local ALL_GROUPS = { "level", "xp", "money", "zone", "character", "guild", "equipment" }

function ns.CollectSnapshot()
  local snap = currentSnapshot()
  if not snap then return nil end
  for _, group in ipairs(ALL_GROUPS) do
    collect[group](snap)
  end
  if snap.deaths == nil then snap.deaths = 0 end
  snap.capturedAt = GetServerTime()
  ns.RequestPlayed()
  return snap
end

-- ---------------------------------------------------------------------------
-- Events (Core's PLAYER_LOGIN handler runs first and sets ns.character)
-- ---------------------------------------------------------------------------

ns.On("PLAYER_LOGIN", function()
  if not ns.character then return end
  ns.CollectKey(ns.character)
  checkRegionalNames()
  ns.CollectSnapshot()
end)

-- UnitLevel("player") can still return the old level while this event runs.
ns.On("PLAYER_LEVEL_UP", function(_, newLevel)
  if not ns.character then return end
  update("level", newLevel)
  ns.RequestPlayed()
end)

ns.On("PLAYER_XP_UPDATE", function() update("xp") end)
ns.On("PLAYER_MONEY", function() update("money") end)
ns.On("ZONE_CHANGED_NEW_AREA", function() update("zone") end)
ns.On("PLAYER_GUILD_UPDATE", function() update("guild") end)
ns.On("PLAYER_EQUIPMENT_CHANGED", function() update("equipment") end)

ns.On("PLAYER_DEAD", function()
  local snap = currentSnapshot()
  if not snap then return end
  snap.deaths = (snap.deaths or 0) + 1
  snap.capturedAt = GetServerTime()
end)

-- Also fired when the player types /played.
ns.On("TIME_PLAYED_MSG", function(_, total, level)
  local snap = currentSnapshot()
  if not snap then return end
  snap.playedTotal = total
  snap.playedLevel = level
  snap.capturedAt = GetServerTime()
end)
