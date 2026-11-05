-- ForeverTracker: character identity (key) and snapshot.
-- Spec: docs/01-spec-addon-companion.md, "Identité du personnage" and "Snapshot (état courant)".
-- The calls marked "Sûr" come first; the "À vérifier" ones (A-03) are in their own section,
-- each guarded by an existence check and pcall.

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
-- "À vérifier" calls (ilvl, professions, reputations, honor)
-- Each API is looked up at call time and run under pcall: if it is missing,
-- raises or returns garbage, the field is left out of the snapshot.
-- ---------------------------------------------------------------------------

ns.MAX_PROFESSIONS = 20
ns.MAX_REPUTATIONS = 200

-- Order of the debug report (/ftr debug on, then log in).
ns.GUARDED_APIS = {
  "GetAverageItemLevel",
  "GetProfessions",
  "GetProfessionInfo",
  "GetNumSkillLines",
  "GetSkillLineInfo",
  "C_Reputation.GetNumFactions",
  "C_Reputation.GetFactionDataByIndex",
  "UnitHonor",
}

-- Last error per API path, cleared by the next successful call.
ns.apiErrors = {}
-- Which API the last profession list came from, for the debug report.
ns.professionSource = nil

-- Return the function at `path` ("UnitHonor", "C_Reputation.GetNumFactions"), or nil.
local function findApi(path)
  local namespace, field = path:match("^([%w_]+)%.([%w_]+)$")
  local fn
  if namespace then
    local tbl = _G[namespace]
    fn = type(tbl) == "table" and tbl[field] or nil
  else
    fn = _G[path]
  end
  if type(fn) == "function" then return fn end
  return nil
end

local function pack(...) return { n = select("#", ...), ... } end

-- Call an API under pcall. Returns false if it is missing or raised,
-- otherwise true followed by its return values.
local function callApi(path, ...)
  local fn = findApi(path)
  if not fn then return false end
  local result = pack(pcall(fn, ...))
  if not result[1] then
    ns.apiErrors[path] = tostring(result[2])
    return false
  end
  ns.apiErrors[path] = nil
  return unpack(result, 1, result.n)
end

-- Non-negative number rounded down, or nil.
local function count(value)
  value = tonumber(value)
  if not value or value < 0 then return nil end
  return math.floor(value)
end

local function professionEntry(name, rank, max)
  rank = count(rank)
  if type(name) ~= "string" or name == "" or not rank then return nil end
  return { name = name, rank = rank, max = count(max) }
end

-- Mainline: GetProfessions() gives up to 5 indices (prof1, prof2, archaeology,
-- fishing, cooking), any of them nil. Returns nil if the path is unusable.
local function professionsFromIndices()
  if not findApi("GetProfessionInfo") then return nil end
  local indices = pack(callApi("GetProfessions"))
  if not indices[1] then return nil end
  local list = {}
  for i = 2, math.max(indices.n, 6) do
    local index = indices[i]
    if index ~= nil then
      local info = pack(callApi("GetProfessionInfo", index))
      if not info[1] then return nil end
      local entry = professionEntry(info[2], info[4], info[5])
      if entry and #list < ns.MAX_PROFESSIONS then list[#list + 1] = entry end
    end
  end
  return list
end

-- Classic skill frame: keep the lines under the "Professions" and "Secondary
-- Skills" headers, identified by the client's own localized strings.
local function professionsFromSkillLines()
  local wanted = {}
  if type(TRADE_SKILLS) == "string" then wanted[TRADE_SKILLS] = true end
  if type(SECONDARY_SKILLS) == "string" then wanted[SECONDARY_SKILLS] = true end
  if next(wanted) == nil or not findApi("GetSkillLineInfo") then return nil end
  local ok, total = callApi("GetNumSkillLines")
  total = ok and count(total)
  if not total then return nil end
  local list, inProfessions = {}, false
  for i = 1, total do
    local line = pack(callApi("GetSkillLineInfo", i))
    if not line[1] then return nil end
    local name, isHeader, rank, max = line[2], line[3], line[5], line[8]
    if isHeader then
      inProfessions = wanted[name] == true
    elseif inProfessions then
      local entry = professionEntry(name, rank, max)
      if entry and #list < ns.MAX_PROFESSIONS then list[#list + 1] = entry end
    end
  end
  return list
