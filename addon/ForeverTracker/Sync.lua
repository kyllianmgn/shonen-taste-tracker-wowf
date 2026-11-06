-- ForeverTracker: the "Synchroniser" window, its timer and the only ReloadUI() of the addon.
-- Spec: docs/01-spec-addon-companion.md, "Addon : synchronisation et commandes".
--
-- The game writes the SavedVariables only on logout, exit or UI reload, and
-- accepts ReloadUI() only from a click or a key press. The addon offers the
-- reload; ns.SyncNow() is called only from the window's button, the key
-- binding (Bindings.xml) and /ftr sync (Commands.lua).

local _, ns = ...
local L = ns.L

ns.SYNC_TICK = 30        -- seconds between two checks of the timer
ns.LATER_DELAY = 5 * 60  -- "Plus tard" postpones the window by this much
ns.SYNC_INTERVALS = { 10, 15, 30 } -- minutes; settings.interval may also be "off"

-- State of this session only (reset by every reload).
ns.lastSaveAt = nil        -- rule 1: GetServerTime() at PLAYER_LOGIN
local snoozeUntil          -- "Plus tard": no window before this time
local dontAsk = false      -- "Ne plus demander cette session"
local levelPending = false -- rule 4: a LEVEL_UP is waiting for the window
local ticker
local hidingForCombat = false

-- Id of the last event of each character read from the SavedVariables, to
-- count the events recorded since the file was written (/ftr status).
local savedLastEventId = {}

-- ---------------------------------------------------------------------------
-- Safe conditions
-- ---------------------------------------------------------------------------

-- Call a global API if this client has it.
local function api(name, ...)
  local fn = _G[name]
  if type(fn) ~= "function" then return nil end
  return fn(...)
end

-- Why a reload is not safe right now, or nil if it is.
function ns.UnsafeReason()
  if not ns.character then return L.REASON_NO_CHARACTER end
  if api("InCombatLockdown") or api("UnitAffectingCombat", "player") then
    return L.REASON_COMBAT
  end
  if api("IsInInstance") then return L.REASON_INSTANCE end
  if api("UnitOnTaxi", "player") then return L.REASON_TAXI end
  if api("UnitIsDeadOrGhost", "player") then return L.REASON_DEAD end
  if api("UnitCastingInfo", "player") or api("UnitChannelInfo", "player") then
    return L.REASON_CASTING
  end
  return nil
end

function ns.IsSafeToSync()
  return ns.UnsafeReason() == nil
end

-- ---------------------------------------------------------------------------
-- Sync (rule 6: callers are a click, a key binding or a typed command only)
-- ---------------------------------------------------------------------------

-- Refresh the snapshot and reload the UI, which writes the SavedVariables.
-- Says why in the chat and returns false when the conditions are not met.
function ns.SyncNow()
  local reason = ns.UnsafeReason()
  if reason then
    ns.Print(L.SYNC_REFUSED:format(reason))
    return false
  end
  ns.CollectSnapshot()
  ReloadUI()
  return true
end

-- Global entry point for Bindings.xml.
function ForeverTracker_SyncNow()
  ns.SyncNow()
end

BINDING_HEADER_FOREVERTRACKER = "ForeverTracker"
BINDING_NAME_FOREVERTRACKER_SYNC = L.BINDING_SYNC

-- ---------------------------------------------------------------------------
-- Window
-- ---------------------------------------------------------------------------

local window = CreateFrame("Frame", nil, UIParent, "BasicFrameTemplateWithInset")
ns.syncWindow = window
window:Hide()
window:SetSize(340, 130)
window:SetPoint("CENTER", UIParent, "CENTER", 0, 160)
window:SetFrameStrata("DIALOG")
window:SetClampedToScreen(true)
window:SetMovable(true)
window:EnableMouse(true)
window:RegisterForDrag("LeftButton")
window:SetScript("OnDragStart", window.StartMoving)
window:SetScript("OnDragStop", window.StopMovingOrSizing)
if window.TitleText then window.TitleText:SetText("ForeverTracker") end

window.text = window:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
window.text:SetPoint("TOP", window, "TOP", 0, -36)
window.text:SetWidth(300)
window.text:SetText(L.SYNC_PROMPT)

