-- ForeverTracker: core. Owns the addon table, the event frame and ForeverTrackerDB.
-- Format of ForeverTrackerDB: docs/01-spec-addon-companion.md, "Addon : format des SavedVariables".

local addonName, ns = ...

ns.name = addonName
ns.VERSION = "0.1.0"
ns.SCHEMA = 1
ns.DEFAULT_SETTINGS = {
  interval = 15, -- minutes between "Synchroniser" prompts: 10, 15, 30 or "off"
  levelPrompt = true,
  debug = false,
}

-- ---------------------------------------------------------------------------
-- Events: modules subscribe with ns.On(event, handler); handlers run in
-- subscription order, i.e. TOC order, so Core always runs first.
-- ---------------------------------------------------------------------------

local frame = CreateFrame("Frame")
ns.frame = frame
local handlers = {}

function ns.On(event, handler)
  local list = handlers[event]
  if not list then
    list = {}
    handlers[event] = list
    frame:RegisterEvent(event)
  end
  list[#list + 1] = handler
end

frame:SetScript("OnEvent", function(_, event, ...)
  local list = handlers[event]
  if not list then return end
  for i = 1, #list do
    list[i](event, ...)
  end
end)

-- ---------------------------------------------------------------------------
-- Database
-- ---------------------------------------------------------------------------

-- Initialise ForeverTrackerDB in place. A missing, non-table or empty value
-- (the client can load the file empty) is replaced by a fresh structure;
-- an existing table keeps every value and only gets the missing fields.
function ns.InitDB()
  local db = ForeverTrackerDB
  if type(db) ~= "table" or next(db) == nil then
    db = {}
    ForeverTrackerDB = db
  end

  if db.schema == nil then db.schema = ns.SCHEMA end
  db.addonVersion = ns.VERSION

  if type(db.settings) ~= "table" then db.settings = {} end
  for key, value in pairs(ns.DEFAULT_SETTINGS) do
    if db.settings[key] == nil then db.settings[key] = value end
  end

  if type(db.characters) ~= "table" then db.characters = {} end

  ns.db = db
  return db
end

-- Return the entry of a character, creating an empty one if needed.
-- Identity and snapshot are filled by Collect.lua, events by Journal.lua.
function ns.GetCharacter(guid)
  local characters = ns.db.characters
  local entry = characters[guid]
  if type(entry) ~= "table" then
    entry = {
      key = { guid = guid },
      snapshot = {},
      events = {},
    }
    characters[guid] = entry
  end
  return entry
end

-- ---------------------------------------------------------------------------
-- Lifecycle
-- ---------------------------------------------------------------------------

-- Print a chat message only when settings.debug is on.
function ns.Debug(message)
  local settings = ns.db and ns.db.settings
  if not (settings and settings.debug) then return end
  print("|cff33ff99ForeverTracker|r: " .. message)
end

ns.On("ADDON_LOADED", function(_, loadedName)
  if loadedName ~= addonName then return end
  ns.InitDB()
end)

ns.On("PLAYER_LOGIN", function()
  if not ns.db then ns.InitDB() end
  local guid = UnitGUID("player")
  if not guid then return end
  ns.guid = guid
  ns.character = ns.GetCharacter(guid)
end)