end

local function readProfessions()
  local list = professionsFromIndices()
  if list and #list > 0 then
    ns.professionSource = "GetProfessionInfo"
    return list
  end
  local fallback = professionsFromSkillLines()
  if fallback then
    ns.professionSource = "GetSkillLineInfo"
    return fallback
  end
  ns.professionSource = list and "GetProfessionInfo" or nil
  return list
end

-- C_Reputation.GetFactionDataByIndex returns a FactionData table; value and
-- max are relative to the current standing (e.g. 1200 / 6000 in Friendly).
local function reputationEntry(data)
  if type(data) ~= "table" then return nil end
  local factionId, standing = count(data.factionID), count(data.reaction)
  if not factionId or factionId == 0 or not standing then return nil end
  if data.isHeader and not data.isHeaderWithRep then return nil end
  local entry = { factionId = factionId, standing = standing }
  if type(data.name) == "string" then entry.name = data.name end
  local low, high, current = tonumber(data.currentReactionThreshold),
    tonumber(data.nextReactionThreshold), tonumber(data.currentStanding)
  if low and high and current then
    entry.value = count(current - low)
    entry.max = count(high - low)
  end
  return entry
end

local function readReputations()
  if not findApi("C_Reputation.GetFactionDataByIndex") then return nil end
  local ok, total = callApi("C_Reputation.GetNumFactions")
  total = ok and count(total)
  if not total then return nil end
  local list = {}
  for i = 1, total do
    if #list >= ns.MAX_REPUTATIONS then break end
    local found, data = callApi("C_Reputation.GetFactionDataByIndex", i)
    if not found then return nil end
    list[#list + 1] = reputationEntry(data)
  end
  return list
end

-- GetAverageItemLevel() returns (overall, equipped); prefer the equipped one,
-- rounded down like the character sheet.
local function readIlvl()
  local ok, overall, equipped = callApi("GetAverageItemLevel")
  if not ok then return nil end
  return count(equipped) or count(overall)
end

local function readHonor()
  local ok, honor = callApi("UnitHonor", "player")
  if not ok then return nil end
  return count(honor)
end

-- Run a reader so that even a bug in its own logic cannot raise.
local function guarded(reader)
  local ok, value = pcall(reader)
  if ok then return value end
  return nil
end

function collect.ilvl(snap) snap.ilvl = guarded(readIlvl) end
function collect.honor(snap) snap.honor = guarded(readHonor) end
function collect.professions(snap) snap.professions = guarded(readProfessions) end
function collect.reputations(snap) snap.reputations = guarded(readReputations) end

-- The full collection (ns.CollectSnapshot) also runs the guarded groups.
for _, group in ipairs({ "ilvl", "professions", "reputations", "honor" }) do
  ALL_GROUPS[#ALL_GROUPS + 1] = group
end

-- Debug report: which "à vérifier" APIs this client has, for the in-game
-- checklist (A-07). Printed only when settings.debug is on.
function ns.ReportGuardedApis()
  local L = ns.L
  ns.Debug(L.API_REPORT_TITLE)
  for _, path in ipairs(ns.GUARDED_APIS) do
    local status
    if not findApi(path) then
      status = L.API_MISSING
    elseif ns.apiErrors[path] then
      status = L.API_FAILED
    else
      status = L.API_FOUND
    end
    ns.Debug(L.API_STATUS:format(path, status))
  end
  if ns.professionSource then
    ns.Debug(L.API_PROFESSION_SOURCE:format(ns.professionSource))
  else
    ns.Debug(L.API_PROFESSION_NONE)
  end
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

-- "À vérifier" fields. PLAYER_EQUIPMENT_CHANGED runs the equipment handler first.
ns.On("PLAYER_LOGIN", function()
  if not ns.character then return end
  ns.ReportGuardedApis()
end)
ns.On("PLAYER_EQUIPMENT_CHANGED", function() update("ilvl") end)
ns.On("SKILL_LINES_CHANGED", function() update("professions") end)
ns.On("UPDATE_FACTION", function() update("reputations") end)
ns.On("HONOR_XP_UPDATE", function() update("honor") end)

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