window.syncButton = CreateFrame("Button", nil, window, "UIPanelButtonTemplate")
window.syncButton:SetSize(130, 24)
window.syncButton:SetPoint("BOTTOMRIGHT", window, "BOTTOM", -6, 36)
window.syncButton:SetText(L.SYNC_BUTTON)
window.syncButton:SetScript("OnClick", function() ns.SyncNow() end)

window.laterButton = CreateFrame("Button", nil, window, "UIPanelButtonTemplate")
window.laterButton:SetSize(130, 24)
window.laterButton:SetPoint("BOTTOMLEFT", window, "BOTTOM", 6, 36)
window.laterButton:SetText(L.LATER_BUTTON)
window.laterButton:SetScript("OnClick", function() window:Hide() end)

window.dontAsk = CreateFrame("CheckButton", nil, window, "UICheckButtonTemplate")
window.dontAsk:SetSize(22, 22)
window.dontAsk:SetPoint("BOTTOMLEFT", window, "BOTTOMLEFT", 18, 10)
window.dontAskLabel = window:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
window.dontAskLabel:SetPoint("LEFT", window.dontAsk, "RIGHT", 2, 0)
window.dontAskLabel:SetText(L.DONT_ASK)

-- Any close other than entering combat ("Plus tard", the X button)
-- postpones the window; the checkbox stops it for the rest of the session.
window:SetScript("OnHide", function()
  if hidingForCombat then return end
  snoozeUntil = GetServerTime() + ns.LATER_DELAY
  levelPending = false
  if window.dontAsk:GetChecked() then dontAsk = true end
end)

-- ---------------------------------------------------------------------------
-- Timer (rules 2 to 4)
-- ---------------------------------------------------------------------------

local function settings()
  return ns.db and ns.db.settings or ns.DEFAULT_SETTINGS
end

local function intervalDue(now)
  local minutes = settings().interval
  if type(minutes) ~= "number" or not ns.lastSaveAt then return false end
  return now - ns.lastSaveAt >= minutes * 60
end

local function wantsWindow(now)
  if dontAsk then return false end
  if snoozeUntil and now < snoozeUntil then return false end
  if levelPending and settings().levelPrompt then return true end
  return intervalDue(now)
end

-- Show the window if it is wanted and the conditions are met.
function ns.CheckSyncPrompt()
  if not ns.character or window:IsShown() then return end
  if not wantsWindow(GetServerTime()) then return end
  if not ns.IsSafeToSync() then return end
  window:Show()
  -- So that playedTotal is fresh by the time the player clicks.
  ns.RequestPlayed()
end

-- ---------------------------------------------------------------------------
-- Pending events (/ftr status)
-- ---------------------------------------------------------------------------

-- Number of events of the current character recorded since the
-- SavedVariables were last written (i.e. not in the file yet).
function ns.PendingEventCount()
  local entry = ns.character
  local events = entry and entry.events
  if type(events) ~= "table" then return 0 end
  local mark = savedLastEventId[ns.guid]
  if mark then
    for i = #events, 1, -1 do
      local e = events[i]
      if type(e) == "table" and e.id == mark then return #events - i end
    end
  end
  return #events
end

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

-- Core's handler has just initialised ns.db with the file's content.
ns.On("ADDON_LOADED", function()
  if not ns.db then return end
  for guid, entry in pairs(ns.db.characters) do
    local events = type(entry) == "table" and entry.events
    local last = type(events) == "table" and events[#events]
    if type(last) == "table" and last.id ~= nil then
      savedLastEventId[guid] = last.id
    end
  end
end)

-- Rule 1: a login or a reload has just written the file.
ns.On("PLAYER_LOGIN", function()
  if not ns.character then return end
  ns.lastSaveAt = GetServerTime()
  if not ticker then
    ticker = C_Timer.NewTicker(ns.SYNC_TICK, ns.CheckSyncPrompt)
  end
end)

-- Rule 4.
ns.On("PLAYER_LEVEL_UP", function()
  if not settings().levelPrompt then return end
  levelPending = true
  ns.CheckSyncPrompt()
end)

-- Rule 5: hide without postponing; the window comes back once it is safe.
ns.On("PLAYER_REGEN_DISABLED", function()
  if not window:IsShown() then return end
  hidingForCombat = true
  window:Hide()
  hidingForCombat = false
end)

ns.On("PLAYER_REGEN_ENABLED", function()
  ns.CheckSyncPrompt()
end)
