-- ForeverTracker: /ftr share, the code a player without the app pastes into /sync code: on Discord.
-- Spec: docs/01-spec-addon-companion.md, "Mode de base : /ftr share".
-- Payload: contract/schemas/share-code.payload.json (the server decodes it in S-19).
--
-- code = "FT1:" .. base64url(rawDeflate(json(payload)))
--   json:      compact, object keys sorted, arrays only where the schema has arrays
--   deflate:   raw (no zlib header), LibDeflate:CompressDeflate
--   base64url: RFC 4648 section 5 alphabet, no "=" padding

local _, ns = ...
local L = ns.L

ns.SHARE_PREFIX = "FT1:"
ns.SHARE_MAX_LENGTH = 4000
-- Left out of the snapshot, in this order, while the code is too long.
ns.SHARE_DROP_ORDER = { "equipment", "reputations" }
ns.SHARE_MAX_EVENTS = 500 -- maxItems of character.events in the schema

-- ---------------------------------------------------------------------------
-- JSON
-- ---------------------------------------------------------------------------

-- Lua has a single table type: tables marked with ns.JsonArray() are written
-- as JSON arrays, every other table as an object (so {} gives "{}").
local ARRAY_MT = {}

function ns.JsonArray(t)
  return setmetatable(t or {}, ARRAY_MT)
end

local ESCAPES = {
  ['"'] = '\\"', ["\\"] = "\\\\", ["\b"] = "\\b", ["\f"] = "\\f",
  ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t",
}

local function escapeChar(c)
  return ESCAPES[c] or string.format("\\u%04x", c:byte())
end

-- UTF-8 bytes are written as they are; quotes, backslashes and control
-- characters (0-31 and 127) are escaped.
local function encodeString(s)
  return '"' .. s:gsub('[%c"\\]', escapeChar) .. '"'
end

local function encodeNumber(n)
  if n ~= n or n == math.huge or n == -math.huge then return "null" end
  -- Lua 5.1 numbers are doubles: write whole values without a decimal part.
  if n == math.floor(n) and math.abs(n) < 2 ^ 53 then
    return string.format("%.0f", n)
  end
  return string.format("%.14g", n)
end

local encodeValue

