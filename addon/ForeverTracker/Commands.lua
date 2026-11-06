-- ForeverTracker: /ftr and its subcommands.
-- Spec: docs/01-spec-addon-companion.md, "Commandes /ftr".
--
-- Add a subcommand with ns.RegisterCommand(name, handler, help, args):
--   handler(args) gets the rest of the line, trimmed; help and args feed /ftr help.

local _, ns = ...
local L = ns.L

local commands = {}
local order = {}

function ns.RegisterCommand(name, handler, help, args)
  name = name:lower()
  if not commands[name] then order[#order + 1] = name end
  commands[name] = { run = handler, help = help, args = args }
end

-- "/ftr name args" as typed, e.g. "/ftr interval 10||15||30||off".
-- "||" is how a single "|" is written in a chat message.
local function usage(name)
  local args = commands[name].args
  return "/ftr " .. name .. (args and (" " .. args) or "")
end

local function printUsage(name)
  ns.Print(L.CMD_USAGE:format(usage(name)))
end

local function printHelp()
  ns.Print(L.CMD_HELP_TITLE)
  for _, name in ipairs(order) do
    local help = commands[name].help
    ns.Print(usage(name) .. (help and (" - " .. help) or ""))
  end
end

local function dispatch(message)
  local line = (message or ""):match("^%s*(.-)%s*$")
  local name, rest = line:match("^(%S+)%s*(.-)$")
  name = name and name:lower() or "status"
  local command = commands[name]
  if not command then
    ns.Print(L.CMD_UNKNOWN:format(name))
    printHelp()
    return
  end
  command.run(rest or "")
end

SLASH_FTR1 = "/ftr"
SlashCmdList.FTR = dispatch

-- ---------------------------------------------------------------------------
-- Built-in subcommands
-- ---------------------------------------------------------------------------

local function settings()
  return ns.db and ns.db.settings
end

local function intervalText(value)
  if type(value) == "number" then return L.STATUS_INTERVAL:format(value) end
  return L.STATUS_INTERVAL_OFF
end

-- on/off subcommand bound to a boolean setting.
local function toggle(name, key, onText, offText)
  return function(args)
    local value = args:lower()
    local s = settings()
    if not s or (value ~= "on" and value ~= "off") then
      printUsage(name)
      return
    end
    s[key] = value == "on"
    ns.Print(s[key] and onText or offText)
  end
end

ns.RegisterCommand("status", function()
  local entry = ns.character
  if not entry then
    ns.Print(L.STATUS_NO_CHARACTER)
    return
  end
  local snap = type(entry.snapshot) == "table" and entry.snapshot or {}
  local level = snap.level or UnitLevel("player") or 0
  local minutes = math.floor((GetServerTime() - (ns.lastSaveAt or GetServerTime())) / 60)
  ns.Print(L.STATUS_CHARACTER:format(GetUnitName("player") or "?", level))
  ns.Print(L.STATUS_LAST_SAVE:format(minutes))
  ns.Print(intervalText(settings().interval))
  ns.Print(L.STATUS_PENDING:format(ns.PendingEventCount()))
end, L.HELP_STATUS)

ns.RegisterCommand("sync", function()
  ns.SyncNow()
end, L.HELP_SYNC)

local INTERVAL_ARGS = (function()
  local parts = {}
  for _, minutes in ipairs(ns.SYNC_INTERVALS) do parts[#parts + 1] = tostring(minutes) end
  parts[#parts + 1] = "off"
  return table.concat(parts, "||")
end)()

ns.RegisterCommand("interval", function(args)
  local value = args:lower()
  local s = settings()
  local chosen
  if value == "off" then
    chosen = "off"
  else
    for _, minutes in ipairs(ns.SYNC_INTERVALS) do
      if value == tostring(minutes) then chosen = minutes end
    end
  end
  if not s or not chosen then
    printUsage("interval")
    return
  end
  s.interval = chosen
  ns.Print(intervalText(chosen))
end, L.HELP_INTERVAL, INTERVAL_ARGS)

ns.RegisterCommand("levelprompt",
  toggle("levelprompt", "levelPrompt", L.LEVELPROMPT_ON, L.LEVELPROMPT_OFF),
  L.HELP_LEVELPROMPT, "on||off")

ns.RegisterCommand("debug",
  toggle("debug", "debug", L.DEBUG_ON, L.DEBUG_OFF),
  L.HELP_DEBUG, "on||off")

-- Reset: empties the current character's journal after a confirmation.
local RESET_POPUP = "FOREVERTRACKER_RESET"

StaticPopupDialogs[RESET_POPUP] = {
  text = L.RESET_CONFIRM,
  button1 = L.RESET_ACCEPT,
  button2 = L.RESET_CANCEL,
  OnAccept = function()
    if not ns.character then return end
    ns.character.events = {}
    ns.Print(L.RESET_DONE)
  end,
  timeout = 0,
  whileDead = true,
  hideOnEscape = true,
  preferredIndex = 3,
}

ns.RegisterCommand("reset", function()
  if not ns.character then
    ns.Print(L.STATUS_NO_CHARACTER)
    return
  end
  StaticPopup_Show(RESET_POPUP)
end, L.HELP_RESET)

ns.RegisterCommand("help", printHelp, L.HELP_HELP)