local function encodeTable(t, out)
  if getmetatable(t) == ARRAY_MT then
    out[#out + 1] = "["
    for i = 1, #t do
      if i > 1 then out[#out + 1] = "," end
      encodeValue(t[i], out)
    end
    out[#out + 1] = "]"
    return
  end
  local names, values = {}, {}
  for k, v in pairs(t) do
    local tk, tv = type(k), type(v)
    if (tk == "string" or tk == "number")
        and (tv == "string" or tv == "number" or tv == "boolean" or tv == "table") then
      local name = tostring(k)
      names[#names + 1] = name
      values[name] = v
    end
  end
  table.sort(names)
  out[#out + 1] = "{"
  for i, name in ipairs(names) do
    if i > 1 then out[#out + 1] = "," end
    out[#out + 1] = encodeString(name)
    out[#out + 1] = ":"
    encodeValue(values[name], out)
  end
  out[#out + 1] = "}"
end

encodeValue = function(v, out)
  local t = type(v)
  if t == "string" then
    out[#out + 1] = encodeString(v)
  elseif t == "number" then
    out[#out + 1] = encodeNumber(v)
  elseif t == "boolean" then
    out[#out + 1] = v and "true" or "false"
  elseif t == "table" then
    encodeTable(v, out)
  else
    out[#out + 1] = "null"
  end
end

function ns.EncodeJSON(value)
  local out = {}
  encodeValue(value, out)
  return table.concat(out)
end

-- ---------------------------------------------------------------------------
-- base64url
-- ---------------------------------------------------------------------------

local ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
local DIGITS = {}
for i = 1, 64 do DIGITS[i - 1] = ALPHABET:sub(i, i) end

local floor = math.floor

function ns.Base64Url(data)
  local out = {}
  local n = #data
  for i = 1, n - 2, 3 do
    local a, b, c = data:byte(i, i + 2)
    local v = a * 65536 + b * 256 + c
    out[#out + 1] = DIGITS[floor(v / 262144)] .. DIGITS[floor(v / 4096) % 64]
      .. DIGITS[floor(v / 64) % 64] .. DIGITS[v % 64]
  end
  local rest = n % 3
  if rest == 1 then
    local v = data:byte(n) * 65536
    out[#out + 1] = DIGITS[floor(v / 262144)] .. DIGITS[floor(v / 4096) % 64]
  elseif rest == 2 then
    local a, b = data:byte(n - 1, n)
    local v = a * 65536 + b * 256
    out[#out + 1] = DIGITS[floor(v / 262144)] .. DIGITS[floor(v / 4096) % 64]
      .. DIGITS[floor(v / 64) % 64]
  end
  return table.concat(out)
end

-- ---------------------------------------------------------------------------
-- Payload (only the fields of the schema: additionalProperties is false)
-- ---------------------------------------------------------------------------

local KEY_FIELDS = { "region", "firstName", "surname", "guid", "realmName" }

local SNAPSHOT_FIELDS = {
  "capturedAt", "level", "xp", "xpMax", "rested", "money", "playedTotal", "playedLevel",
  "zone", "subZone", "mapId", "classFile", "raceFile", "sex", "faction",
  "guild", "guildRank", "ilvl", "deaths", "honor",
}

local SNAPSHOT_LISTS = {
  equipment = { "slot", "itemId", "link" },
  professions = { "name", "rank", "max" },
  reputations = { "factionId", "name", "standing", "value", "max" },
}

local function isScalar(v)
  local t = type(v)
  return t == "string" or t == "number" or t == "boolean"
end

local function pick(source, fields)
  local out = {}
  if type(source) ~= "table" then return out end
  for _, field in ipairs(fields) do
    if isScalar(source[field]) then out[field] = source[field] end
  end
  return out
end

-- Event data is free-form in the schema: copy string keys, scalars and sub-objects.
local function copyObject(source)
  local out = {}
  for k, v in pairs(source) do
    if type(k) == "string" then
      if isScalar(v) then
        out[k] = v
      elseif type(v) == "table" then
        out[k] = copyObject(v)
      end
    end
  end
  return out
end

local function buildSnapshot(snap)
  local out = pick(snap, SNAPSHOT_FIELDS)
  if type(snap) ~= "table" then return out end
  for name, fields in pairs(SNAPSHOT_LISTS) do
    local list = snap[name]
    if type(list) == "table" then
      local items = ns.JsonArray()
      for _, item in ipairs(list) do
        if type(item) == "table" then items[#items + 1] = pick(item, fields) end
      end
      out[name] = items
    end
  end
  return out
end

-- Events at or after `since` (nil = all). The same second as the last share
-- is sent again rather than lost: the server deduplicates by id.
local function eventsSince(events, since)
  local out = ns.JsonArray()
  if type(events) ~= "table" then return out end
  for _, e in ipairs(events) do
    if type(e) == "table" and type(e.id) == "string" and type(e.type) == "string"
        and type(e.at) == "number" and (not since or e.at >= since) then
      out[#out + 1] = {
        id = e.id,
        type = e.type,
        at = e.at,
        data = type(e.data) == "table" and copyObject(e.data) or {},
      }
    end
  end
  local extra = #out - ns.SHARE_MAX_EVENTS
  if extra > 0 then
    local kept = ns.JsonArray()
    for i = extra + 1, #out do kept[#kept + 1] = out[i] end
    out = kept
  end
  return out
end

local function deflate()
  local lib = ns.LibDeflate
  -- Another addon's LibStub already held LibDeflate 1.0.2+ (libs/LibDeflate/README.md).
  if not lib and _G.LibStub then lib = _G.LibStub:GetLibrary("LibDeflate", true) end
  return lib
end

local function encodeCode(payload)
  local compressed = deflate():CompressDeflate(ns.EncodeJSON(payload), { level = 9 })
  return ns.SHARE_PREFIX .. ns.Base64Url(compressed)
end

-- Code of a character entry with the events since `since`, sent at `now`.
-- Returns the code and the list of snapshot fields left out to fit
-- ns.SHARE_MAX_LENGTH (the code may still be longer when nothing is left to drop).
function ns.BuildShareCode(entry, since, now)
  local snapshot = buildSnapshot(entry.snapshot)
  local payload = {
    sentAt = now,
    schema = ns.SCHEMA,
    addonVersion = ns.VERSION,
    character = {
      key = pick(entry.key, KEY_FIELDS),
      snapshot = snapshot,
      events = eventsSince(entry.events, since),
    },
  }
  local dropped = {}
  local code = encodeCode(payload)
  for _, field in ipairs(ns.SHARE_DROP_ORDER) do
    if #code <= ns.SHARE_MAX_LENGTH then break end
    if snapshot[field] ~= nil then
      snapshot[field] = nil
      dropped[#dropped + 1] = field
      code = encodeCode(payload)
    end
  end
  return code, dropped
end

-- ---------------------------------------------------------------------------
-- Window
-- ---------------------------------------------------------------------------

local window = CreateFrame("Frame", nil, UIParent, "BasicFrameTemplateWithInset")
ns.shareWindow = window
window:Hide()
window:SetSize(460, 250)
window:SetPoint("CENTER", UIParent, "CENTER", 0, 120)
window:SetFrameStrata("DIALOG")
window:SetClampedToScreen(true)
window:SetMovable(true)
window:EnableMouse(true)
window:RegisterForDrag("LeftButton")
window:SetScript("OnDragStart", window.StartMoving)
window:SetScript("OnDragStop", window.StopMovingOrSizing)
if window.TitleText then window.TitleText:SetText("ForeverTracker") end

window.help = window:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
window.help:SetPoint("TOPLEFT", window, "TOPLEFT", 16, -34)
window.help:SetWidth(428)
window.help:SetJustifyH("LEFT")
window.help:SetText(L.SHARE_HELP)

window.notice = window:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
window.notice:SetPoint("BOTTOMLEFT", window, "BOTTOMLEFT", 16, 12)
window.notice:SetWidth(428)
window.notice:SetJustifyH("LEFT")
window.notice:SetTextColor(1, 0.6, 0.2)

local scroll = CreateFrame("ScrollFrame", nil, window, "UIPanelScrollFrameTemplate")
scroll:SetPoint("TOPLEFT", window, "TOPLEFT", 16, -60)
scroll:SetPoint("BOTTOMRIGHT", window, "BOTTOMRIGHT", -34, 44)

local box = CreateFrame("EditBox", nil, scroll)
window.editBox = box
box:SetMultiLine(true)
box:SetAutoFocus(false)
box:SetMaxLetters(0)
box:SetWidth(400)
if ChatFontNormal then box:SetFontObject(ChatFontNormal) end
scroll:SetScrollChild(box)

-- The box is read-only: any typing puts the code back, selected.
box:SetScript("OnTextChanged", function(self, userInput)
  if userInput and window.code then
    self:SetText(window.code)
    self:HighlightText()
  end
end)
box:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
box:SetScript("OnMouseUp", function(self) self:HighlightText() end)
box:SetScript("OnEscapePressed", function() window:Hide() end)
window:SetScript("OnHide", function() box:ClearFocus() end)

local function noticeText(code, dropped)
  local lines = {}
  local left = {}
  for _, field in ipairs(dropped) do left[field] = true end
  if left.equipment and left.reputations then
    lines[#lines + 1] = L.SHARE_DROPPED_BOTH
  elseif left.equipment then
    lines[#lines + 1] = L.SHARE_DROPPED_EQUIPMENT
  elseif left.reputations then
    lines[#lines + 1] = L.SHARE_DROPPED_REPUTATIONS
  end
  if #code > ns.SHARE_MAX_LENGTH then
    lines[#lines + 1] = L.SHARE_TOO_LONG:format(#code)
  end
  return table.concat(lines, "\n")
end

local function showWindow(code, dropped)
  window.code = code
  box:SetText(code)
  window.notice:SetText(noticeText(code, dropped))
  window:Show()
  box:SetFocus()
  box:HighlightText()
end

-- ---------------------------------------------------------------------------
-- /ftr share
-- ---------------------------------------------------------------------------

function ns.ShowShare()
  local entry = ns.character
  if not entry or not ns.guid or not ns.db then
    ns.Print(L.STATUS_NO_CHARACTER)
    return
  end
  ns.CollectSnapshot()

  local db = ns.db
  if type(db.lastSharedAt) ~= "table" then db.lastSharedAt = {} end
  local since = db.lastSharedAt[ns.guid]
  if type(since) ~= "number" then since = nil end

  local now = GetServerTime()
  local code, dropped = ns.BuildShareCode(entry, since, now)
  db.lastSharedAt[ns.guid] = now
  showWindow(code, dropped)
end
